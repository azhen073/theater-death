import { describe, expect, it } from 'vitest';
import {
  advanceElectionSpeech,
  advanceSpeech,
  advanceTieSpeech,
  beginDay,
  currentLastWordsSpeaker,
  designateSpeechRound,
  designateSpeechRoundIssue,
  endLastWords,
  registerCandidacy,
  registerCandidacyIssue,
  resolveDaySettle,
  resolveHandover,
  settleDayVote,
  settleElectionVote,
  startDefaultSpeechRound,
  startElectionSpeech,
  submitDayVote,
  submitDayVoteIssue,
  submitElectionVote,
  submitElectionVoteIssue,
  submitHandover,
  submitHandoverIssue,
  voteEligibility,
  voteUnits,
  withdrawCandidacy,
} from '../engine/day.ts';
import { resolveMorning } from '../engine/morning.ts';
import type { AttackPhaseInput } from '../engine/night.ts';
import type { GameState } from '../engine/types.ts';
import { canPostPublic } from '../visibility/chat.ts';
import { runNight, scenario } from './helpers.ts';

function morningState(
  input: Partial<AttackPhaseInput> = {},
  rescueTargetId: string | null = null,
): GameState {
  return resolveMorning(runNight(scenario(), input, rescueTargetId)).state;
}

function begun(state: GameState = morningState()): GameState {
  return beginDay(state).state;
}

function withSheriff(state: GameState, holderId: string): GameState {
  return { ...state, sheriff: { ...state.sheriff, holderId } };
}

function dayTwo(state: GameState = morningState()): GameState {
  return beginDay({ ...state, dayNumber: 2 }).state;
}

/** 结束所有遗言并跳过无人竞选，推进到发言轮待指定状态 */
function toSpeechRound(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.day?.step === 'first_night_last_words' && guard < 20) {
    const speaker = currentLastWordsSpeaker(current);
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

function runElection(state: GameState, candidates: readonly string[]): GameState {
  let current = state;
  for (const candidateId of candidates) {
    current = registerCandidacy(current, candidateId).state;
  }
  current = startElectionSpeech(current).state;
  let guard = 0;
  while (current.day?.election?.phase === 'speech' && guard < 20) {
    current = advanceElectionSpeech(current).state;
    guard += 1;
  }
  return current;
}

function castElectionVotes(
  state: GameState,
  votes: ReadonlyArray<[string, string | null]>,
): GameState {
  let current = state;
  for (const [voterId, targetId] of votes) {
    current = submitElectionVote(current, voterId, targetId).state;
  }
  return current;
}

function castVotes(state: GameState, votes: ReadonlyArray<[string, string | null]>): GameState {
  let current = state;
  for (const [voterId, targetId] of votes) {
    current = submitDayVote(current, voterId, targetId).state;
  }
  return current;
}

function advanceToVote(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.day?.step === 'speech_round' && guard < 20) {
    const speaker = current.day.speechRound?.order[current.day.speechRound.index];
    if (speaker === undefined) {
      break;
    }
    current = advanceSpeech(current, speaker).state;
    guard += 1;
  }
  return current;
}

