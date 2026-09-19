import { describe, expect, it } from 'vitest';
import {
  advanceElectionSpeech,
  advanceSpeech,
  beginDay,
  currentSpeechRoundSpeaker,
  endLastWords,
  registerCandidacy,
  settleDayVote,
  startDefaultSpeechRound,
  startElectionSpeech,
  submitDayVote,
} from '../engine/day.ts';
import { resolveMorning } from '../engine/morning.ts';
import type { AttackPhaseInput } from '../engine/night.ts';
import type { DayContext, GameState } from '../engine/types.ts';
import { voicePermission } from '../voice/policy.ts';
import { runNight, scenario } from './helpers.ts';

function morningState(
  input: Partial<AttackPhaseInput> = {},
  rescueTargetId: string | null = null,
): GameState {
  return resolveMorning(runNight(scenario(), input, rescueTargetId)).state;
}

function begun(input: Partial<AttackPhaseInput> = {}): GameState {
  return beginDay(morningState(input)).state;
}

/** 结束遗言并跳过无人报名的竞选，推进到发言轮（待指定或进行中） */
function toSpeech(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.day?.step === 'first_night_last_words' && guard < 20) {
    const words = current.day.lastWords;
    const speaker = words === null ? null : (words.queue[words.index] ?? null);
    if (speaker === null) {
      break;
    }
    current = endLastWords(current, speaker).state;
    guard += 1;
  }
  if (current.day?.step === 'election') {
    current = startElectionSpeech(current).state;
  }
  return current;
}

function toDayVote(state: GameState): GameState {
  let current = startDefaultSpeechRound(state).state;
  let guard = 0;
  while (current.day?.step === 'speech_round' && guard < 30) {
    const round = current.day.speechRound;
    if (round === null || round.index >= round.order.length) {
      break;
    }
    current = advanceSpeech(current, round.order[round.index] ?? '').state;
    guard += 1;
  }
  return current;
}

