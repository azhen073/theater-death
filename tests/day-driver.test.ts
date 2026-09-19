import { describe, expect, it } from 'vitest';
import { resolveMorning } from '../engine/morning.ts';
import type { AttackPhaseInput } from '../engine/night.ts';
import type { GameEvent } from '../engine/events.ts';
import type { GameState } from '../engine/types.ts';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import { createFakeClock, type FakeClock } from '../server/clock.ts';
import { createDayDriver } from '../server/day-driver.ts';
import { createLogStore } from '../server/log-store.ts';
import { RoomRegistry } from '../server/rooms.ts';
import { runNight, scenario } from './helpers.ts';

function morningState(
  input: Partial<AttackPhaseInput> = {},
  rescueTargetId: string | null = null,
): GameState {
  return resolveMorning(runNight(scenario(), input, rescueTargetId)).state;
}

function withSheriff(state: GameState, holderId: string): GameState {
  return { ...state, sheriff: { ...state.sheriff, holderId } };
}

function createDriver(clock: FakeClock) {
  const steps: Array<{ state: GameState; events: readonly GameEvent[] }> = [];
  const completions: GameState[] = [];
  const driver = createDayDriver({
    clock,
    onStep: (result) => steps.push(result),
    onComplete: (state) => completions.push(state),
  });
  return { driver, steps, completions };
}

function advanceToStep(clock: FakeClock, driver: ReturnType<typeof createDayDriver>, step: string): void {
  let guard = 0;
  while (driver.snapshot()?.day?.step !== step && guard < 40) {
    clock.advance(60_000);
    guard += 1;
  }
}

describe('白天驱动：窗口排程与超时推进', () => {
  it('首夜遗言 60 秒超时后自动进入竞选报名', () => {
    const clock = createFakeClock();
    const { driver } = createDriver(clock);
    driver.start(morningState({ stage1DeathTargetIds: ['p_6'] }));

    expect(driver.snapshot()?.day?.step).toBe('first_night_last_words');
    expect(driver.windows()).toEqual([{ id: 'last_words', closesAt: 60_000 }]);

    clock.advance(60_000);
    expect(driver.snapshot()?.day?.step).toBe('election');
    expect(driver.snapshot()?.day?.election?.phase).toBe('signup');
    expect(driver.windows().map((window) => window.id)).toEqual(['election_signup']);
  });

  it('报名窗口无人报名 → 无天理；指定窗口超时 → 按座位升序发言', () => {
    const clock = createFakeClock();
    const { driver } = createDriver(clock);
    driver.start(morningState());

    clock.advance(30_000);
    expect(driver.snapshot()?.day?.election?.winnerId).toBeNull();
    expect(driver.snapshot()?.day?.step).toBe('speech_round');
    expect(driver.windows().map((window) => window.id)).toEqual(['speech_order']);

    clock.advance(45_000);
    expect(driver.snapshot()?.day?.speechRound?.order[0]).toBe('p_1');
    expect(driver.windows().map((window) => window.id)).toEqual(['speech_round']);
    expect(driver.windows()[0]?.closesAt).toBe(75_000 + 60_000);
  });

  it('夜间死亡天理先移交；超时销毁后继续发言、投票并结算入夜', () => {
    const clock = createFakeClock();
    const { driver, completions } = createDriver(clock);
    const state = withSheriff(
      { ...morningState({ stage1DeathTargetIds: ['p_6'] }), dayNumber: 2 },
      'p_6',
    );
    driver.start(state);
    expect(driver.snapshot()?.day?.step).toBe('handover');
    expect(driver.windows().map((window) => window.id)).toEqual(['handover']);

    clock.advance(45_000);
    expect(driver.snapshot()?.sheriff.holderId).toBeNull();
    expect(driver.snapshot()?.day?.step).toBe('speech_round');
    advanceToStep(clock, driver, 'vote');
    clock.advance(60_000);
    expect(driver.done()).toBe(true);
    expect(completions[0]?.phase).toBe('night');
    expect(completions[0]?.dayNumber).toBe(3);
  });
});

