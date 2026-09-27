import type { VoiceCredentials, VoiceService } from '../../voice/agora.ts';
import type { RoomAccess } from './access.ts';
import { roomVoiceChannel, roomVoiceMembers, type RoomVoiceSource } from './room-voice.ts';
import { gameView } from './view.ts';
import { ApiError } from './errors.ts';

/** 接收端上报的播放状态（C 组送达回执） */
export type DeliveryState = 'playing' | 'blocked' | 'silent-output' | 'failed';
export const DELIVERY_STATES: readonly DeliveryState[] = ['playing', 'blocked', 'silent-output', 'failed'];
/** 当前发言窗口的送达聚合：分母是「上报过的接收端数」，不是频道人数 */
export interface DeliveryView {
  windowInstanceId: string; delivered: number; blocked: number; silentOutput: number; failed: number; listeners: number; updatedAt: number;
}
interface DeliveryWindow { windowInstanceId: string; speakerMediaIds: readonly string[]; startedAt: number; receipts: Map<string, DeliveryState>; lastPushAt: number }

/**
 * 一个语音范围（Q-12）：要么是**对局频道**（`channel = gameId`，权限来自 R-43/Q-11），
 * 要么是**房间频道**（大厅 / 复盘，正式成员自由开麦）。媒体侧只认这个描述，
 * 于是两种范围共用同一套签发 / 回收 / 对账实现，不再复制。
 */
export interface VoiceScope {
  readonly channel: string;
  /** 媒体身份 → 是否持有发布权（听众与第二屏也在表内，值为 false，避免被误踢）。 */
  readonly members: ReadonlyMap<string, boolean>;
  /** 范围已终结（对局结束 / 房间解散）→ `sync` 关闭频道。 */
  readonly ended: boolean;
  /** 仅对局频道提供：发言窗口与送达回执都只在对局内存在；房间频道为 null。 */
  readonly match: RoomAccess | null;
}

/**
 * 拥有发布权的窗口（与客户端 `bar.tsx` 的判据保持一致）。
 * `free_speech` 是「存活玩家可开麦」的阶段：发布者可能有多人。
 */
const SPEAKING_WINDOWS = new Set(['election_speech', 'speech_round', 'last_words', 'tie_speech', 'free_speech']);
/** D 组对账：每轮最多踢的人数，避免一次异常把频道清空 */
const RECONCILE_KICK_LIMIT = 3;
/**
 * 送达聚合变化的推送节流：收据可能每秒到达，若逐条 refresh 会造成快照风暴
 * （realtime 每次 refresh 会为每个 socket 重建视图）。1 秒一帧足够人眼使用。
 */
const DELIVERY_PUSH_INTERVAL_MS = 1000;

