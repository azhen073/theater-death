import type { ClockHandle } from '../clock.ts';
import type { AccountSession } from './account-store.ts';
import type { RoomDirectory } from './room-directory.ts';
import type { StableRoom, ActiveMember } from './stable-room.ts';
import { ApiError } from './errors.ts';

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_TIMEOUT_MS = 20_000;
export const DISCONNECT_GRACE_MS = 15_000;

/** Counts current control-session tabs. Spectator connections never count for their subject. */
export class MemberPresence {
  readonly directory: RoomDirectory;
  readonly pending = new Map<string, ClockHandle>();
  constructor(directory: RoomDirectory) { this.directory = directory; }
  private cancel(member: ActiveMember) {
    const timer = this.pending.get(member.memberId);
    if (timer) this.directory.deps.clock.cancel(timer);
    this.pending.delete(member.memberId);
  }
  connect(room: StableRoom, session: AccountSession, connectionId: string): Promise<void> {
    return room.enqueue(() => {
      if (room.dissolved) throw new ApiError(404, 'room_not_found');
      const member = this.directory.member(room, session);
      this.cancel(member);
      member.connections.add(connectionId); member.disconnectAt = null; member.presence = 'online';
      this.directory.deps.changed(room);
    });
  }
  disconnect(room: StableRoom, session: AccountSession, connectionId: string, reason: string): Promise<void> {
    return room.enqueue(() => {
      const member = room.members.get(session.userId);
      if (room.dissolved || !member || member.sessionId !== session.id || !member.connections.delete(connectionId) || member.connections.size > 0) return;
      this.cancel(member);
      if (reason === 'ping timeout' || !this.directory.deps.accounts.sessionActive(session.id)) {
        member.presence = 'offline'; member.disconnectAt = null;
      } else {
        member.presence = 'reconnecting';
        const deadline = this.directory.deps.clock.now() + DISCONNECT_GRACE_MS;
        const epoch = member.epoch;
        member.disconnectAt = deadline;
        const handle = this.directory.deps.clock.schedule(DISCONNECT_GRACE_MS, () => {
          void room.enqueue(() => {
            if (this.pending.get(member.memberId) !== handle) return;
            this.pending.delete(member.memberId);
            if (room.dissolved || room.members.get(member.userId) !== member || member.epoch !== epoch || member.connections.size > 0 || member.disconnectAt !== deadline) return;
            member.presence = 'offline'; member.disconnectAt = null;
            this.directory.deps.changed(room, { disconnectedMemberId: member.memberId });
          });
        });
        this.pending.set(member.memberId, handle);
      }
      this.directory.deps.changed(room, member.presence === 'offline' ? { disconnectedMemberId: member.memberId } : undefined);
    });
  }
  close() {
    for (const timer of this.pending.values()) this.directory.deps.clock.cancel(timer);
    this.pending.clear();
  }
}