describe('白天驱动：命令提交', () => {
  it('报名/退选/结束发言/投票命令按窗口受理与拒绝', () => {
    const clock = createFakeClock();
    const { driver } = createDriver(clock);
    driver.start(morningState());

    expect(driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_6' }).accepted).toBe(true);
    expect(driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_6' }).code).toBe(
      'already_candidate',
    );
    expect(driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_7' }).accepted).toBe(true);
    expect(driver.submit({ type: 'WITHDRAW_CANDIDACY', playerId: 'p_7' }).accepted).toBe(true);
    expect(driver.submit({ type: 'SUBMIT_ELECTION_VOTE', playerId: 'p_1', targetId: 'p_6' }).code).toBe(
      'window_not_open',
    );

    clock.advance(30_000);
    expect(driver.snapshot()?.day?.election?.phase).toBe('speech');
    expect(driver.submit({ type: 'END_ELECTION_SPEECH', playerId: 'p_7' }).code).toBe(
      'not_current_speaker',
    );
    expect(driver.submit({ type: 'END_ELECTION_SPEECH', playerId: 'p_6' }).accepted).toBe(true);
    expect(driver.snapshot()?.day?.election?.phase).toBe('vote');

    expect(driver.submit({ type: 'SUBMIT_ELECTION_VOTE', playerId: 'p_1', targetId: 'p_6' }).accepted).toBe(true);
    expect(driver.submit({ type: 'SUBMIT_ELECTION_VOTE', playerId: 'p_1', targetId: 'p_6' }).code).toBe(
      'already_voted',
    );

    clock.advance(60_000);
    expect(driver.snapshot()?.sheriff.holderId).toBe('p_6');
    expect(driver.windows().map((window) => window.id)).toEqual(['speech_order']);
  });

  it('天理可指定发言轮，非天理被拒绝', () => {
    const clock = createFakeClock();
    const { driver } = createDriver(clock);
    driver.start(withSheriff({ ...morningState(), dayNumber: 2 }, 'p_6'));

    expect(
      driver.submit({
        type: 'DESIGNATE_SPEECH',
        playerId: 'p_7',
        startPlayerId: 'p_5',
        direction: 'asc',
      }).code,
    ).toBe('not_sheriff');
    expect(
      driver.submit({
        type: 'DESIGNATE_SPEECH',
        playerId: 'p_6',
        startPlayerId: 'p_5',
        direction: 'desc',
      }).accepted,
    ).toBe(true);
    expect(driver.snapshot()?.day?.speechRound?.order.slice(0, 2)).toEqual(['p_5', 'p_4']);
  });

  it('天理提前指定发言顺序后，指定窗口的超时定时器不得再触发（防崩溃）', () => {
    const clock = createFakeClock();
    const { driver } = createDriver(clock);
    driver.start(withSheriff({ ...morningState(), dayNumber: 2 }, 'p_6'));

    expect(driver.windows().map((window) => window.id)).toEqual(['speech_order']);
    expect(
      driver.submit({
        type: 'DESIGNATE_SPEECH',
        playerId: 'p_6',
        startPlayerId: 'p_5',
        direction: 'asc',
      }).accepted,
    ).toBe(true);
    expect(driver.windows().map((window) => window.id)).toEqual(['speech_round']);

    // 原「指定窗口」的超时时刻到达：旧定时器必须已被取消或受守卫保护，不得抛错
    expect(() => clock.advance(45_000)).not.toThrow();
    // 发言轮保持天理指定的顺序，未被默认升序覆盖
    expect(driver.snapshot()?.day?.speechRound?.order[0]).toBe('p_5');
    expect(driver.windows().map((window) => window.id)).toEqual(['speech_round']);
  });

  it('放逐投票全员投完提前结算，出局者遗言可主动结束，随后自动结算', () => {
    const clock = createFakeClock();
    const { driver, completions } = createDriver(clock);
    driver.start({ ...morningState(), dayNumber: 2 });

    clock.advance(45_000);
    advanceToStep(clock, driver, 'vote');

    for (const player of scenario().players) {
      const result = driver.submit({
        type: 'SUBMIT_DAY_VOTE',
        playerId: player.playerId,
        targetId: 'p_6',
      });
      expect(result.accepted).toBe(true);
    }
    expect(driver.snapshot()?.day?.step).toBe('elimination_last_words');
    expect(driver.windows().map((window) => window.id)).toEqual(['last_words']);

    expect(driver.submit({ type: 'END_LAST_WORDS', playerId: 'p_6' }).accepted).toBe(true);
    expect(driver.done()).toBe(true);
    expect(completions[0]?.phase).toBe('night');
  });

  it('投票全员投完提前结算后，原窗口定时器到点不得重复结算', () => {
    const clock = createFakeClock();
    const { driver, completions } = createDriver(clock);
    driver.start({ ...morningState(), dayNumber: 2 });

    clock.advance(45_000);
    advanceToStep(clock, driver, 'vote');
    expect(driver.windows()[0]?.id).toBe('vote');

    for (const player of scenario().players) {
      const result = driver.submit({
        type: 'SUBMIT_DAY_VOTE',
        playerId: player.playerId,
        targetId: 'p_6',
      });
      expect(result.accepted).toBe(true);
    }
    expect(driver.snapshot()?.day?.step).toBe('elimination_last_words');

    // 让原投票窗口的定时器到点：不得抛错或有第二次结算
    expect(() => clock.advance(60_000)).not.toThrow();
    expect(driver.done()).toBe(true);
    expect(completions).toHaveLength(1);
    expect(completions[0]?.phase).toBe('night');
  });
});

describe('循环编排：夜 → 日 → 夜', () => {
  it('一整夜加一整个白天后自动进入第二夜', () => {
    const clock = createFakeClock();
    const registry = new RoomRegistry({
      clock,
      ruleset: THEATER_DEATH_13,
      logStore: createLogStore(':memory:'),
    });
    const created = registry.createRoom('房主');
    for (let index = 0; index < 12; index += 1) {
      const joined = registry.joinRoom(created.room.code, `玩家${index}`);
      expect(joined.ok).toBe(true);
    }
    registry.startGame(created.room);
    expect(created.room.state?.phase).toBe('night');

    let guard = 0;
    while (!(created.room.state?.phase === 'night' && created.room.state.dayNumber === 2) && guard < 200) {
      clock.advance(60_000);
      guard += 1;
    }
    expect(created.room.state?.phase).toBe('night');
    expect(created.room.state?.dayNumber).toBe(2);
    expect(created.room.state?.night?.nightNumber).toBe(2);
    expect(created.room.state?.day).toBeNull();
  });
});
