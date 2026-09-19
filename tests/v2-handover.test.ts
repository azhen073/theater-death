import { describe, expect, it } from 'vitest';
import {
  advanceSpeech,
  beginDay,
  currentLastWordsSpeaker,
  endLastWords,
  resolveDaySettle,
  resolveHandover,
  settleDayVote,
  startDefaultSpeechRound,
  submitDayVote,
  submitHandover,
  submitHandoverIssue,
} from '../engine/day.ts';
import { resolveMorning } from '../engine/morning.ts';
import type { AttackPhaseInput } from '../engine/night.ts';
import type { GameState } from '../engine/types.ts';
import { runNight, scenario } from './helpers.ts';

function morningState(input: Partial<AttackPhaseInput> = {}): GameState {
  return resolveMorning(runNight(scenario(), input)).state;
}

function withSheriff(state: GameState, holderId: string): GameState {
  return { ...state, sheriff: { ...state.sheriff, holderId } };
}

function advanceSpeechToVote(state: GameState): GameState {
  let current = state;
  for (let guard = 0; current.day?.step === 'speech_round' && guard < 20; guard += 1) {
    const speaker = current.day.speechRound?.order[current.day.speechRound.index];
    if (speaker === undefined) {
      break;
    }
    current = advanceSpeech(current, speaker).state;
  }
  return current;
}

describe('v2 天理移交流程边界', () => {
  it('第二日夜死天理在 beginDay 直接进入移交，而不是普通发言', () => {
    const state = withSheriff(
      { ...morningState({ stage1DeathTargetIds: ['p_6'] }), dayNumber: 2 },
      'p_6',
    );

    const begun = beginDay(state);

    expect(begun.state.day?.step).toBe('handover');
    expect(begun.state.day?.handover).toMatchObject({
      deadSheriffId: 'p_6',
      resolved: false,
    });
    expect(begun.events.some((event) => event.type === 'sheriff_handover_started')).toBe(true);
  });

  it('夜死天理移交完成后回到普通发言，白天不会直接跳到结算', () => {
    const state = withSheriff(
      { ...morningState({ stage1DeathTargetIds: ['p_6'] }), dayNumber: 2 },
      'p_6',
    );
    const begun = beginDay(state).state;
    expect(submitHandoverIssue(begun, 'p_7', 'p_8')?.code).toBe('not_sheriff');
    expect(submitHandoverIssue(begun, 'p_6', 'p_6')?.code).toBe('target_dead');
    expect(submitHandoverIssue(begun, 'p_6', 'p_999')?.code).toBe('unknown_target');
    const handedOver = submitHandover(begun, 'p_6', 'p_7');

    expect(handedOver.state.sheriff.holderId).toBe('p_7');
    expect(handedOver.state.day?.step).toBe('speech_round');
    expect(handedOver.state.day?.handover).toMatchObject({ resolved: true, heirId: 'p_7' });
    expect(() => startDefaultSpeechRound(handedOver.state)).not.toThrow();

    const timedOut = resolveHandover(beginDay(state).state);
    expect(timedOut.state.sheriff.holderId).toBeNull();
    expect(timedOut.state.day?.step).toBe('speech_round');
  });

  it('白天放逐天理仍按遗言→移交→settle顺序收尾', () => {
    const state = withSheriff({ ...morningState(), dayNumber: 2 }, 'p_6');
    let current = startDefaultSpeechRound(beginDay(state).state).state;
    current = advanceSpeechToVote(current);
    current = settleDayVote(submitDayVote(current, 'p_1', 'p_6').state).state;

    expect(current.day?.step).toBe('elimination_last_words');
    expect(currentLastWordsSpeaker(current)).toBe('p_6');

    current = endLastWords(current, 'p_6').state;
    expect(current.day?.step).toBe('handover');

    current = submitHandover(current, 'p_6', 'p_7').state;
    expect(current.day?.step).toBe('settle');
    expect(resolveDaySettle(current).state.phase).toBe('night');
  });
});
