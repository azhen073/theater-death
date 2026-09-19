import { randomBytes, randomInt } from 'node:crypto';
import type { GameEvent } from '../engine/events.ts';
import { createGame } from '../engine/setup.ts';
import type { GameState } from '../engine/types.ts';
import { ROLE_IDS, type RulesetConfig } from '../rulesets/types.ts';
import { voicePermission, type VoicePermissionPush } from '../voice/policy.ts';
import type { VoiceService } from '../voice/agora.ts';
import type { Clock } from './clock.ts';
import { createDayDriver, type DayDriver } from './day-driver.ts';
import type { LogStore, StoredMessage } from './log-store.ts';
import { createNightDriver, type NightDriver } from './night-driver.ts';
import { queuedClock } from './queued-clock.ts';
import type { Broadcaster } from './realtime.ts';

export type GameDriver = NightDriver | DayDriver;

/** v1 无在线状态（无状态 cookie + 内存房间），因此以「房间无活动」判定遗弃并在超时后回收。 */
export const INACTIVE_ROOM_TTL_MS = 24 * 60 * 60_000;

export interface RoomMember {
  readonly playerId: string;
  readonly nickname: string;
  ready: boolean;
  readonly joinedAt: number;
}

/** 观战者：绑定一名玩家的只读"第二屏"，不参与对局、不占玩家席位 */
export interface RoomSpectator {
  readonly spectatorId: string;
  readonly nickname: string;
  readonly bindPlayerId: string;
  readonly joinedAt: number;
  /** 声网 uid（1000 起），用于签发语音凭证与移出语音 */
  readonly uid: number;
}

export interface ChatMessage extends StoredMessage {
  readonly channel: 'public' | 'faction';
}

export interface CommandReceipt {
  readonly requestId: string;
  readonly status: 'accepted' | 'rejected';
  readonly code: string | null;
  readonly message: string | null;
}

export type JoinResult =
  | { readonly ok: true; readonly room: Room; readonly member: RoomMember }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
    };

export type LeaveResult =
  | { readonly ok: true; readonly dissolved: boolean }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
    };

export type KickResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
    };

export type WatchResult =
  | { readonly ok: true; readonly room: Room; readonly spectator: RoomSpectator }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
    };

export class Room {
  readonly code: string;
  readonly gameId: string;
  readonly hostPlayerId: string;
  readonly ruleset: RulesetConfig;
  readonly members: RoomMember[] = [];
  readonly spectators: RoomSpectator[] = [];
  state: GameState | null = null;
  events: GameEvent[] = [];
  driver: GameDriver | null = null;
  readonly chat: ChatMessage[] = [];
  nextMessageId = 1;
  readonly receipts = new Map<string, CommandReceipt>();
  voiceClosed = false;
  /** 最近一次房间活动（任何房间 HTTP 请求或实时连接握手）；用于回收被遗弃的 v1 房间 */
  lastActivityAt = 0;
  /** 当前持有发布授权（已下发发布凭证）的玩家，用于识别权限变化 */
  readonly voiceGranted = new Set<string>();
  #queue: Promise<unknown> = Promise.resolve();
  /** v2 persistent rooms share their queue with every match and timer. */
  queueOwner: { enqueue<T>(task: () => T | Promise<T>): Promise<T> } | null = null;

  constructor(code: string, gameId: string, host: RoomMember, ruleset: RulesetConfig) {
    this.code = code;
    this.gameId = gameId;
    this.hostPlayerId = host.playerId;
    this.ruleset = structuredClone(ruleset);
    this.members.push(host);
  }

  requiredPlayerCount(): number {
    return ROLE_IDS.reduce((sum, roleId) => sum + this.ruleset.roles[roleId], 0);
  }

  enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    if (this.queueOwner) return this.queueOwner.enqueue(task);
    const result = this.#queue.then(task, task);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export interface RoomDeps {
  readonly strictWindows?: boolean;
  readonly clock: Clock;
  readonly ruleset: RulesetConfig;
  readonly logStore: LogStore;
  readonly broadcaster?: Broadcaster;
  /** 未配置语音时为 null；语音失败不影响对局流程 */
  readonly voice?: VoiceService | null;
}

export class RoomRegistry {
  readonly #deps: RoomDeps;
  readonly #roomsByCode = new Map<string, Room>();
  readonly #roomsByGameId = new Map<string, Room>();

