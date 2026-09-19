import { afterEach, describe, expect, it } from 'vitest';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { createFakeClock } from '../server/clock.ts';
import { createLogStore } from '../server/log-store.ts';
import { RoomRegistry } from '../server/rooms.ts';
import { EmptyRooms, EMPTY_ROOM_TTL_MS, OFFLINE_ROOM_TTL_MS } from '../server/v2/empty-rooms.ts';
import { RoomGovernance } from '../server/v2/governance.ts';
import { MemberPresence } from '../server/v2/presence.ts';
import { RoomDirectory } from '../server/v2/room-directory.ts';
import { AccountStore } from '../server/v2/account-store.ts';

const stores: Array<{ close(): void }> = [];
afterEach(() => { for (const store of stores.splice(0).reverse()) store.close(); });

function setup() {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const registry = new RoomRegistry({ clock, ruleset: THEATER_DEATH_13_V2, logStore, strictWindows: true });
  const controls: Array<{ sessionId: string | null; reason: string }> = [];
  let governance: RoomGovernance;
  let empty: EmptyRooms;
  const directory = new RoomDirectory({
    clock, accounts, logStore, registry, revokeMedia: () => undefined,
    changed: (room, event) => { governance?.reconcile(room, event); empty?.observe(room); },
    control: (_room, sessionId, reason) => controls.push({ sessionId, reason }), removed: () => undefined,
    beforeMutation: (room) => empty?.expireIfDue(room),
  });
  governance = new RoomGovernance(directory);
  empty = new EmptyRooms(directory, governance);
  stores.push(accounts, logStore);
  const presence = new MemberPresence(directory);
  return { clock, accounts, directory, governance, empty, logStore, controls, presence };
}

function account(accounts: AccountStore, name: string) {
  const nickname = name.replace(/\d/g, digit => String.fromCharCode(97 + Number(digit)));
  const row = accounts.register(`empty-${name}`, nickname, 'hash').account;
  return { userId: row.id, session: accounts.createSession(row.id).session };
}

async function fullMatch(directory: RoomDirectory, accounts: AccountStore, prefix: string) {
  const host = account(accounts, `${prefix}_host`);
  const room = await directory.create(host.session, THEATER_DEATH_13_V2);
  const players = [host];
  for (let i = 1; i < 13; i += 1) {
    const player = account(accounts, `${prefix}_${i}`);
    players.push(player);
    await directory.enter(room, player.session);
  }
  for (const member of room.formalMembers()) member.ready = true;
  room.startMatch();
  return { room, players };
}

