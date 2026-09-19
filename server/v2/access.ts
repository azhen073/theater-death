import { createHash, randomBytes } from 'node:crypto';
import type { Room } from '../rooms.ts';
import type { AccountSession, AccountStore } from './account-store.ts';
import type { ResolvedViewer } from './realtime.ts';
import { ApiError } from './errors.ts';

const random = () => randomBytes(24).toString('base64url');
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
interface SeatLease { userId: string; sessionId: string | null; epoch: string }
interface WatchLease { id: string; userId: string; sessionId: string; subject: string | null; epoch: string }
interface ScreenInvite { subject: string; expiresAt: number }

/** All methods mutating a room are called within that room's serialized queue. */
export class RoomAccess {
  readonly seats = new Map<string, SeatLease>();
  readonly watchers = new Map<string, WatchLease>();
  readonly invitations = new Map<string, ScreenInvite>();
  lastConnectedAt: number;
  endedAt: number | null = null;
  readonly room: Room;
  readonly accounts: AccountStore;
  readonly now: () => number;
  private readonly revokeMedia: (identity: string) => void;
  constructor(room: Room, accounts: AccountStore, now: () => number, revokeMedia: (identity: string) => void) { this.room = room; this.accounts = accounts; this.now = now; this.revokeMedia = revokeMedia; this.lastConnectedAt = now(); }
  bind(playerId: string, session: AccountSession) {
    if ([...this.seats.values()].some((s) => s.userId === session.userId)) throw new ApiError(409, 'already_seated');
    if (this.watchers.has(session.userId)) throw new ApiError(409, 'already_watching');
    this.seats.set(playerId, { userId: session.userId, sessionId: session.id, epoch: random() });
  }
  ownSeat(userId: string): string | null { return [...this.seats.entries()].find(([, s]) => s.userId === userId)?.[0] ?? null; }
  mediaId(subject: string, epoch: string): string { return `v2:${this.room.gameId}:${subject}:${epoch}`; }
  private release(playerId: string, lease: SeatLease) { this.revokeMedia(this.mediaId(playerId, lease.epoch)); lease.sessionId = null; lease.epoch = random(); }
  takeover(session: AccountSession): string {
    const playerId = this.ownSeat(session.userId);
    if (!playerId) throw new ApiError(403, 'not_your_seat');
    const lease = this.seats.get(playerId)!;
    this.release(playerId, lease); lease.sessionId = session.id;
    this.lastConnectedAt = this.now();
    return playerId;
  }
  leave(session: AccountSession) {
    const playerId = this.ownSeat(session.userId);
    if (playerId) {
      const lease = this.seats.get(playerId)!;
      if (lease.sessionId !== session.id) throw new ApiError(409, 'seat_taken_over');
      this.release(playerId, lease);
    } else this.unwatch(session.userId);
  }
  removeSeat(playerId: string) {
    const seat = this.seats.get(playerId);
    if (seat) this.release(playerId, seat);
    this.seats.delete(playerId);
    this.revokeScreens(playerId);
  }
  watch(session: AccountSession, subject: string | null = null) {
    if (this.ownSeat(session.userId)) throw new ApiError(403, 'player_cannot_spectate');
    if (this.watchers.has(session.userId)) throw new ApiError(409, 'already_watching');
    if (this.watchers.size >= 100) throw new ApiError(409, 'spectator_limit');
    if (subject && (!this.seats.has(subject) || [...this.watchers.values()].some((w) => w.subject === subject))) throw new ApiError(409, 'second_screen_unavailable');
    const watcher: WatchLease = { id: random(), userId: session.userId, sessionId: session.id, subject, epoch: random() };
    this.watchers.set(session.userId, watcher);
    this.lastConnectedAt = this.now();
    return watcher.id;
  }
  unwatch(userId: string) {
    const old = this.watchers.get(userId);
    if (old) this.revokeMedia(this.mediaId(old.id, old.epoch));
    this.watchers.delete(userId);
  }
  inviteScreen(playerId: string) {
    if (!this.seats.has(playerId)) throw new ApiError(404, 'player_not_found');
    // At most one outstanding invitation per seat; new issuance revokes the previous code.
    for (const [key, invitation] of this.invitations) if (invitation.subject === playerId) this.invitations.delete(key);
    const token = random(); const expiresAt = this.now() + 300_000;
    this.invitations.set(hash(token), { subject: playerId, expiresAt });
    return { token, expiresAt };
  }
  redeem(session: AccountSession, token: string) {
    const key = hash(token); const invitation = this.invitations.get(key);
    if (!invitation || invitation.expiresAt <= this.now()) throw new ApiError(403, 'invalid_screen_invitation');
    const id = this.watch(session, invitation.subject);
    this.invitations.delete(key);
    return id;
  }
  revokeScreens(playerId: string) {
    for (const [key, i] of this.invitations) if (i.subject === playerId) this.invitations.delete(key);
    for (const w of [...this.watchers.values()]) if (w.subject === playerId) this.unwatch(w.userId);
  }
  resolve(session: AccountSession): ResolvedViewer | null {
    if (!this.accounts.sessionActive(session.id)) return null;
    const playerId = this.ownSeat(session.userId);
    if (playerId) {
      const lease = this.seats.get(playerId)!;
      if (lease.sessionId !== session.id) return null;
      return { room: this.room, identity: { subjectPlayerId: playerId, readOnly: false }, principalId: session.userId, mediaIdentity: this.mediaId(playerId, lease.epoch) };
    }
    const watcher = this.watchers.get(session.userId);
    if (!watcher || watcher.sessionId !== session.id) return null;
    return { room: this.room, identity: { subjectPlayerId: watcher.subject, readOnly: true }, principalId: session.userId, mediaIdentity: this.mediaId(watcher.id, watcher.epoch) };
  }
  expireSessions() {
    for (const [id, lease] of this.seats) if (lease.sessionId && !this.accounts.sessionActive(lease.sessionId)) this.release(id, lease);
    for (const w of [...this.watchers.values()]) if (!this.accounts.sessionActive(w.sessionId)) this.unwatch(w.userId);
  }
  close() { for (const [id, lease] of this.seats) this.release(id, lease); for (const w of [...this.watchers.values()]) this.unwatch(w.userId); this.invitations.clear(); }
}
