import { afterEach, describe, expect, it } from 'vitest';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { createFakeClock } from '../server/clock.ts';
import { beginDay } from '../engine/day.ts';
import { makeEvent } from '../engine/events.ts';
import { resolveMorning } from '../engine/morning.ts';
import { runNight, scenario } from './helpers.ts';
import { createLogStore } from '../server/log-store.ts';
import { RoomRegistry } from '../server/rooms.ts';
import { AccountStore } from '../server/v2/account-store.ts';
import { RoomDirectory } from '../server/v2/room-directory.ts';
import { RoomSnapshots } from '../server/v2/snapshots.ts';
import { ScreenGrants } from '../server/v2/screen-grants.ts';

const stores: Array<{ close(): void }> = [];
afterEach(() => { for (const store of stores.splice(0).reverse()) store.close(); });

function setup() {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const registry = new RoomRegistry({ clock, ruleset: THEATER_DEATH_13_V2, logStore, strictWindows: true });
  const directory = new RoomDirectory({ clock, accounts, logStore, registry, revokeMedia: () => undefined, changed: () => undefined, control: () => undefined });
  const profiles = new Map<string, { userId: string; uid: string; nickname: string; avatarUrl: string | null; profileVersion: number }>();
  const snapshots = new RoomSnapshots({ directory, profile: (userId) => profiles.get(userId)! });
  stores.push(accounts, logStore);
  return { clock, accounts, directory, registry, profiles, snapshots };
}

function account(accounts: AccountStore, profiles: Map<string, { userId: string; uid: string; nickname: string; avatarUrl: string | null; profileVersion: number }>, name: string) {
  const nickname = name.replace(/\d/g, digit => String.fromCharCode(97 + Number(digit)));
  const row = accounts.register(`snapshot-${name}`, nickname, 'hash').account;
  profiles.set(row.id, { userId: row.id, uid: row.uid, nickname: row.nickname, avatarUrl: null, profileVersion: 0 });
  return { userId: row.id, session: accounts.createSession(row.id).session };
}

async function fullMatch(f: ReturnType<typeof setup>, prefix: string) {
  const host = account(f.accounts, f.profiles, `${prefix}_host`);
  const room = await f.directory.create(host.session, THEATER_DEATH_13_V2);
  const players = [host];
  for (let i = 1; i < 13; i += 1) {
    const player = account(f.accounts, f.profiles, `${prefix}_${i}`);
    players.push(player);
    await f.directory.enter(room, player.session);
  }
  for (const member of room.formalMembers()) member.ready = true;
  room.startMatch();
  return { room, players };
}

