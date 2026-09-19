import type { ClockHandle } from '../clock.ts';
import type { RoomDirectory } from './room-directory.ts';
import type { RoomGovernance } from './governance.ts';
import type { StableRoom } from './stable-room.ts';

export const EMPTY_ROOM_TTL_MS = 5 * 60_000;

/** Empty means no formal members. Offline and dead formal members still count. */
export class EmptyRooms {
  readonly directory: RoomDirectory;
  readonly governance: RoomGovernance;
  readonly pending = new Map<string, ClockHandle>();
  constructor(directory: RoomDirectory, governance: RoomGovernance) { this.directory = directory; this.governance = governance; }
  private cancel(room: StableRoom) {
    const handle = this.pending.get(room.roomId);
    if (handle) this.directory.deps.clock.cancel(handle);
    this.pending.delete(room.roomId);
  }
  observe(room: StableRoom): void {
    if (room.dissolved || room.formalMembers().length > 0) {
      this.cancel(room); room.emptyDeadline = null; return;
    }
    // A completed match needs no reconnect grace once every formal member left.
    // Observers cannot retain a finished room; offline formal members still can.
    if (room.phase === 'review') {
      this.cancel(room); room.emptyDeadline = null;
      room.recordCompletion();
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
    if (room.dissolved || room.emptyDeadline === null || this.directory.deps.clock.now() < room.emptyDeadline || room.formalMembers().length > 0) return;
    this.cancel(room);
    if (room.runtime) {
      room.recordCompletion();
      if (!room.runtime.state?.win) this.directory.deps.logStore.finishMatch(room.runtime.gameId, 'aborted', this.directory.deps.clock.now());
    }
    this.governance.dispose(room);
  }
  async sweep(): Promise<void> {
    for (const room of [...this.directory.byId.values()]) await this.directory.transaction(() => room.enqueue(() => {
      this.observe(room); this.expireIfDue(room);
    }));
  }
  close(): void {
    for (const timer of this.pending.values()) this.directory.deps.clock.cancel(timer);
    this.pending.clear();
  }
}
