import { describe, expect, it } from 'vitest';
import type { RoomSnapshot, TaskDTO } from '../contracts/v2.ts';
import { claimIdentityReveal, identityRevealHasUrgentAction, identityRevealKey } from '../web-v2/src/features/game/identity-reveal-model.ts';

function view(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomId: 'room-1', gameId: 'game-1', room: { phase: 'playing' },
    viewer: { kind: 'formal', readOnly: false, subjectPlayerId: 'player-1' },
    private: { self: { playerId: 'player-1' } },
    ...overrides,
  } as RoomSnapshot;
}

function store(initial?: string) {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, value: () => value };
}

describe('entry identity reveal', () => {
  it('keys a formal writable player by room, game, and subject', () => {
    expect(identityRevealKey(view())).toBe('theater-death:identity-reveal:v1:["room-1","game-1","player-1"]');
    expect(identityRevealKey(view({ viewer: { ...view().viewer, kind: 'public_spectator', readOnly: true } }))).toBeNull();
    expect(identityRevealKey(view({ viewer: { ...view().viewer, kind: 'private_spectator', readOnly: true } }))).toBeNull();
    expect(identityRevealKey(view({ room: { ...view().room, phase: 'review' } }))).toBeNull();
    expect(identityRevealKey(view({ private: null }))).toBeNull();
  });

  it('claims once before showing and skips an urgent action for the whole game', () => {
    const shown = store();
    expect(claimIdentityReveal(shown, 'key', false)).toBe('show');
    expect(shown.value()).toBe('shown');
    expect(claimIdentityReveal(shown, 'key', false)).toBe('none');
    const urgent = store();
    expect(claimIdentityReveal(urgent, 'key', true)).toBe('skip');
    expect(urgent.value()).toBe('skipped-for-action');
    expect(claimIdentityReveal(urgent, 'key', false)).toBe('none');
  });

  it('treats ten seconds and unknown countdowns as urgent', () => {
    const task = { closesAt: 20_000 } as TaskDTO;
    expect(identityRevealHasUrgentAction([task], () => 10_001)).toBe(false);
    expect(identityRevealHasUrgentAction([task], () => 10_000)).toBe(true);
    expect(identityRevealHasUrgentAction([task], () => null)).toBe(true);
    expect(identityRevealHasUrgentAction([], () => null)).toBe(false);
  });

  it('does not show repeatedly when session storage is unavailable', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(claimIdentityReveal(broken, 'key', false)).toBe('none');
  });
});
