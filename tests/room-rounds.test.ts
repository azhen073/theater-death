import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClock, type FakeClock } from '../server/clock.ts';
import { createLogStore, type LogStore } from '../server/log-store.ts';
import { RoomRegistry } from '../server/rooms.ts';
import { AccountStore, type AccountSession } from '../server/v2/account-store.ts';
import { RoomDirectory } from '../server/v2/room-directory.ts';
import { RoomGovernance } from '../server/v2/governance.ts';
import { MemberPresence } from '../server/v2/presence.ts';
import { RoomRounds } from '../server/v2/rounds.ts';
import { ScreenGrants } from '../server/v2/screen-grants.ts';
import type { StableRoom } from '../server/v2/stable-room.ts';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';

const stores: Array<{ close(): void }> = [];

afterEach(() => {
  for (const store of stores.splice(0).reverse()) store.close();
});

function setup() {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const registry = new RoomRegistry({
    clock,
    ruleset: THEATER_DEATH_13_V2,
    logStore,
    strictWindows: true,
  });
  let governance: RoomGovernance | undefined;
  const directory = new RoomDirectory({
    clock,
    accounts,
    logStore,
    registry,
    revokeMedia: () => undefined,
    changed: (room, event) => governance?.reconcile(room, event),
    control: () => undefined,
  });
  governance = new RoomGovernance(directory);
  const presence = new MemberPresence(directory);
  const rounds = new RoomRounds(directory, governance);
  const grants = new ScreenGrants(directory);
  stores.push(accounts, logStore);
  return { clock, accounts, logStore, registry, directory, presence, rounds, grants };
}

interface User {
  userId: string;
  session: AccountSession;
}

function account(accounts: AccountStore, username: string): User {
  const nickname = username.replace(/\d/g, digit => String.fromCharCode(97 + Number(digit)));
  const row = accounts.register(`round-${username}`, nickname, 'hash').account;
  return { userId: row.id, session: accounts.createSession(row.id).session };
}

async function createStableRoom(directory: RoomDirectory, accounts: AccountStore) {
  const host = account(accounts, 'round_host');
  const room = await directory.create(host.session, THEATER_DEATH_13_V2);
  const players = [host];
  for (let index = 1; index < 13; index += 1) {
    const player = account(accounts, `round_player_${index}`);
    players.push(player);
    await directory.enter(room, player.session);
  }
  const watcher = account(accounts, 'round_watcher');
  const secondWatcher = account(accounts, 'round_watcher_two');
  await directory.enter(room, watcher.session);
  await directory.enter(room, secondWatcher.session);
  for (const member of room.formalMembers()) member.ready = true;
  return { room, host, players, watcher, secondWatcher };
}

async function drainClockWindows(clock: FakeClock, room: StableRoom, driver: { windows(): readonly { closesAt: number }[]; done(): boolean }): Promise<void> {
  for (let guard = 0; guard < 100 && !driver.done(); guard += 1) {
    const windows = driver.windows();
    if (windows.length === 0) {
      await room.enqueue(() => undefined);
      continue;
    }
    const closesAt = Math.min(...windows.map((window) => window.closesAt));
    clock.advance(Math.max(0, closesAt - clock.now()));
    await room.enqueue(() => undefined);
  }
}

