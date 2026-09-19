import type { EventDTO } from '../../../contracts/v2.ts';

/** Never derive death effects from a private life state or an unpublished result. */
export function publicDeathSeats(events: EventDTO[], afterCursor: number): number[] {
  const seats = new Set<number>();
  for (const event of events) {
    if (event.cursor <= afterCursor || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) continue;
    const payload = event.payload;
    const values = event.type === 'deaths_announced' && Array.isArray(payload.seats) ? payload.seats : event.type === 'elimination_announced' ? [payload.seat] : [];
    for (const value of values) if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) seats.add(value);
  }
  return [...seats];
}
