import { describe, expect, it } from 'vitest';
import { advanceSpeech, beginDay, settleDayVote, startDefaultSpeechRound, submitDayVote } from '../engine/day.ts';
import { resolveMorning } from '../engine/morning.ts';
import type { GameState } from '../engine/types.ts';
import { createFakeClock } from '../server/clock.ts';
import { createDayDriver } from '../server/day-driver.ts';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { runNight, scenario } from './helpers.ts';

function v2Morning(deadIds: readonly string[] = []): GameState {
  const morning = resolveMorning(runNight(scenario(), {})).state;
  return {
    ...morning,
    ruleset: THEATER_DEATH_13_V2,
    dayNumber: 2,
    players: morning.players.map((player) =>
      deadIds.includes(player.playerId) ? { ...player, life: 'dead' as const } : player,
    ),
  };
}

function withLife(state: GameState, playerId: string, life: 'alive' | 'dead', lastFatalCause = state.players.find((p) => p.playerId === playerId)?.lastFatalCause): GameState {
  const cause = lastFatalCause === undefined
    ? state.players.find((player) => player.playerId === playerId)?.lastFatalCause ?? null
    : lastFatalCause;
  return {
    ...state,
    players: state.players.map((player) =>
      player.playerId === playerId ? { ...player, life, lastFatalCause: cause } : player,
    ),
  };
}

function votingState(state: GameState): GameState {
  let current = startDefaultSpeechRound(beginDay(state).state).state;
  for (let guard = 0; current.day?.step === 'speech_round' && guard < 20; guard += 1) {
    const speaker = current.day.speechRound?.order[current.day.speechRound.index];
    if (speaker === undefined) break;
    current = advanceSpeech(current, speaker).state;
  }
  return current;
}

function firstAliveVoter(state: GameState, targetId: string): string {
  const voter = state.players.find((player) => player.life !== 'dead' && player.playerId !== targetId);
  if (voter === undefined) throw new Error('没有可用投票者');
  return voter.playerId;
}

describe('v2 放逐立即终局（规则 2.0）', () => {
  it('最后死神阵营角色被放逐立即人类获胜，不开启遗言', () => {
    const voting = votingState(v2Morning(['p_11', 'p_12']));
    const voted = submitDayVote(voting, firstAliveVoter(voting, 'p_10'), 'p_10').state;
    const result = settleDayVote(voted);

    expect(result.state.phase).toBe('ended');
    expect(result.state.day).toBeNull();
    expect(result.state.win?.winner).toBe('human');
    expect(result.events.some((event) => event.type === 'last_words_started')).toBe(false);
    expect(result.events.some((event) => event.type === 'game_ended')).toBe(true);
  });

  it('科研员已死且最后神职被放逐时先翻牌/转阶段，再判死神胜利', () => {
    const voting = votingState(v2Morning(['p_1', 'p_2', 'p_3', 'p_5']));
    const voted = submitDayVote(voting, firstAliveVoter(voting, 'p_4'), 'p_4').state;
    const result = settleDayVote(voted);
    const types = result.events.map((event) => event.type);

    expect(result.state.phase).toBe('ended');
    expect(result.state.day).toBeNull();
    expect(result.state.stage).toBe(2);
    expect(result.state.win?.winner).toBe('death_faction');
    expect(types.indexOf('reveal_announced')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('stage_changed')).toBeGreaterThan(types.indexOf('reveal_announced'));
    expect(types.indexOf('game_ended')).toBeGreaterThan(types.indexOf('stage_changed'));
    expect(types.includes('last_words_started')).toBe(false);
  });

  it('门先生因守护牺牲已死时，转阶段回归先于判胜', () => {
    let state = v2Morning(['p_5', 'p_6', 'p_7', 'p_8', 'p_2']);
    state = withLife(state, 'p_2', 'dead', 'guard_sacrifice');
    const voting = votingState(state);
    const voted = submitDayVote(voting, firstAliveVoter(voting, 'p_9'), 'p_9').state;
    const result = settleDayVote(voted);
    const types = result.events.map((event) => event.type);

    expect(result.state.players.find((player) => player.playerId === 'p_2')?.life).toBe('alive');
    expect(result.state.win?.winner).toBe('death_faction');
    expect(types.indexOf('door_returned')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('game_ended')).toBeGreaterThan(types.indexOf('door_returned'));
  });

  it('未满足胜负条件时仍保留放逐遗言流程', () => {
    const voting = votingState(v2Morning());
    const voted = submitDayVote(voting, firstAliveVoter(voting, 'p_6'), 'p_6').state;
    const result = settleDayVote(voted);

    expect(result.state.phase).toBe('day');
    expect(result.state.day?.step).toBe('elimination_last_words');
    expect(result.state.day?.lastWordsScope).toBe('elimination');
    expect(result.events.some((event) => event.type === 'last_words_started')).toBe(true);
  });

  it('driver 在立即终局后清理 timer，不残留白天窗口', () => {
    const clock = createFakeClock();
    const driver = createDayDriver({ clock, onStep: () => undefined });
    const initial = v2Morning(['p_11', 'p_12']);
    driver.start(initial);
    for (let guard = 0; driver.snapshot()?.day?.step !== 'vote' && guard < 50; guard += 1) {
      clock.advance(60_000);
    }
    expect(driver.snapshot()?.day?.step).toBe('vote');
    const current = driver.snapshot() as GameState;
    for (const player of current.players.filter((item) => item.life !== 'dead')) {
      expect(driver.submit({ type: 'SUBMIT_DAY_VOTE', playerId: player.playerId, targetId: 'p_10' }).accepted).toBe(true);
    }

    expect(driver.done()).toBe(true);
    expect(driver.windows()).toEqual([]);
    expect(clock.pendingCount()).toBe(0);
    expect(driver.snapshot()?.phase).toBe('ended');
    expect(driver.snapshot()?.day).toBeNull();
  });
});
