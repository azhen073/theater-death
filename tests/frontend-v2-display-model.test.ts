import { describe, expect, it } from 'vitest';
import type { EventDTO } from '../contracts/v2.ts';
import { defaultPreferences, parsePreferences } from '../web-v2/src/state/preferences-model.ts';
import { publicDeathSeats } from '../web-v2/src/presentation/death-events.ts';

function event(cursor: number, type: string, payload: unknown): EventDTO {
  return { cursor, type, dayNumber: 1, stage: 1, payload: payload as EventDTO['payload'] };
}

describe('v2 display preference model', () => {
  it('returns the full default for absent, null, primitive, array, and invalid local data', () => {
    for (const value of [undefined, null, 'token', 42, [], { motion: 'unexpected', deathEffects: 'yes', scale: 125 }]) {
      expect(parsePreferences(value)).toEqual(defaultPreferences);
    }
  });

  it('keeps only the three non-sensitive allowed fields and strips tokens/user objects', () => {
    const parsed = parsePreferences({ motion: 'full', deathEffects: false, scale: 110, token: 'secret', user: { id: 'u1' }, room: 'room' });
    expect(parsed).toEqual({ motion: 'full', deathEffects: false, scale: 110 });
    expect(Object.keys(parsed).sort()).toEqual(['deathEffects', 'motion', 'scale']);
    expect(parsed).not.toHaveProperty('token');
    expect(parsed).not.toHaveProperty('user');
  });

  it('accepts system/full/reduced motion, both deathEffects values, and only 90/100/110 scales', () => {
    expect(parsePreferences({ motion: 'system', deathEffects: true, scale: 90 })).toEqual({ motion: 'system', deathEffects: true, scale: 90 });
    expect(parsePreferences({ motion: 'reduced', deathEffects: false, scale: 100 })).toEqual({ motion: 'reduced', deathEffects: false, scale: 100 });
    expect(parsePreferences({ motion: 'full', deathEffects: true, scale: 110 })).toEqual({ motion: 'full', deathEffects: true, scale: 110 });
    expect(parsePreferences({ motion: 'full', scale: 95 })).toEqual({ motion: 'full', deathEffects: true, scale: 100 });
    expect(parsePreferences({ motion: 'system', scale: '110' })).toEqual(defaultPreferences);
  });
});

describe('v2 public death event projection', () => {
  it('uses only post-cursor public death events, validates positive safe seats, and deduplicates', () => {
    const events = [
      event(4, 'deaths_announced', { seats: [3, 5, 3, 0, -1, 1.5, 7] }),
      event(5, 'elimination_announced', { seat: 17 }),
      event(6, 'deaths_announced', { seats: [5, 9, 11] }),
      event(7, 'deaths_announced', { seats: [Number.POSITIVE_INFINITY, 13] }),
    ];
    expect(publicDeathSeats(events, 4)).toEqual([17, 5, 9, 11, 13]);
    expect(publicDeathSeats(events, 5)).toEqual([5, 9, 11, 13]);
  });

  it('ignores private roles, private/night confirmation, unpublished results, arrays, and old cursors', () => {
    const events = [
      event(1, 'deaths_announced', { seats: [2] }),
      event(2, 'role_assigned', { roleId: 'death', seat: 3 }),
      event(3, 'night_deaths_confirmed', { seats: [4, 5] }),
      event(4, 'game_ended', { result: { seats: [6] } }),
      event(5, 'deaths_announced', [7]),
      event(6, 'elimination_announced', { seat: 8, roleId: 'door' }),
    ];
    expect(publicDeathSeats(events, 1)).toEqual([8]);
  });
});
