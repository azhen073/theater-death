import { afterEach, describe, expect, it } from 'vitest';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { createFakeClock } from '../server/clock.ts';
import { createLogStore } from '../server/log-store.ts';
import { RoomRegistry } from '../server/rooms.ts';
import { MemberPresence } from '../server/v2/presence.ts';
import { RoomDirectory } from '../server/v2/room-directory.ts';
import { RoomGovernance } from '../server/v2/governance.ts';
import type { StableRoom } from '../server/v2/stable-room.ts';
import { AccountStore } from '../server/v2/account-store.ts';

const stores: Array<{ close(): void }> = [];
afterEach(() => { for (const store of stores.splice(0).reverse()) store.close(); });

function setup() {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const registry = new RoomRegistry({ clock, ruleset: THEATER_DEATH_13_V2, logStore, strictWindows: true });
  const controls: Array<{ sessionId: string | null; reason: string }> = [];
  let governance: RoomGovernance | undefined;
  const directory = new RoomDirectory({
    clock, accounts, logStore, registry, revokeMedia: () => undefined,
    changed: (room, event) => governance?.reconcile(room, event),
    control: (_room, sessionId, reason) => controls.push({ sessionId, reason }),
  });
  governance = new RoomGovernance(directory);
  const presence = new MemberPresence(directory);
  stores.push(accounts, logStore);
  return { clock, accounts, directory, governance, presence, controls };
}

function account(accounts: AccountStore, name: string) {
  const nickname = name.replace(/\d/g, digit => String.fromCharCode(97 + Number(digit)));
  const row = accounts.register(`governance-${name}`, nickname, 'hash').account;
  return { userId: row.id, session: accounts.createSession(row.id).session };
}

async function fullMatch(directory: RoomDirectory, accounts: AccountStore, prefix: string) {
  const host = account(accounts, `${prefix}_host`);
  const room = await directory.create(host.session, THEATER_DEATH_13_V2);
  const players = [host];
  for (let index = 1; index < 13; index += 1) {
    const player = account(accounts, `${prefix}_${index}`);
    players.push(player);
    await directory.enter(room, player.session);
  }
  for (const member of room.formalMembers()) member.ready = true;
  room.startMatch();
  return { room, players };
}

