import { randomBytes } from 'node:crypto';
import type { ControlReason } from '../../contracts/v2.ts';
import type { RulesetConfig } from '../../rulesets/types.ts';
import type { AccountSession } from './account-store.ts';
import { ApiError } from './errors.ts';
import { StableRoom, newId, type ActiveMember, type StableRoomDeps } from './stable-room.ts';

export interface DirectoryDeps extends StableRoomDeps {
  changed: (room: StableRoom, event?: { disconnectedMemberId: string }) => void;
  control: (room: StableRoom, sessionId: string | null, reason: ControlReason) => void;
  removed?: (room: StableRoom) => void;
  beforeMutation?: (room: StableRoom) => void;
  closedMatch?: (gameId: string) => void;
}

/** Membership transactions always acquire the directory queue before a room queue.
 * Game commands/timers acquire only the room queue and never wait for this queue.
 */
export class RoomDirectory {
  readonly byId = new Map<string, StableRoom>();
  readonly byCode = new Map<string, StableRoom>();
  readonly current = new Map<string, string>(); // account -> one current room
  readonly deps: DirectoryDeps;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(deps: DirectoryDeps) { this.deps = deps; }
  transaction<T>(task: () => T | Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.then(() => undefined, () => undefined);
    return next;
  }
  private async expireCurrent(userId: string): Promise<void> {
    const id = this.current.get(userId);
    if (!id) return;
    const room = this.byId.get(id);
    if (!room) { this.current.delete(userId); return; }
    if (room.emptyDeadline !== null && this.deps.clock.now() >= room.emptyDeadline) await room.enqueue(() => this.deps.beforeMutation?.(room));
  }
  mutate<T>(room: StableRoom, task: () => T, session?: AccountSession): Promise<T> {
    return this.transaction(async () => {
      if (session) await this.expireCurrent(session.userId);
      return room.enqueue(() => {
        if (room.dissolved || this.byId.get(room.roomId) !== room) throw new ApiError(404, 'room_not_found');
        this.deps.beforeMutation?.(room);
        if (room.dissolved) throw new ApiError(404, 'room_not_found');
        const value = task();
        this.deps.changed(room);
        return value;
      });
    });
  }
  checkSession(session: AccountSession) {
    if (!this.deps.accounts.sessionActive(session.id)) throw new ApiError(401, 'unauthorized');
  }
  checkCurrent(userId: string, roomId?: string) {
    const current = this.current.get(userId);
    if (current && current !== roomId) throw new ApiError(409, 'already_in_room');
  }
  create(session: AccountSession, ruleset: RulesetConfig): Promise<StableRoom> {
    return this.transaction(async () => {
      await this.expireCurrent(session.userId);
      this.checkSession(session); this.checkCurrent(session.userId);
      if (this.byId.size >= 100) throw new ApiError(503, 'room_capacity');
      let code: string;
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      do { code = [...randomBytes(6)].map((n) => alphabet[n % alphabet.length]).join(''); } while (this.byCode.has(code));
      const room = new StableRoom(code, ruleset, this.deps);
      this.byId.set(room.roomId, room); this.byCode.set(code, room);
      const member = this.addMember(room, session, 'formal');
      room.hostMemberId = member.memberId;
      this.deps.changed(room);
      return room;
    });
  }
  private addMember(room: StableRoom, session: AccountSession, kind: ActiveMember['kind']): ActiveMember {
    const row = this.deps.accounts.db.prepare('SELECT uid,nickname FROM accounts WHERE id=?').get(session.userId);
    if (!row) throw new ApiError(401, 'unauthorized');
    const member: ActiveMember = {
      memberId: newId('m'), userId: session.userId, uid: String(row.uid), nickname: String(row.nickname), kind,
      joinedAt: this.deps.clock.now(), joinedOrder: room.nextJoinOrder++, ready: false,
      sessionId: session.id, epoch: newId('e'), presence: 'offline', connections: new Set(), disconnectAt: null,
    };
    room.members.set(session.userId, member); this.current.set(session.userId, room.roomId);
    this.syncLease(room, member);
    return member;
  }
  private syncLease(room: StableRoom, member: ActiveMember): void {
    if (!room.access) return;
    const seat = room.participants.get(member.userId);
    if (seat) {
      room.access.seats.set(seat.playerId, { userId: member.userId, sessionId: member.sessionId, epoch: member.epoch });
    } else if (member.sessionId) {
      const watcher = room.access.watchers.get(member.userId);
      if (watcher) { watcher.sessionId = member.sessionId; watcher.epoch = member.epoch; }
      else room.access.watch({ userId: member.userId, id: member.sessionId, expiresAt: Number.MAX_SAFE_INTEGER });
    }
  }
  member(room: StableRoom, session: AccountSession): ActiveMember {
    this.checkSession(session);
    const member = room.members.get(session.userId);
    if (!member || member.sessionId !== session.id) throw new ApiError(403, 'room_access_required');
    return member;
  }
  enter(room: StableRoom, session: AccountSession, takeover = false): Promise<ActiveMember> {
    return this.mutate(room, () => this.enterWithinQueue(room, session, takeover), session);
  }
  /** For atomic grant redemption; caller must already hold directory and room queues. */
  enterWithinQueue(room: StableRoom, session: AccountSession, takeover = false): ActiveMember {
    this.checkSession(session); this.checkCurrent(session.userId, room.roomId);
    const existing = room.members.get(session.userId);
    if (existing) {
      if (existing.sessionId === session.id) return existing;
      if (!takeover && existing.sessionId && this.deps.accounts.sessionActive(existing.sessionId)) throw new ApiError(409, 'takeover_required');
      this.releaseControl(room, existing, 'taken_over');
      existing.sessionId = session.id;
      this.syncLease(room, existing);
      return existing;
    }
    const former = room.participants.has(session.userId);
    if (takeover && !former) throw new ApiError(403, 'not_your_seat');
    const kind = former || (room.phase === 'lobby' && room.formalMembers().length < room.requiredPlayers()) ? 'formal' : 'public_spectator';
    if (kind !== 'formal' && [...room.members.values()].filter((m) => m.kind !== 'formal').length >= 100) throw new ApiError(409, 'spectator_limit');
    return this.addMember(room, session, kind);
  }
  promote(room: StableRoom, session: AccountSession): Promise<ActiveMember> {
    return this.mutate(room, () => {
      const member = this.member(room, session);
      if (room.phase !== 'lobby') throw new ApiError(409, 'lobby_required');
      if (member.kind === 'formal') throw new ApiError(409, 'already_formal');
      if (room.formalMembers().length >= room.requiredPlayers()) throw new ApiError(409, 'room_full');
      // All fallible checks precede the identity change; failure preserves spectator membership.
      member.kind = 'formal'; member.ready = false;
      return member;
    });
  }
  releaseControl(room: StableRoom, member: ActiveMember, reason: ControlReason): void {
    const oldSession = member.sessionId;
    const seat = room.participants.get(member.userId);
    if (room.access && seat) {
      const lease = room.access.seats.get(seat.playerId);
      if (lease) {
        this.deps.revokeMedia(room.gameId!, room.access.mediaId(seat.playerId, lease.epoch));
        lease.sessionId = null; lease.epoch = newId('e');
      }
    } else if (room.access) {
      const watcher = room.access.watchers.get(member.userId);
      if (watcher) this.deps.revokeMedia(room.gameId!, room.access.mediaId(watcher.id, watcher.epoch));
    }
    member.sessionId = null; member.epoch = newId('e'); member.connections.clear();
    member.presence = 'offline'; member.disconnectAt = null;
    if (oldSession) this.deps.control(room, oldSession, reason);
  }
  removeMember(room: StableRoom, member: ActiveMember, reason: 'left' | 'kicked' | 'account_disabled'): void {
    this.releaseControl(room, member, reason);
    if (member.kind !== 'formal') room.access?.unwatch(member.userId);
    room.members.delete(member.userId);
    if (this.current.get(member.userId) === room.roomId) this.current.delete(member.userId);
  }
  /**
   * 底层「离开成员」原语：只移除成员，**不**处理房主解散语义。
   * 房主离开即解散由 RoomGovernance.leave 承担，HTTP 层一律走它。
   */
  leave(room: StableRoom, session: AccountSession): Promise<{ left: true; seatRetained: boolean }> {
    return this.mutate(room, () => {
      const member = this.member(room, session);
      this.removeMember(room, member, 'left');
      return { left: true, seatRetained: room.participants.has(session.userId) };
    }).then(result => ({ left: true, seatRetained: !room.dissolved && result.seatRetained }));
  }
}
