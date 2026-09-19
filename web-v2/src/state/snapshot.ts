import type { ControlReason, Profile, RoomSnapshot } from '../../../contracts/v2.ts';

export type SnapshotChange = { updated: boolean; gameChanged: boolean; perspectiveChanged: boolean };
const unchanged: SnapshotChange = { updated: false, gameChanged: false, perspectiveChanged: false };

/** One cursor per account and room; private streams must never survive scope changes. */
export class SnapshotCursor {
  private current: RoomSnapshot | null = null;
  private sample: { server: number; local: number } | null = null;
  private version = -1;
  private epoch = 0;
  readonly userId: string;
  readonly roomId: string;
  private readonly now: () => number;
  constructor(userId: string, roomId: string, now: () => number = () => performance.now()) {
    this.userId = userId; this.roomId = roomId; this.now = now;
  }
  ticket(): number { return this.epoch; }
  accept(view: RoomSnapshot, ticket = this.epoch): SnapshotChange {
    if (ticket !== this.epoch || view.contractVersion !== '2.2' || view.rulesVersion !== '2.0' ||
      view.viewer.userId !== this.userId || view.roomId !== this.roomId ||
      !Number.isSafeInteger(view.viewVersion) || view.viewVersion < this.version || !Number.isFinite(view.serverTime)) return unchanged;
    // Equal samples do not reset the local elapsed time and extend a deadline.
    if (!this.sample || view.serverTime > this.sample.server) this.sample = { server: view.serverTime, local: this.now() };
    if (view.viewVersion === this.version) return unchanged;
    const before = this.current;
    const gameChanged = before !== null && before.gameId !== view.gameId;
    const perspectiveChanged = before !== null && (before.viewer.kind !== view.viewer.kind ||
      before.viewer.memberId !== view.viewer.memberId || before.viewer.subjectPlayerId !== view.viewer.subjectPlayerId);
    this.version = view.viewVersion;
    this.current = structuredClone(view);
    return { updated: true, gameChanged, perspectiveChanged };
  }
  snapshot(): RoomSnapshot | null { return this.current ? structuredClone(this.current) : null; }
  remaining(closesAt: number): number | null {
    if (!this.sample) return null;
    return Math.max(0, closesAt - (this.sample.server + Math.max(0, this.now() - this.sample.local)));
  }
  /** Invalidate in-flight HTTP work while retaining the version floor for this room. */
  revoke(): void { this.epoch++; this.current = null; this.sample = null; }
}

export function controlEffect(reason: ControlReason): 'exit' | 'login' | 'refresh' | 'clear-game' | 'clear-private' {
  switch (reason) {
    case 'session_expired': case 'account_disabled': return 'login';
    case 'host_changed': return 'refresh';
    case 'review_ended': return 'clear-game';
    case 'screen_revoked': return 'clear-private';
    default: return 'exit';
  }
}

export function acceptProfile(current: Profile | null, incoming: Profile, userId: string): Profile | null {
  const scoped = current?.userId === userId ? current : null;
  return incoming.userId === userId && (!scoped || incoming.profileVersion >= scoped.profileVersion) ? incoming : scoped;
}