describe('v2 room governance', () => {
  it('keeps the creator host before first socket, then assigns the earliest online formal member after grace', async () => {
    const { clock, accounts, directory, governance, presence, controls } = setup();
    const host = account(accounts, 'gov_host');
    const room = await directory.create(host.session, THEATER_DEATH_13_V2);
    const target = account(accounts, 'gov_target');
    await directory.enter(room, target.session);
    const later = account(accounts, 'gov_later');
    await directory.enter(room, later.session);
    expect(room.hostMemberId).toBe(room.members.get(host.userId)!.memberId);
    governance.reconcile(room);
    expect(room.hostMemberId).toBe(room.members.get(host.userId)!.memberId);
    await presence.connect(room, host.session, 'host-socket');
    await presence.connect(room, later.session, 'later-socket');
    await presence.connect(room, target.session, 'target-socket');
    await presence.disconnect(room, host.session, 'host-socket', 'transport close');
    clock.elapse(15_000); clock.flush(); await Promise.resolve();
    expect(room.hostMemberId).toBe(room.members.get(target.userId)!.memberId);
    expect(controls.some((event) => event.reason === 'host_changed')).toBe(true);
  });

  it('does not choose spectators, while a formal member remains eligible even when its runtime player is dead', async () => {
    const { accounts, directory, presence, clock } = setup();
    const { room, players } = await fullMatch(directory, accounts, 'gov_dead');
    const target = players[1]!;
    const spectator = account(accounts, 'gov_watcher');
    await directory.enter(room, spectator.session);
    await presence.connect(room, target.session, 'target');
    await presence.connect(room, spectator.session, 'spectator');
    room.access!.watchers.get(spectator.userId)!.subject = room.participants.get(target.userId)!.playerId;
    const targetPlayerId = room.participants.get(target.userId)!.playerId;
    room.runtime!.state = { ...room.runtime!.state!, players: room.runtime!.state!.players.map((p) => p.playerId === targetPlayerId ? { ...p, life: 'dead' as const } : p) };
    const host = players[0]!;
    await presence.connect(room, host.session, 'host');
    await presence.disconnect(room, host.session, 'host', 'transport close');
    clock.elapse(15_000); clock.flush(); await Promise.resolve();
    expect(room.hostMemberId).toBe(room.members.get(target.userId)!.memberId);
    expect(room.hostMemberId).not.toBe(room.members.get(spectator.userId)!.memberId);
  });

  it('leaves host null with nobody online, fills it when a formal member returns, and old host does not reclaim it', async () => {
    const { accounts, directory, governance, presence, clock } = setup();
    const host = account(accounts, 'gov_empty_host');
    const target = account(accounts, 'gov_empty_target');
    const room = await directory.create(host.session, THEATER_DEATH_13_V2);
    await directory.enter(room, target.session);
    await presence.connect(room, host.session, 'host');
    await presence.disconnect(room, host.session, 'host', 'transport close');
    clock.elapse(15_000); clock.flush(); await Promise.resolve();
    expect(room.hostMemberId).toBeNull();
    await presence.connect(room, target.session, 'target-return');
    expect(room.hostMemberId).toBe(room.members.get(target.userId)!.memberId);
    const targetOrder = room.members.get(target.userId)!.joinedOrder;
    await directory.leave(room, host.session);
    const newer = accounts.createSession(host.userId).session;
    const returned = await directory.enter(room, newer);
    await presence.connect(room, newer, 'old-host-return');
    governance.reconcile(room);
    expect(returned.joinedOrder).toBeGreaterThan(targetOrder);
    expect(room.hostMemberId).toBe(room.members.get(target.userId)!.memberId);
  });

  it('supports transfer in lobby, playing, and review, with availability and role checks', async () => {
    const lobby = setup();
    const host = account(lobby.accounts, 'transfer_lobby_host');
    const target = account(lobby.accounts, 'transfer_lobby_target');
    const lobbyRoom = await lobby.directory.create(host.session, THEATER_DEATH_13_V2);
    await lobby.directory.enter(lobbyRoom, target.session);
    await lobby.presence.connect(lobbyRoom, host.session, 'h');
    await lobby.presence.connect(lobbyRoom, target.session, 't');
    await expect(lobby.governance.transfer(lobbyRoom, target.session, lobbyRoom.members.get(host.userId)!.memberId)).rejects.toMatchObject({ code: 'not_host' });
    const offline = account(lobby.accounts, 'transfer_lobby_offline');
    await lobby.directory.enter(lobbyRoom, offline.session);
    await expect(lobby.governance.transfer(lobbyRoom, host.session, lobbyRoom.members.get(offline.userId)!.memberId)).rejects.toMatchObject({ code: 'host_target_unavailable' });
    await lobby.governance.transfer(lobbyRoom, host.session, lobbyRoom.members.get(target.userId)!.memberId);
    expect(lobbyRoom.hostMemberId).toBe(lobbyRoom.members.get(target.userId)!.memberId);

    const playing = setup();
    const match = await fullMatch(playing.directory, playing.accounts, 'transfer_playing');
    const next = match.players[1]!;
    await playing.presence.connect(match.room, match.players[0]!.session, 'h');
    await playing.presence.connect(match.room, next.session, 't');
    await playing.governance.transfer(match.room, match.players[0]!.session, match.room.members.get(next.userId)!.memberId);
    expect(match.room.hostMemberId).toBe(match.room.members.get(next.userId)!.memberId);
    match.room.runtime!.state = { ...match.room.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'test' } };
    const reviewTarget = match.players[2]!;
    await playing.presence.connect(match.room, reviewTarget.session, 'review-target');
    await playing.governance.transfer(match.room, next.session, match.room.members.get(reviewTarget.userId)!.memberId);
    expect(match.room.hostMemberId).toBe(match.room.members.get(reviewTarget.userId)!.memberId);
    const audience = account(playing.accounts, 'transfer_audience');
    await playing.directory.enter(match.room, audience.session);
    await playing.presence.connect(match.room, audience.session, 'audience');
    await expect(playing.governance.transfer(match.room, reviewTarget.session, match.room.members.get(audience.userId)!.memberId)).rejects.toMatchObject({ code: 'host_target_unavailable' });
  });

  it('kicks formal members only in lobby while spectators can be kicked in every phase', async () => {
    const lobby = setup();
    const host = account(lobby.accounts, 'dissolve_host');
    const target = account(lobby.accounts, 'dissolve_target');
    const room = await lobby.directory.create(host.session, THEATER_DEATH_13_V2);
    await lobby.directory.enter(room, target.session);
    await lobby.governance.kick(room, host.session, room.members.get(target.userId)!.memberId);
    expect(room.members.has(target.userId)).toBe(false);
    await lobby.governance.dissolve(room, host.session);
    expect(lobby.directory.byCode.has(room.code)).toBe(false);
    expect(lobby.directory.current.has(host.userId)).toBe(false);
    expect(lobby.controls.some((event) => event.reason === 'dissolved')).toBe(true);

    const playing = setup();
    const match = await fullMatch(playing.directory, playing.accounts, 'kick_match');
    const spectator = account(playing.accounts, 'kick_watcher');
    await playing.directory.enter(match.room, spectator.session);
    await expect(playing.governance.kick(match.room, match.players[0]!.session, match.room.members.get(match.players[1]!.userId)!.memberId)).rejects.toMatchObject({ code: 'lobby_required' });
    await playing.governance.kick(match.room, match.players[0]!.session, match.room.members.get(spectator.userId)!.memberId);
    expect(match.room.members.has(spectator.userId)).toBe(false);
    match.room.runtime!.state = { ...match.room.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'test' } };
    const reviewSpectator = account(playing.accounts, 'review_watcher');
    await playing.directory.enter(match.room, reviewSpectator.session);
    await playing.presence.connect(match.room, reviewSpectator.session, 'review-audience');
    await playing.governance.kick(match.room, match.players[0]!.session, match.room.members.get(reviewSpectator.userId)!.memberId);
    expect(match.room.members.has(reviewSpectator.userId)).toBe(false);
  });

  it('dissolves immediately in any phase for the host and rejects non-hosts', async () => {
    const playing = setup();
    const match = await fullMatch(playing.directory, playing.accounts, 'dissolve_any');
    const host = match.players[0]!;
    const spectator = account(playing.accounts, 'dissolve_any_watcher');
    await playing.directory.enter(match.room, spectator.session);
    await expect(playing.governance.dissolve(match.room, match.players[1]!.session)).rejects.toMatchObject({ code: 'not_host' });
    await expect(playing.governance.dissolve(match.room, spectator.session)).rejects.toMatchObject({ code: 'not_host' });
    expect(match.room.dissolved).toBe(false);
    await playing.governance.dissolve(match.room, host.session);
    expect(match.room.dissolved).toBe(true);
    expect(playing.directory.byCode.has(match.room.code)).toBe(false);
    expect(playing.controls.some((event) => event.reason === 'dissolved')).toBe(true);
  });

  it('treats a host leaving as dissolve in lobby and review, but as a temporary absence during play', async () => {
    const lobby = setup();
    const lobbyHost = account(lobby.accounts, 'leave_lobby_host');
    const lobbyRoom = await lobby.directory.create(lobbyHost.session, THEATER_DEATH_13_V2);
    const lobbyOther = account(lobby.accounts, 'leave_lobby_other');
    await lobby.directory.enter(lobbyRoom, lobbyOther.session);
    expect(await lobby.governance.leave(lobbyRoom, lobbyHost.session)).toMatchObject({ left: true, dissolved: true, seatRetained: false });
    expect(lobbyRoom.dissolved).toBe(true);
    expect(lobby.directory.byCode.has(lobbyRoom.code)).toBe(false);

    const playing = setup();
    const match = await fullMatch(playing.directory, playing.accounts, 'leave_playing');
    const successor = match.players[1]!;
    await playing.presence.connect(match.room, successor.session, 'successor-socket');
    expect(await playing.governance.leave(match.room, match.players[0]!.session)).toMatchObject({ left: true, dissolved: false, seatRetained: true });
    expect(match.room.dissolved).toBe(false);
    expect(playing.directory.byCode.has(match.room.code)).toBe(true);
    expect(match.room.hostMemberId).toBe(match.room.members.get(successor.userId)!.memberId);

    const review = setup();
    const reviewed = await fullMatch(review.directory, review.accounts, 'leave_review');
    reviewed.room.runtime!.state = { ...reviewed.room.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'leave_review' } };
    expect(await review.governance.leave(reviewed.room, reviewed.players[0]!.session)).toMatchObject({ left: true, dissolved: true, seatRetained: false });
    expect(reviewed.room.dissolved).toBe(true);
    expect(review.directory.byCode.has(reviewed.room.code)).toBe(false);

    const member = setup();
    const normal = await fullMatch(member.directory, member.accounts, 'leave_member');
    expect(await member.governance.leave(normal.room, normal.players[3]!.session)).toMatchObject({ left: true, dissolved: false });
    expect(member.directory.byCode.has(normal.room.code)).toBe(true);
  });
});
