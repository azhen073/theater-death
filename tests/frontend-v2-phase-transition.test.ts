import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../contracts/v2.ts';
import { claimPublicPhase, phaseTransitionTitle, publicPhaseStamp, type PublicPhaseStamp } from '../web-v2/src/features/game/phase-transition-model.ts';

const night: PublicPhaseStamp = { scope: 'room/game/player', day: 1, stage: 1, light: 'night' };
describe('public phase transitions', () => {
  it('does not animate an initial snapshot, unchanged phase, or another scope', () => {
    expect(phaseTransitionTitle(null, night)).toBeNull();
    expect(phaseTransitionTitle(night, { ...night })).toBeNull();
    expect(phaseTransitionTitle(night, { ...night, scope: 'other', light: 'day' })).toBeNull();
    expect(phaseTransitionTitle(night, null)).toBeNull();
  });
  it('announces dawn, night, and stage two with stage two taking priority', () => {
    const day = { ...night, light: 'day' as const };
    expect(phaseTransitionTitle(night, day)).toBe('天光初现');
    expect(phaseTransitionTitle(day, { ...night, day: 2 })).toBe('夜幕降临');
    expect(phaseTransitionTitle(night, { ...day, stage: 2 })).toBe('第二阶段开启');
    expect(phaseTransitionTitle({ ...night, day: 2 }, day)).toBeNull();
  });
  it('uses only public day/night and stage; morning and day are one light period', () => {
    const view = { roomId: 'r', gameId: 'g', room: { phase: 'playing' }, viewer: { userId: 'u', kind: 'formal', subjectPlayerId: 'p' }, public: { phase: 'morning', dayNumber: 1, stage: 1 } } as RoomSnapshot;
    const morning = publicPhaseStamp(view);
    view.public!.phase = 'day';
    expect(publicPhaseStamp(view)).toEqual(morning);
    view.room.phase = 'review';
    expect(publicPhaseStamp(view)).toBeNull();
  });
  it('claims once per phase including suppressed transitions, with separate games', () => {
    const values = new Map<string, string>();
    const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(claimPublicPhase(store, night)).toBe(true);
    expect(claimPublicPhase(store, night)).toBe(false);
    expect(claimPublicPhase(store, { ...night, light: 'day' })).toBe(true);
    expect(claimPublicPhase(store, { ...night, scope: 'other' })).toBe(true);
  });
  it('fails closed when session storage is unavailable', () => {
    expect(claimPublicPhase({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined }, night)).toBe(false);
  });
});
