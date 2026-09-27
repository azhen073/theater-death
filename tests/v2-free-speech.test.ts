import { describe, expect, it } from 'vitest';
import {
  advanceFreeSpeech,
  advanceSpeech,
  beginDay,
  currentLastWordsSpeaker,
  currentSpeechRoundSpeaker,
  freeSpeechIssue,
  freeSpeechSeconds,
  startDefaultSpeechRound,
  startElectionSpeech,
  endLastWords,
} from '../engine/day.ts';
import { resolveMorning } from '../engine/morning.ts';
import type { GameState } from '../engine/types.ts';
import { voicePermission } from '../voice/policy.ts';
import { runNight, scenario } from './helpers.ts';

/** 开启/关闭白天自由发言：房主的选择体现在冻结的规则集里（1.1 板不带该键）。 */
function withFreeSpeech(state: GameState, seconds: number | null): GameState {
  const timersSeconds = { ...state.ruleset.timersSeconds };
  if (seconds === null) delete timersSeconds.freeSpeech;
  else timersSeconds.freeSpeech = seconds;
  return { ...state, ruleset: { ...state.ruleset, timersSeconds } };
}

/** 推进到「发言轮已开始」的白天状态（保留传入规则集里的开关）。 */
function toSpeechRound(state: GameState): GameState {
  let current = beginDay(resolveMorning(runNight(state, {})).state).state;
  let guard = 0;
  while (current.day?.step === 'first_night_last_words' && guard < 20) {
    const speaker = currentLastWordsSpeaker(current);
    if (speaker === null) break;
    current = endLastWords(current, speaker).state;
    guard += 1;
  }
  if (current.day?.step === 'election') current = startElectionSpeech(current).state;
  if (current.day?.step !== 'speech_round') throw new Error(`未能进入发言轮：${current.day?.step}`);
  return startDefaultSpeechRound(current).state;
}

/** 走完整轮发言（每人一次）。 */
function finishSpeechRound(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.day?.step === 'speech_round' && guard < 40) {
    const speaker = currentSpeechRoundSpeaker(current);
    if (speaker === null) break;
    current = advanceSpeech(current, speaker).state;
    guard += 1;
  }
  return current;
}

describe('白天自由发言（房主开关 · 发言轮之后、放逐投票之前）', () => {
  it('关闭时流程不变：发言轮结束直接进入放逐投票', () => {
    const off = withFreeSpeech(scenario(), null);
    expect(freeSpeechSeconds(off)).toBeNull();
    const ended = finishSpeechRound(toSpeechRound(off));
    expect(ended.day?.step).toBe('vote');
    expect(ended.day?.ballot?.phase).toBe('vote');
  });

  it('开启时发言轮结束进入 120 秒自由发言，窗口截止后才放逐投票', () => {
    const on = withFreeSpeech(scenario(), 120);
    expect(freeSpeechSeconds(on)).toBe(120);
    const ended = finishSpeechRound(toSpeechRound(on));
    expect(ended.day?.step).toBe('free_speech');
    expect(ended.day?.freeSpeechDone).toBe(true);
    // 自由发言阶段没有"当前发言者"：全体存活可同时开麦
    const alive = ended.players.filter((player) => player.life !== 'dead');
    for (const player of alive) expect(voicePermission(ended, player.playerId).canPublish).toBe(true);
    const dead = ended.players.find((player) => player.life === 'dead');
    if (dead !== undefined) expect(voicePermission(ended, dead.playerId).canPublish).toBe(false);
    const voted = advanceFreeSpeech(ended).state;
    expect(voted.day?.step).toBe('vote');
    expect(voted.day?.ballot?.phase).toBe('vote');
  });

  it('自由发言只走一次：天理移交重走发言轮后不再重复', () => {
    const on = withFreeSpeech(scenario(), 120);
    let current = toSpeechRound(on);
    // 先手动标记当天已走过自由发言，再结束发言轮：应直接进入投票
    current = { ...current, day: { ...current.day!, freeSpeechDone: true } };
    const ended = finishSpeechRound(current);
    expect(ended.day?.step).toBe('vote');
  });

  it('未开启时不接受推进自由发言，且校验函数给出原因', () => {
    const on = withFreeSpeech(scenario(), 120);
    const freeSpeech = finishSpeechRound(toSpeechRound(on));
    expect(freeSpeechIssue(freeSpeech)).toBeNull();
    const off = finishSpeechRound(toSpeechRound(withFreeSpeech(scenario(), null)));
    expect(freeSpeechIssue(off)).toMatchObject({ code: 'wrong_day_step' });
    const disabled = { ...freeSpeech, ruleset: { ...freeSpeech.ruleset, timersSeconds: { ...freeSpeech.ruleset.timersSeconds } } };
    delete disabled.ruleset.timersSeconds.freeSpeech;
    expect(freeSpeechIssue(disabled)).toMatchObject({ code: 'free_speech_disabled' });
  });
});