describe('白天流程：遗言与竞选（R-41–R-45）', () => {
  it('首夜出局者遗言在晨间公告后、竞选之前；遗言完成后进入竞选', () => {
    const begunState = beginDay(morningState({ stage1DeathTargetIds: ['p_6', 'p_7'] })).state;
    expect(begunState.day?.step).toBe('first_night_last_words');
    expect(currentLastWordsSpeaker(begunState)).toBe('p_6');

    const first = endLastWords(begunState, 'p_6');
    expect(currentLastWordsSpeaker(first.state)).toBe('p_7');
    expect(first.events.some((event) => event.type === 'last_words_started')).toBe(true);

    const second = endLastWords(first.state, 'p_7');
    expect(second.state.day?.step).toBe('election');
    expect(second.state.day?.election?.phase).toBe('signup');
    expect(second.events.some((event) => event.type === 'election_started')).toBe(true);
  });

  it('T-39：后续夜晚死者没有遗言；被还魂曲救回者不视为出局', () => {
    const nightOne = morningState({ stage1DeathTargetIds: ['p_6'] });
    const second = dayTwo(nightOne);
    expect(second.day?.step).toBe('speech_round');
    expect(second.day?.lastWords).toBeNull();

    const rescued = morningState({ stage1DeathTargetIds: ['p_6'] }, 'p_6');
    expect(rescued.players.find((player) => player.playerId === 'p_6')?.life).toBe('alive');
    expect(dayTwo(rescued).day?.step).toBe('speech_round');
  });

  it('死者不能报名竞选；报名后投票开始前可以退选；全部退选则本局无天理', () => {
    const begunState = begun(morningState({ stage1DeathTargetIds: ['p_6'] }));
    const day = endLastWords(begunState, 'p_6').state;
    expect(day.day?.step).toBe('election');
    expect(registerCandidacyIssue(day, 'p_6')?.code).toBe('dead_cannot_run');

    const signed = registerCandidacy(day, 'p_7').state;
    const withdrawn = withdrawCandidacy(signed, 'p_7').state;
    const speechResult = startElectionSpeech(withdrawn);
    const speech = speechResult.state;
    expect(speech.day?.election?.phase).toBe('done');
    expect(speech.day?.election?.winnerId).toBeNull();
    expect(speech.day?.step).toBe('speech_round');
    expect(speechResult.events.some((event) => event.type === 'election_finished')).toBe(true);
  });

  it('竞选正常当选：候选人按座位发言、除候选外的存活玩家投票、当选者获得天理职务', () => {
    let current = begun();
    for (const candidateId of ['p_7', 'p_6', 'p_8']) {
      current = registerCandidacy(current, candidateId).state;
    }
    const speech = startElectionSpeech(current).state;
    expect(speech.day?.election?.phase).toBe('speech');
    expect(speech.day?.election?.speechOrder).toEqual(['p_6', 'p_7', 'p_8']);

    const afterFirst = advanceElectionSpeech(speech);
    expect(afterFirst.state.day?.election?.speechIndex).toBe(1);
    expect(afterFirst.events.some((event) => event.type === 'candidate_speech_finished')).toBe(true);
    const voting = advanceElectionSpeech(advanceElectionSpeech(afterFirst.state).state).state;
    expect(voting.day?.election?.phase).toBe('vote');
    expect(submitElectionVoteIssue(voting, 'p_6', 'p_7')?.code).toBe('vote_forbidden_candidate');

    const voted = castElectionVotes(voting, [
      ['p_1', 'p_6'],
      ['p_2', 'p_6'],
      ['p_3', 'p_7'],
    ]);
    const result = settleElectionVote(voted);
    expect(result.state.sheriff.holderId).toBe('p_6');
    expect(result.state.day?.election?.winnerId).toBe('p_6');
    expect(result.state.day?.step).toBe('speech_round');
    expect(result.events.some((event) => event.type === 'sheriff_elected')).toBe(true);
  });

  it('R-42：候选不得投票，退选后恢复投票权；平票重投时平票者不得投票', () => {
    let current = begun();
    for (const candidateId of ['p_6', 'p_7', 'p_8']) {
      current = registerCandidacy(current, candidateId).state;
    }
    current = startElectionSpeech(current).state;
    current = withdrawCandidacy(current, 'p_6').state;
    let guard = 0;
    while (current.day?.election?.phase === 'speech' && guard < 20) {
      current = advanceElectionSpeech(current).state;
      guard += 1;
    }
    expect(current.day?.election?.phase).toBe('vote');
    expect(submitElectionVoteIssue(current, 'p_6', 'p_7')).toBeNull();
    expect(submitElectionVoteIssue(current, 'p_7', 'p_6')?.code).toBe('vote_forbidden_candidate');
    expect(submitElectionVoteIssue(current, 'p_8', 'p_7')?.code).toBe('vote_forbidden_candidate');

    const tied = settleElectionVote(
      castElectionVotes(current, [
        ['p_6', 'p_7'],
        ['p_1', 'p_8'],
      ]),
    );
    expect(tied.state.day?.election?.phase).toBe('revote');
    expect(tied.state.day?.election?.tiedIds).toEqual(['p_7', 'p_8']);
    expect(submitElectionVoteIssue(tied.state, 'p_7', 'p_8')?.code).toBe('vote_forbidden_candidate');
    expect(submitElectionVoteIssue(tied.state, 'p_8', 'p_7')?.code).toBe('vote_forbidden_candidate');
    expect(submitElectionVoteIssue(tied.state, 'p_6', 'p_7')).toBeNull();
  });

  it('R-42：全员报名导致没有投票人时本局无天理', () => {
    const everyone = scenario().players.map((player) => player.playerId);
    const finished = runElection(begun(), everyone);
    expect(finished.day?.election?.phase).toBe('done');
    expect(finished.day?.election?.winnerId).toBeNull();
    expect(finished.sheriff.holderId).toBeNull();
    expect(finished.day?.step).toBe('speech_round');
  });

  it('T-37：竞选平票重投一次，再次平票则本局无天理；重投可决出唯一当选', () => {
    const voting = runElection(begun(), ['p_6', 'p_7']);
    const tied = castElectionVotes(voting, [
      ['p_1', 'p_6'],
      ['p_2', 'p_7'],
      ['p_3', 'p_6'],
      ['p_4', 'p_7'],
    ]);
    const first = settleElectionVote(tied);
    expect(first.state.day?.election?.phase).toBe('revote');
    expect(first.state.day?.election?.round).toBe(2);
    expect(first.state.day?.election?.tiedIds).toEqual(['p_6', 'p_7']);
    expect(first.events.some((event) => event.type === 'election_revote_started')).toBe(true);

    const tieAgain = settleElectionVote(
      castElectionVotes(first.state, [
        ['p_1', 'p_6'],
        ['p_2', 'p_7'],
      ]),
    );
    expect(tieAgain.state.day?.election?.winnerId).toBeNull();
    expect(tieAgain.state.sheriff.holderId).toBeNull();
    expect(tieAgain.state.day?.step).toBe('speech_round');

    const redo = settleElectionVote(castElectionVotes(first.state, [['p_1', 'p_7']]));
    expect(redo.state.sheriff.holderId).toBe('p_7');
  });

  it('T-41：莱莱可翻牌禁投期间不能参加竞选投票，二阶段恢复', () => {
    const revealed = {
      ...begun(),
      players: scenario().players.map((player) =>
        player.playerId === 'p_1' ? { ...player, revealed: true } : player,
      ),
    };
    const voting = runElection(revealed, ['p_6', 'p_7']);
    expect(voteEligibility(voting, 'p_1')).toBe('laike_frozen');
    expect(submitElectionVoteIssue(voting, 'p_1', 'p_6')?.code).toBe(
      'vote_forbidden_laike_frozen',
    );

    const stageTwo = { ...voting, stage: 2 as const };
    expect(voteEligibility(stageTwo, 'p_1')).toBe('ok');
  });

  it('竞选投票只看已投人数，截止后公示完整票型', () => {
    const voting = runElection(begun(), ['p_6', 'p_7']);
    const oneVote = submitElectionVote(voting, 'p_1', 'p_6');
    const progress = oneVote.events.find((event) => event.type === 'election_vote_progress');
    expect(progress?.payload).toEqual({ votedCount: 1, eligibleCount: 11 });
    expect(progress?.visibility).toEqual({ kind: 'public' });

    const settled = settleElectionVote(castElectionVotes(oneVote.state, [['p_2', 'p_7']]));
    const result = settled.events.find((event) => event.type === 'election_result');
    expect(result?.payload).toMatchObject({ tiedSeats: [6, 7], winnerSeat: null });
  });
});

