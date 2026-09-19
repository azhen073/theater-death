import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import type { GameEvent } from '../engine/events.ts';
import type { GameState } from '../engine/types.ts';
import { ROLE_DEFINITIONS } from '../rulesets/roles.ts';
import { canReadRoomMessage, roomMembership } from '../visibility/index.ts';
import type { VoicePermissionPush } from '../voice/policy.ts';
import type { ChatMessage, RoomRegistry } from './rooms.ts';
import { SESSION_COOKIE_NAME, verifySession } from './session.ts';

export interface PushEvent {
  readonly flow: 'public' | 'personal';
  readonly type: string;
  readonly dayNumber: number;
  readonly stage: number;
  readonly payload: unknown;
}

export interface BroadcasterDeps {
  readonly registry: RoomRegistry;
  readonly sessionSecret: string;
}

export interface Broadcaster {
  attach(server: HttpServer, deps: BroadcasterDeps): void;
  emitGameEvents(gameId: string, events: readonly GameEvent[], state: GameState): void;
  emitChat(gameId: string, state: GameState, message: ChatMessage): void;
  emitVoicePermission(gameId: string, perPlayer: ReadonlyMap<string, VoicePermissionPush>): void;
}

function roomChannel(gameId: string): string {
  return `game:${gameId}`;
}

function playerChannel(gameId: string, playerId: string): string {
  return `player:${gameId}:${playerId}`;
}

function toPushEvent(event: GameEvent, flow: 'public' | 'personal'): PushEvent {
  return {
    flow,
    type: event.type,
    dayNumber: event.dayNumber,
    stage: event.stage,
    payload: event.payload,
  };
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) {
    return null;
  }
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (trimmed.slice(0, separator) === name) {
      return trimmed.slice(separator + 1);
    }
  }
  return null;
}

export function createBroadcaster(): Broadcaster {
  let io: IOServer | null = null;

  return {
    attach(server, deps) {
      if (io !== null) {
        throw new Error('实时通道已经挂载');
      }
      io = new IOServer(server);

      io.use((socket, next) => {
        const raw = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME);
        const session = raw === null ? null : verifySession(raw, deps.sessionSecret);
        if (session === null) {
          next(new Error('unauthorized'));
          return;
        }
        const room = deps.registry.getByGameId(session.gameId);
        if (room === null) {
          next(new Error('room_not_found'));
          return;
        }
        if (session.kind === 'spectator') {
          const spectator = room.spectators.find((item) => item.spectatorId === session.playerId);
          if (spectator === undefined) {
            next(new Error('not_member'));
            return;
          }
          // 观众与绑定玩家共用个人频道：收到同一事件流；只读由 HTTP 命令层拒绝
          socket.data.gameId = session.gameId;
          socket.data.playerId = spectator.bindPlayerId;
          socket.data.spectatorId = spectator.spectatorId;
          next();
          return;
        }
        const member = room.members.find((item) => item.playerId === session.playerId);
        if (member === undefined) {
          next(new Error('not_member'));
          return;
        }
        socket.data.gameId = session.gameId;
        socket.data.playerId = session.playerId;
        next();
      });

      io.on('connection', (socket) => {
        const gameId = socket.data.gameId as string;
        const playerId = socket.data.playerId as string;
        const spectatorId = (socket.data.spectatorId as string | undefined) ?? null;
        socket.join(roomChannel(gameId));
        socket.join(playerChannel(gameId, playerId));
        const room = deps.registry.getByGameId(gameId);
        socket.emit('hello', {
          gameId,
          playerId,
          roomCode: room?.code ?? null,
          kind: spectatorId === null ? 'player' : 'spectator',
          spectatorId,
        });
      });
    },

    emitGameEvents(gameId, events, state) {
      const server = io;
      if (server === null) {
        return;
      }
      for (const event of events) {
        switch (event.visibility.kind) {
          case 'public':
            server.to(roomChannel(gameId)).emit('game_event', toPushEvent(event, 'public'));
            break;
          case 'players':
            for (const playerId of event.visibility.playerIds) {
              server
                .to(playerChannel(gameId, playerId))
                .emit('game_event', toPushEvent(event, 'personal'));
            }
            break;
          case 'faction':
            for (const player of state.players) {
              if (ROLE_DEFINITIONS[player.roleId].factionId === event.visibility.factionId) {
                server
                  .to(playerChannel(gameId, player.playerId))
                  .emit('game_event', toPushEvent(event, 'personal'));
              }
            }
            break;
          case 'server':
            break;
        }
      }
    },

    emitChat(gameId, state, message) {
      const server = io;
      if (server === null) {
        return;
      }
      if (message.channel === 'public') {
        server.to(roomChannel(gameId)).emit('chat_message', message);
        return;
      }
      for (const player of state.players) {
        if (
          roomMembership(state, player.playerId) !== null &&
          canReadRoomMessage(state, player.playerId, message.eventSeq)
        ) {
          server.to(playerChannel(gameId, player.playerId)).emit('chat_message', message);
        }
      }
    },

    emitVoicePermission(gameId, perPlayer) {
      const server = io;
      if (server === null) {
        return;
      }
      for (const [playerId, push] of perPlayer) {
        server.to(playerChannel(gameId, playerId)).emit('voice_permission', push);
      }
    },
  };
}
