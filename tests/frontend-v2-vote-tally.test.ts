import { describe, expect, it } from 'vitest';
import type { EventDTO } from '../contracts/v2.ts';
import { claimVoteTally, latestVoteTally, parseVoteTally } from '../web-v2/src/presentation/vote-tally.ts';

function tallyEvent(type: string, cursor: number, payload: unknown): EventDTO {
  return { cursor, type, dayNumber: 2, stage: 1, payload: payload as EventDTO['payload'] };
}

const electionPayload = {
  votes: [
    { voterSeat: 1, targetSeat: 3, units: 2 },
    { voterSeat: 2, targetSeat: 3, units: 2 },
    { voterSeat: 4, targetSeat: 5, units: 3 },
    { voterSeat: 6, targetSeat: null, units: 2 },
  ],
  tally: [{ seat: 3, units: 4 }, { seat: 5, units: 3 }],
  tiedSeats: [],
  winnerSeat: 3,
};

describe('vote tally model', () => {
  it('parses election and ballot payloads into structured tallies sorted by units', () => {
    const election = parseVoteTally(tallyEvent('election_result', 9, electionPayload));
    expect(election).toMatchObject({
      kind: 'election', cursor: 9, dayNumber: 2, winnerSeat: 3, eliminatedSeat: null,
      votes: [
        { voterSeat: 1, targetSeat: 3, units: 2 },
        { voterSeat: 2, targetSeat: 3, units: 2 },
        { voterSeat: 4, targetSeat: 5, units: 3 },
        { voterSeat: 6, targetSeat: null, units: 2 },
      ],
      tally: [{ seat: 3, units: 4 }, { seat: 5, units: 3 }],
    });
    const ballot = parseVoteTally(tallyEvent('vote_result', 10, {
      votes: [], tally: [{ seat: 2, units: 5 }, { seat: 7, units: 5 }], tiedSeats: [2, 7], eliminatedSeat: null,
    }));
    expect(ballot).toMatchObject({ kind: 'ballot', tiedSeats: [2, 7], eliminatedSeat: null, winnerSeat: null });
    expect(ballot!.tally.map(row => row.seat)).toEqual([2, 7]);
  });

  it('rejects non-tally events and sanitizes malformed payload entries', () => {
    expect(parseVoteTally(tallyEvent('deaths_announced', 1, { seats: [1] }))).toBeNull();
    expect(parseVoteTally(tallyEvent('election_result', 2, null))).toMatchObject({ kind: 'election', votes: [], tally: [], tiedSeats: [] });
    const messy = parseVoteTally(tallyEvent('vote_result', 3, {
      votes: [{ voterSeat: 'x', targetSeat: 1, units: 2 }, { voterSeat: 2, targetSeat: 'secret', units: -4 }, 'garbage'],
      tally: [{ seat: 0, units: 2 }, { seat: 4, units: Number.NaN }],
      tiedSeats: [0, 'x', 5],
    }));
    expect(messy!.votes).toEqual([{ voterSeat: 2, targetSeat: null, units: 0 }]);
    expect(messy!.tally).toEqual([{ seat: 4, units: 0 }]);
    expect(messy!.tiedSeats).toEqual([5]);
  });

  it('returns only the newest tally strictly after the cursor baseline', () => {
    const events = [
      tallyEvent('election_result', 5, electionPayload),
      tallyEvent('vote_result', 8, { votes: [], tally: [{ seat: 2, units: 6 }], tiedSeats: [], eliminatedSeat: 2 }),
      tallyEvent('day_ended', 9, {}),
    ];
    expect(latestVoteTally(events, 0)).toMatchObject({ kind: 'ballot', cursor: 8, eliminatedSeat: 2 });
    expect(latestVoteTally(events, 5)).toMatchObject({ kind: 'ballot', cursor: 8 });
    expect(latestVoteTally(events, 8)).toBeNull();
    expect(latestVoteTally(events, 100)).toBeNull();
  });

  it('claims each tally once per scope and fails closed without storage', () => {
    const values = new Map<string, string>();
    const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(claimVoteTally(store, 'room/game/player', 8)).toBe(true);
    expect(claimVoteTally(store, 'room/game/player', 8)).toBe(false);
    expect(claimVoteTally(store, 'room/game/player', 9)).toBe(true);
    expect(claimVoteTally(store, 'other-scope', 8)).toBe(true);
    expect(claimVoteTally({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined }, 'room', 8)).toBe(false);
  });
});
