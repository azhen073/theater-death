import type { GameEvent } from '../engine/events.ts';
import type { GameState } from '../engine/types.ts';
import type { RoleId } from '../rulesets/types.ts';

/** Public facts are derived only from public announcements, never from internal death flags. */
export function publishedState(state: GameState, events: readonly GameEvent[]): GameState {
  const alive = new Map(state.players.map((p) => [p.seat, true]));
  const revealed = new Set<number>();
  const revived = new Map<number, Set<number>>();
  for (const event of events) {
    if (event.visibility.kind !== 'public') continue;
    const p = event.payload as { seats?: number[]; seat?: number; targetSeat?: number; reveals?: { seat: number; roleId: RoleId }[] };
    if (event.type === 'deaths_announced') for (const seat of p.seats ?? []) alive.set(seat, revived.get(event.dayNumber)?.has(seat) ?? false);
    if (event.type === 'elimination_announced' && p.seat !== undefined) alive.set(p.seat, false);
    if (event.type === 'revive_announced' && p.targetSeat !== undefined) {
      alive.set(p.targetSeat, true);
      const seats = revived.get(event.dayNumber) ?? new Set<number>();
      seats.add(p.targetSeat);
      revived.set(event.dayNumber, seats);
    }
    if (event.type === 'door_returned' && p.seat !== undefined) alive.set(p.seat, true);
    if (event.type === 'reveal_announced') for (const reveal of p.reveals ?? []) revealed.add(reveal.seat);
  }
  return { ...state, players: state.players.map((p) => ({ ...p, life: alive.get(p.seat) ? 'alive' : 'dead', revealed: revealed.has(p.seat), voteFrozen: p.roleId === 'laike' && revealed.has(p.seat) && state.stage === 1 })) };
}
