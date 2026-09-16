import { makeEvent, type EventVisibility, type GameEvent } from './events.ts';
import type { Stage } from './types.ts';

export interface EventCollector {
  emit<Type extends string, Payload>(
    type: Type,
    payload: Payload,
    visibility: EventVisibility,
  ): GameEvent<Type, Payload>;
  result(): { readonly events: GameEvent[]; readonly eventSeq: number };
}

export function createEmitter(input: {
  readonly dayNumber: number;
  readonly stage: Stage;
  readonly startSeq: number;
}): EventCollector {
  const events: GameEvent[] = [];
  let seq = input.startSeq;

  return {
    emit(type, payload, visibility) {
      seq += 1;
      const event = makeEvent({
        seq,
        dayNumber: input.dayNumber,
        stage: input.stage,
        type,
        payload,
        visibility,
      });
      events.push(event);
      return event;
    },
    result() {
      return { events, eventSeq: seq };
    },
  };
}
