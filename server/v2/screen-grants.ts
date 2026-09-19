import { createHash } from 'node:crypto';
import type { AccountSession } from './account-store.ts';
import type { RoomDirectory } from './room-directory.ts';
import { newId, type StableRoom } from './stable-room.ts';
import { ApiError } from './errors.ts';

export function requireMatch(room: StableRoom, gameId: string): void {
  if (!room.runtime || gameId !== room.gameId) throw new ApiError(409, 'stale_game');
}
export class ScreenGrants {
  readonly directory: RoomDirectory;
  constructor(directory: RoomDirectory) { this.directory = directory; }
  private actor(room: StableRoom, session: AccountSession, gameId: string): string {
    requireMatch(room, gameId);
    const member = this.directory.member(room, session);
    const seat = room.participants.get(member.userId);
    if (member.kind !== 'formal' || !seat || !room.access?.resolve(session)) throw new ApiError(403, 'seat_control_required');
    return seat.playerId;
  }
  invite(room: StableRoom, session: AccountSession, gameId: string) {
    return this.directory.mutate(room, () => {
      const subjectPlayerId = this.actor(room, session, gameId);
      if ([...room.access!.watchers.values()].some((w) => w.subject === subjectPlayerId)) throw new ApiError(409, 'second_screen_unavailable');
      return { ...room.access!.inviteScreen(subjectPlayerId), gameId, subjectPlayerId };
    });
  }
  redeem(room: StableRoom, session: AccountSession, gameId: string, token: string) {
    return this.directory.mutate(room, () => {
      requireMatch(room, gameId);
      this.directory.checkSession(session); this.directory.checkCurrent(session.userId, room.roomId);
      if (room.participants.has(session.userId)) throw new ApiError(403, 'player_cannot_spectate');
      const access = room.access!;
      const key = createHash('sha256').update(token).digest('hex');
      const invitation = access.invitations.get(key);
      if (!invitation || invitation.expiresAt <= this.directory.deps.clock.now()) throw new ApiError(403, 'invalid_screen_invitation');
      const existing = access.watchers.get(session.userId);
      if (existing?.subject || [...access.watchers.values()].some((w) => w.subject === invitation.subject)) throw new ApiError(409, 'second_screen_unavailable');
      // Membership checks and all token checks precede the atomic public -> private transition.
      const member = this.directory.enterWithinQueue(room, session);
      const watcher = access.watchers.get(session.userId)!;
      watcher.subject = invitation.subject;
      member.kind = 'private_spectator';
      access.invitations.delete(key);
      return { memberId: member.memberId, gameId, subjectPlayerId: invitation.subject, kind: member.kind };
    }, session);
  }
  revoke(room: StableRoom, session: AccountSession, gameId: string) {
    return this.directory.mutate(room, () => this.revokeSubject(room, this.actor(room, session, gameId)));
  }
  revokeSubject(room: StableRoom, playerId: string): void {
    const access = room.access;
    if (!access) return;
    const users = [...access.watchers.values()].filter((w) => w.subject === playerId).map((w) => w.userId);
    access.revokeScreens(playerId);
    for (const userId of users) {
      const member = room.members.get(userId);
      if (!member) continue;
      member.kind = 'public_spectator'; member.connections.clear(); member.presence = 'offline'; member.disconnectAt = null; member.epoch = newId('e');
      if (member.sessionId && this.directory.deps.accounts.sessionActive(member.sessionId)) access.watch({ userId, id: member.sessionId, expiresAt: Number.MAX_SAFE_INTEGER });
      if (member.sessionId) this.directory.deps.control(room, member.sessionId, 'screen_revoked');
    }
  }
}
