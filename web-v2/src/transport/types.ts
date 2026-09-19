import type { MemberKind, RoomPhase } from '../../../contracts/v2.ts';
import type { RoleId } from '../../../rulesets/types.ts';

export interface RoomEntry {
  roomId: string; roomCode: string; gameId: string | null; memberId: string;
  kind: MemberKind; playerId: string | null;
}
export interface MyRoom {
  roomId: string; roomCode: string; gameId: string | null; phase: RoomPhase;
  memberId: string | null; kind: MemberKind | null; playerId: string | null;
  activeHere: boolean; controlling: boolean; canRecover: boolean; requiresTakeover: boolean;
}
export interface MyRooms { currentRoomId: string | null; rooms: MyRoom[] }
export interface Review {
  gameId: string; winner: 'human' | 'death_faction'; reason: string; endedAtDay: number;
  startedAt: number; endedAt: number; durationMs: number;
  players: { playerId: string; uid: string; seat: number; nickname: string; avatarUrl: string | null; roleId: RoleId; life: 'alive' | 'dead'; revealed: boolean }[];
  timeline: { dayNumber: number; stage: 1 | 2; type: string; payload: unknown }[];
  chat: Record<'public' | 'faction', { id: number; senderId: string; senderSeat: number | null; text: string; at: number; messageId: string }[]>;
}
