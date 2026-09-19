import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { io as ioClient, type Socket } from 'socket.io-client';
import { AccountStore } from '../server/v2/account-store.ts';
import { authRouter } from '../server/v2/auth.ts';
import { createV2App } from '../server/v2/app.ts';
import { createFakeClock } from '../server/clock.ts';
import { createLogStore } from '../server/log-store.ts';

const resources: Array<{ close(): void | Promise<void> }> = [];
afterEach(async () => { for (const resource of resources.splice(0).reverse()) await resource.close(); });

function errorHandler() {
  return (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const typed = error as { status?: number; code?: string };
    res.status(typed.status ?? 500).json({ error: typed.code ?? 'internal_error' });
  };
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

function cookieValue(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  if (!raw) throw new Error('missing set-cookie');
  return raw.split(';')[0]!;
}

describe('2.1 foundation account cookie contract', () => {
  it('authRouter emits and clears the configured cookie name', async () => {
    const store = new AccountStore(':memory:');
    resources.push(store);
    const app = express();
    app.use(express.json());
    app.use('/auth', authRouter(store, false, () => undefined, 'custom_account'));
    app.use(errorHandler());
    const server = createServer(app);
    resources.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
    const base = await listen(server);
    const account = store.register('foundation-1', 'customuser', 'dummy-hash').account;
    const session = store.createSession(account.id);
    const me = await fetch(`${base}/auth/me`, { headers: { cookie: `custom_account=${session.token}` } });
    expect(me.status).toBe(200);
    const logout = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `custom_account=${session.token}` }, body: '{}' });
    expect(logout.status).toBe(200);
    const cleared = (logout.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()[0] ?? logout.headers.get('set-cookie') ?? '';
    expect(cleared).toContain('custom_account=');
    expect(cleared).not.toContain('td_account_v2=');
  });

  it('createV2App isolates HTTP and Socket.IO authentication by custom cookie name', async () => {
    const accounts = new AccountStore(':memory:');
    const clock = createFakeClock(1_000);
    const logStore = createLogStore(':memory:');
    const account = accounts.register('foundation-2', 'socketuser', 'dummy-hash').account;
    const session = accounts.createSession(account.id);
    const app = createV2App({ accounts, clock, logStore, origin: 'http://allowed.test', cookieName: 'custom_account' });
    const server = createServer(app.app);
    app.hub.attachV2(server);
    resources.push({ close: () => { app.close(); logStore.close(); accounts.close(); } });
    resources.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
    const base = await listen(server);
    const customCookie = `custom_account=${session.token}`;
    const defaultCookie = `td_account_v2=${session.token}`;
    expect((await fetch(`${base}/api/v2/auth/me`, { headers: { cookie: customCookie } })).status).toBe(200);
    expect((await fetch(`${base}/api/v2/auth/me`, { headers: { cookie: defaultCookie } })).status).toBe(401);
    const roomResponse = await fetch(`${base}/api/v2/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: customCookie }, body: JSON.stringify({ requestId: 'foundation-create' }) });
    expect(roomResponse.status).toBe(201);
    const room = await roomResponse.json() as { roomId: string; gameId: null };

    const connect = (cookie: string) => {
      const socket = ioClient(base, { path: '/api/v2/socket.io', auth: { roomId: room.roomId }, extraHeaders: { cookie }, reconnection: false });
      resources.push({ close: () => new Promise<void>((resolve) => { socket.close(); resolve(); }) });
      return socket;
    };
    const accepted = connect(customCookie);
    await new Promise<void>((resolve, reject) => { accepted.once('connect', () => resolve()); accepted.once('connect_error', reject); });
    expect(accepted.connected).toBe(true);
    const rejected = connect(defaultCookie);
    const error = await new Promise<Error>((resolve) => rejected.once('connect_error', resolve));
    expect(error.message).toBe('unauthorized');
    accepted.close();
    rejected.close();
  });
});