  constructor(deps: RoomDeps) {
    this.#deps = deps;
  }

  /** A single-game runtime under a stable v2 room; legacy room lifecycle is unchanged. */
  createMatch(code: string, players: readonly { nickname: string }[], ruleset: RulesetConfig, queueOwner: Room['queueOwner']): Room {
    if (players.length === 0 || this.#roomsByCode.has(code)) throw new Error('Match room unavailable');
    const now = this.#deps.clock.now();
    const members = players.map((p) => this.#makeMember(p.nickname));
    const room = new Room(code, `g_${randomBytes(16).toString('hex')}`, members[0]!, ruleset);
    room.members.push(...members.slice(1));
    room.queueOwner = queueOwner;
    room.lastActivityAt = now;
    this.#roomsByCode.set(code, room);
    this.#roomsByGameId.set(room.gameId, room);
    this.#deps.logStore.recordRoom({ gameId: room.gameId, code, createdAt: now, ruleset });
    return room;
  }

  createRoom(
    nickname: string,
    ruleset: RulesetConfig = this.#deps.ruleset,
  ): { room: Room; member: RoomMember } {
    const code = this.#generateCode();
    const gameId = `g_${randomBytes(8).toString('hex')}`;
    const now = this.#deps.clock.now();
    const member = this.#makeMember(nickname);
    const room = new Room(code, gameId, member, ruleset);
    room.lastActivityAt = now;
    this.#roomsByCode.set(code, room);
    this.#roomsByGameId.set(gameId, room);
    this.#deps.logStore.recordRoom({
      gameId,
      code,
      createdAt: now,
      ruleset,
    });
    return { room, member };
  }

  joinRoom(code: string, nickname: string): JoinResult {
    const room = this.#roomsByCode.get(code);
    if (room === undefined) {
      return { ok: false, status: 404, code: 'room_not_found', message: '房间不存在' };
    }
    if (room.state !== null) {
      return { ok: false, status: 409, code: 'room_started', message: '对局已经开始，不能加入' };
    }
    if (room.members.length >= room.requiredPlayerCount()) {
      return { ok: false, status: 409, code: 'room_full', message: '房间已满' };
    }
    const member = this.#makeMember(nickname);
    room.members.push(member);
    return { ok: true, room, member };
  }

  /**
   * 观战加入：绑定一名玩家（每个玩家最多一名观众），大厅/对局/终局均可加入。
   * 观战者只读，不占玩家席位、不影响开局人数校验。
   */
  watchRoom(code: string, nickname: string, bindPlayerId: string): WatchResult {
    const room = this.#roomsByCode.get(code);
    if (room === undefined) {
      return { ok: false, status: 404, code: 'room_not_found', message: '房间不存在' };
    }
    const target = room.members.find((item) => item.playerId === bindPlayerId);
    if (target === undefined) {
      return { ok: false, status: 404, code: 'player_not_found', message: '要绑定观战的玩家不在该房间' };
    }
    if (room.spectators.some((item) => item.bindPlayerId === bindPlayerId)) {
      return {
        ok: false,
        status: 409,
        code: 'player_already_watched',
        message: '该玩家已有一名观众',
      };
    }
    const spectator: RoomSpectator = {
      spectatorId: `s_${randomBytes(8).toString('hex')}`,
      nickname,
      bindPlayerId,
      joinedAt: this.#deps.clock.now(),
      uid: this.#nextSpectatorUid(room),
    };
    room.spectators.push(spectator);
    return { ok: true, room, spectator };
  }

