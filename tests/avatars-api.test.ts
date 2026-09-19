import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { io as ioClient, type Socket } from 'socket.io-client';
import sharp from 'sharp';
import { AccountStore } from '../server/v2/account-store.ts';
import { AvatarStore } from '../server/v2/avatars.ts';
import { createV2App } from '../server/v2/app.ts';
import { createFakeClock, type FakeClock } from '../server/clock.ts';
import { createLogStore, type LogStore } from '../server/log-store.ts';

type User = { uid: string; nickname: string; userId: string; cookie: string; sessionId: string };
type Harness = { app: ReturnType<typeof createV2App>; accounts: AccountStore; avatars?: AvatarStore; clock: FakeClock; logStore: LogStore; users: User[]; server: Server; base: string; directory: string };
const harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    h.app.close();
    await new Promise<void>((resolve) => { h.server.close(() => resolve()); h.server.closeAllConnections(); });
    h.accounts.close(); h.logStore.close(); rmSync(h.directory, { recursive: true, force: true });
  }
});

async function makeHarness(avatarsEnabled = true, count = 14): Promise<Harness> {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const directory = mkdtempSync(join(tmpdir(), 'theater-avatar-api-'));
  const avatars = avatarsEnabled ? new AvatarStore(accounts, join(directory, 'avatars')) : undefined;
  const users: User[] = [];
  for (let index = 1; index <= count; index += 1) {
    const account = accounts.register(`avatar-user-${index}`, `avataruser${String.fromCharCode(96 + index)}`, 'dummy-hash').account;
    const session = accounts.createSession(account.id);
    users.push({ uid: account.uid, nickname: account.nickname, userId: account.id, sessionId: session.session.id, cookie: `td_account_v2=${session.token}` });
  }
  const app = createV2App({ accounts, clock, logStore, avatars, origin: 'http://allowed.test' });
  const server = createServer(app.app);
  app.hub.attachV2(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const h = { app, accounts, avatars, clock, logStore, users, server, base: `http://127.0.0.1:${port}`, directory };
  harnesses.push(h);
  return h;
}

async function request(h: Harness, path: string, init: RequestInit = {}, user?: User): Promise<Response> {
  const headers = new Headers(init.headers);
  if (user) headers.set('cookie', user.cookie);
  return fetch(`${h.base}${path}`, { ...init, headers });
}
function put(bytes: Uint8Array, mime: string): RequestInit { return { method: 'PUT', headers: { 'content-type': mime }, body: Buffer.from(bytes) }; }
async function json(response: Response): Promise<Record<string, any>> { return await response.json() as Record<string, any>; }
async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> { const started = Date.now(); while (!predicate()) { if (Date.now() - started >= timeoutMs) throw new Error('avatar socket wait timed out'); await new Promise((resolve) => setTimeout(resolve, 5)); } }

async function image(format: 'jpeg' | 'png' | 'webp', width = 256, height = 256): Promise<Buffer> {
  const source = sharp({ create: { width, height, channels: 4, background: { r: 38, g: 99, b: 235, alpha: 1 } } });
  if (format === 'jpeg') return source.jpeg().toBuffer();
  if (format === 'png') return source.png().toBuffer();
  return source.webp().toBuffer();
}

function connect(h: Harness, user: User, roomId: string): { socket: Socket; views: any[] } {
  const socket = ioClient(h.base, { path: '/api/v2/socket.io', auth: { roomId }, extraHeaders: { cookie: user.cookie }, reconnection: false });
  const views: any[] = [];
  socket.on('view_updated', (view) => views.push(view));
  return { socket, views };
}

async function startRoom(h: Harness) {
  const created = await request(h, '/api/v2/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'avatar-room-create' }) }, h.users[0]);
  expect(created.status).toBe(201);
  const room = await json(created) as { roomId: string; roomCode: string };
  for (let index = 1; index < 13; index += 1) {
    const entered = await request(h, `/api/v2/rooms/${room.roomCode}/enter`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: `avatar-enter-${index}` }) }, h.users[index]);
    expect(entered.status).toBe(200);
  }
  for (let index = 0; index < 13; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: `avatar-ready-${index}`, ready: true }) }, h.users[index]);
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'avatar-start' }) }, h.users[0]);
  expect(started.status).toBe(200);
  return { ...room, ...(await json(started)) } as { roomId: string; roomCode: string; gameId: string };
}

