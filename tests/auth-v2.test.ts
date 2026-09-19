import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { AccountStore } from '../server/v2/account-store.ts';
import { authRouter, COOKIE } from '../server/v2/auth.ts';
import { hashPassword } from '../server/v2/passwords.ts';

const stores: AccountStore[] = [], servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve())); for (const store of stores.splice(0)) store.close(); });
function json(value: unknown): RequestInit { return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }; }
async function harness() {
  const store = new AccountStore(':memory:', () => 1_000); stores.push(store); const app = express(); app.use(express.json()); app.use('/auth', authRouter(store, false, () => undefined)); app.use((_e: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => res.status(400).json({ error: 'bad_request' }));
  const server = createServer(app); servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port; return { store, request: (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}/auth${path}`, init) };
}
function cookie(response: Response): string { return (response.headers.get('set-cookie') ?? '').split(';')[0]!; }

describe('v2.2 account authentication', () => {
  it('registers with requestId, returns uid/nickname, and replays safely', async () => {
    const h = await harness(); h.store.setRegistrationEnabled(true);
    const body = { requestId: 'auth-register-1', nickname: '新用户', password: 'eight888' };
    const first = await h.request('/register', json(body)); expect(first.status).toBe(201); const profile = await first.json() as Record<string, unknown>;
    expect(profile).toMatchObject({ uid: '10000001', nickname: '新用户' });
    const replay = await h.request('/register', json(body)); expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ uid: '10000001', nickname: '新用户' });
  }, 30_000);

  it('logs in by numeric uid and rejects username login', async () => {
    const h = await harness(); const account = h.store.register('auth-login-1', '登录用户', await hashPassword('eight888')).account;
    const login = await h.request('/login', json({ uid: account.uid, password: 'eight888' })); expect(login.status).toBe(200); expect(await login.json()).toMatchObject({ uid: account.uid, nickname: '登录用户' });
    expect((await h.request('/login', json({ username: '登录用户', password: 'eight888' }))).status).toBe(400);
    expect((await h.request('/me', { headers: { cookie: cookie(login) } })).status).toBe(200);
  }, 30_000);
});