async function playHumanWin(clock: FakeClock, room: StableRoom, useLaike = false) {
  const runtime = room.runtime;
  if (!runtime || !runtime.driver) throw new Error('match did not start');
  const night = runtime.driver;
  const state = runtime.state;
  if (!state) throw new Error('runtime state missing');
  const death = state.players.find((player) => player.roleId === 'death');
  const spirits = state.players.filter((player) => player.roleId === 'spirit');
  const laike = state.players.find((player) => player.roleId === 'laike');
  if (!death || spirits.length !== 2) throw new Error('unexpected 2.0 role assignment');

  const factionWindow = night.windows().find((window) => window.id === 'faction');
  expect(factionWindow?.instanceId).toBeDefined();
  expect(night.submit({ type: 'EDIT_PROPOSAL', playerId: death.playerId, targets: [death.playerId], windowInstanceId: factionWindow?.instanceId })).toMatchObject({ accepted: true });
  for (const spirit of spirits) {
    expect(night.submit({
      type: 'EDIT_PROPOSAL',
      playerId: spirit.playerId,
      targets: spirits.map((player) => player.playerId),
      windowInstanceId: factionWindow?.instanceId,
    })).toMatchObject({ accepted: true });
  }
  if (useLaike) {
    const laikeWindow = night.windows().find((window) => window.id === 'laike');
    expect(laike).toBeDefined();
    expect(laikeWindow?.instanceId).toBeDefined();
    expect(night.submit({ type: 'SUBMIT_LAIKE', playerId: laike!.playerId, targetId: death.playerId, windowInstanceId: laikeWindow?.instanceId })).toMatchObject({ accepted: true });
  }

  await drainClockWindows(clock, room, night);
  expect(night.done()).toBe(true);
  expect(night.windows()).toEqual([]);

  const day = room.runtime?.driver;
  if (!day) throw new Error('day driver did not start');
  expect(day.windows()).toHaveLength(1);
  expect(day.windows()[0]?.id).toBe('election_signup');
  await drainClockWindows(clock, room, day);
  expect(day.done()).toBe(true);
  expect(room.runtime?.state?.phase).toBe('ended');
  expect(room.runtime?.state?.win).toMatchObject({ winner: 'human' });
  return { runtime, night, state: room.runtime!.state!, day, death, spirits, laike };
}

