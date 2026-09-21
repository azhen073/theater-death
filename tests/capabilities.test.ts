import { describe, expect, it } from 'vitest';
import { beginDay } from '../engine/day.ts';
import { capabilities } from '../server/capabilities.ts';
import type { BallotState, DayContext, ElectionState, GameState, NightContext } from '../engine/types.ts';
import { runNight, scenario, overrideLife, overridePlayer } from './helpers.ts';

const open = (...ids: string[]) => ids.map((id) => ({ id, closesAt: 10_000 }));

describe('能力查询（后端 v2 02）', () => {
  it('遗言者可发公屏和开麦，其他人不能代发', () => {
    const morning = runNight(scenario(), { stage1DeathTargetIds: ['p_6', 'p_7'] });
    const state = overrideLife(beginDay({ ...morning, phase: 'day' }).state, 'p_7', 'dead');
    const speaker = capabilities(state, 'p_6', open('last_words'), 0);
    const other = capabilities(state, 'p_7', open('last_words'), 0);

    expect(speaker.canPostPublic).toBe(true);
    expect(speaker.canPublishVoice).toBe(true);
    expect(other.canPostPublic).toBe(false);
    expect(other.canPublishVoice).toBe(false);
  });

  it('莱莱可翻牌后一阶段冻结票权', () => {
    const ballot: BallotState = {
      phase: 'vote',
      round: 1,
      votes: {},
      tiedIds: [],
      tieSpeechIndex: 0,
      eliminatedId: null,
    };
    const day: DayContext = {
      dayNumber: 1,
      step: 'vote',
      lastWordsScope: null,
      lastWords: null,
      election: null,
      speechRound: null,
      ballot,
      eliminatedIds: [],
      handover: null,
    };
    const state = overridePlayer({ ...scenario(), phase: 'day', day }, 'p_1', { revealed: true });
    const result = capabilities(state, 'p_1', open('vote'), 0);

    expect(result.canVote).toBe(false);
    expect(result.allowedCommands).not.toContain('SUBMIT_DAY_VOTE');
  });

  it('R-42：竞选投票期间候选人没有投票能力，其他存活玩家可以投', () => {
    const election: ElectionState = {
      phase: 'vote',
      candidates: ['p_1', 'p_2'],
      withdrawn: [],
      speechOrder: ['p_1', 'p_2'],
      speechIndex: 2,
      round: 1,
      votes: {},
      tiedIds: [],
      winnerId: null,
    };
    const day: DayContext = {
      dayNumber: 1,
      step: 'election',
      lastWordsScope: null,
      lastWords: null,
      election,
      speechRound: null,
      ballot: null,
      eliminatedIds: [],
      handover: null,
    };
    const state = { ...scenario(), phase: 'day' as const, day };
    const candidate = capabilities(state, 'p_1', open('election_vote'), 0);
    const voter = capabilities(state, 'p_3', open('election_vote'), 0);

    expect(candidate.canVote).toBe(false);
    expect(candidate.allowedCommands).not.toContain('SUBMIT_ELECTION_VOTE');
    expect(voter.canVote).toBe(true);
    expect(voter.allowedCommands).toContain('SUBMIT_ELECTION_VOTE');
  });

  it('夜间全体禁麦，且不可用技能不出现在 allowedCommands', () => {
    const state = overridePlayer(scenario(), 'p_1', {
      abilities: { laikeBladeUsed: true, waterRescueUsed: false },
    });
    const result = capabilities(state, 'p_1', open('laike', 'faction'), 0);

    expect(result.canPublishVoice).toBe(false);
    expect(result.allowedCommands).not.toContain('SUBMIT_LAIKE');
    expect(result.allowedCommands).toEqual([]);
  });

  it('只读观战查询返回零操作能力', () => {
    const result = capabilities(scenario(), 'p_1', open('guard', 'faction'), 0, true);

    expect(result).toEqual({
      canPostPublic: false,
      canPostFaction: false,
      canPublishVoice: false,
      canVote: false,
      allowedCommands: [],
    });
  });

  it('二阶段水妖在晨间回归窗口获得回归能力', () => {
    const base = scenario();
    const night: NightContext = {
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
    };
    const state: GameState = {
      ...base,
      phase: 'morning',
      stage: 2,
      nightStage: 2,
      night,
      players: base.players.map((player) =>
        player.playerId === 'p_3' ? { ...player, life: 'dead' as const } : player,
      ),
    };
    const result = capabilities(state, 'p_3', open('revive'), 0);

    expect(result.allowedCommands).toContain('SUBMIT_REVIVE');
    expect(result.canPublishVoice).toBe(false);
  });
});