describe('白天流程：发言轮与放逐投票（R-41、R-43、R-44）', () => {
  it('无天理时按座位升序发言；天理可指定起点与方向', () => {
    const defaultRound = startDefaultSpeechRound(toSpeechRound(begun())).state;
    expect(defaultRound.day?.speechRound?.order[0]).toBe('p_1');
    expect(defaultRound.day?.speechRound?.order.at(-1)).toBe('p_13');

    const withSheriffState = withSheriff(toSpeechRound(begun()), 'p_6');
    const designated = designateSpeechRound(withSheriffState, 'p_6', 'p_5', 'desc').state;
    expect(designated.day?.speechRound?.order.slice(0, 6)).toEqual([
      'p_5',
      'p_4',
      'p_3',
      'p_2',
      'p_1',
      'p_13',
    ]);
    expect(designateSpeechRoundIssue(withSheriffState, 'p_7', 'p_5', 'asc')?.code).toBe(
      'not_sheriff',
    );
  });

  it('发言轮逐人推进，全部结束后进入放逐投票', () => {
    const running = startDefaultSpeechRound(toSpeechRound(begun())).state;
    const voted = advanceToVote(running);
    expect(voted.day?.step).toBe('vote');
    expect(voted.day?.ballot?.phase).toBe('vote');
  });

  it('T-38：天理票以 3 单位结算，普通票 2 单位；1.5 票打破人头平票', () => {
    const withSheriffVote = withSheriff(dayTwo(), 'p_6');
    expect(voteUnits(withSheriffVote, 'p_6')).toBe(3);
    expect(voteUnits(withSheriffVote, 'p_7')).toBe(2);

    const voting = advanceToVote(startDefaultSpeechRound(withSheriffVote).state);
    const voted = castVotes(voting, [
      ['p_6', 'p_8'],
      ['p_7', 'p_9'],
    ]);
    const result = settleDayVote(voted);
    expect(result.state.day?.ballot?.eliminatedId).toBe('p_8');
    expect(result.state.players.find((player) => player.playerId === 'p_8')?.life).toBe('dead');
  });

  it('T-41：莱莱可翻牌禁投期间不能参加放逐投票，天理票权同步冻结', () => {
    const revealedLaike = {
      ...withSheriff(dayTwo(), 'p_1'),
      players: scenario().players.map((player) =>
        player.playerId === 'p_1' ? { ...player, revealed: true } : player,
      ),
    };
    const voting = advanceToVote(startDefaultSpeechRound(revealedLaike).state);
    expect(submitDayVoteIssue(voting, 'p_1', 'p_6')?.code).toBe('vote_forbidden_laike_frozen');
    expect(voteEligibility({ ...voting, stage: 2 as const }, 'p_1')).toBe('ok');
  });

  it('T-50：天理莱莱可禁投时决胜票不生效，按剩余票重判平票', () => {
    const revealedSheriff = {
      ...withSheriff(dayTwo(), 'p_1'),
      players: scenario().players.map((player) =>
        player.playerId === 'p_1' ? { ...player, revealed: true } : player,
      ),
    };
    const voting = advanceToVote(startDefaultSpeechRound(revealedSheriff).state);
    expect(submitDayVoteIssue(voting, 'p_1', 'p_6')?.code).toBe('vote_forbidden_laike_frozen');

    // p_8→p_6 与 p_9→p_7 各 2 单位；天理莱莱可的决胜票被禁 → 平票进入平票发言
    const frozen = settleDayVote(
      castVotes(voting, [
        ['p_8', 'p_6'],
        ['p_9', 'p_7'],
      ]),
    );
    expect(frozen.state.day?.ballot?.phase).toBe('tie_speech');
    expect(frozen.state.day?.ballot?.tiedIds).toEqual(['p_6', 'p_7']);
    expect(frozen.state.day?.ballot?.eliminatedId).toBeNull();

    // 反事实：二阶段恢复莱莱可票权，同一张 3 单位票打破平票 → p_6 出局
    const recovered = settleDayVote(
      castVotes(
        { ...voting, stage: 2 as const },
        [
          ['p_1', 'p_6'],
          ['p_8', 'p_6'],
          ['p_9', 'p_7'],
        ],
      ),
    );
    expect(recovered.state.day?.ballot?.eliminatedId).toBe('p_6');
  });

  it('放逐平票：平票者依次发言后全体重投，再次平票无人出局', () => {
    const voting = advanceToVote(startDefaultSpeechRound(toSpeechRound(begun())).state);
    const tied = settleDayVote(
      castVotes(voting, [
        ['p_1', 'p_6'],
        ['p_2', 'p_7'],
      ]),
    );
    expect(tied.state.day?.ballot?.phase).toBe('tie_speech');
    expect(tied.state.day?.ballot?.tiedIds).toEqual(['p_6', 'p_7']);

    const afterSpeech = advanceTieSpeech(tied.state, 'p_6').state;
    expect(afterSpeech.day?.ballot?.tieSpeechIndex).toBe(1);
    const revote = advanceTieSpeech(afterSpeech, 'p_7').state;
    expect(revote.day?.ballot?.phase).toBe('revote');
    expect(revote.day?.ballot?.round).toBe(2);

    const tieAgain = settleDayVote(
      castVotes(revote, [
        ['p_3', 'p_6'],
        ['p_4', 'p_7'],
      ]),
    );
    expect(tieAgain.state.day?.ballot?.eliminatedId).toBeNull();
    expect(tieAgain.state.day?.step).not.toBe('vote');
    expect(tieAgain.state.day?.eliminatedIds).toEqual([]);
  });

  it('投票过程仅显示已投人数，截止后公示完整票型与出局者', () => {
    const voting = advanceToVote(startDefaultSpeechRound(toSpeechRound(begun())).state);
    const oneVote = submitDayVote(voting, 'p_1', 'p_6');
    const progress = oneVote.events.find((event) => event.type === 'vote_progress');
    expect(progress?.payload).toEqual({ votedCount: 1, eligibleCount: 13 });

    const settled = settleDayVote(castVotes(oneVote.state, [['p_2', 'p_6']]));
    const voteResult = settled.events.find((event) => event.type === 'vote_result');
    expect(voteResult?.payload).toMatchObject({ eliminatedSeat: 6, tiedSeats: [] });
  });
});

