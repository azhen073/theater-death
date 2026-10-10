import type { EventDTO } from '../../../contracts/v2.ts';
import type { SessionStore } from '../features/game/identity-reveal-model.ts';

/** 结构化票型；只从公开的 election_result / vote_result 事件解析，绝不读私人数据。 */
export interface VoteTally {
  kind: 'election' | 'ballot';
  cursor: number;
  dayNumber: number;
  stage: 1 | 2;
  votes: { voterSeat: number; targetSeat: number | null; units: number }[];
  tally: { seat: number; units: number }[];
  tiedSeats: number[];
  winnerSeat: number | null;
  eliminatedSeat: number | null;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const seatNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
const unitsNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

export function isVoteTallyEvent(type: string): boolean {
  return type === 'election_result' || type === 'vote_result';
}

export function parseVoteTally(event: Pick<EventDTO, 'type' | 'payload' | 'cursor' | 'dayNumber' | 'stage'>): VoteTally | null {
  if (!isVoteTallyEvent(event.type)) return null;
  const payload = record(event.payload);
  const votes = (Array.isArray(payload.votes) ? payload.votes : []).map(value => {
    const vote = record(value);
    const voterSeat = seatNumber(vote.voterSeat);
    if (voterSeat === null) return null;
    const targetSeat = vote.targetSeat === null ? null : seatNumber(vote.targetSeat);
    return { voterSeat, targetSeat, units: unitsNumber(vote.units) };
  }).filter((vote): vote is VoteTally['votes'][number] => vote !== null);
  const tally = (Array.isArray(payload.tally) ? payload.tally : []).map(value => {
    const row = record(value);
    const seat = seatNumber(row.seat);
    return seat === null ? null : { seat, units: unitsNumber(row.units) };
  }).filter((row): row is VoteTally['tally'][number] => row !== null)
    .sort((a, b) => b.units - a.units || a.seat - b.seat);
  const tiedSeats = (Array.isArray(payload.tiedSeats) ? payload.tiedSeats : [])
    .map(seatNumber).filter((seat): seat is number => seat !== null);
  return {
    kind: event.type === 'election_result' ? 'election' : 'ballot',
    cursor: event.cursor,
    dayNumber: event.dayNumber,
    stage: event.stage,
    votes,
    tally,
    tiedSeats,
    winnerSeat: seatNumber(payload.winnerSeat),
    eliminatedSeat: seatNumber(payload.eliminatedSeat),
  };
}

/** 游标基线防重播：只看晚于基线的最新一条票型事件，历史快照不弹开票卡。 */
export function latestVoteTally(events: EventDTO[], afterCursor: number): VoteTally | null {
  let latest: VoteTally | null = null;
  for (const event of events) {
    if (event.cursor <= afterCursor) continue;
    const tally = parseVoteTally(event);
    if (tally && (!latest || tally.cursor > latest.cursor)) latest = tally;
  }
  return latest;
}

const prefix = 'theater-death:vote-tally:v1:';

/** 消费即去重：被压制的票型同样记账，刷新/重连/重现后不补播。 */
export function claimVoteTally(store: SessionStore, scope: string, cursor: number): boolean {
  const key = prefix + scope + ':' + cursor;
  try {
    if (store.getItem(key) !== null) return false;
    store.setItem(key, 'seen');
    return true;
  } catch {
    return false;
  }
}
