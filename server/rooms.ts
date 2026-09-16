import { randomBytes, randomInt } from 'node:crypto';
import type { GameEvent } from '../engine/events.ts';
import { createGame } from '../engine/setup.ts';
import type { GameState } from '../engine/types.ts';
import { ROLE_IDS, type RulesetConfig } from '../rulesets/types.ts';
import type { Clock } from './clock.ts';
import { createDayDriver, type DayDriver } from './day-driver.ts';
import type { LogStore, StoredMessage } from './log-store.ts';
import { createNightDriver, type NightDriver } from './night-driver.ts';
import type { Broadcaster } from './realtime.ts';

export type GameDriver = NightDriver | DayDriver;

export interface RoomMember {
  readonly playerId: string;
  readonly nickname: string;
  ready: boolean;
  readonly joinedAt: number;
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

export class Room {
  readonly code: string;
  readonly gameId: string;
  readonly hostPlayerId: string;
  readonly ruleset: RulesetConfig;
  readonly members: RoomMember[] = [];
  state: GameState | null = null;
  events: GameEvent[] = [];
  driver: GameDriver | null = null;
  readonly chat: ChatMessage[] = [];
  nextMessageId = 1;
  readonly receipts = new Map<string, CommandReceipt>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(code: string, gameId: string, host: RoomMember, ruleset: RulesetConfig) {
    this.code = code;
    this.gameId = gameId;
    this.hostPlayerId = host.playerId;
    this.ruleset = ruleset;
    this.members.push(host);
  }

  requiredPlayerCount(): number {
    return ROLE_IDS.reduce((sum, roleId) => sum + this.ruleset.roles[roleId], 0);
  }

  enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    const result = this.#queue.then(task, task);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export interface RoomDeps {
  readonly clock: Clock;
  readonly ruleset: RulesetConfig;
  readonly logStore: LogStore;
  readonly broadcaster?: Broadcaster;
}

export class RoomRegistry {
  readonly #deps: RoomDeps;
  readonly #roomsByCode = new Map<string, Room>();
  readonly #roomsByGameId = new Map<string, Room>();

  constructor(deps: RoomDeps) {
    this.#deps = deps;
  }

  createRoom(
    nickname: string,
    ruleset: RulesetConfig = this.#deps.ruleset,
  ): { room: Room; member: RoomMember } {
    const code = this.#generateCode();
    const gameId = `g_${randomBytes(8).toString('hex')}`;
    const member = this.#makeMember(nickname);
    const room = new Room(code, gameId, member, ruleset);
    this.#roomsByCode.set(code, room);
    this.#roomsByGameId.set(gameId, room);
    this.#deps.logStore.recordRoom({
      gameId,
      code,
      createdAt: this.#deps.clock.now(),
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

  leaveRoom(room: Room, playerId: string): LeaveResult {
    if (room.state !== null) {
      return { ok: false, status: 409, code: 'game_started', message: '对局已经开始，不能退出' };
    }
    if (playerId === room.hostPlayerId) {
      this.#roomsByCode.delete(room.code);
      this.#roomsByGameId.delete(room.gameId);
      return { ok: true, dissolved: true };
    }
    const index = room.members.findIndex((item) => item.playerId === playerId);
    if (index === -1) {
      return { ok: false, status: 404, code: 'not_a_member', message: '你不在这个房间里' };
    }
    room.members.splice(index, 1);
    return { ok: true, dissolved: false };
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
  }

  #startNight(room: Room, state: GameState): void {
    const driver = createNightDriver({
      clock: this.#deps.clock,
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
      clock: this.#deps.clock,
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
