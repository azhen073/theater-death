import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { io as ioClient, type Socket } from 'socket.io-client';
import { Room, type RoomMember } from '../server/rooms.ts';
import { createV2Realtime, type ResolvedViewer } from '../server/v2/realtime.ts';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import { makeEvent } from '../engine/events.ts';
import { scenario } from './helpers.ts';

const sockets: Socket[] = [];
const servers: Array<{ server: Server; close: () => Promise<void> }> = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await Promise.all(servers.splice(0).map(({ server, close }) => close()));
});

type Harness = {
  room: Room;
  resolve: (cookie: string, gameId: string) => ResolvedViewer | null;
  broadcaster: ReturnType<typeof createV2Realtime>['broadcaster'];
  base: string;
  revoke: (cookie: string) => void;
};

async function harness(): Promise<Harness> {
  const host: RoomMember = { playerId: 'p_1', nickname: '主持人', ready: true, joinedAt: 0 };
  const room = new Room('R1', 'g_v2', host, THEATER_DEATH_13);
  room.state = scenario();
  room.chat.push(
    { id: 1, channel: 'public', senderId: 'p_1', text: '公开', at: 1, eventSeq: 1 },
    { id: 2, channel: 'faction', senderId: 'p_11', text: '阵营秘密', at: 2, eventSeq: 1 },
  );
  room.events.push(
    makeEvent({ seq: 1, dayNumber: 1, stage: 1, type: 'public_notice', payload: { text: '公开' }, visibility: { kind: 'public' } }),
    makeEvent({ seq: 2, dayNumber: 1, stage: 1, type: 'private_notice', payload: { text: '私密' }, visibility: { kind: 'players', playerIds: ['p_11'] } }),
  );
  const accounts = new Map<string, ResolvedViewer>([
    ['public-cookie', { room, identity: { subjectPlayerId: null, readOnly: true }, principalId: 'account-public', mediaIdentity: 'm-public' }],
    ['private-cookie', { room, identity: { subjectPlayerId: 'p_11', readOnly: false }, principalId: 'account-private', mediaIdentity: 'm-private' }],
    ['second-screen-cookie', { room, identity: { subjectPlayerId: 'p_11', readOnly: true }, principalId: 'account-second', mediaIdentity: 'm-second' }],
  ]);
  const revoked = new Set<string>();
  const resolve = (cookie: string, gameId: string) => gameId === room.gameId && !revoked.has(cookie) ? accounts.get(cookie) ?? null : null;
  const realtime = createV2Realtime(resolve, () => 123, 'http://allowed.test');
  const server = createServer();
  realtime.attachV2(server);
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address() as { port: number };
  const close = () => new Promise<void>((resolveClose) => { realtime.close(); server.close(() => resolveClose()); });
  servers.push({ server, close });
  return { room, resolve, broadcaster: realtime.broadcaster, base: `http://127.0.0.1:${address.port}`, revoke: (cookie) => revoked.add(cookie) };
}

function connect(h: Harness, cookie: string, gameId = 'g_v2', origin?: string, onView?: (view: unknown) => void): Promise<Socket> {
  const socket = ioClient(h.base, {
    path: '/api/v2/socket.io',
    auth: { gameId },
    extraHeaders: { cookie, ...(origin === undefined ? {} : { origin }) },
    reconnection: false,
  });
  if (onView !== undefined) socket.on('view_updated', onView);
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

describe('v2 realtime authorization and private projections', () => {
  it('public viewer receives public chat only, never private events or faction chat', async () => {
    const h = await harness();
    let snapshot: { chat: { public: unknown[]; faction: unknown[] }; private: unknown } | undefined;
    await connect(h, 'public-cookie', 'g_v2', undefined, (view) => { snapshot = view as typeof snapshot; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (snapshot === undefined) throw new Error('v2 view not received');
    expect(snapshot.chat.public).toHaveLength(1);
    expect(snapshot.chat.faction).toHaveLength(0);
    expect(snapshot.private).toBeNull();
  });

  it('private second screen reads subject data while capabilities remain non-writing', async () => {
    const h = await harness();
    let snapshot: { private: { self: unknown } | null; capabilities: { allowedCommands: unknown[] } } | undefined;
    await connect(h, 'second-screen-cookie', 'g_v2', undefined, (view) => { snapshot = view as typeof snapshot; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (snapshot === undefined) throw new Error('v2 view not received');
    expect(snapshot.private?.self).toBeDefined();
    expect(snapshot.capabilities.allowedCommands).toEqual([]);
  });

  it('revocation disconnects on refresh and emits no further private frame', async () => {
    const h = await harness();
    const frames: unknown[] = [];
    const socket = await connect(h, 'private-cookie', 'g_v2', undefined, (frame) => frames.push(frame));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const initialFrames = frames.length;
    let disconnected = false;
    socket.once('disconnect', () => { disconnected = true; });
    h.revoke('private-cookie');
    h.broadcaster.emitChat('g_v2', h.room.state!, h.room.chat[0]!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(disconnected).toBe(true);
    expect(frames).toHaveLength(initialFrames);
  });

  it('rejects a forged gameId during handshake', async () => {
    const h = await harness();
    await expect(connect(h, 'private-cookie', 'forged-game')).rejects.toThrow();
  });

  it('rejects a disallowed Origin during handshake', async () => {
    const h = await harness();
    await expect(connect(h, 'private-cookie', 'g_v2', 'http://evil.test')).rejects.toThrow();
  });
});
