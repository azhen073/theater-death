import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { io as ioClient, type Socket } from 'socket.io-client';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { createFakeClock } from '../server/clock.ts';
import { createLogStore, type LogStore } from '../server/log-store.ts';
import { RoomRegistry } from '../server/rooms.ts';
import { AccountStore, type AccountSession } from '../server/v2/account-store.ts';
import { RoomDirectory } from '../server/v2/room-directory.ts';
import { RoomGovernance } from '../server/v2/governance.ts';
import { MemberPresence } from '../server/v2/presence.ts';
import { RoomRounds } from '../server/v2/rounds.ts';
import { ScreenGrants } from '../server/v2/screen-grants.ts';
import { RoomSnapshots } from '../server/v2/snapshots.ts';
import { createRoomRealtime } from '../server/v2/room-realtime.ts';
import type { StableRoom } from '../server/v2/stable-room.ts';

const sockets: Socket[] = [];
const harnesses: Harness[] = [];
const viewStore = new WeakMap<Socket, Array<Record<string, any>>>();

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

interface User {
  userId: string;
  session: AccountSession;
  cookie: string;
}

interface Harness {
  clock: ReturnType<typeof createFakeClock>;
  accounts: AccountStore;
  logStore: LogStore;
  directory: RoomDirectory;
  presence: MemberPresence;
  rounds: RoomRounds;
  grants: ScreenGrants;
  hub: ReturnType<typeof createRoomRealtime>;
  server: Server;
  base: string;
  revoked: string[];
  profiles: Map<string, { userId: string; uid: string; nickname: string; avatarUrl: string | null; profileVersion: number }>;
  close(): Promise<void>;
}

function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error('等待实时帧超时'));
      setTimeout(check, 5);
    };
    check();
  });
}

