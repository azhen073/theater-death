import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../contracts/v2.ts';
import { DeathEffectsTracker, DEATH_EFFECT_MS, particleCount, makeParticles } from '../web-v2/src/presentation/death-effects.ts';

function baseline(): RoomSnapshot {
  const view = JSON.parse(readFileSync('tests/fixtures/contract-2.1/night-door-full.json', 'utf8')) as RoomSnapshot;
  view.public!.events = [];
  view.public!.seats.forEach(seat => { seat.alive = true; });
  return view;
}
function announce(view: RoomSnapshot, seats: number[], cursor: number): RoomSnapshot {
  const next = structuredClone(view);
  next.viewVersion++;
  next.public!.events.push({ cursor, type: 'deaths_announced', dayNumber: 1, stage: 1, payload: { seats } });
  next.public!.seats.forEach(seat => { if (seats.includes(seat.seat)) seat.alive = false; });
  return next;
}

describe('public death effects lifecycle', () => {
  it('establishes a baseline, deduplicates snapshots and expires without extending the deadline', () => {
    const tracker = new DeathEffectsTracker(), view = baseline();
    expect(tracker.update(view, true, 0)).toEqual([]);
    const dead = announce(view, [1, 1, 2], 1);
    expect(tracker.update(dead, true, 100).map(item => item.seat)).toEqual([1, 2]);
    expect(tracker.update(structuredClone(dead), true, 200).map(item => item.startedAt)).toEqual([100, 100]);
    expect(tracker.expire(100 + DEATH_EFFECT_MS)).toEqual([]);
    expect(tracker.update(dead, true, 4000)).toEqual([]);
    expect(new DeathEffectsTracker().update(dead, true, 5000)).toEqual([]);
  });

  it('keeps overlapping batches independently, and a revived seat may die again', () => {
    const tracker = new DeathEffectsTracker(), view = baseline();
    tracker.update(view, true, 0);
    const first = announce(view, [1], 1);
    tracker.update(first, true, 100);
    const second = announce(first, [2], 2);
    expect(tracker.update(second, true, 800).map(item => item.seat)).toEqual([1, 2]);
    expect(tracker.expire(100 + DEATH_EFFECT_MS).map(item => item.seat)).toEqual([2]);
    const revived = structuredClone(second); revived.viewVersion++;
    revived.public!.seats.find(seat => seat.seat === 2)!.alive = true;
    expect(tracker.update(revived, true, 3350)).toEqual([]);
    const again = announce(revived, [2], 3);
    expect(tracker.update(again, true, 3400)).toMatchObject([{ seat: 2, cursor: 3, startedAt: 3400 }]);
  });

  it('never derives public death from private state or a same-snapshot death followed by revival', () => {
    const tracker = new DeathEffectsTracker(), view = baseline(); tracker.update(view, true, 0);
    const privateOnly = structuredClone(view); privateOnly.viewVersion++;
    privateOnly.private!.self.life = 'dead';
    privateOnly.private!.events.push({ cursor: 10, type: 'night_deaths_confirmed', dayNumber: 1, stage: 1, payload: { seats: [1] } });
    expect(tracker.update(privateOnly, true, 100)).toEqual([]);
    const revived = announce(privateOnly, [1], 1);
    revived.public!.seats.find(seat => seat.seat === 1)!.alive = true;
    expect(tracker.update(revived, true, 200)).toEqual([]);
  });

  it('suppresses history after disconnect, hidden page, room/game/user/subject/read-only changes', () => {
    for (const change of [
      (v: RoomSnapshot) => { v.gameId += '-next'; },
      (v: RoomSnapshot) => { v.roomId += '-next'; },
      (v: RoomSnapshot) => { v.viewer.userId += '-next'; },
      (v: RoomSnapshot) => { v.viewer.subjectPlayerId = 'another'; },
      (v: RoomSnapshot) => { v.viewer.readOnly = true; },
    ]) {
      const tracker = new DeathEffectsTracker(), view = baseline(); tracker.update(view, true, 0);
      const dead = announce(view, [1], 1); change(dead);
      expect(tracker.update(dead, true, 100)).toEqual([]);
    }
    const tracker = new DeathEffectsTracker(), view = baseline(); tracker.update(view, true, 0);
    const dead = announce(view, [1], 1);
    expect(tracker.update(dead, false, 100)).toEqual([]);
    expect(tracker.update(dead, true, 200)).toEqual([]);
    expect(tracker.update(announce(dead, [2], 2), true, 300)).toMatchObject([{ seat: 2 }]);
    expect(tracker.update(null, true, 400)).toEqual([]);
  });

  it('preserves the final live announcement into review, but never replays when opening review', () => {
    const tracker = new DeathEffectsTracker(), view = baseline(); tracker.update(view, true, 0);
    const end = announce(view, [1], 1); end.room.phase = 'review'; end.public!.phase = 'ended';
    expect(tracker.update(end, true, 100)).toMatchObject([{ seat: 1 }]);
    expect(tracker.update(end, true, 200)).toMatchObject([{ seat: 1 }]);
    expect(new DeathEffectsTracker().update(end, true, 200)).toEqual([]);
    const lobby = structuredClone(end); lobby.room.phase = 'lobby';
    expect(tracker.update(lobby, true, 300)).toEqual([]);
  });

  it('ignores stale versions/cursors and invalid seats; public viewers still see public announcements', () => {
    const tracker = new DeathEffectsTracker(), view = baseline(); view.viewer.kind = 'public_spectator'; view.viewer.readOnly = true; view.private = null;
    tracker.update(view, true, 0);
    const dead = announce(view, [1, 0, -1, 5000], 1);
    expect(tracker.update(dead, true, 100)).toMatchObject([{ seat: 1 }]);
    expect(tracker.update(view, true, 200)).toMatchObject([{ seat: 1 }]);
    expect(tracker.update(dead, true, 300)).toMatchObject([{ seat: 1, startedAt: 100 }]);
  });

  it('caps shared particle budgets and yields deterministic bounded particles', () => {
    for (const width of [320, 390, 844, 1440]) for (const count of [1, 5, 13, 26, 64]) {
      const total = count * particleCount(width, count);
      expect(total).toBeLessThanOrEqual(width < 600 ? 100 : 220);
      expect(total).toBeGreaterThan(0);
    }
    expect(particleCount(390, 0)).toBe(0);
    const particles = makeParticles(17, 10);
    expect(particles).toEqual(makeParticles(17, 10));
    expect(particles).not.toEqual(makeParticles(18, 10));
    expect(particles).toHaveLength(10);
    expect(particles.every(p => p.life + p.delay < DEATH_EFFECT_MS / 1000)).toBe(true);
  });
});