describe('白天流程：出局遗言与天理移交（R-45、R-46）', () => {
  it('T-39：白天出局者获得遗言，位于票型公示后、移交之前', () => {
    const voting = advanceToVote(startDefaultSpeechRound(toSpeechRound(begun())).state);
    const settled = settleDayVote(castVotes(voting, [['p_1', 'p_6']]));
    expect(settled.state.day?.step).toBe('elimination_last_words');
    expect(settled.state.day?.lastWordsScope).toBe('elimination');
    expect(currentLastWordsSpeaker(settled.state)).toBe('p_6');

    const afterWords = endLastWords(settled.state, 'p_6').state;
    expect(afterWords.day?.step).toBe('settle');
  });

  it('T-40：天理夜间死亡先移交；完成或超时销毁后继续发言、投票与结算', () => {
    // 简化构造：以夜 1 晨间充当第 2 日，天理 p_6 于夜间死亡（首个白天之前无天理，竞选仅在首日）
    const deadSheriff = withSheriff(
      { ...morningState({ stage1DeathTargetIds: ['p_6'] }), dayNumber: 2 },
      'p_6',
    );
    const begunState = beginDay(deadSheriff).state;
    expect(begunState.day?.step).toBe('handover');
    expect(begunState.day?.handover?.deadSheriffId).toBe('p_6');

    expect(submitHandoverIssue(begunState, 'p_7', 'p_8')?.code).toBe('not_sheriff');
    expect(submitHandoverIssue(begunState, 'p_6', 'p_6')?.code).toBe('target_dead');
    expect(submitHandoverIssue(begunState, 'p_6', 'p_999')?.code).toBe('unknown_target');

    const inherited = submitHandover(begunState, 'p_6', 'p_7');
    expect(inherited.state.sheriff.holderId).toBe('p_7');
    expect(inherited.state.day?.step).toBe('speech_round');
    expect(inherited.events.some((event) => event.type === 'sheriff_handover')).toBe(true);
    const voting = advanceToVote(startDefaultSpeechRound(inherited.state).state);
    const settled = settleDayVote(voting).state;
    expect(settled.day?.step).toBe('settle');
    expect(resolveDaySettle(settled).state.phase).toBe('night');

    const destroyed = resolveHandover(begunState);
    expect(destroyed.state.sheriff.holderId).toBeNull();
    expect(destroyed.state.day?.step).toBe('speech_round');
    expect(destroyed.events.some((event) => event.type === 'sheriff_handover')).toBe(true);
  });

  it('T-40：天理白天出局在遗言后移交，死者不能继承', () => {
    const aliveSheriff = withSheriff({ ...morningState(), dayNumber: 2 }, 'p_6');
    let day = startDefaultSpeechRound(beginDay(aliveSheriff).state).state;
    day = advanceToVote(day);
    day = settleDayVote(castVotes(day, [['p_1', 'p_6']])).state;
    expect(day.day?.step).toBe('elimination_last_words');
    expect(day.day?.handover?.deadSheriffId).toBe('p_6');

    const handover = endLastWords(day, 'p_6').state;
    expect(handover.day?.step).toBe('handover');
    expect(submitHandover(handover, 'p_6', 'p_8').state.sheriff.holderId).toBe('p_8');
  });
});

