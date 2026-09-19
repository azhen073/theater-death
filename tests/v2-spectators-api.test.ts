import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { io as ioClient, type Socket } from 'socket.io-client';
import { AccountStore } from '../server/v2/account-store.ts';
import { createV2App } from '../server/v2/app.ts';
import { createFakeClock, type FakeClock } from '../server/clock.ts';
import { createLogStore } from '../server/log-store.ts';
import type { VoiceCredentials, VoiceService } from '../voice/agora.ts';

type User = { userId: string; cookie: string; sessionId: string };
type Harness = {
  app: ReturnType<typeof createV2App>;
  accounts: AccountStore;
  clock: FakeClock;
  users: User[];
  server: Server;
  base: string;
  voice: MockVoice;
};
const harnesses: Harness[] = [];

class MockVoice implements VoiceService {
  readonly issued: Array<{ roomName: string; uid: number }> = [];
  readonly removed: Array<{ roomName: string; uid: number }> = [];
  readonly closed: string[] = [];
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
  removeParticipant(roomName: string, uid: number): Promise<void> {
    this.removed.push({ roomName, uid });
    return Promise.resolve();
  }
  closeRoom(roomName: string): Promise<void> {
    this.closed.push(roomName);
    return Promise.resolve();
  }
}

afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    h.app.close();
    await new Promise<void>((resolve) => { h.server.close(() => resolve()); h.server.closeAllConnections(); });
    h.accounts.close();
  }
});

