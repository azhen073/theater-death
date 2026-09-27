import { describe, expect, it } from 'vitest';
import { makeEvent, type GameEvent } from '../engine/events.ts';
import type { GameState } from '../engine/types.ts';
import { Room, type RoomMember } from '../server/rooms.ts';
import { gameView } from '../server/v2/view.ts';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import { publishedState } from '../visibility/knowledge.ts';
import { buildPlayerView } from '../visibility/projection.ts';
import { overrideLife, overridePlayer, playerIdAt, scenario } from './helpers.ts';
import { getJson, setupStartedGame, startTestServer } from './server-test-utils.ts';

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
    const privateDeath = event('deaths_announced', { seats: [6] }, { kind: 'server' });

    expect(life(publishedState(scenario(), [privateDeath]), 6)).toBe('alive');
  });

  it('只有 public deaths_announced 才把夜间死亡公开为 dead', () => {
    const announced = event('deaths_announced', { seats: [6] });

    expect(life(publishedState(scenario(), [announced]), 6)).toBe('dead');
  });

  it('同晨 revive_announced 先于 deaths_announced 时，死亡公告不覆盖复活者的 alive', () => {
    const revived = event('revive_announced', { targetSeat: 3 });
    const deaths = event('deaths_announced', { seats: [3] });

    expect(life(publishedState(scenario(), [revived, deaths]), 3)).toBe('alive');
  });

  it('后日公开死亡公告和白天放逐公告都确实公开为 dead', () => {
    const nightDeath = event('deaths_announced', { seats: [6] }, { kind: 'public' }, 2);
    const elimination = event('elimination_announced', { seat: 7 }, { kind: 'public' }, 2);

    const published = publishedState(scenario(), [nightDeath, elimination]);

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
});

