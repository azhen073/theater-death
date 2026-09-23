import type { VoiceCredentials, VoiceService } from '../../voice/agora.ts';
import type { AccountSession } from './account-store.ts';
import type { RoomAccess } from './access.ts';
import { gameView } from './view.ts';
import { ApiError } from './errors.ts';

/** 接收端上报的播放状态（C 组送达回执） */
export type DeliveryState = 'playing' | 'blocked' | 'silent-output' | 'failed';
export const DELIVERY_STATES: readonly DeliveryState[] = ['playing', 'blocked', 'silent-output', 'failed'];
/** 当前发言窗口的送达聚合：分母是「上报过的接收端数」，不是频道人数 */
export interface DeliveryView {
  windowInstanceId: string; delivered: number; blocked: number; silentOutput: number; failed: number; listeners: number; updatedAt: number;
}
interface DeliveryWindow { windowInstanceId: string; speakerMediaId: string; startedAt: number; receipts: Map<string, DeliveryState>; lastPushAt: number }

/** 拥有发布权的窗口（与客户端 `bar.tsx` 的判据保持一致） */
const SPEAKING_WINDOWS = new Set(['election_speech', 'speech_round', 'last_words', 'tie_speech']);
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
   * 当前"有人有发布权"的窗口（窗口实例 + 该身份的媒体 id）。没有正在发言的人时返回 null。
   * 只用来给送达聚合定 key：窗口实例变化即视为新一轮，旧计数作废。
   */
  private currentWindow(meta: RoomAccess): { windowInstanceId: string; speakerMediaId: string } | null {
    const state = meta.room.state;
    if (!state || state.win) return null;
    const view = gameView(meta.room, { subjectPlayerId: null, readOnly: true }, this.now());
    const window = view.windows.find((w) => SPEAKING_WINDOWS.has(w.id) && typeof w.instanceId === 'string' && w.instanceId !== '');
    if (!window || typeof window.instanceId !== 'string') return null;
    for (const [identity, canPublish] of this.permissions(meta)) if (canPublish) return { windowInstanceId: window.instanceId, speakerMediaId: identity };
    return null;
  }
  private windowFor(gameId: string, meta: RoomAccess): DeliveryWindow | null {
    const current = this.currentWindow(meta);
    if (current === null) { this.deliveries.delete(gameId); return null; }
    const existing = this.deliveries.get(gameId);
    if (existing && existing.windowInstanceId === current.windowInstanceId && existing.speakerMediaId === current.speakerMediaId) return existing;
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
    if (receiverIdentity === window.speakerMediaId) return { recorded: false, push: false, delivery: this.deliveryView(window) };
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
  reconcile(meta: RoomAccess): Promise<void> {
    const voice = this.voice;
    const queryChannelUsers = voice?.queryChannelUsers?.bind(voice);
    if (voice === null || queryChannelUsers === undefined) { this.reconcileStats.skipped += 1; return Promise.resolve(); }
    const gameId = meta.room.gameId;
    const known = this.identities.get(gameId);
    if (!known || known.size === 0) { this.reconcileStats.skipped += 1; return Promise.resolve(); }
    return this.enqueue(gameId, async () => {
      let query;
      try {
        query = await queryChannelUsers(gameId);
      } catch {
        this.reconcileStats = { ...this.reconcileStats, failures: this.reconcileStats.failures + 1, lastAt: this.now() };
        return; // 媒体失败不改变胜负、不暂停计时
      }
      const present = new Set(query.users);
      const knownUids = new Set(known.values());
      let kicks = 0;
      for (const uid of present) {
        if (knownUids.has(uid) || kicks >= RECONCILE_KICK_LIMIT) continue;
        try { await voice.removeParticipant(gameId, uid); kicks += 1; } catch { this.reconcileStats = { ...this.reconcileStats, failures: this.reconcileStats.failures + 1 }; }
      }
      let missing = 0;
      for (const uid of known.values()) if (!present.has(uid)) missing += 1;
      this.reconcileStats = { rounds: this.reconcileStats.rounds + 1, lastAt: this.now(), notInChannel: missing, unknownKicks: this.reconcileStats.unknownKicks + kicks, failures: this.reconcileStats.failures, skipped: this.reconcileStats.skipped };
    });
  }
  reconcileSnapshot() { return { ...this.reconcileStats }; }
  permissions(meta: RoomAccess): Map<string, boolean> {
    const permissions = new Map<string, boolean>();
    if (meta.room.state?.win) return permissions;
    for (const [playerId, lease] of meta.seats) {
      if (!lease.sessionId || !meta.accounts.sessionActive(lease.sessionId)) continue;
      const canPublish = gameView(meta.room, { subjectPlayerId: playerId, readOnly: false }, this.now()).capabilities?.canPublishVoice ?? false;
      permissions.set(meta.mediaId(playerId, lease.epoch), canPublish);
    }
    for (const watcher of meta.watchers.values()) if (meta.accounts.sessionActive(watcher.sessionId)) permissions.set(meta.mediaId(watcher.id, watcher.epoch), false);
    return permissions;
  }
  /**
   * Agora encodes publish rights in the token and offers no live permission update,
   * so alignment means: close the channel after the game ends, or kick identities
   * whose lease is no longer live.
   */
  sync(meta: RoomAccess, required = false) {
    if (!this.voice) return Promise.resolve();
    return this.enqueue(meta.room.gameId, async () => {
      const gameId = meta.room.gameId;
      // 没有正在发言的人（或对局已结束）→ 送达聚合作废；发言窗口换了 → 旧窗口计数同样作废
      const current = this.currentWindow(meta);
      const stale = this.deliveries.get(gameId);
      if (meta.room.state?.win || current === null || (stale !== undefined && stale.windowInstanceId !== current.windowInstanceId)) this.deliveries.delete(gameId);
      if (meta.room.state?.win) {
        if (!this.closed.has(gameId)) { await this.voice!.closeRoom(gameId); this.closed.add(gameId); }
        return;
      }
      const allowed = this.permissions(meta);
      const known = this.identities.get(gameId);
      if (!known) return;
      let failures = 0;
      for (const [identity, uid] of [...known]) {
        if (allowed.has(identity)) continue;
        try {
          await this.voice!.removeParticipant(gameId, uid);
          known.delete(identity);
        } catch {
          // 保留映射，下一次 sync 重试；单个失败不影响其余身份的回收
          failures += 1;
        }
      }
      if (failures > 0) throw new Error(`voice_remove_failed:${failures}`);
    }, required);
  }
  async issue(meta: RoomAccess, session: AccountSession): Promise<VoiceCredentials> {
    if (!this.voice) throw new ApiError(409, 'voice_disabled');
    const viewer = meta.resolve(session);
    if (!viewer) throw new ApiError(403, 'room_access_required');
    if (!meta.room.state || meta.room.state.win) throw new ApiError(409, 'voice_unavailable');
    const gameId = meta.room.gameId;
    const uid = this.uidFor(gameId, viewer.mediaIdentity);
    const canPublish = this.permissions(meta).get(viewer.mediaIdentity) ?? false;
    let credentials: VoiceCredentials;
    try {
      const base = this.voice.issueCredentials({ roomName: gameId, uid });
      credentials = {
        ...base,
        token: canPublish
          ? this.voice.issuePublishGrant({ roomName: gameId, uid }).token
          : this.voice.issueSubscriberGrant({ roomName: gameId, uid }).token,
      };
    } catch {
      throw new ApiError(503, 'voice_unavailable');
    }
    if (meta.resolve(session)?.mediaIdentity !== viewer.mediaIdentity || meta.room.state.win) {
      await this.revoke(gameId, viewer.mediaIdentity);
      throw new ApiError(403, 'authorization_changed');
    }
    return credentials;
  }
  async joined(meta: RoomAccess | undefined, gameId: string, identity: string) {
    if (!meta || !this.permissions(meta).has(identity)) await this.revoke(gameId, identity);
  }
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
