import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { createFakeClock } from '../server/clock.ts';
import { createLogStore } from '../server/log-store.ts';
import { RoomRegistry } from '../server/rooms.ts';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, MemberPresence } from '../server/v2/presence.ts';
import { RoomDirectory } from '../server/v2/room-directory.ts';
import type { StableRoom } from '../server/v2/stable-room.ts';
import { AccountStore, type AccountSession } from '../server/v2/account-store.ts';
import { createV2Realtime, type ResolvedViewer } from '../server/v2/realtime.ts';
import type { Room } from '../server/rooms.ts';

const stores: Array<{ close(): void }> = [];
const servers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of servers.splice(0).reverse()) await close(); for (const store of stores.splice(0).reverse()) store.close(); });

function setup() {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const registry = new RoomRegistry({ clock, ruleset: THEATER_DEATH_13_V2, logStore, strictWindows: true });
  const directory = new RoomDirectory({ clock, accounts, logStore, registry, revokeMedia: () => undefined, changed: () => undefined, control: () => undefined });
  const presence = new MemberPresence(directory);
  stores.push(accounts, logStore);
  return { clock, accounts, directory, presence };
}

function account(accounts: AccountStore, name: string) {
  const nickname = name.replace(/\d/g, digit => String.fromCharCode(97 + Number(digit)));
  const row = accounts.register(`presence-${name}`, nickname, 'hash').account;
  return { userId: row.id, session: accounts.createSession(row.id).session };
}

async function fullMatch(directory: RoomDirectory, accounts: AccountStore, prefix: string) {
  const host = account(accounts, `${prefix}_host`);
  const room = await directory.create(host.session, THEATER_DEATH_13_V2);
  const players = [host];
  for (let index = 1; index < 13; index += 1) {
    const user = account(accounts, `${prefix}_${index}`);
    players.push(user);
    await directory.enter(room, user.session);
  }
  for (const member of room.formalMembers()) member.ready = true;
  room.startMatch();
  return { room, players };
}

describe('v2 member presence', () => {
  it('counts control tabs: one disconnect stays online, final disconnect enters grace then offline', async () => {
    const { clock, accounts, directory, presence } = setup();
    const user = account(accounts, 'presence_tabs');
    const room = await directory.create(user.session, THEATER_DEATH_13_V2);
    const member = room.members.get(user.userId)!;
    member.ready = true;
    await presence.connect(room, user.session, 'tab-1');
    await presence.connect(room, user.session, 'tab-2');
    await presence.disconnect(room, user.session, 'tab-1', 'transport close');
    expect(member.presence).toBe('online');
    await presence.disconnect(room, user.session, 'tab-2', 'transport close');
    expect(member.presence).toBe('reconnecting');
    expect(member.disconnectAt).toBe(16_000);
    clock.elapse(14_999); clock.flush();
    expect(member.presence).toBe('reconnecting');
    clock.elapse(1); clock.flush(); await Promise.resolve();
    expect(member.presence).toBe('offline');
    expect(member.kind).toBe('formal');
    expect(member.ready).toBe(true);
  });

  it('cancels the old grace timer on reconnect and ping timeout goes offline immediately', async () => {
    const { clock, accounts, directory, presence } = setup();
    const user = account(accounts, 'presence_reconnect');
    const room = await directory.create(user.session, THEATER_DEATH_13_V2);
    const member = room.members.get(user.userId)!;
    await presence.connect(room, user.session, 'old');
    await presence.disconnect(room, user.session, 'old', 'transport close');
    await presence.connect(room, user.session, 'new');
    expect(member.presence).toBe('online');
    clock.elapse(15_000); clock.flush();
    expect(member.presence).toBe('online');
    await presence.disconnect(room, user.session, 'new', 'ping timeout');
    expect(member.presence).toBe('offline');
    expect(member.disconnectAt).toBeNull();
  });

  it('disconnecting an old socket after takeover does not affect the new control session', async () => {
    const { accounts, directory, presence } = setup();
    const user = account(accounts, 'presence_takeover');
    const room = await directory.create(user.session, THEATER_DEATH_13_V2);
    await presence.connect(room, user.session, 'old-socket');
    const newer = accounts.createSession(user.userId).session;
    await directory.enter(room, newer, true);
    await presence.connect(room, newer, 'new-socket');
    await presence.disconnect(room, user.session, 'old-socket', 'transport close');
    expect(room.members.get(user.userId)?.presence).toBe('online');
    expect(room.members.get(user.userId)?.sessionId).toBe(newer.id);
  });

  it('spectator and second-screen connections count only their own member identity', async () => {
    const { accounts, directory, presence } = setup();
    const { room, players } = await fullMatch(directory, accounts, 'presence_view');
    const subject = players[0]!;
    const spectator = account(accounts, 'presence_spectator');
    const spectatorMember = await directory.enter(room, spectator.session);
    const subjectPlayerId = room.participants.get(subject.userId)!.playerId;
    room.access!.watchers.get(spectator.userId)!.subject = subjectPlayerId;
    await presence.connect(room, spectator.session, 'second-screen');
    expect(spectatorMember.presence).toBe('online');
    expect(room.members.get(subject.userId)?.presence).toBe('offline');
  });

  it('advertises the Engine.IO heartbeat contract without waiting for real time', async () => {
    const server = createServer();
    const fakeRoom = {} as Room;
    const realtime = createV2Realtime(() => ({ room: fakeRoom, identity: { subjectPlayerId: null, readOnly: true }, principalId: 'p', mediaIdentity: 'm' }) as ResolvedViewer, () => 0, 'http://allowed.test');
    realtime.attachV2(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    servers.push(() => new Promise<void>((resolve) => { realtime.close(); server.close(() => resolve()); }));
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v2/socket.io/?EIO=4&transport=polling`);
    expect(response.status).toBe(200);
    const payload = await response.text();
    const handshake = JSON.parse(payload.slice(1)) as { pingInterval: number; pingTimeout: number };
    expect(handshake).toMatchObject({ pingInterval: HEARTBEAT_INTERVAL_MS, pingTimeout: HEARTBEAT_TIMEOUT_MS });
  });
});
