import { afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import { createApp } from '../server/app.ts';
import { createFakeClock, type FakeClock } from '../server/clock.ts';
import { createLogStore, type LogStore } from '../server/log-store.ts';
import { createBroadcaster, type Broadcaster } from '../server/realtime.ts';
import { RoomRegistry, type Room } from '../server/rooms.ts';
import type { VoiceService } from '../voice/livekit.ts';

export const TEST_SESSION_SECRET = 'test-secret';

export interface TestContext {
  clock: FakeClock;
  logStore: LogStore;
  registry: RoomRegistry;
  broadcaster: Broadcaster | null;
  base: string;
  close(): Promise<void>;
}

const contexts: TestContext[] = [];
const openSockets: ClientSocket[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    socket.disconnect();
  }
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

export async function startTestServer(
  options: { realtime?: boolean; voice?: VoiceService | null } = {},
): Promise<TestContext> {
  const clock = createFakeClock();
  const logStore = createLogStore(':memory:');
  const broadcaster = options.realtime === true ? createBroadcaster() : null;
  const voice = options.voice ?? null;
  const registry = new RoomRegistry({
    clock,
    ruleset: THEATER_DEATH_13,
    logStore,
    ...(broadcaster !== null ? { broadcaster } : {}),
    ...(voice !== null ? { voice } : {}),
  });
  const app = createApp({
    registry,
    clock,
    sessionSecret: TEST_SESSION_SECRET,
    cookieSecure: false,
    ...(broadcaster !== null ? { broadcaster } : {}),
    ...(voice !== null ? { voice } : {}),
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  if (broadcaster !== null) {
    broadcaster.attach(server, { registry, sessionSecret: TEST_SESSION_SECRET });
  }
  const address = server.address() as AddressInfo;
  const context: TestContext = {
    clock,
    logStore,
    registry,
    broadcaster,
    base: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
  contexts.push(context);
  return context;
}

export interface HttpResponse {
  status: number;
  json: Record<string, unknown>;
  cookie: string | null;
  rawSetCookie: string | null;
}

export async function postJson(
  context: TestContext,
  path: string,
  body: unknown,
  cookie?: string,
): Promise<HttpResponse> {
  const response = await fetch(`${context.base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const setCookieList =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const rawSetCookie = setCookieList[0] ?? response.headers.get('set-cookie');
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
    cookie: rawSetCookie?.split(';')[0] ?? null,
    rawSetCookie: rawSetCookie ?? null,
  };
}

export async function getJson(
  context: TestContext,
  path: string,
  cookie?: string,
): Promise<HttpResponse> {
  const response = await fetch(`${context.base}${path}`, {
    headers: cookie !== undefined ? { cookie } : {},
  });
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
    cookie: null,
    rawSetCookie: null,
  };
}

export interface Client {
  playerId: string;
  cookie: string;
}

export async function setupLobby(context: TestContext) {
  const host = await postJson(context, '/api/rooms', { nickname: '玩家1' });
  const roomCode = host.json.roomCode as string;
  const clients: Client[] = [{ playerId: host.json.playerId as string, cookie: host.cookie ?? '' }];
  for (let index = 2; index <= 13; index += 1) {
    const joined = await postJson(context, `/api/rooms/${roomCode}/join`, {
      nickname: `玩家${index}`,
    });
    clients.push({ playerId: joined.json.playerId as string, cookie: joined.cookie ?? '' });
  }
  return { roomCode, clients, hostClient: clients[0] };
}

export async function setupStartedGame(context: TestContext) {
  const lobby = await setupLobby(context);
  for (const client of lobby.clients) {
    await postJson(context, `/api/rooms/${lobby.roomCode}/ready`, { ready: true }, client.cookie);
  }
  await postJson(context, `/api/rooms/${lobby.roomCode}/start`, {}, lobby.hostClient.cookie);
  const room = context.registry.getByCode(lobby.roomCode) as Room;
  return { ...lobby, room };
}

export function clientForRole(room: Room, clients: Client[], roleId: string): Client {
  const player = room.state?.players.find((item) => item.roleId === roleId);
  if (player === undefined) {
    throw new Error(`房间中没有 ${roleId}`);
  }
  const client = clients.find((item) => item.playerId === player.playerId);
  if (client === undefined) {
    throw new Error('找不到对应玩家会话');
  }
  return client;
}

export interface TestSocket {
  socket: ClientSocket;
  hellos: Array<Record<string, unknown>>;
  gameEvents: Array<{
    flow: string;
    type: string;
    dayNumber: number;
    stage: number;
    payload: unknown;
  }>;
  chatMessages: Array<Record<string, unknown>>;
  voicePermissions: Array<Record<string, unknown>>;
}

export async function connectClient(context: TestContext, cookie: string): Promise<TestSocket> {
  const socket = ioClient(context.base, {
    extraHeaders: { cookie },
    reconnection: false,
  });
  const client: TestSocket = {
    socket,
    hellos: [],
    gameEvents: [],
    chatMessages: [],
    voicePermissions: [],
  };
  socket.on('hello', (payload: Record<string, unknown>) => {
    client.hellos.push(payload);
  });
  socket.on(
    'game_event',
    (event: { flow: string; type: string; dayNumber: number; stage: number; payload: unknown }) => {
      client.gameEvents.push(event);
    },
  );
  socket.on('chat_message', (message: Record<string, unknown>) => {
    client.chatMessages.push(message);
  });
  socket.on('voice_permission', (permission: Record<string, unknown>) => {
    client.voicePermissions.push(permission);
  });
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (error: Error) => reject(error));
  });
  openSockets.push(socket);
  return client;
}

export async function expectConnectFailure(context: TestContext, cookie: string): Promise<void> {
  const socket = ioClient(context.base, {
    extraHeaders: { cookie },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => {
      socket.disconnect();
      reject(new Error('连接不应成功'));
    });
    socket.on('connect_error', () => {
      socket.disconnect();
      resolve();
    });
  });
}

export async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('等待超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