describe('公开面：未公告的死亡与翻牌不得对外可见', () => {
  it('buildPlayerView：内部已 dead / dying、尚无公开公告时，公开席位仍视为存活', () => {
    const internal = overridePlayer(
      overrideLife(overrideLife(scenario(), 'p_6', 'dead'), 'p_2', 'dying'),
      'p_1',
      { revealed: true },
    );

    const view = buildPlayerView({ state: internal, events: [], playerId: 'p_1' });

    expect(view.seats.find((seat) => seat.seat === 6)?.alive).toBe(true);
    expect(view.seats.find((seat) => seat.seat === 2)?.alive).toBe(true);
    expect(view.seats.find((seat) => seat.seat === 1)?.revealedRoleId).toBeNull();
  });

  it('buildPlayerView：公开公告之后死亡与翻牌正常公开', () => {
    const internal = overrideLife(scenario(), 'p_6', 'dead');
    const events = [
      event('deaths_announced', { seats: [6] }),
      event('reveal_announced', { reveals: [{ seat: 1, roleId: 'laike' }] }),
    ];

    const view = buildPlayerView({ state: internal, events, playerId: 'p_1' });

    expect(view.seats.find((seat) => seat.seat === 6)?.alive).toBe(false);
    expect(view.seats.find((seat) => seat.seat === 1)?.revealedRoleId).toBe('laike');
  });

  it('公开成员名单：未公告的夜间死亡不得通过 /api/rooms/:code/members 泄露', async () => {
    const context = await startTestServer();
    const game = await setupStartedGame(context);
    const room = game.room;
    if (room.state === null) {
      throw new Error('对局未开始');
    }
    room.state = overrideLife(room.state, playerIdAt(room.state, 6), 'dead');

    const members = await getJson(context, `/api/rooms/${game.roomCode}/members`);

    expect(members.status).toBe(200);
    const memberList = members.json.members as Array<{ seat: number | null; alive: boolean | null }>;
    expect(memberList.find((member) => member.seat === 6)?.alive).toBe(true);
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

describe('private.knowledge.dyingSeats 授权（R-20 / R-24）', () => {
  /** 一阶段夜间、攻击已结算：p_6 与 p_7 濒死（座位 6 / 7）。 */
  function nightWithDying(dyingPlayerIds: string[] = ['p_6', 'p_7']): GameState {
    const base = scenario();
    return {
      ...base,
      stage: 1,
      nightStage: 1,
      night: {
        nightNumber: 1,
        guardSelections: [],
        attacks: [],
        rescue: null,
        revive: null,
        descenderCheck: null,
        fatalRecords: [],
        dyingSet: dyingPlayerIds,
        deaths: [],
        sacrificeTriggered: false,
      },
    };
  }

  function roomWith(state: GameState): Room {
    const host: RoomMember = { playerId: 'p_1', nickname: '玩家1', ready: true, joinedAt: 0 };
    const room = new Room('ROOMDY', 'g_dying_view', host, THEATER_DEATH_13);
    room.state = state;
    room.driver = { windows: () => [], proposalState: () => null } as unknown as NonNullable<Room['driver']>;
    return room;
  }

  const knowledge = (room: Room, playerId: string) => gameView(room, { subjectPlayerId: playerId, readOnly: false }, 0).private?.knowledge;

  it('降临者与水妖（未用还魂曲）拿到本夜名单，其余身份不含该字段', () => {
    const room = roomWith(nightWithDying());
    expect(knowledge(room, 'p_4')?.dyingSeats).toEqual([6, 7]); // 降临者
    expect(knowledge(room, 'p_3')?.dyingSeats).toEqual([6, 7]); // 水妖
    expect(knowledge(room, 'p_1')).not.toHaveProperty('dyingSeats'); // 平民
    expect(knowledge(room, 'p_2')).not.toHaveProperty('dyingSeats'); // 门先生
    expect(knowledge(room, 'p_10')).not.toHaveProperty('dyingSeats'); // 死神阵营也不给
  });

  it('水妖用过还魂曲后当场失去名单视野（不以下发空数组代替）', () => {
    const used = overridePlayer(nightWithDying(), 'p_3', { abilities: { laikeBladeUsed: false, waterRescueUsed: true } });
    const room = roomWith(used);
    expect(knowledge(room, 'p_3')).not.toHaveProperty('dyingSeats');
    expect(knowledge(room, 'p_4')?.dyingSeats).toEqual([6, 7]); // 降临者不受影响
  });

  it('二阶段、白天、名单未产生、本人已死亡时都不下发该字段', () => {
    const stageTwo = { ...nightWithDying(), stage: 2 as const };
    expect(knowledge(roomWith(stageTwo), 'p_4')).not.toHaveProperty('dyingSeats');

    const morning = { ...nightWithDying(), phase: 'morning' as const, night: null };
    expect(knowledge(roomWith(morning), 'p_4')).not.toHaveProperty('dyingSeats');

    const notResolved = nightWithDying([]);
    expect(knowledge(roomWith(notResolved), 'p_4')).not.toHaveProperty('dyingSeats');

    const deadDescender = overrideLife(nightWithDying(), 'p_4', 'dead');
    expect(knowledge(roomWith(deadDescender), 'p_4')).not.toHaveProperty('dyingSeats');

    // 濒死的水妖 / 降临者仍保留本夜资格（R-10）
    const dyingWater = overrideLife(nightWithDying(), 'p_3', 'dying');
    expect(knowledge(roomWith(dyingWater), 'p_3')?.dyingSeats).toEqual([6, 7]);
  });

  it('公开视图永远不含名单，且濒死不改变公开存活状态', () => {
    const state = nightWithDying();
    const room = roomWith(state);
    const civilian = gameView(room, { subjectPlayerId: 'p_1', readOnly: false }, 0);
    const spectator = gameView(room, { subjectPlayerId: null, readOnly: true }, 0);
    expect(JSON.stringify(civilian.public)).not.toContain('dyingSeats');
    expect(spectator.private).toBeNull();
    expect(civilian.public.seats?.find((seat) => seat.seat === 6)?.alive).toBe(true);
  });

  it('与夜间事件口径一致：dying_list.seats 等于该角色的 dyingSeats', () => {
    const state = nightWithDying(['p_6', 'p_7']);
    const room = roomWith(state);
    const waterId = 'p_3';
    const listEvent = {
      ...event('dying_list', { nightNumber: 1, seats: [6, 7] }, { kind: 'players' as const, playerIds: [waterId, 'p_4'] }, 1),
    };
    room.events = [listEvent];
    const water = gameView(room, { subjectPlayerId: waterId, readOnly: false }, 0);
    const fromEvent = (water.private?.events ?? []).find((item) => item.type === 'dying_list') as { payload?: { seats?: number[] } } | undefined;
    expect(fromEvent?.payload?.seats).toEqual([6, 7]);
    expect(water.private?.knowledge?.dyingSeats).toEqual(fromEvent?.payload?.seats);
  });
});