describe('语音许可策略（R-43；平票者开麦为 2026-09-16 追加裁定）', () => {
  it('夜间与晨间结算全员静音', () => {
    expect(voicePermission(scenario(), 'p_1')).toEqual({
      canPublish: false,
      reason: 'night_silence',
    });
    expect(voicePermission(morningState({ stage1DeathTargetIds: ['p_6'] }), 'p_1')).toEqual({
      canPublish: false,
      reason: 'night_silence',
    });
  });

  it('遗言：当前遗言者（死者）可开麦，其他死者仅旁听，活人无许可', () => {
    const state = begun({ stage1DeathTargetIds: ['p_6', 'p_7'] });
    expect(state.day?.step).toBe('first_night_last_words');
    expect(voicePermission(state, 'p_6')).toEqual({ canPublish: true, reason: 'speaker' });
    expect(voicePermission(state, 'p_7')).toEqual({ canPublish: false, reason: 'dead_listener' });
    expect(voicePermission(state, 'p_1')).toEqual({ canPublish: false, reason: 'not_your_turn' });
  });

  it('竞选报名期不开麦：活人无许可、死者仅旁听', () => {
    const state = endLastWords(begun({ stage1DeathTargetIds: ['p_6'] }), 'p_6').state;
    expect(state.day?.election?.phase).toBe('signup');
    expect(voicePermission(state, 'p_1')).toEqual({ canPublish: false, reason: 'not_your_turn' });
    expect(voicePermission(state, 'p_6')).toEqual({ canPublish: false, reason: 'dead_listener' });
  });

  it('竞选候选发言轮：仅当前候选可开麦', () => {
    let state = endLastWords(begun({ stage1DeathTargetIds: ['p_6'] }), 'p_6').state;
    state = registerCandidacy(state, 'p_7').state;
    state = registerCandidacy(state, 'p_1').state;
    state = startElectionSpeech(state).state;
    expect(state.day?.election?.phase).toBe('speech');
    expect(voicePermission(state, 'p_1')).toEqual({ canPublish: true, reason: 'speaker' });
    expect(voicePermission(state, 'p_7')).toEqual({ canPublish: false, reason: 'not_your_turn' });
    expect(voicePermission(state, 'p_2')).toEqual({ canPublish: false, reason: 'not_your_turn' });
  });

  it('竞选投票期全体禁麦', () => {
    let state = endLastWords(begun({ stage1DeathTargetIds: ['p_6'] }), 'p_6').state;
    state = registerCandidacy(state, 'p_1').state;
    state = startElectionSpeech(state).state;
    state = advanceElectionSpeech(state).state;
    expect(state.day?.election?.phase).toBe('vote');
    expect(voicePermission(state, 'p_1')).toEqual({ canPublish: false, reason: 'vote_silence' });
    expect(voicePermission(state, 'p_6')).toEqual({ canPublish: false, reason: 'dead_listener' });
  });

  it('发言轮：天理指定窗口禁麦，发言中仅当前发言者', () => {
    const waiting = toSpeech(begun({ stage1DeathTargetIds: ['p_6'] }));
    expect(waiting.day?.step).toBe('speech_round');
    expect(waiting.day?.speechRound).toBeNull();
    expect(voicePermission(waiting, 'p_1')).toEqual({ canPublish: false, reason: 'not_your_turn' });

    const round = startDefaultSpeechRound(waiting).state;
    expect(round.day?.speechRound?.order[0]).toBe('p_1');
    expect(voicePermission(round, 'p_1')).toEqual({ canPublish: true, reason: 'speaker' });
    expect(voicePermission(round, 'p_2')).toEqual({ canPublish: false, reason: 'not_your_turn' });
    expect(voicePermission(round, 'p_6')).toEqual({ canPublish: false, reason: 'dead_listener' });
  });

  it('放逐投票期全体禁麦', () => {
    const state = toDayVote(toSpeech(begun({ stage1DeathTargetIds: ['p_6'] })));
    expect(state.day?.step).toBe('vote');
    expect(state.day?.ballot?.phase).toBe('vote');
    expect(voicePermission(state, 'p_1')).toEqual({ canPublish: false, reason: 'vote_silence' });
    expect(voicePermission(state, 'p_6')).toEqual({ canPublish: false, reason: 'dead_listener' });
  });

  it('平票发言：仅当前平票者可开麦，其余禁麦', () => {
    let state = toDayVote(toSpeech(begun({ stage1DeathTargetIds: ['p_6'] })));
    state = submitDayVote(state, 'p_1', 'p_2').state;
    state = submitDayVote(state, 'p_2', 'p_1').state;
    state = settleDayVote(state).state;
    expect(state.day?.ballot?.phase).toBe('tie_speech');
    const tied = state.day?.ballot?.tiedIds ?? [];
    expect(tied.length).toBe(2);
    expect(voicePermission(state, tied[0] ?? '')).toEqual({ canPublish: true, reason: 'speaker' });
    expect(voicePermission(state, tied[1] ?? '')).toEqual({
      canPublish: false,
      reason: 'not_your_turn',
    });
    expect(voicePermission(state, 'p_3')).toEqual({ canPublish: false, reason: 'not_your_turn' });
  });

  it('天理移交窗口禁麦；对局结束全员禁麦', () => {
    const baseDay: DayContext = {
      dayNumber: 2,
      step: 'handover',
      lastWordsScope: null,
      lastWords: null,
      election: null,
      speechRound: null,
      ballot: null,
      eliminatedIds: [],
      handover: { deadSheriffId: 'p_1', resolved: false, heirId: null },
    };
    const handover: GameState = { ...morningState(), phase: 'day', day: baseDay };
    expect(voicePermission(handover, 'p_2')).toEqual({ canPublish: false, reason: 'not_your_turn' });
    expect(voicePermission(handover, 'p_1')).toEqual({
      canPublish: false,
      reason: 'not_your_turn',
    });

    const ended: GameState = {
      ...handover,
      win: { winner: 'death_faction', dayNumber: 3, reason: '测试终局' },
    };
    expect(voicePermission(ended, 'p_2')).toEqual({ canPublish: false, reason: 'game_ended' });
  });

  it('V2-03 发言准备窗口不开麦（preparing_speech）', () => {
    const speech = startDefaultSpeechRound(toSpeech(begun())).state;
    const speaker = currentSpeechRoundSpeaker(speech);
    expect(speaker).not.toBeNull();
    expect(voicePermission(speech, speaker!)).toEqual({ canPublish: true, reason: 'speaker' });
    const preparing: GameState = {
      ...speech,
      day: { ...(speech.day as DayContext), speechPreparing: true },
    };
    expect(voicePermission(preparing, speaker!)).toEqual({
      canPublish: false,
      reason: 'preparing_speech',
    });
  });
});
