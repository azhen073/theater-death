import type { VoiceCredentials, VoiceService } from '../../voice/agora.ts';
import type { AccountSession } from './account-store.ts';
import type { RoomAccess } from './access.ts';
import { gameView } from './view.ts';
import { ApiError } from './errors.ts';

/** Serialize media side effects without blocking the game queue. Resolve current leases at execution time. */
export class V2Media {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly closed = new Set<string>();
  private readonly identities = new Map<string, Map<string, number>>();
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
    });
  }
  async drain() { await Promise.all(this.pending.values()); }
}