/** Serialize media side effects without blocking the game queue. Resolve current leases at execution time. */
export class V2Media {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly closed = new Set<string>();
  private readonly identities = new Map<string, Map<string, number>>();
  private readonly deliveries = new Map<string, DeliveryWindow>();
  private reconcileStats = { rounds: 0, lastAt: 0, notInChannel: 0, unknownKicks: 0, failures: 0, skipped: 0 };
  private nextUid = 1;
  readonly voice: VoiceService | null;
  private readonly now: () => number;
  constructor(voice: VoiceService | null, now: () => number) { this.voice = voice; this.now = now; }
  private enqueue(gameId: string, work: () => Promise<void>, required = false): Promise<void> {
    const previous = this.pending.get(gameId) ?? Promise.resolve();
    const run = previous.then(work);
    const settled = run.catch((error) => {
      console.warn('voice_service_unavailable');
      if (required) throw error;
    });
    // 队列本身永不 reject：否则下一次入队的 work 会被 .then 跳过（静默丢失一次踢人/关房）。
    const chain = settled.then(() => undefined, () => undefined);
    this.pending.set(gameId, chain);
    const cleanup = () => { if (this.pending.get(gameId) === chain) this.pending.delete(gameId); };
    void chain.then(cleanup, cleanup);
    return settled;
  }
  /** Agora uid is numeric; map every media identity to a stable channel uid for kick operations. */
  private uidFor(gameId: string, identity: string): number {
    const known = this.identities.get(gameId) ?? new Map<string, number>();
    const existing = known.get(identity);
    if (existing !== undefined) return existing;
    const uid = this.nextUid;
    this.nextUid += 1;
    known.set(identity, uid);
    this.identities.set(gameId, known);
    return uid;
  }
  /**
   * 频道 uid → 语音主体的映射，供客户端把远端音量归属到座位 / 成员卡（显示「谁在说话」）。
   * 身份形如 `v2:<channel>:<subject>:<epoch>`；对局频道里 subject 是 `p_`（playerId），
   * 房间频道里是 `m_`（memberId，大厅/复盘还没有 playerId）。观众/第二屏的租约 id 不是主体，不暴露。
   * 该映射不含隐藏信息：uid 本就是频道内可见的编号。
   */
  uidMap(channel: string): Record<string, string> {
    const known = this.identities.get(channel);
    if (!known) return {};
    const map: Record<string, string> = {};
    for (const [identity, uid] of known) {
      const parts = identity.split(':');
      const subject = parts.length >= 4 ? parts[2] : '';
      if (subject === undefined || !(subject.startsWith('p_') || subject.startsWith('m_'))) continue;
      map[String(uid)] = subject;
    }
    return map;
  }
  revoke(gameId: string, identity: string) {
    return this.enqueue(gameId, async () => {
      const known = this.identities.get(gameId);
      const uid = known?.get(identity);
      if (uid === undefined) return;
      // 先踢成功再删映射：REST 失败时保留，交给下一次 sync 重试（一次性踢出在断连时会失败）。
      await this.voice?.removeParticipant(gameId, uid);
      known!.delete(identity);
    });
  }
  /**
   * 当前"有人有发布权"的窗口（窗口实例 + **所有**有发布权的媒体身份）。没有正在发言的人时返回 null。
   * 常规时段只有当前发言者一人有发布权；「自由发言」阶段存活玩家都有，因此这里按集合处理：
   * 送达聚合只以窗口实例为 key，且任何发布者自己的回执都不算（那是自证）。
   */
  private currentWindow(meta: RoomAccess): { windowInstanceId: string; speakerMediaIds: readonly string[] } | null {
    const state = meta.room.state;
    if (!state || state.win) return null;
    const view = gameView(meta.room, { subjectPlayerId: null, readOnly: true }, this.now());
    const window = view.windows.find((w) => SPEAKING_WINDOWS.has(w.id) && typeof w.instanceId === 'string' && w.instanceId !== '');
    if (!window || typeof window.instanceId !== 'string') return null;
    const speakers = [...this.permissions(meta)].filter(([, canPublish]) => canPublish).map(([identity]) => identity).sort();
    if (!speakers.length) return null;
    return { windowInstanceId: window.instanceId, speakerMediaIds: speakers };
  }
  private sameSpeakers(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  private windowFor(gameId: string, meta: RoomAccess): DeliveryWindow | null {
    const current = this.currentWindow(meta);
    if (current === null) { this.deliveries.delete(gameId); return null; }
    const existing = this.deliveries.get(gameId);
    if (existing && existing.windowInstanceId === current.windowInstanceId && this.sameSpeakers(existing.speakerMediaIds, current.speakerMediaIds)) return existing;
    const next: DeliveryWindow = { ...current, startedAt: this.now(), receipts: new Map(), lastPushAt: 0 };
    this.deliveries.set(gameId, next);
    return next;
  }
  private deliveryView(window: DeliveryWindow): DeliveryView {
    let delivered = 0, blocked = 0, silentOutput = 0, failed = 0;
    for (const state of window.receipts.values()) {
      if (state === 'playing') delivered += 1;
      else if (state === 'blocked') blocked += 1;
      else if (state === 'silent-output') silentOutput += 1;
      else failed += 1;
    }
    return { windowInstanceId: window.windowInstanceId, delivered, blocked, silentOutput, failed, listeners: window.receipts.size, updatedAt: this.now() };
  }
  /**
   * 记录一条接收端回执。身份一律由服务端从会话解析后传入，客户端自报被忽略；
   * 只接受「当前窗口 + 当前有效的媒体身份」，且发言者自己的回执不算（那是自证）。
   * `push` 表示聚合发生了变化且距上次推送已达节流窗口，调用方据此决定是否刷新快照。
   */
  recordReceipt(meta: RoomAccess, receiverIdentity: string, windowInstanceId: string, state: DeliveryState): { recorded: boolean; push: boolean; delivery: DeliveryView | null } {
    const gameId = meta.room.gameId;
    const window = this.windowFor(gameId, meta);
    if (window === null || window.windowInstanceId !== windowInstanceId) return { recorded: false, push: false, delivery: null };
    if (window.speakerMediaIds.includes(receiverIdentity)) return { recorded: false, push: false, delivery: this.deliveryView(window) };
    if (!this.permissions(meta).has(receiverIdentity)) return { recorded: false, push: false, delivery: this.deliveryView(window) };
    const previous = window.receipts.get(receiverIdentity);
    window.receipts.set(receiverIdentity, state);
    const changed = previous !== state;
    const push = changed && this.now() - window.lastPushAt >= DELIVERY_PUSH_INTERVAL_MS;
    if (push) window.lastPushAt = this.now();
    return { recorded: true, push, delivery: this.deliveryView(window) };
  }
  deliveryFor(gameId: string): DeliveryView | null {
    const window = this.deliveries.get(gameId);
    return window ? this.deliveryView(window) : null;
  }
  /**
   * D 组轮询对账：把「我们发过凭证的身份」与「声网频道里真实在线的 uid」对齐。
   * 官方 REST **查不到是否在发流**，因此这里只做两件事：
   *   ① 踢掉频道里我们不认识的 uid（旧凭证/异常入频）；
   *   ② 统计"该在却不在"的身份数（供诊断）。
   * 注意：不可据此踢"有身份但在线"的人——听众同样合法在线，踢了会把人踢出语音。
   */
  reconcile(scope: VoiceScope): Promise<void> {
    const voice = this.voice;
    const queryChannelUsers = voice?.queryChannelUsers?.bind(voice);
    if (voice === null || queryChannelUsers === undefined) { this.reconcileStats.skipped += 1; return Promise.resolve(); }
    const channel = scope.channel;
    const known = this.identities.get(channel);
    if (!known || known.size === 0) { this.reconcileStats.skipped += 1; return Promise.resolve(); }
    return this.enqueue(channel, async () => {
      let query;
      try {
        query = await queryChannelUsers(channel);
      } catch (error) {
        this.reconcileStats = { ...this.reconcileStats, failures: this.reconcileStats.failures + 1, lastAt: this.now() };
        // 以前这里只计数不留原因：真实环境对账失败时无法判断是凭据、区域地址还是响应形状问题
        console.warn('voice_reconcile_query_failed', error instanceof Error ? error.message : String(error));
        return; // 媒体失败不改变胜负、不暂停计时
      }
      const present = new Set(query.users);
      const knownUids = new Set(known.values());
      let kicks = 0;
      for (const uid of present) {
        if (knownUids.has(uid) || kicks >= RECONCILE_KICK_LIMIT) continue;
        try { await voice.removeParticipant(channel, uid); kicks += 1; } catch { this.reconcileStats = { ...this.reconcileStats, failures: this.reconcileStats.failures + 1 }; }
      }
      let missing = 0;
      for (const uid of known.values()) if (!present.has(uid)) missing += 1;
      this.reconcileStats = { rounds: this.reconcileStats.rounds + 1, lastAt: this.now(), notInChannel: missing, unknownKicks: this.reconcileStats.unknownKicks + kicks, failures: this.reconcileStats.failures, skipped: this.reconcileStats.skipped };
    });
  }
  reconcileSnapshot() { return { ...this.reconcileStats }; }
  /**
   * 对局频道范围：权限**逐字沿用既有对局口径**（`capabilities.canPublishVoice`，含
   * 「窗口未开启即无发布权」的细化），大厅/复盘的房间频道才用 `roomVoicePermission`。
   */
  matchScope(meta: RoomAccess): VoiceScope {
    const members = new Map<string, boolean>();
    const ended = Boolean(meta.room.state?.win);
    if (!ended) {
      for (const [playerId, lease] of meta.seats) {
        if (!lease.sessionId || !meta.accounts.sessionActive(lease.sessionId)) continue;
        const canPublish = gameView(meta.room, { subjectPlayerId: playerId, readOnly: false }, this.now()).capabilities?.canPublishVoice ?? false;
        members.set(meta.mediaId(playerId, lease.epoch), canPublish);
      }
      for (const watcher of meta.watchers.values()) if (meta.accounts.sessionActive(watcher.sessionId)) members.set(meta.mediaId(watcher.id, watcher.epoch), false);
    }
    return { channel: meta.room.gameId, members, ended, match: meta };
  }
  /** 房间频道范围（大厅 / 复盘）：正式成员自由开麦，观众与第二屏只订阅。 */
  roomScope(room: RoomVoiceSource): VoiceScope {
    const channel = roomVoiceChannel(room.roomId);
    return { channel, members: roomVoiceMembers(channel, room.members.values()), ended: false, match: null };
  }
  /** 兼容既有调用点：对局频道的身份表。 */
  permissions(meta: RoomAccess): Map<string, boolean> { return new Map(this.matchScope(meta).members); }
  scopePermissions(scope: VoiceScope): Map<string, boolean> { return new Map(scope.members); }
  /**
   * Agora encodes publish rights in the token and offers no live permission update,
   * so alignment means: close the channel after the scope ends, or kick identities
   * whose lease is no longer live.
   */
  sync(scope: VoiceScope, required = false) {
    if (!this.voice) return Promise.resolve();
    return this.enqueue(scope.channel, async () => {
      const channel = scope.channel;
      // 没有正在发言的人（或对局已结束）→ 送达聚合作废；发言窗口换了 → 旧窗口计数同样作废
      const current = scope.match === null ? null : this.currentWindow(scope.match);
      const stale = this.deliveries.get(channel);
      if (scope.ended || current === null || (stale !== undefined && stale.windowInstanceId !== current.windowInstanceId)) this.deliveries.delete(channel);
      if (scope.ended) {
        if (!this.closed.has(channel)) { await this.voice!.closeRoom(channel); this.closed.add(channel); }
        return;
      }
      const allowed = scope.members;
      const known = this.identities.get(channel);
      if (!known) return;
      let failures = 0;
      for (const [identity, uid] of [...known]) {
        if (allowed.has(identity)) continue;
        try {
          await this.voice!.removeParticipant(channel, uid);
          known.delete(identity);
        } catch {
          // 保留映射，下一次 sync 重试；单个失败不影响其余身份的回收
          failures += 1;
        }
      }
      if (failures > 0) throw new Error(`voice_remove_failed:${failures}`);
    }, required);
  }
  /**
   * 签发凭证：权限由范围给出。调用方负责解析身份（不信任载荷），
   * 并在签发后复核身份是否仍然有效（`revalidate`）。
   */
  async issue(scope: VoiceScope, identity: string): Promise<VoiceCredentials> {
    if (!this.voice) throw new ApiError(409, 'voice_disabled');
    if (scope.ended) throw new ApiError(409, 'voice_unavailable');
    const channel = scope.channel;
    const uid = this.uidFor(channel, identity);
    const canPublish = scope.members.get(identity) ?? false;
    try {
      const base = this.voice.issueCredentials({ roomName: channel, uid });
      return {
        ...base,
        token: canPublish
          ? this.voice.issuePublishGrant({ roomName: channel, uid }).token
          : this.voice.issueSubscriberGrant({ roomName: channel, uid }).token,
      };
    } catch {
      throw new ApiError(503, 'voice_unavailable');
    }
  }
  /** 签发后复核：身份或范围发生变化（换座/接管/对局结束）→ 立即撤销并拒绝。 */
  async revalidate(scope: VoiceScope, identity: string, stillValid: boolean): Promise<void> {
    if (stillValid && !scope.ended) return;
    await this.revoke(scope.channel, identity);
    throw new ApiError(403, 'authorization_changed');
  }
  async joined(scope: VoiceScope | undefined, identity: string) {
    if (!scope || !scope.members.has(identity)) await this.revoke(scope?.channel ?? this.channelOf(identity), identity);
  }
  /** 兜底：从身份串里取回频道名（`v2:<channel>:<subject>:<epoch>`）。 */
  private channelOf(identity: string): string { const parts = identity.split(':'); return parts.length >= 4 ? parts[1]! : identity; }
  closeRoom(gameId: string) {
    return this.enqueue(gameId, async () => {
      await this.voice?.closeRoom(gameId);
      this.closed.delete(gameId);
      this.identities.delete(gameId);
      this.deliveries.delete(gameId);
    });
  }
  async drain() { await Promise.all(this.pending.values()); }
}
