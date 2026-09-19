import { createServer, type Server } from 'node:http';
import { io as ioClient, type Socket } from 'socket.io-client';
import { AccountStore } from '../server/v2/account-store.ts';
import { createV2App } from '../server/v2/app.ts';
import { createFakeClock, type FakeClock } from '../server/clock.ts';
import { createLogStore, type LogStore } from '../server/log-store.ts';
import type { VoiceCredentials, VoiceService } from '../voice/agora.ts';

export interface User { uid: string; nickname: string; userId: string; cookie: string; sessionId: string }
export interface HttpHarness {
  app: ReturnType<typeof createV2App>;
  accounts: AccountStore;
  clock: FakeClock;
  logStore: LogStore;
  users: User[];
  server: Server;
  base: string;
  close(): Promise<void>;
}

export class MockVoice implements VoiceService {
  readonly issued: Array<{ roomName: string; uid: number }> = [];
  readonly closed: string[] = [];
  readonly removed: Array<{ roomName: string; uid: number }> = [];
  issueCredentials(input: { roomName: string; uid: number }): VoiceCredentials {
    this.issued.push(input);
    return { appId: 'appid-test', channel: input.roomName, uid: input.uid, token: `token:${input.uid}` };
  }
  issuePublishGrant(input: { roomName: string; uid: number }): { token: string; expiresAt: number } {
    return { token: `pub:${input.uid}`, expiresAt: Date.now() + 600_000 };
  }
  issueSubscriberGrant(input: { roomName: string; uid: number }): { token: string } {
    return { token: `sub:${input.uid}` };
  }
  closeRoom(roomName: string): Promise<void> { this.closed.push(roomName); return Promise.resolve(); }
  removeParticipant(roomName: string, uid: number): Promise<void> { this.removed.push({ roomName, uid }); return Promise.resolve(); }
}

const open: HttpHarness[] = [];

export async function makeHarness(count = 20, voice?: VoiceService): Promise<HttpHarness> {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const users: User[] = [];
  for (let index = 1; index <= count; index += 1) {
    const nickname = `httpuser${String.fromCharCode(96 + index)}`;
    const account = accounts.register(`http-user-${index}`, nickname, 'dummy-hash').account;
    const session = accounts.createSession(account.id);
    users.push({ uid: account.uid, nickname, userId: account.id, cookie: `td_account_v2=${session.token}`, sessionId: session.session.id });
  }
  const app = createV2App({ accounts, clock, logStore, origin: 'http://allowed.test', voice });
  const server = createServer(app.app);
  app.hub.attachV2(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const harness: HttpHarness = {
    app, accounts, clock, logStore, users, server, base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      app.close();
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
      accounts.close(); logStore.close();
    },
  };
  open.push(harness);
  return harness;
}

export async function closeHarnesses(): Promise<void> {
  await Promise.all(open.splice(0).reverse().map((harness) => harness.close()));
}

export async function request(h: HttpHarness, path: string, init: RequestInit = {}, user?: User): Promise<Response> {
  const headers = new Headers(init.headers);
  if (user) headers.set('cookie', user.cookie);
  return fetch(`${h.base}${path}`, { ...init, headers });
}

export function post(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export async function json(response: Response): Promise<Record<string, any>> { return (await response.json()) as Record<string, any>; }

export async function createRoom(h: HttpHarness, user = h.users[0]!, requestId = 'create-1') {
  const response = await request(h, '/api/v2/rooms', post({ requestId }), user);
  return { response, body: await json(response) };
}

export async function enter(h: HttpHarness, roomCode: string, user: User, requestId: string) {
  const response = await request(h, `/api/v2/rooms/${roomCode}/enter`, post({ requestId }), user);
  return { response, body: await json(response) };
}

export async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error('HTTP realtime wait timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function connectRoom(h: HttpHarness, user: User, roomId: string): Promise<{ socket: Socket; views: any[]; controls: any[] }> {
  const socket = ioClient(h.base, { path: '/api/v2/socket.io', auth: { roomId }, extraHeaders: { cookie: user.cookie }, reconnection: false });
  const views: any[] = []; const controls: any[] = [];
  socket.on('view_updated', (view) => views.push(view)); socket.on('control', (notice) => controls.push(notice));
  await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject); });
  await waitFor(() => views.length > 0);
  return { socket, views, controls };
}