describe('v2 avatar HTTP and profile contract', () => {
  it('requires auth, rejects cross-origin and disabled uploads, and advertises the real avatar feature', async () => {
    const disabled = await makeHarness(false);
    const bytes = await image('png');
    expect((await request(disabled, '/api/v2/me/avatar', put(bytes, 'image/png'))).status).toBe(401);
    expect((await request(disabled, '/api/v2/me/avatar', put(bytes, 'image/png'), disabled.users[0])).status).toBe(409);
    const enabled = await makeHarness(true);
    const crossOrigin = await request(enabled, '/api/v2/me/avatar', { ...put(bytes, 'image/png'), headers: { 'content-type': 'image/png', origin: 'http://evil.test' } }, enabled.users[0]);
    expect(crossOrigin.status).toBe(403);
    expect((await json(await request(enabled, '/api/v2/bootstrap'))).features.avatars).toBe(true);
    const registered = await request(enabled, '/api/v2/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'avatar-register', nickname: 'avatarregistered', password: 'valid888' }) });
    expect(registered.status).toBe(201);
    expect(await json(registered)).toMatchObject({ avatarUrl: null, profileVersion: 0 });
  }, 30_000);

  it('normalizes JPEG, PNG, and WebP uploads to square 256 WebP responses with increasing profile versions', async () => {
    const h = await makeHarness();
    let previousVersion = 0;
    for (const [index, format] of (['jpeg', 'png', 'webp'] as const).entries()) {
      const response = await request(h, '/api/v2/me/avatar', put(await image(format), `image/${format}`), h.users[0]);
      expect(response.status).toBe(200);
      const profile = await json(response);
      expect(profile).toMatchObject({ userId: h.users[0]!.userId, uid: h.users[0]!.uid, nickname: h.users[0]!.nickname, avatarUrl: expect.stringMatching(/^\/api\/v2\/avatars\//), profileVersion: index + 1 });
      expect(profile.profileVersion).toBeGreaterThan(previousVersion); previousVersion = profile.profileVersion;
      const avatar = await request(h, profile.avatarUrl, {}, h.users[0]);
      expect(avatar.status).toBe(200);
      expect(avatar.headers.get('content-type')).toContain('image/webp');
      expect(avatar.headers.get('x-content-type-options')).toBe('nosniff');
      expect(avatar.headers.get('cache-control')).toContain('private');
      expect((await sharp(Buffer.from(await avatar.arrayBuffer())).metadata())).toMatchObject({ format: 'webp', width: 256, height: 256 });
      expect((await request(h, profile.avatarUrl)).status).toBe(401);
      expect((await request(h, '/api/v2/avatars/not-an-asset-id', {}, h.users[0])).status).toBe(404);
    }
  }, 30_000);

  it('rejects malformed, mismatched, SVG, oversized, and non-square inputs without replacing the previous avatar', async () => {
    const h = await makeHarness();
    const good = await request(h, '/api/v2/me/avatar', put(await image('png'), 'image/png'), h.users[0]);
    expect(good.status).toBe(200);
    const before = await json(good);
    const cases: Array<{ bytes: Uint8Array; mime: string; status: number }> = [
      { bytes: new Uint8Array(), mime: 'image/png', status: 400 },
      { bytes: new Uint8Array(await image('png')), mime: 'image/jpeg', status: 400 },
      { bytes: new TextEncoder().encode('not-an-image'), mime: 'image/png', status: 400 },
      { bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), mime: 'image/svg+xml', status: 415 },
      { bytes: new Uint8Array(2 * 1024 * 1024 + 1), mime: 'image/png', status: 413 },
      { bytes: new Uint8Array(await image('png', 256, 128)), mime: 'image/png', status: 400 },
    ];
    for (const item of cases) {
      expect((await request(h, '/api/v2/me/avatar', put(item.bytes, item.mime), h.users[0])).status).toBe(item.status);
      h.clock.elapse(60_001);
    }
    const me = await request(h, '/api/v2/auth/me', { headers: { cookie: h.users[0]!.cookie } }, undefined);
    expect(await json(me)).toMatchObject({ avatarUrl: before.avatarUrl, profileVersion: before.profileVersion });
  }, 30_000);

  it('refreshes connected room profiles and uses the current avatar in constructed review data', async () => {
    const h = await makeHarness();
    const room = await startRoom(h);
    const live = connect(h, h.users[0]!, room.roomId);
    await new Promise<void>((resolve, reject) => { live.socket.once('connect', () => resolve()); live.socket.once('connect_error', reject); });
    await waitFor(() => live.views.length > 0);
    const uploaded = await request(h, '/api/v2/me/avatar', put(await image('webp'), 'image/webp'), h.users[0]);
    expect(uploaded.status).toBe(200);
    const profile = await json(uploaded);
    await waitFor(() => live.views.some((view) => view.room.formalMembers.find((member: any) => member.userId === h.users[0]!.userId)?.profileVersion === profile.profileVersion));
    const liveProfile = live.views.at(-1)!.room.formalMembers.find((member: any) => member.userId === h.users[0]!.userId);
    expect(liveProfile).toMatchObject({ avatarUrl: profile.avatarUrl, profileVersion: profile.profileVersion });
    const stable = h.app.directory.byId.get(room.roomId)!;
    stable.runtime!.state = { ...stable.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'constructed_avatar_review' } };
    stable.recordCompletion();
    const review = await request(h, `/api/v2/rooms/${room.roomCode}/review`, {}, h.users[0]);
    expect(review.status).toBe(200);
    const reviewBody = await json(review);
    expect(reviewBody.review.players.find((player: any) => player.nickname === h.users[0]!.nickname).avatarUrl).toBe(profile.avatarUrl);
    live.socket.disconnect();
  }, 30_000);

  it('does not commit after session revocation during async processing and enforces five uploads per minute', async () => {
    const h = await makeHarness();
    const originalPut = h.avatars!.put.bind(h.avatars);
    let firstAuthorize = true;
    vi.spyOn(h.avatars!, 'put').mockImplementation((userId, input, mime, authorize) => originalPut(userId, input, mime, () => {
      authorize?.();
      if (firstAuthorize) { firstAuthorize = false; queueMicrotask(() => h.accounts.logout(h.users[0]!.sessionId)); }
    }));
    const revoked = await request(h, '/api/v2/me/avatar', put(await image('png'), 'image/png'), h.users[0]);
    expect(revoked.status).toBe(401);
    expect(h.accounts.profile(h.users[0]!.userId)).toMatchObject({ avatarUrl: null, profileVersion: 0 });

    const second = await makeHarness();
    const bytes = await image('png');
    const responses: Response[] = [];
    for (let index = 0; index < 6; index += 1) responses.push(await request(second, '/api/v2/me/avatar', put(bytes, 'image/png'), second.users[0]));
    expect(responses.slice(0, 5).every((response) => response.status === 200)).toBe(true);
    expect(responses[5]?.status).toBe(429);
    expect((await json(responses[5]!)).error.code).toBe('rate_limited');
  }, 30_000);
});
