import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { io as ioClient, type Socket } from 'socket.io-client';
import { AccountStore } from '../server/v2/account-store.ts';
import { createV2App } from '../server/v2/app.ts';
import { createFakeClock, type FakeClock } from '../server/clock.ts';
import { createLogStore, type LogStore } from '../server/log-store.ts';
import { EMPTY_ROOM_TTL_MS } from '../server/v2/empty-rooms.ts';
import type { VoiceCredentials, VoiceService } from '../voice/livekit.ts';

type User = { userId: string; cookie: string; sessionId: string };
type Harness = {
  app: ReturnType<typeof createV2App>;
  accounts: AccountStore;
  clock: FakeClock;
  logs: LogStore;
  users: User[];
  server: Server;
  base: string;
  voice: MaintenanceVoice;
};
const harnesses: Harness[] = [];

class MaintenanceVoice implements VoiceService {
  readonly removed: Array<{ roomName: string; identity: string }> = [];
  issueCredentials(input: { roomName: string; playerId: string }): Promise<VoiceCredentials> {
    return Promise.resolve({ url: 'wss://voice.test', token: input.playerId, roomName: input.roomName });
  }
  syncRoom(): Promise<void> { return Promise.resolve(); }
  closeRoom(): Promise<void> { return Promise.resolve(); }
  removeParticipant(roomName: string, identity: string): Promise<void> {
    this.removed.push({ roomName, identity });
    return Promise.resolve();
  }
}

afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    h.app.close();
    await new Promise<void>((resolve) => { h.server.close(() => resolve()); h.server.closeAllConnections(); });
    h.accounts.close(); h.logs.close();
  }
});

