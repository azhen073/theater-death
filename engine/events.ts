import type { FactionId, RoleId } from '../rulesets/types.ts';
import type { CheckKind, Stage } from './types.ts';

export type EventVisibility =
  | { readonly kind: 'public' }
  | { readonly kind: 'players'; readonly playerIds: readonly string[] }
  | { readonly kind: 'faction'; readonly factionId: FactionId }
  | { readonly kind: 'server' };

export interface GameEvent<Type extends string = string, Payload = unknown> {
  readonly eventId: string;
  readonly seq: number;
  readonly dayNumber: number;
  readonly stage: Stage;
  readonly type: Type;
  readonly payload: Payload;
  readonly visibility: EventVisibility;
}

export interface SeatInfo {
  readonly playerId: string;
  readonly nickname: string;
  readonly seat: number;
}

export interface GameStartedPayload {
  readonly dayNumber: number;
  readonly seats: readonly SeatInfo[];
}

export interface RoleAssignedPayload {
  readonly playerId: string;
  readonly roleId: RoleId;
}

export interface SpiritKnowledgePayload {
  readonly seats: readonly number[];
}

export interface FactionRoomCreatedPayload {
  readonly roomId: string;
  readonly memberSeats: readonly number[];
}

export interface FactionRoomJoinedPayload {
  readonly roomId: string;
  readonly readOnly: boolean;
}

export interface DescenderCheckPayload {
  readonly nightNumber: number;
  readonly targetPlayerId: string;
  readonly targetSeat: number;
  readonly kind: CheckKind;
  readonly answer: boolean;
}

export function makeEvent<Type extends string, Payload>(input: {
  readonly seq: number;
  readonly dayNumber: number;
  readonly stage: Stage;
  readonly type: Type;
  readonly payload: Payload;
  readonly visibility: EventVisibility;
}): GameEvent<Type, Payload> {
  return {
    eventId: `e_${input.seq}`,
    seq: input.seq,
    dayNumber: input.dayNumber,
    stage: input.stage,
    type: input.type,
    payload: input.payload,
    visibility: input.visibility,
  };
}
