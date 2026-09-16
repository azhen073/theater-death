import { io, type Socket } from 'socket.io-client';
import type {
  ChatMessage,
  CommandReceipt,
  PushEvent,
  ReviewView,
  ViewResponse,
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
  createRoom(nickname: string) {
    return request<{ roomCode: string; playerId: string }>('POST', '/api/rooms', { nickname });
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
};

export interface SocketHandlers {
  onGameEvent(event: PushEvent): void;
  onChatMessage(message: ChatMessage): void;
  onConnect(): void;
  onDisconnect(): void;
}

export function connectSocket(handlers: SocketHandlers): Socket {
  const socket = io();
  socket.on('connect', handlers.onConnect);
  socket.on('disconnect', handlers.onDisconnect);
  socket.on('game_event', (event: PushEvent) => handlers.onGameEvent(event));
  socket.on('chat_message', (message: ChatMessage) => handlers.onChatMessage(message));
  return socket;
}
