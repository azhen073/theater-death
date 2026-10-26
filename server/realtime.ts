import type { GameEvent } from '../engine/events.ts';
import type { GameState } from '../engine/types.ts';
import type { VoicePermissionPush } from '../voice/policy.ts';
import type { ChatMessage } from './rooms.ts';

export interface Broadcaster {
  attach(...args: unknown[]): void;
  emitGameEvents(gameId: string, events: readonly GameEvent[], state: GameState): void;
  emitChat(gameId: string, state: GameState, message: ChatMessage): void;
  emitVoicePermission(gameId: string, perPlayer: ReadonlyMap<string, VoicePermissionPush>): void;
}