describe('v2 stable room round lifecycle', () => {
  it('completes two real matches and resets only match-scoped state between them', async () => {
    const { clock, accounts, logStore, registry, directory, presence, rounds, grants } = setup();
    const { room, host, players, watcher, secondWatcher } = await createStableRoom(directory, accounts);
    const roomId = room.roomId;
    const roomCode = room.code;
    const ruleset = room.ruleset;

    await presence.connect(room, host.session, 'host-connection');
    const offlineFormal = players[1]!;
    await presence.connect(room, offlineFormal.session, 'offline-after-review');

    const first = room.startMatch();
    const firstGameId = first.gameId;
    const firstParticipantIds = new Set(first.state!.players.map((player) => player.playerId));
    const firstSeatByUser = new Map([...room.participants].map(([userId, seat]) => [userId, seat.playerId]));
    const firstWatcherInvite = await grants.invite(room, host.session, firstGameId);
    await grants.redeem(room, watcher.session, firstGameId, firstWatcherInvite.token);
    expect(room.members.get(watcher.userId)?.kind).toBe('private_spectator');

    const firstReceiptStore = room.receipts;
    const firstReceipt = firstReceiptStore.execute(
      firstGameId,
      first.state!.players[0]!.playerId,
      'old-request',
      { type: 'OLD_MATCH_COMMAND' },
      () => ({ requestId: 'old-request', status: 'accepted', code: null, message: null }),
    );
    expect(firstReceipt.status).toBe('accepted');
    const oldChat = {
      id: 1,
      channel: 'public',
      senderId: first.state!.players[0]!.playerId,
      text: 'old match chat',
      at: clock.now(),
      eventSeq: first.state!.eventSeq,
    } as const;
    registry.logMessage(first, oldChat);
    first.chat.push(oldChat);

    const firstResult = await playHumanWin(clock, room, true);
    expect(firstResult.state.win).toMatchObject({ winner: 'human' });
    expect(firstResult.state.players.find((player) => player.roleId === 'laike')?.abilities.laikeBladeUsed).toBe(true);
    expect(logStore.listMessages(firstGameId, 0)).toHaveLength(1);
    expect(logStore.listMatches(roomId)).toMatchObject([{ gameId: firstGameId, status: 'playing' }]);

    await presence.disconnect(room, offlineFormal.session, 'offline-after-review', 'ping timeout');
    await directory.leave(room, players[12]!.session);
    expect(room.members.has(players[12]!.userId)).toBe(false);
    expect(directory.current.has(players[12]!.userId)).toBe(false);

    const oldAccess = room.access!;
    const reviewInvite = await grants.invite(room, players[1]!.session, firstGameId);
    expect(oldAccess.invitations.size).toBe(1);
    expect(room.phase).toBe('review');

    await expect(rounds.endReview(room, players[1]!.session, firstGameId)).rejects.toMatchObject({ code: 'not_host' });
    const currentBeforeEnd = new Map(directory.current);
    const end = await rounds.endReview(room, host.session, firstGameId);
    expect(end).toEqual({ roomId, roomCode, gameId: null, endedGameId: firstGameId });
    expect(room.roomId).toBe(roomId);
    expect(room.code).toBe(roomCode);
    expect(room.ruleset).toEqual(ruleset);
    expect(new Map(directory.current)).toEqual(currentBeforeEnd);
    expect(room.runtime).toBeNull();
    expect(room.participants.size).toBe(0);
    expect(room.access).toBeNull();
    expect(oldAccess.invitations.size).toBe(0);
    expect(oldAccess.watchers.size).toBe(0);
    expect(room.members.get(watcher.userId)?.kind).toBe('public_spectator');
    expect(room.members.get(secondWatcher.userId)?.kind).toBe('public_spectator');
    expect(room.formalMembers().every((member) => member.ready === false)).toBe(true);
    expect(room.members.get(offlineFormal.userId)?.kind).toBe('formal');
    expect(room.members.get(offlineFormal.userId)?.presence).toBe('offline');
    expect(firstResult.night.done()).toBe(true);
    expect(firstResult.night.windows()).toEqual([]);
    expect(firstResult.day.done()).toBe(true);
    expect(firstResult.day.windows()).toEqual([]);
    expect(firstReceiptStore).not.toBe(room.receipts);

    const replacement = account(accounts, 'round_replacement');
    await directory.enter(room, replacement.session);
    for (const member of room.formalMembers()) member.ready = true;
    expect(room.formalMembers()).toHaveLength(13);

    const second = room.startMatch();
    const secondGameId = second.gameId;
    const secondPlayerIds = second.state!.players.map((player) => player.playerId);
    expect(secondGameId).not.toBe(firstGameId);
    expect(room.roomId).toBe(roomId);
    expect(room.code).toBe(roomCode);
    expect(room.ruleset).toEqual(ruleset);
    expect(room.members.get(host.userId)?.connections.has('host-connection')).toBe(true);
    expect(room.members.has(players[12]!.userId)).toBe(false);
    expect(room.participants.has(replacement.userId)).toBe(true);
    expect(secondPlayerIds.every((playerId) => !firstParticipantIds.has(playerId))).toBe(true);
    expect([...room.participants.values()].some((seat) => seat.playerId === firstSeatByUser.get(players[12]!.userId))).toBe(false);
    expect(second.state!.players.every((player) => player.abilities.laikeBladeUsed === false && player.abilities.waterRescueUsed === false && player.guardHistory.length === 0)).toBe(true);
    expect(second.state!.players.some((player) => player.life === 'dead')).toBe(false);
    expect(second.driver?.windows().length).toBeGreaterThan(0);
    expect(second.driver?.windows().every((window) => window.instanceId?.startsWith(`${secondGameId}:`))).toBe(true);
    expect(secondGameId).not.toBe(firstGameId);
    expect(logStore.listMessages(secondGameId, 0)).toEqual([]);
    expect(second.chat).toEqual([]);
    expect(room.receipts.execute(
      secondGameId,
      second.state!.players[0]!.playerId,
      'old-request',
      { type: 'NEW_MATCH_COMMAND' },
      () => ({ requestId: 'old-request', status: 'accepted', code: null, message: null }),
    ).status).toBe('accepted');
    await expect(grants.redeem(room, secondWatcher.session, secondGameId, reviewInvite.token)).rejects.toMatchObject({ code: 'invalid_screen_invitation' });

    await expect(rounds.endReview(room, host.session, secondGameId)).rejects.toMatchObject({ code: 'review_required' });
    await expect(rounds.endReview(room, host.session, firstGameId)).rejects.toMatchObject({ code: 'stale_game' });

    const secondResult = await playHumanWin(clock, room);
    expect(secondResult.state.win).toMatchObject({ winner: 'human' });
    expect(secondResult.state.gameId).toBe(secondGameId);
    await rounds.endReview(room, host.session, secondGameId);

    const matches = logStore.listMatches(roomId);
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.gameId)).toEqual([firstGameId, secondGameId]);
    expect(matches.every((match) => match.status === 'completed' && match.endedAt !== null)).toBe(true);
    expect(room.phase).toBe('lobby');
    expect(room.gameId).toBeNull();
  });
});