async function makeHarness(): Promise<Harness> {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logs = createLogStore(':memory:');
  const users: User[] = [];
  for (let index = 1; index <= 20; index += 1) {
    const account = accounts.register(`maintenance-user-${index}`, `maintenance${String.fromCharCode(97 + index)}`, 'dummy-hash').account;
    const session = accounts.createSession(account.id);
    users.push({ userId: account.id, sessionId: session.session.id, cookie: `td_account_v2=${session.token}` });
  }
  const voice = new MaintenanceVoice();
  const app = createV2App({ accounts, clock, logStore: logs, origin: 'http://allowed.test', voice });
  const server = createServer(app.app);
  app.hub.attachV2(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const h = { app, accounts, clock, logs, users, server, base: `http://127.0.0.1:${port}`, voice };
  harnesses.push(h);
  return h;
}
async function request(h: Harness, path: string, user: User, body?: Record<string, unknown>): Promise<Response> {
  return fetch(`${h.base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: user.cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function json(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}
function intent(requestId: string, extra: Record<string, unknown> = {}) { return { requestId, ...extra }; }
async function createRoom(h: Harness, user = h.users[0]!, requestId = 'maintenance-create') {
  const response = await request(h, '/api/v2/rooms', user, intent(requestId));
  expect(response.status).toBe(201);
  return await json(response) as { roomId: string; roomCode: string; gameId: null };
}
async function startFullRoom(h: Harness) {
  const room = await createRoom(h);
  for (let index = 1; index < 13; index += 1) {
    const entered = await request(h, `/api/v2/rooms/${room.roomCode}/enter`, h.users[index]!, intent(`enter-${index}`));
    expect(entered.status).toBe(200);
  }
  for (let index = 0; index < 13; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, h.users[index]!, intent(`ready-${index}`, { ready: true }));
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, h.users[0]!, intent('maintenance-start'));
  expect(started.status).toBe(200);
  const startedBody = await json(started);
  expect(typeof startedBody.gameId).toBe('string');
  if (typeof startedBody.gameId !== 'string') throw new Error('start response missing gameId');
  return { roomId: room.roomId, roomCode: room.roomCode, gameId: startedBody.gameId };
}
async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error('maintenance socket assertion timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function connect(h: Harness, user: User, roomId: string): { socket: Socket; controls: any[] } {
  const socket = ioClient(h.base, {
    path: '/api/v2/socket.io', auth: { roomId }, extraHeaders: { cookie: user.cookie }, reconnection: false,
  });
  const controls: any[] = [];
  socket.on('control', (notice) => controls.push(notice));
  return { socket, controls };
}

describe('v2 maintenance lifecycle', () => {
  it('keeps offline formal membership and a constructed ended match after the 24-hour boundary', async () => {
    const h = await makeHarness(); const room = await startFullRoom(h); const stable = h.app.directory.byId.get(room.roomId)!;
    for (const user of h.users.slice(0, 13)) h.accounts.logout(user.sessionId);
    await h.app.maintenance.sweep();
    expect(stable.formalMembers()).toHaveLength(13); expect(stable.formalMembers().every((member) => member.sessionId === null && member.presence === 'offline')).toBe(true);
    stable.runtime!.state = { ...stable.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'test' } };
    stable.recordCompletion(); h.clock.elapse(24 * 3600_000); await h.app.maintenance.sweep();
    expect(h.app.directory.byId.has(room.roomId)).toBe(true); expect(stable.runtime!.state!.win).toBeTruthy(); expect(h.logs.listMatches(room.roomId).at(-1)?.status).toBe('completed');
  });

  it('expires natural seven-day sessions with HTTP 401, session_expired socket control, and media revocation while retaining formal seats', async () => {
    const h = await makeHarness(); const room = await startFullRoom(h); const live = connect(h, h.users[1]!, room.roomId); await new Promise<void>((resolve, reject) => { live.socket.once('connect', () => resolve()); live.socket.once('connect_error', reject); });
    h.clock.advance(7 * 24 * 3600_000 + 1); await h.app.maintenance.sweep(); await waitFor(() => live.controls.some((notice) => notice.reason === 'session_expired') && !live.socket.connected); await h.app.drain();
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/view`, h.users[1]!)).status).toBe(401);
    const member = h.app.directory.byId.get(room.roomId)!.members.get(h.users[1]!.userId)!; expect(member.kind).toBe('formal'); expect(member.sessionId).toBeNull(); expect(member.presence).toBe('offline'); expect(h.voice.removed.some((entry) => entry.roomName === room.gameId)).toBe(true); live.socket.disconnect();
  });

  it('retains an offline private-screen member and removes expired invitations during sweep', async () => {
    const h = await makeHarness(); const room = await startFullRoom(h); const invitation = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/invitations`, h.users[0]!, intent('private-invite', { gameId: room.gameId })); expect(invitation.status).toBe(201); const token = String((await json(invitation)).token);
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/enter`, h.users[13]!, intent('private-enter'))).status).toBe(200); expect((await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/redeem`, h.users[13]!, intent('private-redeem', { gameId: room.gameId, token }))).status).toBe(200);
    const staleInvite = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/invitations`, h.users[1]!, intent('stale-invite', { gameId: room.gameId })); expect(staleInvite.status).toBe(201); h.clock.advance(300_001); h.accounts.logout(h.users[13]!.sessionId); await h.app.maintenance.sweep();
    const member = h.app.directory.byId.get(room.roomId)!.members.get(h.users[13]!.userId)!; expect(member.kind).toBe('private_spectator'); expect(member.sessionId).toBeNull(); expect(h.app.directory.byId.get(room.roomId)!.access!.invitations.size).toBe(0);
  });

  it('aborts a match after all formal members leave, preserves audit events, and records no fabricated win', async () => {
    const h = await makeHarness(); const room = await startFullRoom(h); const stable = h.app.directory.byId.get(room.roomId)!; const beforeEvents = h.logs.listEvents(room.gameId, 0).length;
    for (let index = 0; index < 13; index += 1) expect((await request(h, `/api/v2/rooms/${room.roomCode}/leave`, h.users[index]!, intent(`leave-${index}`))).status).toBe(200);
    expect(stable.emptyDeadline).toBe(h.clock.now() + EMPTY_ROOM_TTL_MS); h.clock.elapse(EMPTY_ROOM_TTL_MS); expect(h.app.directory.byId.has(room.roomId)).toBe(true); await h.app.empty.sweep();
    expect(h.app.directory.byId.has(room.roomId)).toBe(false); expect(h.logs.listEvents(room.gameId, 0).length).toBeGreaterThanOrEqual(beforeEvents); expect(stable.runtime!.state!.win).toBeFalsy(); expect(h.logs.listMatches(room.roomId).at(-1)?.status).toBe('aborted');
  });

  it('expires a due empty room before a spectator creates another room, without requiring the fake clock callback queue to flush', async () => {
    const h = await makeHarness(); const room = await startFullRoom(h); const spectator = h.users[13]!; expect((await request(h, `/api/v2/rooms/${room.roomCode}/enter`, spectator, intent('empty-spectator'))).status).toBe(200);
    for (let index = 0; index < 13; index += 1) expect((await request(h, `/api/v2/rooms/${room.roomCode}/leave`, h.users[index]!, intent(`empty-leave-${index}`))).status).toBe(200);
    const stable = h.app.directory.byId.get(room.roomId)!; const beforeEvents = h.logs.listEvents(room.gameId, 0).length; expect(stable.emptyDeadline).not.toBeNull(); h.clock.elapse(EMPTY_ROOM_TTL_MS); expect(h.app.directory.byId.has(room.roomId)).toBe(true);
    const replacement = await createRoom(h, spectator, 'spectator-replacement'); expect(replacement.roomId).not.toBe(room.roomId); expect(h.app.directory.byId.has(room.roomId)).toBe(false); expect(h.app.directory.current.get(spectator.userId)).toBe(replacement.roomId); expect(h.logs.listEvents(room.gameId, 0).length).toBeGreaterThanOrEqual(beforeEvents); expect(h.logs.listMatches(room.roomId).at(-1)?.status).toBe('aborted');
  });

  it('expires a due empty room before a spectator enters another existing room without flushing the fake clock', async () => {
    const h = await makeHarness();
    const room = await startFullRoom(h);
    const spectator = h.users[13]!;
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/enter`, spectator, intent('enter-empty-spectator'))).status).toBe(200);
    const other = await createRoom(h, h.users[19]!, 'existing-target');
    for (let index = 0; index < 13; index += 1) {
      expect((await request(h, `/api/v2/rooms/${room.roomCode}/leave`, h.users[index]!, intent(`existing-leave-${index}`))).status).toBe(200);
    }
    const stable = h.app.directory.byId.get(room.roomId)!;
    h.clock.elapse(EMPTY_ROOM_TTL_MS);
    expect(stable.emptyDeadline).toBeLessThanOrEqual(h.clock.now());
    expect(h.app.directory.byId.has(room.roomId)).toBe(true);
    const entered = await request(h, `/api/v2/rooms/${other.roomCode}/enter`, spectator, intent('enter-existing-target'));
    expect(entered.status).toBe(200);
    expect(h.app.directory.byId.has(room.roomId)).toBe(false);
    expect(h.app.directory.current.get(spectator.userId)).toBe(other.roomId);
  });
});