async function makeHarness(): Promise<Harness> {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const users: User[] = [];
  for (let index = 1; index <= 20; index += 1) {
    const account = accounts.register(`spectator-user-${index}`, `spectator${String.fromCharCode(97 + index)}`, 'dummy-hash').account;
    const session = accounts.createSession(account.id);
    users.push({ userId: account.id, sessionId: session.session.id, cookie: `td_account_v2=${session.token}` });
  }
  const voice = new MockVoice();
  const app = createV2App({ accounts, clock, logStore: createLogStore(':memory:'), origin: 'http://allowed.test', voice });
  const server = createServer(app.app);
  app.hub.attachV2(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const h = { app, accounts, clock, users, server, base: `http://127.0.0.1:${port}`, voice };
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

async function createRoom(h: Harness, user = h.users[0]!, requestId = 'create-room') {
  const response = await request(h, '/api/v2/rooms', user, intent(requestId));
  expect(response.status).toBe(201);
  return await json(response) as { roomId: string; roomCode: string; gameId: null; memberId: string; kind: 'formal'; playerId: null };
}
async function startFullRoom(h: Harness, existing?: { roomId: string; roomCode: string; gameId: null }) {
  const room = existing ?? await createRoom(h);
  for (let index = 1; index < 13; index += 1) {
    const entered = await request(h, `/api/v2/rooms/${room.roomCode}/enter`, h.users[index]!, intent(`enter-${index}`));
    expect(entered.status).toBe(200);
  }
  for (let index = 0; index < 13; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, h.users[index]!, intent(`ready-${index}`, { ready: true }));
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, h.users[0]!, intent('start-room'));
  expect(started.status).toBe(200);
  const startedBody = await json(started);
  expect(typeof startedBody.gameId).toBe('string');
  if (typeof startedBody.gameId !== 'string') throw new Error('start response missing gameId');
  return { roomId: room.roomId, roomCode: room.roomCode, gameId: startedBody.gameId };
}
async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error('socket assertion timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function connect(h: Harness, user: User, roomId: string): { socket: Socket; views: any[]; controls: any[] } {
  const socket = ioClient(h.base, {
    path: '/api/v2/socket.io', auth: { roomId }, extraHeaders: { cookie: user.cookie }, reconnection: false,
  });
  const views: any[] = [];
  const controls: any[] = [];
  socket.on('view_updated', (view) => views.push(view));
  socket.on('control', (notice) => controls.push(notice));
  return { socket, views, controls };
}

describe('v2 spectator HTTP and realtime security', () => {
  it('creates a lobby entry with no game and exposes a public view without private or faction data', async () => {
    const h = await makeHarness();
    const lobby = await createRoom(h);
    expect(lobby.gameId).toBeNull();
    const room = await startFullRoom(h, lobby);
    const entered = await request(h, `/api/v2/rooms/${room.roomCode}/enter`, h.users[13]!, intent('public-enter'));
    expect(entered.status).toBe(200);
    expect((await json(entered)).kind).toBe('public_spectator');
    const viewResponse = await request(h, `/api/v2/rooms/${room.roomCode}/view`, h.users[13]!);
    expect(viewResponse.status).toBe(200);
    const view = await json(viewResponse);
    expect(view.viewer).toMatchObject({ kind: 'public_spectator', subjectPlayerId: null, readOnly: true });
    expect(view.private).toBeNull();
    expect(view.chat.faction).toEqual([]);
    expect(view.capabilities.canPostFaction).toBe(false);
    expect(view.capabilities.canPublishVoice).toBe(false);
    expect(view.capabilities.allowedCommands).toEqual([]);
  });

  it('rejects public and private spectators on every state-changing room/game route with valid game arguments', async () => {
    const h = await makeHarness();
    const room = await startFullRoom(h);
    const publicUser = h.users[13]!;
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/enter`, publicUser, intent('public-enter'))).status).toBe(200);
    const publicView = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, publicUser));
    const targetMemberId = publicView.room.formalMembers[1].memberId as string;
    const privateUser = h.users[14]!;
    const invitation = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/invitations`, h.users[0]!, intent('invite-private', { gameId: room.gameId }));
    expect(invitation.status).toBe(201);
    const token = String((await json(invitation)).token);
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/enter`, privateUser, intent('private-enter'))).status).toBe(200);
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/redeem`, privateUser, intent('private-redeem', { gameId: room.gameId, token }))).status).toBe(200);
    const writeCases = (prefix: string) => [
      [`/api/v2/rooms/${room.roomCode}/ready`, intent(`${prefix}-ready`, { ready: true })],
      [`/api/v2/rooms/${room.roomCode}/start`, intent(`${prefix}-start`)],
      [`/api/v2/rooms/${room.roomCode}/command`, intent(`${prefix}-command`, { gameId: room.gameId, action: 'END_SPEECH', windowInstanceId: 'legal-window' })],
      [`/api/v2/rooms/${room.roomCode}/chat`, intent(`${prefix}-chat`, { gameId: room.gameId, channel: 'public', clientMessageId: `${prefix}-message`, text: 'blocked' })],
      [`/api/v2/rooms/${room.roomCode}/transfer-host`, intent(`${prefix}-transfer`, { memberId: targetMemberId })],
      [`/api/v2/rooms/${room.roomCode}/end-review`, intent(`${prefix}-review`, { gameId: room.gameId })],
      [`/api/v2/rooms/${room.roomCode}/kick`, intent(`${prefix}-kick`, { memberId: targetMemberId })],
    ] as const;
    for (const [path, body] of writeCases('public')) expect((await request(h, path, publicUser, body)).status, path).toBe(403);
    for (const [path, body] of writeCases('private')) expect((await request(h, path, privateUser, body)).status, path).toBe(403);
  });

  it('enforces second-screen scope, one-time use, expiry, old sessions, and removes legacy direct-watch paths', async () => {
    const h = await makeHarness(); const first = await startFullRoom(h); const issued = await request(h, `/api/v2/rooms/${first.roomCode}/second-screen/invitations`, h.users[0]!, intent('invite-one', { gameId: first.gameId })); expect(issued.status).toBe(201); const token = String((await json(issued)).token);
    expect((await request(h, `/api/v2/rooms/${first.roomCode}/second-screen/redeem`, h.users[0]!, intent('self-redeem', { gameId: first.gameId, token }))).status).toBe(403);
    const second = await createRoom(h, h.users[19]!, 'create-second'); expect((await request(h, `/api/v2/rooms/${second.roomCode}/second-screen/redeem`, h.users[15]!, intent('cross-game', { gameId: 'wrong-game', token }))).status).toBe(409);
    expect((await request(h, `/api/v2/rooms/${first.roomCode}/second-screen/redeem`, h.users[13]!, intent('redeem-one', { gameId: first.gameId, token }))).status).toBe(200); expect((await request(h, `/api/v2/rooms/${first.roomCode}/second-screen/redeem`, h.users[14]!, intent('redeem-again', { gameId: first.gameId, token }))).status).toBe(403);
    const replacementSession = h.accounts.createSession(h.users[13]!.userId); const replacement = { ...h.users[13]!, cookie: `td_account_v2=${replacementSession.token}`, sessionId: replacementSession.session.id }; const nextInvite = await request(h, `/api/v2/rooms/${first.roomCode}/second-screen/invitations`, h.users[1]!, intent('invite-old-session', { gameId: first.gameId })); expect(nextInvite.status).toBe(201);
    expect((await request(h, `/api/v2/rooms/${first.roomCode}/second-screen/redeem`, replacement, intent('old-session-redeem', { gameId: first.gameId, token: String((await json(nextInvite)).token) }))).status).toBe(409);
    const expired = await request(h, `/api/v2/rooms/${first.roomCode}/second-screen/invitations`, h.users[1]!, intent('invite-expired', { gameId: first.gameId })); expect(expired.status).toBe(201); const expiredToken = String((await json(expired)).token); h.clock.elapse(300_001);
    expect((await request(h, `/api/v2/rooms/${first.roomCode}/second-screen/redeem`, h.users[14]!, intent('redeem-expired', { gameId: first.gameId, token: expiredToken }))).status).toBe(403); expect((await request(h, `/api/v2/rooms/${first.roomCode}/watch`, h.users[15]!, intent('legacy-watch'))).status).toBe(404); expect((await request(h, `/api/v2/rooms/${first.roomCode}/join`, h.users[15]!, intent('legacy-join'))).status).toBe(404);
  });

  it('disconnects private sockets on revoke and kick, stops private frames, and keeps voice publish permission false', async () => {
    const h = await makeHarness(); const room = await startFullRoom(h); const invitation = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/invitations`, h.users[0]!, intent('invite-socket', { gameId: room.gameId })); const firstToken = String((await json(invitation)).token);
    await request(h, `/api/v2/rooms/${room.roomCode}/enter`, h.users[13]!, intent('socket-enter')); expect((await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/redeem`, h.users[13]!, intent('socket-redeem', { gameId: room.gameId, token: firstToken }))).status).toBe(200); expect((await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, h.users[13]!, intent('socket-voice', { gameId: room.gameId }))).status).toBe(200);
    const privateSocket = connect(h, h.users[13]!, room.roomId); await waitFor(() => privateSocket.views.length > 0); expect(privateSocket.views.at(-1)?.viewer).toMatchObject({ kind: 'private_spectator' }); const beforeRevoke = privateSocket.views.length; const revoked = new Promise<void>((resolve) => privateSocket.socket.once('disconnect', () => resolve()));
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/revoke`, h.users[0]!, intent('revoke-socket', { gameId: room.gameId }))).status).toBe(200); await revoked; expect(privateSocket.controls.some((notice) => notice.reason === 'screen_revoked')).toBe(true); await new Promise((resolve) => setTimeout(resolve, 20)); expect(privateSocket.views.length).toBe(beforeRevoke);
    await h.app.drain(); expect(h.voice.removed.some((entry) => entry.roomName === room.gameId)).toBe(true);
    const secondInvitation = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/invitations`, h.users[1]!, intent('invite-kick', { gameId: room.gameId })); const secondToken = String((await json(secondInvitation)).token); await request(h, `/api/v2/rooms/${room.roomCode}/enter`, h.users[14]!, intent('kick-enter')); await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/redeem`, h.users[14]!, intent('kick-redeem', { gameId: room.gameId, token: secondToken }));
    const kickView = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, h.users[14]!)); const targetMemberId = kickView.viewer.memberId as string; const kickedSocket = connect(h, h.users[14]!, room.roomId); await waitFor(() => kickedSocket.views.length > 0); const beforeKick = kickedSocket.views.length; const kicked = new Promise<void>((resolve) => kickedSocket.socket.once('disconnect', () => resolve()));
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/kick`, h.users[0]!, intent('kick-socket', { memberId: targetMemberId }))).status).toBe(200); await kicked; expect(kickedSocket.controls.some((notice) => notice.reason === 'kicked')).toBe(true); await new Promise((resolve) => setTimeout(resolve, 20)); expect(kickedSocket.views.length).toBe(beforeKick); kickedSocket.socket.disconnect(); privateSocket.socket.disconnect();
  });
});