describe('v2 RoomSnapshot contract', () => {
  it('returns a complete lobby snapshot with stable null/empty top-level fields and room permissions', async () => {
    const f = setup();
    const host = account(f.accounts, f.profiles, 'snapshot_lobby');
    const room = await f.directory.create(host.session, THEATER_DEATH_13_V2);
    const snapshot = f.snapshots.read(room, host.session);
    expect(Object.keys(snapshot).sort()).toEqual(['capabilities', 'chat', 'contractVersion', 'gameId', 'private', 'public', 'room', 'roomId', 'rulesVersion', 'serverTime', 'submissionState', 'tasks', 'viewer', 'viewVersion', 'windows'].sort());
    expect(snapshot).toMatchObject({ contractVersion: '2.2', gameId: null, public: null, private: null, tasks: [], windows: [], submissionState: [], chat: { public: [], faction: [] } });
    expect(snapshot.room.formalMembers).toHaveLength(1);
    expect(snapshot.viewer.isHost).toBe(true);
    expect(snapshot.capabilities.room.start).toMatchObject({ allowed: false, reason: 'room_not_full' });
    expect(snapshot.capabilities.room.ready).toMatchObject({ allowed: true });
  });

  it('starts a full ready match without requiring online presence and exposes profile projections', async () => {
    const f = setup();
    const { room, players } = await fullMatch(f, 'snapshot_ready');
    const snapshot = f.snapshots.read(room, players[0]!.session);
    expect(snapshot.gameId).toBe(room.gameId);
    expect(snapshot.room.formalMembers).toHaveLength(13);
    expect(snapshot.public?.seats).toHaveLength(13);
    expect(snapshot.public?.seats.every((seat) => seat.presence === 'offline')).toBe(true);
    expect(snapshot.public?.seats[0]).toMatchObject({ avatarUrl: null, profileVersion: 0 });
  });

  it('keeps public spectators read-only and private second screens subject-bound', async () => {
    const f = setup();
    const { room, players } = await fullMatch(f, 'snapshot_spectator');
    const spectator = account(f.accounts, f.profiles, 'snapshot_public');
    await f.directory.enter(room, spectator.session);
    const publicView = f.snapshots.read(room, spectator.session);
    expect(publicView.viewer).toMatchObject({ userId: spectator.userId, kind: 'public_spectator', subjectPlayerId: null, readOnly: true, isHost: false });
    expect(publicView.private).toBeNull();
    expect(publicView.tasks).toEqual([]);
    const grants = new ScreenGrants(f.directory);
    const factionPlayerId = room.runtime!.state!.players.find((player) => player.roleId === 'death')!.playerId;
    const factionPlayer = players.find((player) => room.participants.get(player.userId)!.playerId === factionPlayerId)!;
    room.runtime!.state = { ...room.runtime!.state!, factionRoom: { ...room.runtime!.state!.factionRoom, deathJoinDecided: true, deathJoined: true, deathReadOnly: false, deathJoinedEventSeq: 0 } };
    const invite = await grants.invite(room, factionPlayer.session, room.gameId!);
    await grants.redeem(room, spectator.session, room.gameId!, invite.token);
    const privateView = f.snapshots.read(room, spectator.session);
    expect(privateView.viewer).toMatchObject({ kind: 'private_spectator', subjectPlayerId: factionPlayerId, readOnly: true });
    expect(privateView.private?.factionRoom?.canWrite).toBe(false);
    expect(privateView.private?.factionRoom?.readOnly).toBe(true);
  });

  it('increments viewVersion for visible member/profile changes but not serverTime-only changes', async () => {
    const f = setup();
    const host = account(f.accounts, f.profiles, 'snapshot_versions');
    const room = await f.directory.create(host.session, THEATER_DEATH_13_V2);
    const first = f.snapshots.read(room, host.session);
    f.clock.elapse(500);
    const timeOnly = f.snapshots.read(room, host.session);
    expect(timeOnly.serverTime).toBeGreaterThan(first.serverTime);
    expect(timeOnly.viewVersion).toBe(first.viewVersion);
    room.members.get(host.userId)!.ready = true;
    const readyChanged = f.snapshots.read(room, host.session);
    expect(readyChanged.viewVersion).toBeGreaterThan(timeOnly.viewVersion);
    f.profiles.get(host.userId)!.avatarUrl = 'https://cdn.example.test/avatar.png';
    f.profiles.get(host.userId)!.profileVersion = 1;
    const profileChanged = f.snapshots.read(room, host.session);
    expect(profileChanged.viewVersion).toBeGreaterThan(readyChanged.viewVersion);
  });

  it('hides personal private windows from a public viewer and does not expose vote dictionaries', async () => {
    const f = setup();
    const { room, players } = await fullMatch(f, 'snapshot_visibility');
    const spectator = account(f.accounts, f.profiles, 'snapshot_viewer');
    await f.directory.enter(room, spectator.session);
    const publicView = f.snapshots.read(room, spectator.session);
    expect(publicView.private).toBeNull();
    expect(publicView.tasks).toEqual([]);
    expect(JSON.stringify(publicView)).not.toContain('votes');
    const playerView = f.snapshots.read(room, players[0]!.session);
    expect(playerView.private?.self.playerId).toBe(room.participants.get(players[0]!.userId)!.playerId);
    expect(playerView.capabilities.room.inviteSecondScreen.allowed).toBe(true);
  });

  it('does not change a public viewer snapshot for a hidden personal event or global event sequence', async () => {
    const f = setup();
    const { room } = await fullMatch(f, 'snapshot_hidden');
    const spectator = account(f.accounts, f.profiles, 'snapshot_hidden_viewer');
    await f.directory.enter(room, spectator.session);
    const before = f.snapshots.read(room, spectator.session);
    const runtime = room.runtime!;
    const hiddenSeq = runtime.events.length + 1;
    runtime.events.push(makeEvent({ seq: hiddenSeq, dayNumber: runtime.state!.dayNumber, stage: runtime.state!.stage, type: 'private_notice', payload: { text: 'secret' }, visibility: { kind: 'players', playerIds: [runtime.members[0]!.playerId] } }));
    runtime.state = { ...runtime.state!, eventSeq: runtime.state!.eventSeq + 1 };
    const after = f.snapshots.read(room, spectator.session);
    expect(after.viewVersion).toBe(before.viewVersion);
    expect(JSON.stringify(after)).not.toContain('secret');
  });

  it('projects real day vote progress without exposing the votes dictionary', async () => {
    const f = setup();
    const { room, players } = await fullMatch(f, 'snapshot_votes');
    const runtime = room.runtime!;
    const morning = resolveMorning(runNight(runtime.state!, {})).state;
    const day = beginDay(morning).state;
    if (!day.day?.election) throw new Error('missing election fixture');
    const election = { ...day.day.election, phase: 'vote' as const, votes: { [runtime.members[0]!.playerId]: runtime.members[1]!.playerId } };
    runtime.state = { ...day, phase: 'day', day: { ...day.day, election } };
    const view = f.snapshots.read(room, players[0]!.session);
    expect(view.public?.day?.election).toMatchObject({ votedCount: 1 });
    expect(view.public?.day?.election && 'votes' in view.public.day.election).toBe(false);
    expect(view.public?.night).toBeNull();
  });

  it('shows personal skill windows only to the matching player and keeps spectators/civilians free of them', async () => {
    const f = setup();
    const { room, players } = await fullMatch(f, 'snapshot_windows');
    const door = players.find((player) => room.runtime!.state!.players.find((p) => p.playerId === room.participants.get(player.userId)!.playerId)?.roleId === 'door')!;
    const civilian = players.find((player) => room.runtime!.state!.players.find((p) => p.playerId === room.participants.get(player.userId)!.playerId)?.roleId === 'civilian')!;
    const spectator = account(f.accounts, f.profiles, 'snapshot_window_viewer');
    await f.directory.enter(room, spectator.session);
    const doorView = f.snapshots.read(room, door.session);
    const civilianView = f.snapshots.read(room, civilian.session);
    const spectatorView = f.snapshots.read(room, spectator.session);
    expect(doorView.tasks.some((task) => task.action === 'SUBMIT_GUARD')).toBe(true);
    expect(doorView.windows.some((window) => window.id === 'guard')).toBe(true);
    expect(civilianView.tasks.some((task) => ['SUBMIT_GUARD', 'SUBMIT_LAIKE', 'EDIT_PROPOSAL'].includes(task.action))).toBe(false);
    expect(civilianView.windows.some((window) => window.id === 'guard')).toBe(false);
    expect(spectatorView.tasks).toEqual([]);
    expect(spectatorView.windows).toEqual([]);
    const factionClose = room.runtime!.driver!.windows().find((window) => window.id === 'faction')!.closesAt;
    expect(doorView.public?.night).toEqual({ closesAt: factionClose });
    expect(civilianView.public?.night).toEqual({ closesAt: factionClose });
    expect(spectatorView.public?.night).toEqual({ closesAt: factionClose });
  });

  it('sends spirit identity knowledge only to death, mourner and spirits', async () => {
    const f = setup();
    const { room, players } = await fullMatch(f, 'snapshot_knowledge');
    const runtime = room.runtime!;
    const spiritSeats = runtime.state!.players.filter((player) => player.roleId === 'spirit').map((player) => player.seat).sort((a, b) => a - b);
    expect(spiritSeats.length).toBeGreaterThan(0);
    for (const player of players) {
      const self = runtime.state!.players.find((item) => item.playerId === room.participants.get(player.userId)!.playerId)!;
      const view = f.snapshots.read(room, player.session);
      if (self.roleId === 'death' || self.roleId === 'mourner') {
        expect(view.private?.knowledge).toEqual({ spiritSeats });
      } else if (self.roleId === 'spirit') {
        expect(view.private?.knowledge).toEqual({ spiritSeats: spiritSeats.filter((seat) => seat !== self.seat) });
      } else {
        expect(view.private?.knowledge).toEqual({ spiritSeats: [] });
      }
    }
  });

  it('projects effective proposal state to the player view while keeping proposal/private data out of public spectators', async () => {
    const f = setup();
    const { room, players } = await fullMatch(f, 'snapshot_effective_proposal');
    const runtime = room.runtime!;
    const spirits = players.filter((player) => {
      const playerId = room.participants.get(player.userId)!.playerId;
      return runtime.state!.players.find((item) => item.playerId === playerId)?.roleId === 'spirit';
    });
    const firstSpirit = spirits[0]!;
    const secondSpirit = spirits[1]!;
    const firstTarget = runtime.state!.players[0]!.playerId;
    const factionWindow = runtime.driver!.windows().find((window) => window.id === 'faction')!;
    expect(runtime.driver!.submit({ type: 'EDIT_PROPOSAL', playerId: room.participants.get(firstSpirit.userId)!.playerId, targets: [firstTarget], windowInstanceId: factionWindow.instanceId }).accepted).toBe(true);
    expect(runtime.driver!.submit({ type: 'EDIT_PROPOSAL', playerId: room.participants.get(secondSpirit.userId)!.playerId, targets: [], windowInstanceId: factionWindow.instanceId }).accepted).toBe(true);
    const playerView = f.snapshots.read(room, secondSpirit.session);
    expect(playerView.private?.proposal?.effective).toEqual({ revision: 2, targetPlayerIds: [], basis: 'latest_legal' });

    const spectator = account(f.accounts, f.profiles, 'snapshot_effective_public');
    await f.directory.enter(room, spectator.session);
    const publicView = f.snapshots.read(room, spectator.session);
    expect(publicView.private).toBeNull();
    expect('proposal' in publicView).toBe(false);
  });
});
