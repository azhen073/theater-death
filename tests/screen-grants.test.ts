import { afterEach, describe, expect, it } from 'vitest';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { createFakeClock } from '../server/clock.ts';
import { createLogStore } from '../server/log-store.ts';
import { RoomRegistry } from '../server/rooms.ts';
import { AccountStore } from '../server/v2/account-store.ts';
import { RoomDirectory } from '../server/v2/room-directory.ts';
import { ScreenGrants } from '../server/v2/screen-grants.ts';

const stores: Array<{ close(): void }> = [];
afterEach(() => { for (const store of stores.splice(0).reverse()) store.close(); });

function setup() {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const registry = new RoomRegistry({ clock, ruleset: THEATER_DEATH_13_V2, logStore, strictWindows: true });
  const directory = new RoomDirectory({ clock, accounts, logStore, registry, revokeMedia: () => undefined, changed: () => undefined, control: () => undefined });
  const grants = new ScreenGrants(directory);
  stores.push(accounts, logStore);
  return { clock, accounts, directory, grants };
}

function account(accounts: AccountStore, name: string) {
  const nickname = name.replace(/\d/g, digit => String.fromCharCode(97 + Number(digit)));
  const row = accounts.register(`screen-${name}`, nickname, 'hash').account;
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

describe('v2 game-bound second-screen grants', () => {
  it('requires an active seat control and the current game, while lobby and cross-room attempts fail', async () => {
    const { accounts, directory, grants } = setup();
    const lobbyHost = account(accounts, 'grant_lobby_host');
    const lobby = await directory.create(lobbyHost.session, THEATER_DEATH_13_V2);
    await expect(grants.invite(lobby, lobbyHost.session, 'no-game')).rejects.toMatchObject({ code: 'stale_game' });
    const { room, players } = await fullMatch(directory, accounts, 'grant_auth');
    const spectator = account(accounts, 'grant_spectator');
    await directory.enter(room, spectator.session);
    await expect(grants.invite(room, spectator.session, room.gameId!)).rejects.toMatchObject({ code: 'seat_control_required' });
    const invite = await grants.invite(room, players[0]!.session, room.gameId!);
    await expect(grants.invite(room, players[0]!.session, 'old-game')).rejects.toMatchObject({ code: 'stale_game' });
    const otherRoom = await directory.create(account(accounts, 'other_room').session, THEATER_DEATH_13_V2);
    const other = account(accounts, 'current_elsewhere');
    await directory.enter(otherRoom, other.session);
    await expect(grants.redeem(room, other.session, room.gameId!, invite.token)).rejects.toMatchObject({ code: 'already_in_room' });
    expect(room.access!.invitations.size).toBe(1);
  });

  it('atomically upgrades an existing public spectator without using a formal seat', async () => {
    const { accounts, directory, grants } = setup();
    const { room, players } = await fullMatch(directory, accounts, 'grant_upgrade');
    const spectator = account(accounts, 'grant_public');
    const publicMember = await directory.enter(room, spectator.session);
    const invite = await grants.invite(room, players[0]!.session, room.gameId!);
    await expect(grants.redeem(room, spectator.session, room.gameId!, 'wrong-token')).rejects.toMatchObject({ code: 'invalid_screen_invitation' });
    expect(room.members.get(spectator.userId)).toMatchObject({ memberId: publicMember.memberId, kind: 'public_spectator', sessionId: spectator.session.id });
    const newer = accounts.createSession(spectator.userId).session;
    await directory.enter(room, newer, true);
    await expect(grants.redeem(room, spectator.session, room.gameId!, invite.token)).rejects.toMatchObject({ code: 'takeover_required' });
    expect(room.access!.invitations.size).toBe(1);
    const redeemed = await grants.redeem(room, newer, room.gameId!, invite.token);
    expect(redeemed).toMatchObject({ memberId: publicMember.memberId, kind: 'private_spectator', gameId: room.gameId });
    expect(room.formalMembers()).toHaveLength(13);
    expect(room.access!.watchers.get(spectator.userId)?.subject).toBe(redeemed.subjectPlayerId);
    await expect(grants.redeem(room, spectator.session, room.gameId!, invite.token)).rejects.toMatchObject({ code: 'invalid_screen_invitation' });
  });

  it('keeps codes single-use, rejects expired/cross-game/former-player redemption, and preserves public membership on failure', async () => {
    const { clock, accounts, directory, grants } = setup();
    const first = await fullMatch(directory, accounts, 'grant_expire_a');
    const second = await fullMatch(directory, accounts, 'grant_expire_b');
    const former = accounts.createSession(first.players[1]!.userId).session;
    const token = await grants.invite(first.room, first.players[0]!.session, first.room.gameId!);
    await expect(grants.redeem(second.room, account(accounts, 'cross_game').session, second.room.gameId!, token.token)).rejects.toMatchObject({ code: 'invalid_screen_invitation' });
    await directory.leave(first.room, first.players[1]!.session);
    await expect(grants.redeem(first.room, former, first.room.gameId!, token.token)).rejects.toMatchObject({ code: 'player_cannot_spectate' });
    expect(first.room.access!.invitations.size).toBe(1);
    clock.elapse(300_000);
    const expired = account(accounts, 'expired_screen');
    await expect(grants.redeem(first.room, expired.session, first.room.gameId!, token.token)).rejects.toMatchObject({ code: 'invalid_screen_invitation' });
    expect(first.room.access!.invitations.size).toBe(1);
  });

  it('enforces the five-minute boundary and rejects a second watcher for the same player', async () => {
    const { clock, accounts, directory, grants } = setup();
    const { room, players } = await fullMatch(directory, accounts, 'grant_boundary');
    const first = account(accounts, 'boundary_first');
    const second = account(accounts, 'boundary_second');
    await directory.enter(room, first.session);
    await directory.enter(room, second.session);
    const near = await grants.invite(room, players[0]!.session, room.gameId!);
    clock.elapse(299_999);
    await grants.redeem(room, first.session, room.gameId!, near.token);
    const duplicate = await grants.invite(room, players[0]!.session, room.gameId!).catch((error: unknown) => error as { code?: string });
    expect(duplicate).toMatchObject({ code: 'second_screen_unavailable' });
    expect(room.access!.watchers.get(second.userId)?.subject ?? null).toBeNull();
  });

  it('revokes private access to public, changes media identity, and emits screen_revoked', async () => {
    const controls: Array<{ sessionId: string | null; reason: string }> = [];
    const revoked: string[] = [];
    const clock = createFakeClock(1_000);
    const accounts = new AccountStore(':memory:', clock.now);
    const logStore = createLogStore(':memory:');
    const registry = new RoomRegistry({ clock, ruleset: THEATER_DEATH_13_V2, logStore, strictWindows: true });
    const directory = new RoomDirectory({ clock, accounts, logStore, registry, revokeMedia: (_gameId, identity) => revoked.push(identity), changed: () => undefined, control: (_r, sessionId, reason) => controls.push({ sessionId, reason }) });
    const grants = new ScreenGrants(directory);
    stores.push(accounts, logStore);
    const { room, players } = await fullMatch(directory, accounts, 'grant_revoke');
    const spectator = account(accounts, 'revoke_screen');
    await directory.enter(room, spectator.session);
    const invite = await grants.invite(room, players[0]!.session, room.gameId!);
    await grants.redeem(room, spectator.session, room.gameId!, invite.token);
    const before = room.access!.resolve(spectator.session)!;
    await grants.revoke(room, players[0]!.session, room.gameId!);
    const after = room.access!.resolve(spectator.session)!;
    expect(after.identity.subjectPlayerId).toBeNull();
    expect(after.identity.readOnly).toBe(true);
    expect(after.mediaIdentity).not.toBe(before.mediaIdentity);
    expect(revoked).toEqual([before.mediaIdentity]);
    expect(room.members.get(spectator.userId)?.kind).toBe('public_spectator');
    expect(controls).toContainEqual({ sessionId: spectator.session.id, reason: 'screen_revoked' });
  });
});
