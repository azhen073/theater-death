import { describe, expect, it } from 'vitest';
import type { BallotState, DayContext, GameState, NightContext } from '../engine/types.ts';
import { startNight, resolveAttackPhase, type AttackPhaseInput } from '../engine/night.ts';
import { legalTargets, targetSelectionIssue } from '../engine/targets.ts';
import { overrideLife, overridePlayer, scenario } from './helpers.ts';

const attack = (overrides: Partial<AttackPhaseInput> = {}): AttackPhaseInput => ({
  guardTargetIds: [],
  stage1DeathTargetIds: [],
  stage1SpiritTargetIds: [],
  stage2JointTargetIds: [],
  laikeTargetId: null,
  ...overrides,
});

function started(): GameState {
  return startNight(scenario()).state;
}

describe('目标查询与组合校验', () => {
  it('守护禁止自守，并把连续同对表达为 forbiddenPairs', () => {
    const self = started();
    expect(targetSelectionIssue(self, 'p_2', 'SUBMIT_GUARD', ['p_2'])?.code).toBe('guard_self_forbidden');

    const pair = overridePlayer(self, 'p_2', {
      guardHistory: [
        { nightNumber: 2, targetPlayerIds: ['p_6', 'p_7'] },
      ],
    });
    const result = legalTargets({ ...pair, dayNumber: 3 }, 'p_2', 'SUBMIT_GUARD');
    expect(result.forbiddenPairs).toEqual([['p_6', 'p_7']]);
    expect(targetSelectionIssue({ ...pair, dayNumber: 3 }, 'p_2', 'SUBMIT_GUARD', ['p_6', 'p_7'])?.code).toBe(
      'guard_same_pair_consecutive',
    );
    expect(targetSelectionIssue({ ...pair, dayNumber: 3 }, 'p_2', 'SUBMIT_GUARD', ['p_7', 'p_6'])?.code).toBe(
      'guard_same_pair_consecutive',
    );
  });

  it('连续三夜守护同一人时从候选中排除该目标', () => {
    const state = overridePlayer(started(), 'p_2', {
      guardHistory: [
        { nightNumber: 1, targetPlayerIds: ['p_6'] },
        { nightNumber: 2, targetPlayerIds: ['p_6'] },
      ],
    });
    const result = legalTargets({ ...state, dayNumber: 3 }, 'p_2', 'SUBMIT_GUARD');
    expect(result.playerIds).not.toContain('p_6');
  });

  it('袭击允许重复目标但仍受团队上限约束', () => {
    const state = started();
    const result = legalTargets(state, 'p_10', 'EDIT_PROPOSAL');
    expect(result.allowRepeated).toBe(true);
    expect(result.maxTargets).toBe(2);
    expect(targetSelectionIssue(state, 'p_10', 'EDIT_PROPOSAL', ['p_6', 'p_6'])).toBeNull();
    expect(targetSelectionIssue(state, 'p_10', 'EDIT_PROPOSAL', ['p_6', 'p_7', 'p_8'])?.code).toBe(
      'death_targets_exceeded',
    );
  });

  it('查验、还魂和晨间回归只返回各自合法目标', () => {
    const night = overrideLife(
      resolveAttackPhase(started(), attack({ stage1DeathTargetIds: ['p_6'] })).state,
      'p_6',
      'dead',
    );
    expect(targetSelectionIssue(night, 'p_4', 'SUBMIT_CHECK', ['p_6'])?.code).toBe('target_dead');
    expect(targetSelectionIssue(night, 'p_4', 'SUBMIT_CHECK', ['p_5'])).toBeNull();
    expect(targetSelectionIssue(night, 'p_3', 'SUBMIT_RESCUE', ['p_6'])).toBeNull();
    expect(targetSelectionIssue(night, 'p_3', 'SUBMIT_RESCUE', ['p_3'])?.code).toBe('rescue_self_forbidden');

    const morning: GameState = {
      ...scenario(),
      phase: 'morning',
      stage: 2,
      nightStage: 2,
      players: scenario().players.map((player) =>
        player.playerId === 'p_3' || player.playerId === 'p_6'
          ? { ...player, life: 'dead' as const }
          : player,
      ),
      night: {
        nightNumber: 2,
        guardSelections: [],
        attacks: [],
        rescue: null,
        revive: null,
        descenderCheck: null,
        fatalRecords: [],
        dyingSet: ['p_3'],
        deaths: ['p_3'],
        sacrificeTriggered: false,
      } satisfies NightContext,
    };
    expect(targetSelectionIssue(morning, 'p_3', 'SUBMIT_REVIVE', ['p_6'])).toBeNull();
    expect(targetSelectionIssue(morning, 'p_3', 'SUBMIT_REVIVE', ['p_3'])?.code).toBe('revive_self_forbidden');
    expect(legalTargets(morning, 'p_3', 'SUBMIT_REVIVE').playerIds).toEqual(['p_6']);
  });

  it('白天放逐票的候选只包含存活玩家', () => {
    const ballot: BallotState = {
      phase: 'vote', round: 1, votes: {}, tiedIds: [], tieSpeechIndex: 0, eliminatedId: null,
    };
    const day: DayContext = {
      dayNumber: 1, step: 'vote', lastWordsScope: null, lastWords: null, election: null,
      speechRound: null, ballot, eliminatedIds: [], handover: null,
    };
    const state = overrideLife({ ...scenario(), phase: 'day', day }, 'p_6', 'dead');
    const result = legalTargets(state, 'p_1', 'SUBMIT_DAY_VOTE');
    expect(result.maxTargets).toBe(1);
    expect(result.playerIds).not.toContain('p_6');
    expect(result.playerIds).toContain('p_7');
    expect(targetSelectionIssue(state, 'p_1', 'SUBMIT_DAY_VOTE', ['p_6'])?.code).toBe('invalid_vote_target');
  });
});