async function harness(): Promise<Harness> {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const registry = new RoomRegistry({ clock, ruleset: THEATER_DEATH_13_V2, logStore, strictWindows: true });
  let hub: ReturnType<typeof createRoomRealtime> | undefined;
  let governance: RoomGovernance | undefined;
  const revoked: string[] = [];
  const profiles = new Map<string, { userId: string; uid: string; nickname: string; avatarUrl: string | null; profileVersion: number }>();
  const directory = new RoomDirectory({
    clock, accounts, logStore, registry,
    revokeMedia: (_gameId, identity) => revoked.push(identity),
    changed: (room, event) => { governance?.reconcile(room, event); hub?.refresh(room.roomId); },
    control: (room, sessionId, reason) => hub?.control(room, sessionId, reason),
  });
  const snapshots = new RoomSnapshots({ directory, profile: (userId) => profiles.get(userId)! });
  governance = new RoomGovernance(directory);
  const presence = new MemberPresence(directory);
  const rounds = new RoomRounds(directory, governance);
  const grants = new ScreenGrants(directory);
  hub = createRoomRealtime({ directory, snapshots, presence, origin: 'http://allowed.test' });
  const server = createServer();
  hub.attachV2(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const result: Harness = {
    clock, accounts, logStore, directory, presence, rounds, grants, hub, server,
    base: `http://127.0.0.1:${address.port}`, revoked, profiles,
    close: () => new Promise<void>((resolve) => { hub!.close(); server.close(() => { accounts.close(); logStore.close(); resolve(); }); }),
  };
  harnesses.push(result);
  return result;
}

function profileMap(h: Harness) {
  return h.profiles;
}

function account(h: Harness, username: string): User {
  const nickname = username.replace(/\d/g, digit => String.fromCharCode(97 + Number(digit)));
  const row = h.accounts.register(`realtime-${username}`, nickname, 'hash').account;
  profileMap(h).set(row.id, { userId: row.id, uid: row.uid, nickname: row.nickname, avatarUrl: null, profileVersion: 0 });
  const created = h.accounts.createSession(row.id);
  return { userId: row.id, session: created.session, cookie: `td_account_v2=${created.token}` };
}

async function fullRoom(h: Harness, prefix: string) {
  const host = account(h, `${prefix}_host`);
  const room = await h.directory.create(host.session, THEATER_DEATH_13_V2);
  const players = [host];
  for (let index = 1; index < 13; index += 1) {
    const player = account(h, `${prefix}_${index}`);
    players.push(player);
    await h.directory.enter(room, player.session);
  }
  const spectator = account(h, `${prefix}_spectator`);
  await h.directory.enter(room, spectator.session);
  for (const member of room.formalMembers()) member.ready = true;
  room.startMatch();
  return { room, host, players, spectator };
}

function connect(h: Harness, user: User, auth: Record<string, string>, origin = 'http://allowed.test'): Promise<Socket> {
  const socket = ioClient(h.base, {
    path: '/api/v2/socket.io', auth, extraHeaders: { cookie: user.cookie, origin }, reconnection: false,
  });
  const views: Array<Record<string, any>> = [];
  viewStore.set(socket, views);
  socket.on('view_updated', (view: Record<string, any>) => views.push(view));
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function collectViews(socket: Socket) {
  return viewStore.get(socket)!;
}

describe('v2 stable room realtime lifecycle', () => {
  it('authenticates by roomId, sends a complete snapshot, and rejects gameId/cookie/origin violations', async () => {
    const h = await harness();
    const host = account(h, 'realtime_handshake_host');
    const room = await h.directory.create(host.session, THEATER_DEATH_13_V2);
    const socket = await connect(h, host, { roomId: room.roomId });
    const views = collectViews(socket);
    await waitFor(() => views.length > 0);
    expect(views[0]).toMatchObject({ roomId: room.roomId, gameId: null, viewer: { userId: host.userId, kind: 'formal' }, room: { code: room.code, phase: 'lobby' } });
    expect(views[0]?.room.formalMembers[0]).toMatchObject({ userId: host.userId, nickname: 'realtime_handshake_host', avatarUrl: null });
    expect(room.members.get(host.userId)?.presence).toBe('online');

    const badCookie = { ...host, cookie: 'td_account_v2=bad' };
    await expect(connect(h, badCookie, { roomId: room.roomId })).rejects.toThrow();
    await expect(connect(h, host, { gameId: 'g_forged' })).rejects.toThrow();
    await expect(connect(h, host, { roomId: room.roomId }, 'http://evil.test')).rejects.toThrow();
  });

  it('terminates takeover and screen revocation with the correct control reason and reconnect projection', async () => {
    const h = await harness();
    const host = account(h, 'realtime_takeover_host');
    const room = await h.directory.create(host.session, THEATER_DEATH_13_V2);
    const oldSocket = await connect(h, host, { roomId: room.roomId });
    const oldViews = collectViews(oldSocket);
    await waitFor(() => oldViews.length > 0);
    const controls: Array<Record<string, unknown>> = [];
    oldSocket.on('control', (notice: Record<string, unknown>) => controls.push(notice));
    const replacement = h.accounts.createSession(host.userId);
    const newerUser = { ...host, session: replacement.session, cookie: `td_account_v2=${replacement.token}` };
    await h.directory.enter(room, newerUser.session, true);
    await waitFor(() => controls.some((notice) => notice.reason === 'taken_over') && !oldSocket.connected);
    const before = oldViews.length;
    room.members.get(host.userId)!.ready = true;
    h.hub.refresh(room.roomId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(oldViews).toHaveLength(before);
    const newSocket = await connect(h, newerUser, { roomId: room.roomId });
    const newViews = collectViews(newSocket);
    await waitFor(() => newViews.length > 0);
    expect(newViews.at(-1)?.viewer.userId).toBe(host.userId);

    const match = await fullRoom(h, 'realtime_screen');
    const invite = await h.grants.invite(match.room, match.host.session, match.room.gameId!);
    await h.grants.redeem(match.room, match.spectator.session, match.room.gameId!, invite.token);
    const beforeRevoke = match.room.access!.resolve(match.spectator.session)!;
    const screenSocket = await connect(h, match.spectator, { roomId: match.room.roomId });
    const screenViews = collectViews(screenSocket);
    await waitFor(() => screenViews.length > 0 && screenViews.at(-1)?.viewer.kind === 'private_spectator');
    const screenControls: Array<Record<string, unknown>> = [];
    screenSocket.on('control', (notice: Record<string, unknown>) => screenControls.push(notice));
    await h.grants.revoke(match.room, match.host.session, match.room.gameId!);
    await waitFor(() => screenControls.some((notice) => notice.reason === 'screen_revoked') && !screenSocket.connected);
    expect(h.revoked).toContain(beforeRevoke.mediaIdentity);
    const publicSocket = await connect(h, match.spectator, { roomId: match.room.roomId });
    const publicViews = collectViews(publicSocket);
    await waitFor(() => publicViews.length > 0);
    expect(publicViews.at(-1)).toMatchObject({ viewer: { kind: 'public_spectator', subjectPlayerId: null }, private: null });
  });

  it('keeps one room subscription through review and the next game while versions and access reset', async () => {
    const h = await harness();
    const match = await fullRoom(h, 'realtime_rounds');
    const invite = await h.grants.invite(match.room, match.host.session, match.room.gameId!);
    await h.grants.redeem(match.room, match.spectator.session, match.room.gameId!, invite.token);
    const socket = await connect(h, match.spectator, { roomId: match.room.roomId });
    const views = collectViews(socket);
    await waitFor(() => views.length > 0 && views.at(-1)?.viewer.kind === 'private_spectator');
    const playing = views.at(-1)!;
    const firstGameId = match.room.gameId!;
    const oldRuntime = match.room.runtime!;
    await match.room.enqueue(() => { oldRuntime.state = { ...oldRuntime.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'test' } }; });
    h.hub.refresh(match.room.roomId);
    await waitFor(() => views.at(-1)?.room.phase === 'review');
    const review = views.at(-1)!;
    expect(review.viewVersion).toBeGreaterThan(playing.viewVersion);
    expect(review.private).toBeTruthy();
    const control: Array<Record<string, unknown>> = [];
    socket.on('control', (notice: Record<string, unknown>) => control.push(notice));
    await h.rounds.endReview(match.room, match.host.session, firstGameId);
    await waitFor(() => views.at(-1)?.room.phase === 'lobby');
    const lobby = views.at(-1)!;
    expect(control.some((notice) => notice.reason === 'review_ended')).toBe(true);
    expect(lobby.viewVersion).toBeGreaterThan(review.viewVersion);
    expect(lobby.gameId).toBeNull();
    expect(lobby.private).toBeNull();
    expect(lobby.viewer.kind).toBe('public_spectator');
    for (const member of match.room.formalMembers()) member.ready = true;
    await h.directory.mutate(match.room, () => match.room.startMatch());
    const secondGameId = match.room.gameId!;
    await waitFor(() => views.at(-1)?.gameId === secondGameId);
    const second = views.at(-1)!;
    expect(secondGameId).not.toBe(firstGameId);
    expect(second.viewVersion).toBeGreaterThan(lobby.viewVersion);
    expect(second.viewer.kind).toBe('public_spectator');
    expect(second.private).toBeNull();
    expect(socket.connected).toBe(true);
  });

  it('does not push hidden private events, pushes visible member changes, and reports expired sessions', async () => {
    const h = await harness();
    const match = await fullRoom(h, 'realtime_visibility');
    const socket = await connect(h, match.spectator, { roomId: match.room.roomId });
    const views = collectViews(socket);
    await waitFor(() => views.length > 0);
    const before = views.at(-1)!;
    const frameCount = views.length;
    const runtime = match.room.runtime!;
    await match.room.enqueue(() => {
      const hiddenSeq = runtime.events.length + 1;
      runtime.events.push({ seq: hiddenSeq, dayNumber: runtime.state!.dayNumber, stage: runtime.state!.stage, type: 'private_notice', payload: { text: 'hidden' }, visibility: { kind: 'players', playerIds: [runtime.members[0]!.playerId] } } as never);
      runtime.state = { ...runtime.state!, eventSeq: runtime.state!.eventSeq + 1 };
    });
    h.hub.refresh(match.room.roomId);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(views).toHaveLength(frameCount);
    expect(views.at(-1)?.viewVersion).toBe(before.viewVersion);
    await h.directory.mutate(match.room, () => { match.room.members.get(match.players[0]!.userId)!.ready = false; });
    await waitFor(() => views.length > frameCount);
    expect(views.at(-1)?.viewVersion).toBeGreaterThan(before.viewVersion);

    const controls: Array<Record<string, unknown>> = [];
    socket.on('control', (notice: Record<string, unknown>) => controls.push(notice));
    h.accounts.logout(match.spectator.session.id);
    h.hub.refresh(match.room.roomId);
    await waitFor(() => controls.some((notice) => notice.reason === 'session_expired') && !socket.connected);
    expect(controls.some((notice) => notice.reason === 'taken_over')).toBe(false);
  });
});
