import { afterEach, describe, expect, it } from 'vitest';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { createFakeClock } from '../server/clock.ts';
import { createLogStore } from '../server/log-store.ts';
import { RoomRegistry } from '../server/rooms.ts';
import { AccountStore, type AccountSession } from '../server/v2/account-store.ts';
import { RoomDirectory } from '../server/v2/room-directory.ts';
import type { StableRoom } from '../server/v2/stable-room.ts';

const stores: Array<{ close(): void }> = [];
afterEach(() => { for (const store of stores.splice(0).reverse()) store.close(); });

function setup() {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const registry = new RoomRegistry({ clock, ruleset: THEATER_DEATH_13_V2, logStore, strictWindows: true });
  const changed: StableRoom[] = [];
  const controls: Array<{ room: StableRoom; sessionId: string | null; reason: string }> = [];
  const directory = new RoomDirectory({
    clock, accounts, logStore, registry, revokeMedia: () => undefined,
    changed: (room) => changed.push(room),
    control: (room, sessionId, reason) => controls.push({ room, sessionId, reason }),
  });
  stores.push(accounts, logStore);
  return { accounts, directory, changed, controls };
}

function account(accounts: AccountStore, name: string): { userId: string; session: AccountSession } {
  const nickname = name.replace(/\d/g, digit => String.fromCharCode(97 + Number(digit)));
  const row = accounts.register(`membership-${name}`, nickname, 'hash').account;
  const created = accounts.createSession(row.id);
  return { userId: row.id, session: created.session };
}

async function fillLobby(directory: RoomDirectory, accounts: AccountStore, room: StableRoom, prefix: string) {
  const users = [account(accounts, `${prefix}_host`), ...Array.from({ length: 12 }, (_, i) => account(accounts, `${prefix}_${i + 1}`))];
  for (const user of users.slice(1)) await directory.enter(room, user.session);
  for (const member of room.formalMembers()) member.ready = true;
  return users;
}

describe('v2 room membership policy', () => {
  it('serializes concurrent create/enter so one account has only one current room', async () => {
    const { accounts, directory } = setup();
    const user = account(accounts, 'race_user');
    const created = await Promise.allSettled([directory.create(user.session, THEATER_DEATH_13_V2), directory.create(user.session, THEATER_DEATH_13_V2)]);
    expect(created.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(created.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(directory.byId.size).toBe(1);

    const roomA = created.find((result): result is PromiseFulfilledResult<StableRoom> => result.status === 'fulfilled')!.value;
    const other = account(accounts, 'other_host');
    const roomB = await directory.create(other.session, THEATER_DEATH_13_V2);
    expect(directory.current.get(user.userId)).toBe(roomA.roomId);
    const entrant = account(accounts, 'enter_race');
    const entered = await Promise.allSettled([directory.enter(roomA, entrant.session), directory.enter(roomB, entrant.session)]);
    expect(entered.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(entered.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect([roomA, roomB].filter((room) => room.members.has(entrant.userId))).toHaveLength(1);
  });

  it('fills formal lobby seats, puts overflow in spectator membership, and makes repeated enter idempotent', async () => {
    const { accounts, directory } = setup();
    const host = account(accounts, 'lobby_host');
    const room = await directory.create(host.session, THEATER_DEATH_13_V2);
    await fillLobby(directory, accounts, room, 'lobby_player');
    expect(room.formalMembers()).toHaveLength(13);
    const overflow = account(accounts, 'overflow');
    const spectator = await directory.enter(room, overflow.session);
    expect(spectator.kind).toBe('public_spectator');
    expect(room.formalMembers()).toHaveLength(13);
    expect((await directory.enter(room, overflow.session)).memberId).toBe(spectator.memberId);
    expect(room.members.size).toBe(14);
  });

  it('preserves spectator identity on failed promotion and promotes into a freed lobby seat unready', async () => {
    const { accounts, directory } = setup();
    const host = account(accounts, 'promote_host');
    const room = await directory.create(host.session, THEATER_DEATH_13_V2);
    const users = await fillLobby(directory, accounts, room, 'promote_player');
    const spectator = account(accounts, 'promote_spectator');
    const member = await directory.enter(room, spectator.session);
    expect(member.kind).toBe('public_spectator');
    await expect(directory.promote(room, spectator.session)).rejects.toMatchObject({ code: 'room_full' });
    expect(room.members.get(spectator.userId)?.kind).toBe('public_spectator');
    await directory.leave(room, users[1]!.session);
    const repeated = await directory.enter(room, spectator.session);
    expect(repeated.memberId).toBe(member.memberId);
    expect(repeated.kind).toBe('public_spectator');
    const promoted = await directory.promote(room, spectator.session);
    expect(promoted.kind).toBe('formal');
    expect(promoted.ready).toBe(false);
  });

  it('returns a departed player to the same participant seat while a newcomer remains only a spectator', async () => {
    const { accounts, directory } = setup();
    const host = account(accounts, 'match_host');
    const room = await directory.create(host.session, THEATER_DEATH_13_V2);
    const players = await fillLobby(directory, accounts, room, 'match_player');
    room.startMatch();
    const newcomer = account(accounts, 'new_spectator');
    expect((await directory.enter(room, newcomer.session)).kind).toBe('public_spectator');
    const departing = players[1]!;
    const playerId = room.participants.get(departing.userId)!.playerId;
    expect((await directory.leave(room, departing.session)).seatRetained).toBe(true);
    expect(room.members.has(departing.userId)).toBe(false);
    expect(room.participants.get(departing.userId)?.playerId).toBe(playerId);
    const returnedSession = accounts.createSession(departing.userId).session;
    const restored = await directory.enter(room, returnedSession);
    expect(restored.kind).toBe('formal');
    expect(room.participants.get(departing.userId)?.playerId).toBe(playerId);
    expect(room.members.get(newcomer.userId)?.kind).toBe('public_spectator');
  });

  it('requires explicit takeover for a second active session and invalidates the old lease', async () => {
    const { accounts, directory, controls } = setup();
    const user = account(accounts, 'takeover_user');
    const room = await directory.create(user.session, THEATER_DEATH_13_V2);
    const second = accounts.createSession(user.userId).session;
    await expect(directory.enter(room, second)).rejects.toMatchObject({ code: 'takeover_required' });
    const taken = await directory.enter(room, second, true);
    expect(taken.sessionId).toBe(second.id);
    expect(controls).toContainEqual({ room, sessionId: user.session.id, reason: 'taken_over' });
    expect(() => directory.member(room, user.session)).toThrowError();
    expect(directory.member(room, second).userId).toBe(user.userId);
  });
});
