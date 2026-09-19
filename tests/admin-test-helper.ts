import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountStore } from '../server/v2/account-store.ts';
import { createV2App } from '../server/v2/app.ts';
import { createFakeClock, type FakeClock } from '../server/clock.ts';
import { createLogStore, type LogStore } from '../server/log-store.ts';
import { hashPassword } from '../server/v2/passwords.ts';
import { io, type Socket } from 'socket.io-client';

export type AdminUser = { userId: string; uid: string; nickname: string; password: string; cookie: string; sessionId: string };
export type AdminHarness = {
  app: ReturnType<typeof createV2App>; accounts: AccountStore; clock: FakeClock; logStore: LogStore;
  server: Server; base: string; directory: string; adminCookie: string | null; users: AdminUser[];
  sockets: Socket[];
};

export const ADMIN_PASSWORD = 'admin password value 123';
const harnesses: AdminHarness[] = [];

export async function makeAdminHarness(configured = true, count = 14): Promise<AdminHarness> {
  const clock = createFakeClock(100_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const directory = mkdtempSync(join(tmpdir(), 'theater-admin-api-'));
  const users: AdminUser[] = [];
  for (let index = 1; index <= count; index += 1) {
    const password = `play${String.fromCharCode(96 + index)}8888`;
    const account = accounts.register(`admin-player-${index}`, `admin_player_${String.fromCharCode(96 + index)}`, await hashPassword(password)).account;
    const session = accounts.createSession(account.id);
    users.push({ userId: account.id, uid: account.uid, nickname: account.nickname, password, sessionId: session.session.id, cookie: `td_account_v2=${session.token}` });
  }
  // The admin dependency is intentionally supplied as an opaque test-only option
  // until the implementation lands; current createV2App ignores it and should red.
  const deps = { accounts, clock, logStore, origin: 'http://allowed.test', adminPassword: configured ? ADMIN_PASSWORD : undefined } as any;
  const app = createV2App(deps);
  const server = createServer(app.app);
  app.hub.attachV2(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const harness: AdminHarness = { app, accounts, clock, logStore, server, base: `http://127.0.0.1:${port}`, directory, adminCookie: null, users, sockets: [] };
  harnesses.push(harness);
  return harness;
}

export async function closeAdminHarnesses(): Promise<void> {
  for (const harness of harnesses.splice(0).reverse()) {
    for (const socket of harness.sockets.splice(0)) socket.disconnect();
    harness.app.close();
    await new Promise<void>((resolve) => { harness.server.close(() => resolve()); harness.server.closeAllConnections(); });
    harness.accounts.close(); harness.logStore.close(); rmSync(harness.directory, { recursive: true, force: true });
  }
}

export async function connectRoom(harness: AdminHarness, user: AdminUser, roomId: string): Promise<Socket> {
  const socket = io(harness.base, { path: '/api/v2/socket.io', auth: { roomId }, extraHeaders: { cookie: user.cookie }, reconnection: false });
  harness.sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject); });
  return socket;
}

export async function request(harness: AdminHarness, path: string, init: RequestInit = {}, cookie?: string, origin = 'http://allowed.test'): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  if (origin) headers.set('origin', origin);
  return fetch(`${harness.base}${path}`, { ...init, headers });
}

export function jsonPost(value: unknown, cookie?: string): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(value) };
}

export function cookieOf(response: Response, name: string): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  const value = values.find(item => item.startsWith(`${name}=`));
  if (!value) throw new Error(`missing ${name} set-cookie`);
  return value.split(';')[0]!;
}

export async function json(response: Response): Promise<Record<string, any>> { return await response.json() as Record<string, any>; }

export async function loginAdmin(harness: AdminHarness): Promise<string> {
  const response = await request(harness, '/api/v2/admin/auth/login', jsonPost({ password: ADMIN_PASSWORD }));
  if (response.status !== 200) throw new Error(`admin login status ${response.status}`);
  const cookie = cookieOf(response, 'td_admin_v2');
  harness.adminCookie = cookie;
  return cookie;
}

export async function createStartedRoom(harness: AdminHarness, users = harness.users.slice(0, 13)): Promise<{ roomCode: string; gameId: string }> {
  const created = await request(harness, '/api/v2/rooms', jsonPost({ requestId: `admin-room-${crypto.randomUUID()}` }, users[0]!.cookie));
  if (created.status !== 201) throw new Error(`room create status ${created.status}`);
  const room = await json(created);
  for (let index = 1; index < users.length; index += 1) {
    const entered = await request(harness, `/api/v2/rooms/${room.roomCode}/enter`, jsonPost({ requestId: `admin-enter-${index}-${crypto.randomUUID()}` }, users[index]!.cookie));
    if (entered.status !== 200) throw new Error(`room enter status ${entered.status}`);
  }
  for (const user of users) {
    const ready = await request(harness, `/api/v2/rooms/${room.roomCode}/ready`, jsonPost({ requestId: `admin-ready-${crypto.randomUUID()}`, ready: true }, user.cookie));
    if (ready.status !== 200) throw new Error(`room ready status ${ready.status}`);
  }
  const started = await request(harness, `/api/v2/rooms/${room.roomCode}/start`, jsonPost({ requestId: `admin-start-${crypto.randomUUID()}` }, users[0]!.cookie));
  if (started.status !== 200) throw new Error(`room start status ${started.status}`);
  const body = await json(started);
  return { roomCode: room.roomCode as string, gameId: body.gameId as string };
}
