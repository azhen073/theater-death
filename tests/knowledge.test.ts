import { describe, expect, it } from 'vitest';
import { makeEvent, type GameEvent } from '../engine/events.ts';
import type { GameState } from '../engine/types.ts';
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
});
