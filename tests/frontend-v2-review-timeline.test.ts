import { describe, expect, it } from 'vitest';
import {
  reviewDayAnchors,
  reviewDeathSeats,
  reviewVoteTally,
  type ReviewDTO,
  type ReviewEvent,
} from '../web-v2/src/features/review/model.ts';

const review = {
  players: [
    { playerId: 'p1', uid: 'u1', seat: 1, roleId: 'death', life: 'dead', revealed: true, nickname: '甲', avatarUrl: null },
    { playerId: 'p2', uid: 'u2', seat: 2, roleId: 'door', life: 'alive', revealed: false, nickname: '乙', avatarUrl: null },
    { playerId: 'p3', uid: 'u3', seat: 3, roleId: 'civilian', life: 'alive', revealed: false, nickname: '丙', avatarUrl: null },
  ],
} as unknown as ReviewDTO;

const event = (type: string, payload: ReviewEvent['payload'], dayNumber = 1): ReviewEvent => ({ dayNumber, stage: 1, type, payload });

describe('review timeline presentation adapters', () => {
  it('parses review election/ballot payloads with the public vote-tally parser (cursor fixed at 0)', () => {
    const election = reviewVoteTally(event('election_result', {
      votes: [{ voterSeat: 2, targetSeat: 1, units: 2 }, { voterSeat: 3, targetSeat: null, units: 2 }],
      tally: [{ seat: 1, units: 2 }],
      tiedSeats: [],
      winnerSeat: 1,
    }));
    expect(election).toMatchObject({
      kind: 'election', cursor: 0, dayNumber: 1, stage: 1,
      votes: [{ voterSeat: 2, targetSeat: 1, units: 2 }, { voterSeat: 3, targetSeat: null, units: 2 }],
      tally: [{ seat: 1, units: 2 }], tiedSeats: [], winnerSeat: 1, eliminatedSeat: null,
    });

    const ballot = reviewVoteTally(event('vote_result', {
      votes: [], tally: [{ seat: 2, units: 4 }, { seat: 3, units: 2 }], tiedSeats: [], eliminatedSeat: 2,
    }, 2));
    expect(ballot).toMatchObject({ kind: 'ballot', dayNumber: 2, eliminatedSeat: 2, winnerSeat: null });

    expect(reviewVoteTally(event('night_started', { nightNumber: 1 }))).toBeNull();
    // 畸形 payload 不崩溃：按空票型解析
    expect(reviewVoteTally(event('vote_result', 'garbage'))).toMatchObject({ votes: [], tally: [], eliminatedSeat: null });
  });

  it('extracts death seats for badge rows and keeps null/empty semantics', () => {
    expect(reviewDeathSeats(event('deaths_announced', { seats: [1, 3] }), review)).toEqual([1, 3]);
    expect(reviewDeathSeats(event('elimination_announced', { seat: 2 }), review)).toEqual([2]);
    expect(reviewDeathSeats(event('night_deaths_confirmed', { deaths: [{ playerId: 'p1' }, { playerId: 'p2' }] }), review)).toEqual([1, 2]);
    // 未识别/缺失的玩家静默跳过；空名单保留给文字行（「无人」）
    expect(reviewDeathSeats(event('night_deaths_confirmed', { deaths: [{ playerId: 'unknown' }] }), review)).toEqual([]);
    expect(reviewDeathSeats(event('deaths_announced', { seats: [] }), review)).toEqual([]);
    expect(reviewDeathSeats(event('elimination_announced', {}), review)).toEqual([]);
    expect(reviewDeathSeats(event('game_started', {}), review)).toBeNull();
  });

  it('builds day anchors in first-appearance order', () => {
    expect(reviewDayAnchors([
      event('game_started', {}), event('night_started', {}), event('day_ended', {}, 2), event('day_ended', {}, 2), event('day_ended', {}, 5),
    ])).toEqual([1, 2, 5]);
    expect(reviewDayAnchors([])).toEqual([]);
  });
});
