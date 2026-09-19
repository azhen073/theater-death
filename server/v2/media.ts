import type { VoiceService } from '../../voice/livekit.ts';
import type { AccountSession } from './account-store.ts';
import type { RoomAccess } from './access.ts';
import { gameView } from './view.ts';
import { ApiError } from './errors.ts';

/** Serialize media side effects without blocking the game queue. Resolve current leases at execution time. */
export class V2Media {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly closed = new Set<string>();
  readonly voice: VoiceService | null;
  private readonly now: () => number;
  constructor(voice: VoiceService | null, now: () => number) { this.voice = voice; this.now = now; }
  private enqueue(gameId: string, work: () => Promise<void>, required = false): Promise<void> {
    const run = (this.pending.get(gameId) ?? Promise.resolve()).then(work);
    const next = run.catch((error) => {
      console.warn('voice_service_unavailable');
      if (required) throw error;
    });
    this.pending.set(gameId, next);
    const cleanup = () => { if (this.pending.get(gameId) === next) this.pending.delete(gameId); };
    void next.then(cleanup, cleanup);
    return next;
  }
  revoke(gameId: string, identity: string) { return this.enqueue(gameId, async () => { await this.voice?.removeParticipant(gameId, identity); }); }
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
  sync(meta: RoomAccess, required = false) {
    if (!this.voice) return Promise.resolve();
    return this.enqueue(meta.room.gameId, async () => {
      const attempts = required ? 1 : 3;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          if (meta.room.state?.win) {
            if (!this.closed.has(meta.room.gameId)) { await this.voice!.closeRoom(meta.room.gameId); this.closed.add(meta.room.gameId); }
          } else await this.voice!.syncRoom({ roomName: meta.room.gameId, permissions: this.permissions(meta) });
          return;
        } catch (error) {
          if (attempt === attempts) throw error;
          await new Promise(resolve => setTimeout(resolve, attempt * 100));
        }
      }
    }, required);
  }
  async issue(meta: RoomAccess, session: AccountSession) {
    if (!this.voice) throw new ApiError(409, 'voice_disabled');
    const viewer = meta.resolve(session);
    if (!viewer) throw new ApiError(403, 'room_access_required');
    if (!meta.room.state || meta.room.state.win) throw new ApiError(409, 'voice_unavailable');
    let credentials;
    try { credentials = await this.voice.issueCredentials({ roomName: meta.room.gameId, playerId: viewer.mediaIdentity }); }
    catch { throw new ApiError(503, 'voice_unavailable'); }
    if (meta.resolve(session)?.mediaIdentity !== viewer.mediaIdentity || meta.room.state.win) {
      await this.revoke(meta.room.gameId, viewer.mediaIdentity);
      throw new ApiError(403, 'authorization_changed');
    }
    try { await this.sync(meta, true); }
    catch { throw new ApiError(503, 'voice_unavailable'); }
    if (meta.resolve(session)?.mediaIdentity !== viewer.mediaIdentity || meta.room.state.win) {
      await this.revoke(meta.room.gameId, viewer.mediaIdentity);
      throw new ApiError(403, 'authorization_changed');
    }
    return credentials;
  }
  async joined(meta: RoomAccess | undefined, gameId: string, identity: string) {
    if (!meta || !this.permissions(meta).has(identity)) await this.revoke(gameId, identity);
    else await this.sync(meta);
  }
  closeRoom(gameId: string) { return this.enqueue(gameId, async () => { await this.voice?.closeRoom(gameId); this.closed.delete(gameId); }); }
  async drain() { await Promise.all(this.pending.values()); }
}
