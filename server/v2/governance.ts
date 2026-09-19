import type { AccountSession } from './account-store.ts';
import type { RoomDirectory } from './room-directory.ts';
import type { StableRoom, ActiveMember } from './stable-room.ts';
import { ApiError } from './errors.ts';

export class RoomGovernance {
  readonly directory: RoomDirectory;
  constructor(directory: RoomDirectory) { this.directory = directory; }
  /** Creation assigns its host before the first socket exists. Transfer on an actual
   * disconnect/expiry/leave, not on the HTTP-to-Socket handoff of a new room.
   */
  reconcile(room: StableRoom, event?: { disconnectedMemberId: string }): void {
    if (room.dissolved) return;
    const current = room.formalMembers().find((m) => m.memberId === room.hostMemberId);
    if (current && current.sessionId && this.directory.deps.accounts.sessionActive(current.sessionId) && current.memberId !== event?.disconnectedMemberId) return;
    const next = room.formalMembers().find((m) => m.presence === 'online' && m.connections.size > 0 && m.sessionId && this.directory.deps.accounts.sessionActive(m.sessionId));
    const id = next?.memberId ?? null;
    if (id !== room.hostMemberId) {
      room.hostMemberId = id;
      this.directory.deps.control(room, null, 'host_changed');
    }
  }
  host(room: StableRoom, session: AccountSession): ActiveMember {
    const member = this.directory.member(room, session);
    if (member.kind !== 'formal' || room.hostMemberId !== member.memberId) throw new ApiError(403, 'not_host');
    return member;
  }
  transfer(room: StableRoom, session: AccountSession, targetMemberId: string): Promise<void> {
    return this.directory.mutate(room, () => {
      this.host(room, session);
      const target = [...room.members.values()].find((m) => m.memberId === targetMemberId);
      if (!target || target.kind !== 'formal' || target.presence !== 'online' || target.connections.size === 0 || !target.sessionId || !this.directory.deps.accounts.sessionActive(target.sessionId)) throw new ApiError(409, 'host_target_unavailable');
      if (room.hostMemberId !== target.memberId) {
        room.hostMemberId = target.memberId;
        this.directory.deps.control(room, null, 'host_changed');
      }
    });
  }
  kick(room: StableRoom, session: AccountSession, targetMemberId: string): Promise<void> {
    return this.directory.mutate(room, () => {
      const host = this.host(room, session);
      if (host.memberId === targetMemberId) throw new ApiError(409, 'cannot_kick_self');
      const target = [...room.members.values()].find((m) => m.memberId === targetMemberId);
      if (!target) throw new ApiError(404, 'member_not_found');
      if (target.kind === 'formal' && room.phase !== 'lobby') throw new ApiError(409, 'lobby_required');
      this.directory.removeMember(room, target, 'kicked');
    });
  }
  dissolve(room: StableRoom, session: AccountSession): Promise<void> {
    return this.directory.mutate(room, () => {
      this.host(room, session);
      if (room.phase !== 'lobby') throw new ApiError(409, 'lobby_required');
      this.dispose(room);
    });
  }
  /** Caller already holds membership/room queues; game audit is retained. */
  dispose(room: StableRoom): void {
    room.dissolved = true;
    this.directory.deps.control(room, null, 'dissolved');
    room.access?.close();
    if (room.gameId) this.directory.deps.registry.disposeRoom(room.gameId);
    for (const member of room.members.values()) if (this.directory.current.get(member.userId) === room.roomId) this.directory.current.delete(member.userId);
    room.members.clear();
    this.directory.byId.delete(room.roomId); this.directory.byCode.delete(room.code);
    this.directory.deps.removed?.(room);
  }
}
