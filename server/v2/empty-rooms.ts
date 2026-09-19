import type { ClockHandle } from '../clock.ts';
import type { RoomDirectory } from './room-directory.ts';
import type { RoomGovernance } from './governance.ts';
import type { StableRoom } from './stable-room.ts';

export const EMPTY_ROOM_TTL_MS = 5 * 60_000;
/** 全员离线（有正式成员但无人在线）后的回收时限。 */
export const OFFLINE_ROOM_TTL_MS = 24 * 60 * 60_000;

/**
 * Empty means no formal members. Offline and dead formal members still count against emptiness,
 * but a room whose formal members are *all* offline expires after OFFLINE_ROOM_TTL_MS so an
 * abandoned room cannot hold a directory slot forever.
 */
export class EmptyRooms {
  readonly directory: RoomDirectory;
  readonly governance: RoomGovernance;
  readonly pending = new Map<string, ClockHandle>();
  readonly offlinePending = new Map<string, ClockHandle>();
  constructor(directory: RoomDirectory, governance: RoomGovernance) { this.directory = directory; this.governance = governance; }
  private cancel(room: StableRoom) {
    const handle = this.pending.get(room.roomId);
    if (handle) this.directory.deps.clock.cancel(handle);
    this.pending.delete(room.roomId);
  }
  private anyOnline(room: StableRoom): boolean {
    return room.formalMembers().some((member) => member.presence === 'online' && member.connections.size > 0);
  }
  private cancelOffline(room: StableRoom) {
    const handle = this.offlinePending.get(room.roomId);
    if (handle) this.directory.deps.clock.cancel(handle);
    this.offlinePending.delete(room.roomId);
    room.allOfflineSince = null;
  }
  /** 全员离线即起算回收倒计时；只要有一名正式成员回到在线就取消。 */
  private observeOffline(room: StableRoom): void {
    if (this.anyOnline(room)) { this.cancelOffline(room); return; }
    if (room.allOfflineSince !== null) return;
    const since = this.directory.deps.clock.now();
    room.allOfflineSince = since;
    const handle = this.directory.deps.clock.schedule(OFFLINE_ROOM_TTL_MS, () => {
      void this.directory.transaction(() => room.enqueue(() => {
        if (this.offlinePending.get(room.roomId) !== handle || room.allOfflineSince !== since) return;
        this.expireIfDue(room);
      })).catch(() => console.warn('offline_room_expiry_failed'));
    });
    this.offlinePending.set(room.roomId, handle);
  }
  /**
   * 房间被销毁时的兜底清理：不经 observe 的销毁路径（如 RoomGovernance.dispose）也应清掉待执行定时器，
   * 避免 pending/offlinePending 里留下永不执行的条目。由 RoomDirectory 的 removed 钩子调用。
   */
  forget(roomId: string): void {
    for (const map of [this.pending, this.offlinePending]) {
      const handle = map.get(roomId);
      if (handle) this.directory.deps.clock.cancel(handle);
      map.delete(roomId);
    }
  }
  observe(room: StableRoom): void {
    if (room.dissolved) { this.cancel(room); this.cancelOffline(room); return; }
    if (room.formalMembers().length > 0) {
      this.cancel(room); room.emptyDeadline = null;
      this.observeOffline(room);
      return;
    }
    this.cancelOffline(room);
    // A completed match needs no reconnect grace once every formal member left.
    // Observers cannot retain a finished room; offline formal members still can.
    if (room.phase === 'review') {
      this.cancel(room); room.emptyDeadline = null;
      this.governance.dispose(room);
      return;
    }
    if (room.emptyDeadline !== null) return; // spectators cannot extend an empty interval
    const deadline = this.directory.deps.clock.now() + EMPTY_ROOM_TTL_MS;
    room.emptyDeadline = deadline;
    const handle = this.directory.deps.clock.schedule(EMPTY_ROOM_TTL_MS, () => {
      void this.directory.transaction(() => room.enqueue(() => {
        if (this.pending.get(room.roomId) !== handle || room.emptyDeadline !== deadline) return;
        this.expireIfDue(room);
      })).catch(() => console.warn('empty_room_expiry_failed'));
    });
    this.pending.set(room.roomId, handle);
  }
  /** Also checked before an incoming membership mutation, even if a timer callback is delayed. */
  expireIfDue(room: StableRoom): void {
    if (room.dissolved) return;
    const now = this.directory.deps.clock.now();
    if (room.formalMembers().length === 0) {
      if (room.emptyDeadline === null || now < room.emptyDeadline) return;
      this.cancel(room); this.cancelOffline(room);
      this.governance.dispose(room);
      return;
    }
    // 全员离线满 OFFLINE_ROOM_TTL_MS：回收；未终局的对局由 dispose 记 aborted。
    if (room.allOfflineSince !== null && now >= room.allOfflineSince + OFFLINE_ROOM_TTL_MS && !this.anyOnline(room)) {
      this.cancel(room); this.cancelOffline(room);
      this.governance.dispose(room);
    }
  }
  async sweep(): Promise<void> {
    for (const room of [...this.directory.byId.values()]) await this.directory.transaction(() => room.enqueue(() => {
      this.observe(room); this.expireIfDue(room);
    }));
  }
  close(): void {
    for (const timer of this.pending.values()) this.directory.deps.clock.cancel(timer);
    this.pending.clear();
    for (const timer of this.offlinePending.values()) this.directory.deps.clock.cancel(timer);
    this.offlinePending.clear();
  }
}
