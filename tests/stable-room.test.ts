import { afterEach, describe, expect, it } from 'vitest';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { createFakeClock, type FakeClock } from '../server/clock.ts';
import { createLogStore, type LogStore } from '../server/log-store.ts';
import { RoomRegistry } from '../server/rooms.ts';
import { AccountStore } from '../server/v2/account-store.ts';
import { StableRoom, type ActiveMember } from '../server/v2/stable-room.ts';

const opened: Array<{ close(): void }> = [];
afterEach(() => { for (const resource of opened.splice(0).reverse()) resource.close(); });

function setup() {
  const clock = createFakeClock(1_000);
  const accounts = new AccountStore(':memory:', clock.now);
  const logStore = createLogStore(':memory:');
  const registry = new RoomRegistry({ clock, ruleset: THEATER_DEATH_13_V2, logStore });
  const deps = { clock, accounts, logStore, registry, revokeMedia: () => undefined };
  opened.push(accounts, logStore);
  return { clock, accounts, logStore, registry, deps };
}

function member(index: number, userId: string, sessionId: string | null, kind: ActiveMember['kind'] = 'formal'): ActiveMember {
  return {
    memberId: `m_${index}`, userId, uid: String(10_000_001 + index), nickname: `user${String.fromCharCode(96 + index)}`, kind, joinedAt: index, joinedOrder: index,
    ready: true, sessionId, epoch: `epoch_${index}`, presence: 'online', connections: new Set(), disconnectAt: null,
  };
}

describe('StableRoom lifecycle contract', () => {
  it('deep clones and freezes the ruleset snapshot', () => {
    const { deps } = setup();
    const source = structuredClone(THEATER_DEATH_13_V2);
    const room = new StableRoom('STABLE01', source, deps);
    (source.roles as Record<string, number>).civilian = 99;
    expect(room.ruleset.roles.civilian).toBe(THEATER_DEATH_13_V2.roles.civilian);
    expect(Object.isFrozen(room.ruleset)).toBe(true);
    expect(Object.isFrozen(room.ruleset.roles)).toBe(true);
  });

  it('starts in lobby with no gameId, then creates a separate match and excludes spectators', () => {
    const { deps, accounts } = setup();
    const room = new StableRoom('STABLE02', THEATER_DEATH_13_V2, deps);
    expect(room.gameId).toBeNull();
    const formal: string[] = [];
    for (let index = 1; index <= 13; index += 1) {
      const account = accounts.register(`formal-${index}`, `formal${String.fromCharCode(97 + index)}`, 'hash').account;
      const session = accounts.createSession(account.id);
      formal.push(account.id);
      room.members.set(account.id, member(index, account.id, session.session.id));
    }
    const spectator = accounts.register('spectator-1', 'spectatorone', 'hash').account;
    const spectatorSession = accounts.createSession(spectator.id);
    room.members.set(spectator.id, member(14, spectator.id, spectatorSession.session.id, 'public_spectator'));
    room.hostMemberId = room.members.get(formal[0]!)!.memberId;

    const runtime = room.startMatch();
    expect(room.gameId).toBe(runtime.gameId);
    expect(runtime.gameId).not.toBe(room.roomId);
    expect(runtime.members).toHaveLength(13);
    expect([...room.participants.keys()]).toEqual(formal);
    expect(room.participants.has(spectator.id)).toBe(false);
    expect(room.access?.watchers.has(spectator.id)).toBe(true);
    expect(room.access?.seats.size).toBe(13);
    expect(room.phase).toBe('playing');
  });

  it('serializes runtime.enqueue through the stable room queue', async () => {
    const { deps, accounts } = setup();
    const room = new StableRoom('STABLE03', THEATER_DEATH_13_V2, deps);
    for (let index = 1; index <= 13; index += 1) {
      const account = accounts.register(`queue-${index}`, `queue${String.fromCharCode(97 + index)}`, 'hash').account;
      const session = accounts.createSession(account.id);
      room.members.set(account.id, member(index, account.id, session.session.id));
    }
    room.hostMemberId = room.members.values().next().value!.memberId;
    const runtime = room.startMatch();
    const order: string[] = [];
    const first = runtime.enqueue(async () => { order.push('runtime-start'); await Promise.resolve(); order.push('runtime-end'); });
    const second = room.enqueue(() => { order.push('stable'); });
    await Promise.all([first, second]);
    expect(order).toEqual(['runtime-start', 'runtime-end', 'stable']);
  });

  it('records completion once while preserving startedAt and endedAt', () => {
    const { deps, accounts, logStore, clock } = setup();
    const room = new StableRoom('STABLE04', THEATER_DEATH_13_V2, deps);
    for (let index = 1; index <= 13; index += 1) {
      const account = accounts.register(`complete-${index}`, `complete${String.fromCharCode(97 + index)}`, 'hash').account;
      const session = accounts.createSession(account.id);
      room.members.set(account.id, member(index, account.id, session.session.id));
    }
    room.hostMemberId = [...room.members.keys()][0]!;
    const runtime = room.startMatch();
    runtime.state = { ...runtime.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'test' } };
    const started = logStore.listMatches(room.roomId)[0]!;
    clock.elapse(500);
    room.recordCompletion();
    const completed = logStore.listMatches(room.roomId)[0]!;
    expect(completed).toMatchObject({ gameId: runtime.gameId, roomId: room.roomId, startedAt: started.startedAt, endedAt: 1_500, status: 'completed' });
    clock.elapse(500);
    room.recordCompletion();
    expect(logStore.listMatches(room.roomId)[0]!.endedAt).toBe(1_500);
  });

  it('keeps legacy audit matches separate when different persistent rooms reuse a code', () => {
    const { logStore } = setup();
    logStore.recordRoom({ gameId: 'legacy', code: 'SAME01', createdAt: 0, ruleset: {} });
    logStore.recordPersistentRoom({ roomId: 'legacy-room-a', code: 'SAME01', createdAt: 1, ruleset: {} });
    logStore.recordPersistentRoom({ roomId: 'legacy-room-b', code: 'SAME01', createdAt: 2, ruleset: {} });
    logStore.recordMatch({ roomId: 'legacy-room-a', gameId: 'game-a', startedAt: 3 });
    logStore.recordMatch({ roomId: 'legacy-room-b', gameId: 'game-b', startedAt: 4 });
    expect(logStore.listMatches('legacy-room-a').map((match) => match.gameId)).toEqual(['game-a']);
    expect(logStore.listMatches('legacy-room-b').map((match) => match.gameId)).toEqual(['game-b']);
    expect(logStore.listMatches('legacy').map((match) => match.gameId)).toEqual([]);
    expect(logStore.getRoom('legacy')?.code).toBe('SAME01');
  });
});
