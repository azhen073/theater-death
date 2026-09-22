import type { RoomSnapshot } from '../../../contracts/v2.ts';
import { publicDeathSeats } from './death-events.ts';

export const DEATH_EFFECT_MS = 3200;
export interface DeathBurst { seat: number; cursor: number; startedAt: number }
export function deathScope(view: RoomSnapshot): string {
  return JSON.stringify([view.viewer.userId, view.roomId, view.gameId, view.viewer.memberId,
    view.viewer.kind, view.viewer.subjectPlayerId, view.viewer.readOnly]);
}

/** One bounded burst per publicly dead seat, with independent expiry for overlapping batches. */
export class DeathEffectsTracker {
  private baseline: { scope: string; cursor: number; version: number; active: boolean; phase: string } | null = null;
  private bursts: DeathBurst[] = [];

  expire(now: number): DeathBurst[] {
    this.bursts = this.bursts.filter(burst => now - burst.startedAt < DEATH_EFFECT_MS);
    return [...this.bursts];
  }

  update(view: RoomSnapshot | null, active: boolean, now: number): DeathBurst[] {
    if (!view) { this.baseline = null; this.bursts = []; return []; }
    const scope = deathScope(view), previous = this.baseline;
    const events = view.public?.events ?? [];
    const cursor = events.reduce((max, event) => Math.max(max, event.cursor), 0);
    const live = active && !!view.gameId && !!view.public && view.room.phase !== 'lobby';
    if (previous?.scope === scope && live && previous.active &&
        (view.viewVersion < previous.version || cursor < previous.cursor)) return this.expire(now);
    this.baseline = { scope, cursor, version: view.viewVersion, active: live, phase: view.room.phase };
    if (!live || !previous?.active || previous.scope !== scope) { this.bursts = []; return []; }

    // A return in the same snapshot wins over an earlier death announcement.
    const dead = new Set(view.public!.seats.filter(seat => !seat.alive).map(seat => seat.seat));
    this.bursts = this.expire(now).filter(burst => dead.has(burst.seat));
    // Opening/reloading review establishes a baseline; only the final LIVE death survives.
    if (previous.phase === 'playing') {
      for (const seat of publicDeathSeats(events, previous.cursor)) {
        if (!dead.has(seat)) continue;
        this.bursts = this.bursts.filter(burst => burst.seat !== seat);
        this.bursts.push({ seat, cursor, startedAt: now });
      }
    }
    return [...this.bursts];
  }
}

export interface DeathParticle { angle: number; speed: number; delay: number; life: number; size: number; rotation: number; spin: number; red: boolean }
export function particleCount(width: number, seats: number): number {
  return seats > 0 ? Math.min(66, Math.floor((width < 600 ? 100 : 220) / seats)) : 0;
}
export function makeParticles(seed: number, count: number): DeathParticle[] {
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({ length: count }, () => ({
    angle: random() * Math.PI * 2, speed: 24 + random() * 100, delay: random() * .3,
    life: 1.4 + random() * 1.45, size: 1.1 + random() * 3.2,
    rotation: random() * 6, spin: (random() - .5) * 4, red: random() > .35,
  }));
}
