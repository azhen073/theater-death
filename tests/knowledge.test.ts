import { describe, expect, it } from 'vitest';
import { makeEvent, type GameEvent } from '../engine/events.ts';
import { type GameState } from '../engine/types.ts';
import { Room, type RoomMember } from '../server/rooms.ts';
import { gameView } from '../server/v2/view.ts';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import { publishedState } from '../visibility/knowledge.ts';
import { overrideLife, overridePlayer, scenario } from './helpers.ts';

function event<Type extends string, Payload>(
  type: Type,
  payload: Payload,
  visibility: GameEvent['visibility'] = { kind: 'public' },
  dayNumber = 1,
): GameEvent<Type, Payload> {
  return makeEvent({ seq: dayNumber, dayNumber, stage: 1, type, payload, visibility });
}

function life(state: GameState, seat: number): string {
  return state.players.find((player) => player.seat === seat)?.life ?? 'missing';
}

describe('publishedState 公开知识投影', () => {
  it('普通座位内部为 dead 或 dying、没有公开公告时仍公开为 alive', () => {
    const internal = overrideLife(overrideLife(scenario(), 'p_1', 'dead'), 'p_2', 'dying');

    const published = publishedState(internal, []);

    expect(life(published, 1)).toBe('alive');
    expect(life(published, 2)).toBe('alive');
  });

  it('server 可见的死亡事件不改变公开生命状态', () => {
    const state = scenario();
    const privateDeath = event(
      'deaths_announced',
      { seats: [6] },
      { kind: 'server' },
    );

    expect(life(publishedState(state, [privateDeath]), 6)).toBe('alive');
  });

  it('只有 public deaths_announced 才把夜间死亡公开为 dead', () => {
    const state = scenario();
    const announced = event('deaths_announced', { seats: [6] });

    expect(life(publishedState(state, [announced]), 6)).toBe('dead');
  });

  it('同晨 revive_announced 先于 deaths_announced 时，死亡公告不覆盖复活者的 alive', () => {
    const state = scenario();
    const revived = event('revive_announced', { targetSeat: 3 });
    const deaths = event('deaths_announced', { seats: [3] });

    expect(life(publishedState(state, [revived, deaths]), 3)).toBe('alive');
  });

  it('后日公开死亡公告和白天放逐公告都确实公开为 dead', () => {
    const state = scenario();
    const nightDeath = event('deaths_announced', { seats: [6] }, { kind: 'public' }, 2);
    const elimination = event('elimination_announced', { seat: 7 }, { kind: 'public' }, 2);

    const published = publishedState(state, [nightDeath, elimination]);

    expect(life(published, 6)).toBe('dead');
    expect(life(published, 7)).toBe('dead');
  });

  it('只有 public reveal_announced 才公开翻牌身份', () => {
    const internallyRevealed = overridePlayer(scenario(), 'p_1', { revealed: true });
    const hidden = publishedState(internallyRevealed, []);
    const revealed = publishedState(
      scenario(),
      [event('reveal_announced', { reveals: [{ seat: 1, roleId: 'laike' }] })],
    );

    expect(hidden.players.find((player) => player.seat === 1)?.revealed).toBe(false);
    expect(revealed.players.find((player) => player.seat === 1)?.revealed).toBe(true);
  });

  it('gameView 对普通玩家和公开观战都隐藏未公告的死亡、濒死与翻牌', () => {
    const host: RoomMember = { playerId: 'p_1', nickname: '玩家1', ready: true, joinedAt: 0 };
    const room = new Room('ROOM01', 'g_view', host, THEATER_DEATH_13);
    const internal = overridePlayer(
      overrideLife(overrideLife(scenario(), 'p_6', 'dead'), 'p_2', 'dying'),
      'p_1',
      { revealed: true },
    );
    room.state = { ...internal, phase: 'morning', nightStage: 2, night: {
      nightNumber: 2,
      guardSelections: [],
      attacks: [],
      rescue: null,
      revive: null,
      descenderCheck: null,
      fatalRecords: [],
      dyingSet: [],
      deaths: ['p_3', 'p_6'],
      sacrificeTriggered: false,
    } };
    room.events = [
      event('deaths_announced', { seats: [6] }, { kind: 'server' }, 2),
      event('reveal_announced', { reveals: [{ seat: 1, roleId: 'laike' }] }, { kind: 'server' }, 2),
      event('revive_selected', { targetPlayerId: 'p_6' }, { kind: 'players', playerIds: ['p_3'] }, 2),
    ];
    room.driver = { windows: () => [{ id: 'revive', closesAt: 1000 }], proposalState: () => null } as unknown as NonNullable<Room['driver']>;

    const player = gameView(room, { subjectPlayerId: 'p_1', readOnly: false }, 0);
    const spectator = gameView(room, { subjectPlayerId: null, readOnly: true }, 0);

    expect(player.public.seats?.find((seat) => seat.seat === 6)).toMatchObject({ alive: true, revealedRoleId: null });
    expect(player.public.seats?.find((seat) => seat.seat === 2)?.alive).toBe(true);
    expect(player.public.seats?.find((seat) => seat.seat === 1)?.revealedRoleId).toBeNull();
    expect(player.private?.events?.map((item) => item.type)).not.toContain('revive_selected');
    const factionRoom = player.private?.factionRoom;
    expect(factionRoom === null || factionRoom === undefined || !('historyFromSeq' in factionRoom)).toBe(true);
    expect(player.private?.targets).toEqual({});
    expect(player.private?.proposal).toBeNull();
    expect(spectator.public.seats?.find((seat) => seat.seat === 6)?.alive).toBe(true);
    expect(spectator.public.seats?.find((seat) => seat.seat === 1)?.revealedRoleId).toBeNull();
    expect(spectator.private).toBeNull();
    expect(spectator.windows).toEqual([]);
  });

  it('水妖可见复活窗口和合法死亡目标，其他玩家看不到 revive', () => {
    const host: RoomMember = { playerId: 'p_1', nickname: '玩家1', ready: true, joinedAt: 0 };
    const room = new Room('ROOM02', 'g_revive_view', host, THEATER_DEATH_13);
    const state = overrideLife(overrideLife(scenario(), 'p_3', 'dead'), 'p_6', 'dead');
    room.state = { ...state, phase: 'morning', nightStage: 2, night: {
      nightNumber: 2,
      guardSelections: [],
      attacks: [],
      rescue: null,
      revive: null,
      descenderCheck: null,
      fatalRecords: [],
      dyingSet: [],
      deaths: ['p_3', 'p_6'],
      sacrificeTriggered: false,
    } };
    room.driver = { windows: () => [{ id: 'revive', closesAt: 1000 }], proposalState: () => null } as unknown as NonNullable<Room['driver']>;

    const water = gameView(room, { subjectPlayerId: 'p_3', readOnly: false }, 0);
    const civilian = gameView(room, { subjectPlayerId: 'p_1', readOnly: false }, 0);

    expect(water.windows.map((window) => window.id)).toEqual(['revive']);
    expect(water.private?.targets?.SUBMIT_REVIVE?.playerIds).toEqual(['p_6']);
    expect(civilian.windows).toEqual([]);
    expect(civilian.private?.targets).toEqual({});
  });
});