describe('v2 empty room policy', () => {
  it('treats all-offline formal members as non-empty, then reclaims the room after the offline TTL', async () => {
    const { clock, accounts, directory, empty } = setup();
    const host = account(accounts, 'empty_formal');
    const room = await directory.create(host.session, THEATER_DEATH_13_V2);
    empty.observe(room);
    expect(room.emptyDeadline).toBeNull();
    expect(room.allOfflineSince).toBe(1_000);
    clock.elapse(OFFLINE_ROOM_TTL_MS - 1);
    await empty.sweep();
    expect(directory.byCode.has(room.code)).toBe(true);
    expect(room.formalMembers()).toHaveLength(1);
    clock.elapse(1); clock.flush(); await Promise.resolve();
    await directory.transaction(() => room.enqueue(() => undefined));
    expect(directory.byCode.has(room.code)).toBe(false);
    expect(room.dissolved).toBe(true);
    empty.close();
  });

  it('starts one five-minute deadline; spectators do not extend it and beforeMutation expires delayed timers', async () => {
    const { clock, accounts, directory, empty } = setup();
    const { room, players } = await fullMatch(directory, accounts, 'empty_deadline');
    for (const player of players) await directory.leave(room, player.session);
    empty.observe(room);
    expect(room.emptyDeadline).toBe(1_000 + EMPTY_ROOM_TTL_MS);
    const spectator = account(accounts, 'empty_spectator');
    await directory.enter(room, spectator.session);
    expect(room.emptyDeadline).toBe(1_000 + EMPTY_ROOM_TTL_MS);
    await directory.enter(room, spectator.session);
    clock.elapse(299_999); await directory.transaction(() => room.enqueue(() => undefined));
    expect(directory.byCode.has(room.code)).toBe(true);
    clock.elapse(1); clock.flush(); await Promise.resolve(); await directory.transaction(() => room.enqueue(() => undefined));
    expect(directory.byCode.has(room.code)).toBe(false);
    expect(room.dissolved).toBe(true);
    empty.close();
  });

  it('runs the delayed expiry check at membership entry even when the timer callback was not flushed', async () => {
    const { clock, accounts, directory, controls } = setup();
    const host = account(accounts, 'delayed_expiry_host');
    const room = await directory.create(host.session, THEATER_DEATH_13_V2);
    await directory.leave(room, host.session);
    clock.elapse(EMPTY_ROOM_TTL_MS);
    const newcomer = accounts.createSession(host.userId).session;
    await expect(directory.enter(room, newcomer)).rejects.toMatchObject({ code: 'room_not_found' });
    expect(room.dissolved).toBe(true);
    expect(controls.some((event) => event.reason === 'dissolved')).toBe(true);
  });

  it('restoring a former participant before expiry cancels the old timer and preserves the same player seat', async () => {
    const { clock, accounts, directory, empty } = setup();
    const { room, players } = await fullMatch(directory, accounts, 'empty_restore');
    for (const player of players) await directory.leave(room, player.session);
    expect(room.emptyDeadline).toBe(1_000 + EMPTY_ROOM_TTL_MS);
    const former = players[3]!;
    const playerId = room.participants.get(former.userId)!.playerId;
    const restoredSession = accounts.createSession(former.userId).session;
    clock.elapse(EMPTY_ROOM_TTL_MS - 1);
    const restored = await directory.enter(room, restoredSession);
    expect(restored.kind).toBe('formal');
    expect(room.participants.get(former.userId)?.playerId).toBe(playerId);
    expect(room.emptyDeadline).toBeNull();
    clock.elapse(1); await directory.transaction(() => room.enqueue(() => undefined));
    expect(directory.byCode.has(room.code)).toBe(true);
    empty.close();
  });

  it('expires an empty in-progress match as aborted, preserving audit events and without fabricating a win', async () => {
    const { clock, accounts, directory, logStore, empty } = setup();
    const { room, players } = await fullMatch(directory, accounts, 'empty_abort');
    const gameId = room.gameId!;
    const beforeEvents = logStore.listEvents(gameId, 0).length;
    for (const player of players) await directory.leave(room, player.session);
    empty.observe(room);
    clock.elapse(EMPTY_ROOM_TTL_MS); clock.flush(); await Promise.resolve();
    await directory.transaction(() => room.enqueue(() => undefined));
    expect(room.runtime?.state?.win).toBeNull();
    expect(logStore.listEvents(gameId, 0).length).toBeGreaterThanOrEqual(beforeEvents);
    expect(logStore.listMatches(room.roomId)).toEqual([expect.objectContaining({ gameId, status: 'aborted', endedAt: 1_000 + EMPTY_ROOM_TTL_MS })]);
    expect(directory.byCode.has(room.code)).toBe(false);
  });

  it('old expiry handles cannot remove a room after a formal member cancels emptiness', async () => {
    const { clock, accounts, directory } = setup();
    const host = account(accounts, 'empty_cancel');
    const room = await directory.create(host.session, THEATER_DEATH_13_V2);
    await directory.leave(room, host.session);
    const restored = accounts.createSession(host.userId).session;
    await directory.enter(room, restored);
    expect(room.emptyDeadline).toBeNull();
    clock.elapse(EMPTY_ROOM_TTL_MS + 1); clock.flush(); await Promise.resolve(); await directory.transaction(() => room.enqueue(() => undefined));
    expect(directory.byCode.has(room.code)).toBe(true);
  });

  it('forget cancels and drops both pending timers so a disposed room leaves no residue', async () => {
    const { clock, accounts, directory, empty } = setup();
    const offlineHost = account(accounts, 'forget_offline');
    const offlineRoom = await directory.create(offlineHost.session, THEATER_DEATH_13_V2);
    empty.observe(offlineRoom);
    expect(offlineRoom.allOfflineSince).toBe(1_000);
    expect(empty.offlinePending.has(offlineRoom.roomId)).toBe(true);

    const emptyHost = account(accounts, 'forget_empty');
    const emptyRoom = await directory.create(emptyHost.session, THEATER_DEATH_13_V2);
    await directory.leave(emptyRoom, emptyHost.session);
    empty.observe(emptyRoom);
    expect(empty.pending.has(emptyRoom.roomId)).toBe(true);
    expect(clock.pendingCount()).toBe(2);

    empty.forget(offlineRoom.roomId);
    empty.forget(emptyRoom.roomId);
    expect(empty.offlinePending.size).toBe(0);
    expect(empty.pending.size).toBe(0);
    expect(clock.pendingCount()).toBe(0);
    empty.close();
  });

  it('keeps a reviewed match with all-offline formal members below the offline TTL, then reclaims it', async () => {
    const { clock, accounts, directory, empty } = setup();
    const { room, players } = await fullMatch(directory, accounts, 'empty_retention');
    const dead = players[1]!;
    const deadPlayerId = room.participants.get(dead.userId)!.playerId;
    room.runtime!.state = {
      ...room.runtime!.state!,
      phase: 'ended',
      players: room.runtime!.state!.players.map((player) => player.playerId === deadPlayerId ? { ...player, life: 'dead' as const } : player),
      win: { winner: 'human', dayNumber: 1, reason: 'test' },
    };
    clock.elapse(OFFLINE_ROOM_TTL_MS - 1);
    await empty.sweep();
    expect(directory.byCode.has(room.code)).toBe(true);
    expect(room.formalMembers()).toHaveLength(13);
    expect(room.runtime!.state?.win).toBeDefined();
    clock.elapse(1); clock.flush(); await Promise.resolve();
    await directory.transaction(() => room.enqueue(() => undefined));
    expect(directory.byCode.has(room.code)).toBe(false);
    expect(room.dissolved).toBe(true);
    expect(room.runtime!.state?.win).toBeDefined();
  });

  it('disposes a reviewed room immediately after the last formal member leaves and removes spectators', async () => {
    const { accounts, directory, empty } = setup();
    const { room, players } = await fullMatch(directory, accounts, 'review_empty');
    const spectator = account(accounts, 'review_empty_spectator');
    await directory.enter(room, spectator.session);
    room.runtime!.state = { ...room.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'review_empty' } };
    for (const player of players.slice(1)) await directory.leave(room, player.session);
    expect(room.phase).toBe('review');
    await directory.leave(room, players[0]!.session);
    expect(room.dissolved).toBe(true);
    expect(directory.byCode.has(room.code)).toBe(false);
    expect(room.members.size).toBe(0);
    expect(empty.pending.size).toBe(0);
  });

  it('keeps a reviewed room when the host leaves while formal successors remain online', async () => {
    const { accounts, directory, presence } = setup();
    const { room, players } = await fullMatch(directory, accounts, 'review_successor');
    room.runtime!.state = { ...room.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'review_successor' } };
    const successor = room.participants.get(players[1]!.userId)!;
    await presence.connect(room, players[1]!.session, 'review-successor');
    await directory.leave(room, players[0]!.session);
    expect(room.dissolved).toBe(false);
    expect(directory.byCode.has(room.code)).toBe(true);
    expect(room.phase).toBe('review');
    expect(room.hostMemberId).toBe(successor.memberId);
  });
});