describe('白天结算：翻牌、阶段转换、回归与胜负（R-25、R-33、R-51）', () => {
  it('白天票出科研员：翻牌、公布死神阵营人数并触发阶段转换', () => {
    const voting = advanceToVote(startDefaultSpeechRound(toSpeechRound(begun())).state);
    const settled = settleDayVote(castVotes(voting, [['p_1', 'p_5']])).state;
    const afterWords = endLastWords(settled, 'p_5').state;

    const result = resolveDaySettle(afterWords);
    const researcher = result.state.players.find((player) => player.roleId === 'researcher');
    expect(researcher?.revealed).toBe(true);
    expect(result.state.stage).toBe(2);
    expect(result.events.some((event) => event.type === 'reveal_announced')).toBe(true);
    expect(result.events.some((event) => event.type === 'researcher_announcement')).toBe(true);
    expect(result.events.some((event) => event.type === 'stage_changed')).toBe(true);
  });

  it('白天阶段转换时门先生按守护牺牲死因立即回归', () => {
    const doorSacrificed = morningState({
      guardTargetIds: ['p_6', 'p_7'],
      stage1DeathTargetIds: ['p_6', 'p_7'],
    });
    expect(doorSacrificed.stage).toBe(1);
    let day = startDefaultSpeechRound(toSpeechRound(begun(doorSacrificed))).state;
    day = advanceToVote(day);
    day = settleDayVote(castVotes(day, [['p_1', 'p_5']])).state;
    day = endLastWords(day, 'p_5').state;

    const result = resolveDaySettle(day);
    expect(result.state.stage).toBe(2);
    expect(result.state.players.find((player) => player.playerId === 'p_2')?.life).toBe('alive');
    expect(result.events.some((event) => event.type === 'door_returned')).toBe(true);
  });

  it('白天死亡的水妖不进入复活选择', () => {
    const voting = advanceToVote(startDefaultSpeechRound(toSpeechRound(begun())).state);
    const settled = settleDayVote(castVotes(voting, [['p_1', 'p_3']])).state;
    const afterWords = endLastWords(settled, 'p_3').state;

    const result = resolveDaySettle(afterWords);
    expect(result.state.players.find((player) => player.playerId === 'p_3')?.life).toBe('dead');
    expect(result.state.night).toBeNull();
    expect(result.events.some((event) => event.type.includes('revive'))).toBe(false);
  });

  it('无人出局时结算后进入下一夜，夜晚号递增', () => {
    const voting = advanceToVote(startDefaultSpeechRound(toSpeechRound(begun())).state);
    const result = resolveDaySettle(settleDayVote(voting).state);
    expect(result.state.phase).toBe('night');
    expect(result.state.dayNumber).toBe(2);
    expect(result.state.day).toBeNull();
    expect(result.state.nightStage).toBe(result.state.stage);
  });

  it('投票结算后判胜负：所有平民与科研员出局时死神阵营获胜', () => {
    const lateGame = morningState({
      stage1DeathTargetIds: ['p_5', 'p_6'],
      stage1SpiritTargetIds: ['p_7', 'p_8'],
    });
    const voting = advanceToVote(startDefaultSpeechRound(toSpeechRound(begun(lateGame))).state);
    const voted = castVotes(voting, [['p_1', 'p_9']]);
    const settled = settleDayVote(voted).state;
    const afterWords = endLastWords(settled, 'p_9').state;

    const result = resolveDaySettle(afterWords);
    expect(result.state.phase).toBe('ended');
    expect(result.state.win?.winner).toBe('death_faction');
    expect(result.events.some((event) => event.type === 'game_ended')).toBe(true);
  });
});

describe('白天公屏发言权（R-35、R-45）', () => {
  it('遗言窗口内的出局者可以发公屏，其他死者不能', () => {
    const begunState = beginDay(morningState({ stage1DeathTargetIds: ['p_6', 'p_7'] })).state;
    expect(canPostPublic(begunState, 'p_6')).toBe(true);
    expect(canPostPublic(begunState, 'p_7')).toBe(false);
    expect(canPostPublic(begunState, 'p_1')).toBe(true);

    const next = endLastWords(begunState, 'p_6').state;
    expect(canPostPublic(next, 'p_6')).toBe(false);
    expect(canPostPublic(next, 'p_7')).toBe(true);
  });
});