  /** 观战者 uid 从 1000 起顺序分配（与玩家座位号 1-13 区隔，稳定用于签发凭证与移出语音） */
  #nextSpectatorUid(room: Room): number {
    const used = new Set(room.spectators.map((item) => item.uid));
    let uid = 1000;
    while (used.has(uid)) {
      uid += 1;
    }
    return uid;
  }

  removeSpectator(room: Room, spectatorId: string): boolean {
    const index = room.spectators.findIndex((item) => item.spectatorId === spectatorId);
    if (index === -1) {
      return false;
    }
    room.spectators.splice(index, 1);
    return true;
  }

  /**
   * 离开房间。大厅：普通成员释放席位、房主解散整房。
   * 终局后：任何人（含房主）都只释放自己的席位，房主先走不会夺走其他人的复盘；
   * 移除后房间空了才销毁（避免终局房间常驻内存）。对局进行中一律拒绝。
   */
  leaveRoom(room: Room, playerId: string): LeaveResult {
    const ended = room.state !== null && room.state.phase === 'ended';
    if (room.state !== null && !ended) {
      return { ok: false, status: 409, code: 'game_started', message: '对局已经开始，不能退出' };
    }
    if (!ended && playerId === room.hostPlayerId) {
      this.#roomsByCode.delete(room.code);
      this.#roomsByGameId.delete(room.gameId);
      return { ok: true, dissolved: true };
    }
    const index = room.members.findIndex((item) => item.playerId === playerId);
    if (index === -1) {
      return { ok: false, status: 404, code: 'not_a_member', message: '你不在这个房间里' };
    }
    this.#removeMemberWithSpectator(room, playerId);
    if (ended && room.members.length === 0) {
      this.#roomsByCode.delete(room.code);
      this.#roomsByGameId.delete(room.gameId);
      return { ok: true, dissolved: true };
    }
    return { ok: true, dissolved: false };
  }

  /** 房主移出成员：仅未开局可用；被移出者释放席位、可重新加入（踢人 = 清位，不做拉黑） */
  kickMember(room: Room, targetPlayerId: string): KickResult {
    if (room.state !== null) {
      return { ok: false, status: 409, code: 'game_started', message: '对局已经开始，不能移出成员' };
    }
    if (targetPlayerId === room.hostPlayerId) {
      return {
        ok: false,
        status: 409,
        code: 'cannot_kick_self',
        message: '房主不能移出自己；如要结束请解散房间',
      };
    }
    const index = room.members.findIndex((item) => item.playerId === targetPlayerId);
    if (index === -1) {
      return { ok: false, status: 404, code: 'not_a_member', message: '目标不在房间成员中' };
    }
    this.#removeMemberWithSpectator(room, targetPlayerId);
    return { ok: true };
  }

  /** 房主移出观战者：不限阶段（观战不影响对局），其绑定的玩家不受影响 */
  kickSpectator(room: Room, spectatorId: string): KickResult {
    const index = room.spectators.findIndex((item) => item.spectatorId === spectatorId);
    if (index === -1) {
      return { ok: false, status: 404, code: 'not_a_spectator', message: '目标不在观战名单中' };
    }
    room.spectators.splice(index, 1);
    return { ok: true };
  }

  #removeMemberWithSpectator(room: Room, playerId: string): void {
    const index = room.members.findIndex((item) => item.playerId === playerId);
    if (index !== -1) {
      room.members.splice(index, 1);
    }
    const spectatorIndex = room.spectators.findIndex((item) => item.bindPlayerId === playerId);
    if (spectatorIndex !== -1) {
      room.spectators.splice(spectatorIndex, 1);
    }
  }

  startGame(room: Room): GameState {
    if (room.state !== null) {
      throw new Error('对局已经开始');
    }
    const result = createGame({
      gameId: room.gameId,
      ruleset: room.ruleset,
      players: room.members.map((member) => ({
        playerId: member.playerId,
        nickname: member.nickname,
      })),
      seed: randomInt(1, 2 ** 31),
    });
    room.state = result.state;
    this.#step(room, result);
    this.#startNight(room, result.state);
    return room.state ?? result.state;
  }

  #step(room: Room, result: { state: GameState; events: readonly GameEvent[] }): void {
    room.state = result.state;
    room.events.push(...result.events);
    this.#deps.logStore.appendEvents(room.gameId, result.events);
    this.#deps.broadcaster?.emitGameEvents(room.gameId, result.events, result.state);
    this.#afterStep(room);
  }

  /**
   * 每次状态推进后：广播每人自己的语音许可。
   * 声网模式下发布权编码在短期 token 中：获得发言权时附带发布凭证、
   * 失去时附带订阅凭证（前端 renewToken 即时降权），token 到期自动兜底收回。
   */
  #afterStep(room: Room): void {
    const state = room.state;
    if (state === null) {
      return;
    }
    const voice = this.#deps.voice ?? null;

    if (state.win !== null) {
      if (voice !== null && !room.voiceClosed) {
        room.voiceClosed = true;
        void voice.closeRoom(room.gameId).catch((error: unknown) => {
          console.warn(`[theater-death] 关闭语音房间失败：${String(error)}`);
        });
      }
      room.voiceGranted.clear();
      const finalPushes = new Map<string, VoicePermissionPush>();
      for (const player of state.players) {
        finalPushes.set(player.playerId, {
          permission: voicePermission(state, player.playerId),
        });
      }
      this.#deps.broadcaster?.emitVoicePermission(room.gameId, finalPushes);
      return;
    }

    const pushes = new Map<string, VoicePermissionPush>();
    for (const player of state.players) {
      const permission = voicePermission(state, player.playerId);
      const granted = room.voiceGranted.has(player.playerId);
      if (voice === null || permission.canPublish === granted) {
        pushes.set(player.playerId, { permission });
        continue;
      }
      const token = permission.canPublish
        ? voice.issuePublishGrant({ roomName: room.gameId, uid: player.seat }).token
        : voice.issueSubscriberGrant({ roomName: room.gameId, uid: player.seat }).token;
      if (permission.canPublish) {
        room.voiceGranted.add(player.playerId);
      } else {
        room.voiceGranted.delete(player.playerId);
      }
      pushes.set(player.playerId, { permission, token });
    }
    this.#deps.broadcaster?.emitVoicePermission(room.gameId, pushes);
  }

  #startNight(room: Room, state: GameState): void {
    const driver = createNightDriver({
      strictWindows: this.#deps.strictWindows,
      clock: this.#deps.strictWindows ? queuedClock(this.#deps.clock, (task) => room.enqueue(task)) : this.#deps.clock,
      onStep: (step) => this.#step(room, step),
      onComplete: (next) => {
        if (next.phase === 'day') {
          this.#startDay(room, next);
        }
      },
    });
    driver.start(state);
    room.driver = driver;
  }

  #startDay(room: Room, state: GameState): void {
    const driver = createDayDriver({
      strictWindows: this.#deps.strictWindows,
      clock: this.#deps.strictWindows ? queuedClock(this.#deps.clock, (task) => room.enqueue(task)) : this.#deps.clock,
      onStep: (step) => this.#step(room, step),
      onComplete: (next) => {
        if (next.phase === 'night') {
          this.#startNight(room, next);
        }
      },
    });
    driver.start(state);
    room.driver = driver;
  }

  logMessage(room: Room, message: ChatMessage): void {
    this.#deps.logStore.appendMessage(room.gameId, message);
  }

  getByCode(code: string): Room | null {
    return this.#roomsByCode.get(code) ?? null;
  }

  getByGameId(gameId: string): Room | null {
    return this.#roomsByGameId.get(gameId) ?? null;
  }

  /** Called by v2 lifecycle policy only after it has selected an eligible idle/ended room. Audit rows stay intact. */
  disposeRoom(gameId: string): void {
    const room = this.#roomsByGameId.get(gameId);
    if (!room) return;
    room.driver?.dispose();
    room.driver = null;
    this.#roomsByCode.delete(room.code);
    this.#roomsByGameId.delete(gameId);
  }

  /**
   * 回收被遗弃的 v1 房间：超过 ttlMs 没有任何房间请求或实时握手即销毁（成员下次请求拿到 404 回入口页）。
   * v2 稳定房间由 StableRoom/EmptyRooms 管理（queueOwner 非空），这里跳过，避免两套生命周期互相拆台。
   */
  sweepInactive(now: number, ttlMs: number): Room[] {
    const reclaimed: Room[] = [];
    for (const room of [...this.#roomsByCode.values()]) {
      if (room.queueOwner !== null) continue;
      if (now - room.lastActivityAt < ttlMs) continue;
      this.disposeRoom(room.gameId);
      reclaimed.push(room);
    }
    return reclaimed;
  }

  #makeMember(nickname: string): RoomMember {
    return {
      playerId: `p_${randomBytes(8).toString('hex')}`,
      nickname,
      ready: false,
      joinedAt: this.#deps.clock.now(),
    };
  }

  #generateCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) {
      const bytes = randomBytes(6);
      let code = '';
      for (const byte of bytes) {
        code += alphabet[byte % alphabet.length];
      }
      if (!this.#roomsByCode.has(code)) {
        return code;
      }
    }
  }
}
