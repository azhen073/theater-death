import type { RoomSnapshot, Profile } from '../../contracts/v2.ts';

/** Small runnable integration example; rendering and action drafts stay in the frontend. */
export class SnapshotCursor {
  private current: RoomSnapshot | null = null;
  private sample: { server: number; local: number } | null = null;
  readonly userId: string;
  readonly roomId: string;
  readonly monotonicNow: () => number;
  constructor(userId: string, roomId: string, monotonicNow = () => performance.now()) {
    this.userId = userId; this.roomId = roomId; this.monotonicNow = monotonicNow;
  }
  accept(view: RoomSnapshot): { updated: boolean; gameChanged: boolean } {
    if (view.viewer.userId !== this.userId || view.roomId !== this.roomId || (this.current && view.viewVersion < this.current.viewVersion)) return { updated: false, gameChanged: false };
    if (!this.sample || view.serverTime >= this.sample.server) this.sample = { server: view.serverTime, local: this.monotonicNow() };
    if (this.current && view.viewVersion === this.current.viewVersion) return { updated: false, gameChanged: false };
    const gameChanged = this.current !== null && this.current.gameId !== view.gameId;
    this.current = structuredClone(view);
    return { updated: true, gameChanged };
  }
  remainingMs(closesAt: number): number | null {
    return this.sample ? Math.max(0, closesAt - this.sample.server - (this.monotonicNow() - this.sample.local)) : null;
  }
  clear(): void { this.current = null; this.sample = null; }
  snapshot(): RoomSnapshot | null { return this.current ? structuredClone(this.current) : null; }
}

export function acceptProfile(current: Profile | null, response: Profile, activeUserId: string): Profile | null {
  const active = current?.userId === activeUserId ? current : null;
  return response.userId === activeUserId && (!active || response.profileVersion >= active.profileVersion) ? response : active;
}

export class HttpFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

/** Network rejection is deliberately not converted into a server-rejected command receipt. */
export async function postJson<T>(path: string, intent: object, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api/v2${path}`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intent),
  });
  const body = await response.json() as { error?: { code?: unknown } };
  if (!response.ok) throw new HttpFailure(response.status, typeof body?.error?.code === 'string' ? body.error.code : 'unknown_error');
  return body as T;
}
