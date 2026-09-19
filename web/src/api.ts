import { io, type Socket } from 'socket.io-client';
import type { RulesetConfig } from '../../rulesets/types.ts';
import type {
  ChatMessage,
  CommandReceipt,
  PushEvent,
  ReviewView,
  ViewResponse,
  VoicePermission,
  VoicePermissionPush,
  VoiceTokenResponse,
  WatchCandidate,
} from './types.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let code = 'request_failed';
    let message = `请求失败（${response.status}）`;
    try {
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      if (typeof payload.error?.code === 'string') {
        code = payload.error.code;
      }
      if (typeof payload.error?.message === 'string') {
        message = payload.error.message;
      }
    } catch {
      // 非 JSON 响应保留默认文案
    }
    throw new ApiError(response.status, code, message);
  }
  return (await response.json()) as T;
}

export const api = {
  createRoom(nickname: string, ruleset?: RulesetConfig) {
    return request<{ roomCode: string; playerId: string }>('POST', '/api/rooms', {
      nickname,
      ...(ruleset === undefined ? {} : { ruleset }),
    });
  },
  joinRoom(code: string, nickname: string) {
    return request<{ roomCode: string; playerId: string }>('POST', `/api/rooms/${code}/join`, {
      nickname,
    });
  },
  setReady(code: string, ready: boolean) {
    return request<{ ready: boolean }>('POST', `/api/rooms/${code}/ready`, { ready });
  },
  leaveRoom(code: string) {
    return request<{ left: boolean; dissolved: boolean }>('POST', `/api/rooms/${code}/leave`);
  },
  /** 房主移出成员（仅未开局）或观战者（不限阶段） */
  kickMember(code: string, targetPlayerId: string) {
    return request<{ kicked: boolean; kind: 'player' }>('POST', `/api/rooms/${code}/kick`, {
      targetPlayerId,
    });
  },
  kickSpectator(code: string, targetSpectatorId: string) {
    return request<{ kicked: boolean; kind: 'spectator' }>('POST', `/api/rooms/${code}/kick`, {
      targetSpectatorId,
    });
  },
  /** 观战入口：读取公开成员名单（选择绑定目标） */
  roomMembers(code: string) {
    return request<{
      roomCode: string;
      phase: 'lobby' | 'started';
      requiredPlayers: number;
      memberCount: number;
      members: WatchCandidate[];
    }>('GET', `/api/rooms/${code}/members`);
  },
  watchRoom(code: string, nickname: string, bindPlayerId: string) {
    return request<{ roomCode: string; spectatorId: string; bindPlayerId: string }>(
      'POST',
      `/api/rooms/${code}/watch`,
      { nickname, bindPlayerId },
    );
  },
  leaveSpectate() {
    return request<{ left: boolean }>('POST', '/api/spectate/leave');
  },
  startGame(code: string) {
    return request<{ started: boolean; dayNumber: number }>('POST', `/api/rooms/${code}/start`);
  },
  view() {
    return request<ViewResponse>('GET', '/api/view');
  },
  review() {
    return request<{ review: ReviewView }>('GET', '/api/review');
  },
  command(requestId: string, action: string, extra: Record<string, unknown> = {}) {
    return request<CommandReceipt>('POST', '/api/command', { requestId, action, ...extra });
  },
  chatHistory(channel: 'public' | 'faction', since = 0) {
    return request<{ messages: ChatMessage[] }>(
      'GET',
      `/api/chat?channel=${channel}&since=${since}`,
    );
  },
  sendChat(channel: 'public' | 'faction', text: string) {
    return request<{ id: number; channel: string; at: number; eventSeq: number }>(
      'POST',
      '/api/chat',
      { channel, text },
    );
  },
  voiceToken() {
    return request<VoiceTokenResponse>('POST', '/api/voice/token');
  },
  voiceSync() {
    return request<{ permission: VoicePermission; token: string }>('POST', '/api/voice/sync');
  },
};

export interface SocketHandlers {
  onGameEvent(event: PushEvent): void;
  onChatMessage(message: ChatMessage): void;
  onVoicePermission(push: VoicePermissionPush): void;
  onConnect(): void;
  onDisconnect(): void;
}

export function connectSocket(handlers: SocketHandlers): Socket {
  const socket = io();
  socket.on('connect', handlers.onConnect);
  socket.on('disconnect', handlers.onDisconnect);
  socket.on('game_event', (event: PushEvent) => handlers.onGameEvent(event));
  socket.on('chat_message', (message: ChatMessage) => handlers.onChatMessage(message));
  socket.on('voice_permission', (push: VoicePermissionPush) => handlers.onVoicePermission(push));
  return socket;
}
