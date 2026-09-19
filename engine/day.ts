import { createEmitter, type EventCollector } from './emit.ts';
import type { GameEvent } from './events.ts';
import {
  announceResearcherCount,
  applyReveals,
  applyStageTransition,
  detectStageTrigger,
} from './stage.ts';
import type {
  BallotState,
  DayContext,
  DayStep,
  ElectionState,
  GameState,
  HandoverState,
  PacedQueue,
  PlayerState,
  SpeechRoundState,
} from './types.ts';
import { checkVictory } from './victory.ts';

export interface DayValidationIssue {
  readonly code: string;
  readonly message: string;
}

export type VoteEligibility = 'ok' | 'unknown' | 'dead' | 'laike_frozen';

const VOTE_UNITS_PER_VOTE = 2;

/** 投票资格：死者不可投；莱莱可翻牌且处一阶段禁投（持天理时票权同步冻结，R-44、R-16） */
export function voteEligibility(state: GameState, playerId: string): VoteEligibility {
  const player = playerOf(state, playerId);
  if (player === undefined) {
    return 'unknown';
  }
  if (player.life === 'dead') {
    return 'dead';
  }
  if (player.roleId === 'laike' && player.revealed && state.stage === 1) {
    return 'laike_frozen';
  }
  return 'ok';
}

/** 结票单位：普通票 2 单位；天理票 = voteWeight × 2（默认 1.5 票 = 3 单位，R-42） */
export function voteUnits(state: GameState, voterId: string): number {
  if (state.sheriff.holderId === voterId) {
    return Math.round(state.ruleset.sheriff.voteWeight * 2);
  }
  return VOTE_UNITS_PER_VOTE;
}

export function currentLastWordsSpeaker(state: GameState): string | null {
  const day = state.day;
  if (day === null || day.lastWords === null) {
    return null;
  }
  const { queue, index } = day.lastWords;
  return index < queue.length ? queue[index] : null;
}

export function currentElectionSpeaker(state: GameState): string | null {
  const election = state.day?.election ?? null;
  if (election === null || election.phase !== 'speech') {
    return null;
  }
  const speaker = election.speechOrder[election.speechIndex];
  if (speaker === undefined || election.withdrawn.includes(speaker)) {
    return null;
  }
  return speaker;
}

export function currentSpeechRoundSpeaker(state: GameState): string | null {
  const round = state.day?.speechRound ?? null;
  if (round === null || round.index >= round.order.length) {
    return null;
  }
  return round.order[round.index];
}

export function currentTieSpeechSpeaker(state: GameState): string | null {
  const ballot = state.day?.ballot ?? null;
  if (ballot === null || ballot.phase !== 'tie_speech') {
    return null;
  }
  const speaker = ballot.tiedIds[ballot.tieSpeechIndex];
  return speaker ?? null;
}

function playerOf(state: GameState, playerId: string): PlayerState | undefined {
  const player = state.players.find((item) => item.playerId === playerId);
  if (player && state.preAnnouncementElection) return { ...player, life: state.night?.eligibleAtStart?.includes(playerId) ? 'alive' : 'dead', revealed: false, voteFrozen: false };
  return player;
}

function seatOf(state: GameState, playerId: string): number {
  const player = playerOf(state, playerId);
  if (player === undefined) {
    throw new Error(`未知玩家 ${playerId}`);
  }
  return player.seat;
}

function aliveSorted(state: GameState): readonly PlayerState[] {
  return state.players.map((p) => playerOf(state, p.playerId)!).filter((player) => player.life !== 'dead').sort((a, b) => a.seat - b.seat);
}

function eligibleVoters(state: GameState): readonly string[] {
  return aliveSorted(state)
    .filter((player) => voteEligibility(state, player.playerId) === 'ok')
    .map((player) => player.playerId);
}

function buildSpeechOrder(
  state: GameState,
  startPlayerId: string,
  direction: 'asc' | 'desc',
): readonly string[] {
  const alive = aliveSorted(state);
  const startIndex = alive.findIndex((player) => player.playerId === startPlayerId);
  if (startIndex < 0) {
    throw new Error(`发言起点 ${startPlayerId} 不可用`);
  }
  if (direction === 'asc') {
    const rotated = [...alive.slice(startIndex), ...alive.slice(0, startIndex)];
    return rotated.map((player) => player.playerId);
  }
  const rotated = [
    alive[startIndex],
    ...alive.slice(0, startIndex).reverse(),
    ...alive.slice(startIndex + 1).reverse(),
  ];
  return rotated.map((player) => player.playerId);
}

function requireDay(state: GameState): DayContext {
  if (state.phase !== 'day' || state.day === null) {
    throw new Error(`当前阶段 ${state.phase} 不能执行白天行动`);
  }
  return state.day;
}

function emitterFor(state: GameState): EventCollector {
  return createEmitter({ dayNumber: state.dayNumber, stage: state.stage, startSeq: state.eventSeq });
}

function result(
  state: GameState,
  day: DayContext,
  emitter: EventCollector,
): { state: GameState; events: GameEvent[] } {
  const { events, eventSeq } = emitter.result();
  return { state: { ...state, day, eventSeq }, events };
}

function issue(code: string, message: string): DayValidationIssue {
  return { code, message };
}

function requireStep(state: GameState, step: DayStep): DayValidationIssue | null {
  const day = state.day;
  if (state.phase !== 'day' || day === null) {
    return issue('not_day', '当前不在白天流程');
  }
  if (day.step !== step) {
    return issue('wrong_day_step', `当前白天步骤为 ${day.step}，不能执行该行动`);
  }
  return null;
}

/** 卸任天理已死且尚未移交时建立移交待办（R-46） */
function handoverAfterDeath(state: GameState, players: readonly PlayerState[], cause: 'night_death' | 'day_elimination' = 'night_death'): HandoverState | null {
  if (!state.ruleset.sheriff.enabled) {
    return null;
  }
  const holderId = state.sheriff.holderId;
  if (holderId === null) {
    return null;
  }
  const holder = players.find((player) => player.playerId === holderId);
  if (holder !== undefined && holder.life === 'dead') {
    return { deadSheriffId: holderId, resolved: false, heirId: null, cause, resumeStep: cause === 'night_death' ? 'speech_round' : 'settle' };
  }
  return null;
}

function makeElection(state: GameState): ElectionState {
  return {
    phase: 'signup',
    candidates: [],
    withdrawn: [],
    speechOrder: [],
    speechIndex: 0,
    round: 1,
    votes: {},
    tiedIds: [],
    winnerId: null,
  };
}

function enterSpeechRound(state: GameState, emitter: EventCollector): { step: DayStep } {
  const sheriff = state.sheriff.holderId;
  const holderAlive = sheriff !== null && playerOf(state, sheriff)?.life !== 'dead';
  emitter.emit('speech_order_pending', { sheriffSeat: holderAlive ? seatOf(state, sheriff) : null }, {
    kind: 'public',
  });
  return { step: 'speech_round' };
}

function enterElectionOrSpeech(
  state: GameState,
  emitter: EventCollector,
): { step: DayStep; election: ElectionState | null } {
  if (state.dayNumber === 1 && state.ruleset.sheriff.enabled && !state.firstDayElectionDone) {
    emitter.emit('election_started', { phase: 'signup' }, { kind: 'public' });
    return { step: 'election', election: makeElection(state) };
  }
  return { step: enterSpeechRound(state, emitter).step, election: null };
}

function enterHandoverOrSettle(
  state: GameState,
  day: DayContext,
  emitter: EventCollector,
): DayStep {
  if (day.handover !== null && !day.handover.resolved) {
    emitter.emit('sheriff_handover_started', { fromSeat: seatOf(state, day.handover.deadSheriffId) }, {
      kind: 'public',
    });
    return 'handover';
  }
  return 'settle';
}

export function beginDayIssue(state: GameState): DayValidationIssue | null {
  if (state.phase !== 'day') {
    return issue('not_day', `当前阶段 ${state.phase} 不能开始白天流程`);
  }
  if (state.day !== null) {
    return issue('day_already_begun', '白天流程已经开始');
  }
  return null;
}

export function beginDay(state: GameState): { state: GameState; events: GameEvent[] } {
  const beginIssue = beginDayIssue(state);
  if (beginIssue !== null) {
    throw new Error(`不能开始白天流程：${beginIssue.message}`);
  }
  const emitter = emitterFor(state);

  const handover = state.preAnnouncementElection ? null : handoverAfterDeath(state, state.players);
  const firstNightDeaths =
    !state.preAnnouncementElection && state.dayNumber === 1 && state.night !== null ? state.night.deaths.filter((id) => playerOf(state, id)?.life === 'dead') : ([] as readonly string[]);

  let step: DayStep;
  let lastWords: PacedQueue | null = null;
  let lastWordsScope: 'first_night' | 'elimination' | null = null;
  let election: ElectionState | null = null;
  let speechRound: SpeechRoundState | null = null;

  if (firstNightDeaths.length > 0) {
    step = 'first_night_last_words';
    lastWordsScope = 'first_night';
    const queue = [...firstNightDeaths].sort((a, b) => seatOf(state, a) - seatOf(state, b));
    lastWords = { queue, index: 0 };
    emitter.emit(
      'last_words_started',
      { scope: 'first_night', seat: seatOf(state, queue[0]) },
      { kind: 'public' },
    );
  } else if (handover !== null) {
    step = 'handover';
    emitter.emit('sheriff_handover_started', { fromSeat: seatOf(state, handover.deadSheriffId) }, { kind: 'public' });
  } else {
    const next = enterElectionOrSpeech(state, emitter);
    step = next.step;
    election = next.election;
  }

  const day: DayContext = {
    dayNumber: state.dayNumber,
    step,
    lastWordsScope,
    lastWords,
    election,
    speechRound,
    ballot: null,
    eliminatedIds: [],
    handover,
  };
  return result(state, day, emitter);
}

export function endLastWordsIssue(state: GameState, actorId: string): DayValidationIssue | null {
  const day = state.day;
  if (state.phase !== 'day' || day === null || day.lastWords === null) {
    return issue('no_last_words_window', '当前没有遗言窗口');
  }
  const speaker = currentLastWordsSpeaker(state);
  if (speaker === null) {
    return issue('no_last_words_window', '遗言已发表完毕');
  }
  if (speaker !== actorId) {
    return issue('not_current_speaker', '只有当前遗言者可以结束遗言');
  }
  return null;
}

export function endLastWords(
  state: GameState,
  actorId: string,
): { state: GameState; events: GameEvent[] } {
  const lastWordsIssue = endLastWordsIssue(state, actorId);
  if (lastWordsIssue !== null) {
    throw new Error(`结束遗言失败：${lastWordsIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const { queue, index } = day.lastWords as PacedQueue;
  const scope = day.lastWordsScope;
  emitter.emit('last_words_finished', { scope, seat: seatOf(state, actorId) }, { kind: 'public' });

  const nextIndex = index + 1;
  let lastWords: PacedQueue | null = null;
  let step = day.step;
  let election = day.election;
  if (nextIndex < queue.length) {
    lastWords = { queue, index: nextIndex };
    emitter.emit(
      'last_words_started',
      { scope, seat: seatOf(state, queue[nextIndex]) },
      { kind: 'public' },
    );
  } else if (scope === 'first_night') {
    if (day.handover !== null && !day.handover.resolved) {
      step = enterHandoverOrSettle(state, day, emitter);
    } else {
      const next = enterElectionOrSpeech(state, emitter);
      step = next.step;
      election = next.election;
    }
  } else {
    step = enterHandoverOrSettle(state, day, emitter);
  }

  const updated: DayContext = {
    ...day,
    step,
    lastWordsScope: lastWords === null ? null : day.lastWordsScope,
    lastWords,
    election,
  };
  return result(state, updated, emitter);
}

export function registerCandidacyIssue(state: GameState, actorId: string): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'election');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const election = (state.day as DayContext).election as ElectionState;
  if (election.phase !== 'signup') {
    return issue('election_not_signup', '竞选报名已结束');
  }
  const player = playerOf(state, actorId);
  if (player === undefined) {
    return issue('unknown_player', `玩家 ${actorId} 不存在`);
  }
  if (player.life === 'dead') {
    return issue('dead_cannot_run', '死者不能参加竞选');
  }
  if (election.candidates.includes(actorId) || election.withdrawn.includes(actorId)) {
    return issue('already_candidate', '已经报名或退选过，不能重复报名');
  }
  return null;
}

export function registerCandidacy(
  state: GameState,
  actorId: string,
): { state: GameState; events: GameEvent[] } {
  const candidacyIssue = registerCandidacyIssue(state, actorId);
  if (candidacyIssue !== null) {
    throw new Error(`竞选报名失败：${candidacyIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const election = day.election as ElectionState;
  emitter.emit('candidacy_registered', { seat: seatOf(state, actorId) }, { kind: 'public' });
  const updated: DayContext = {
    ...day,
    election: { ...election, candidates: [...election.candidates, actorId] },
  };
  return result(state, updated, emitter);
}

export function withdrawCandidacyIssue(state: GameState, actorId: string): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'election');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const election = (state.day as DayContext).election as ElectionState;
  if (election.phase !== 'signup' && election.phase !== 'speech') {
    return issue('election_vote_started', '投票开始后不能退选');
  }
  if (!election.candidates.includes(actorId) || election.withdrawn.includes(actorId)) {
    return issue('not_candidate', '该玩家不在候选名单中');
  }
  return null;
}

export function withdrawCandidacy(
  state: GameState,
  actorId: string,
): { state: GameState; events: GameEvent[] } {
  const withdrawIssue = withdrawCandidacyIssue(state, actorId);
  if (withdrawIssue !== null) {
    throw new Error(`退选失败：${withdrawIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const election = day.election as ElectionState;
  emitter.emit('candidacy_withdrawn', { seat: seatOf(state, actorId) }, { kind: 'public' });
  const updated: DayContext = {
    ...day,
    election: { ...election, withdrawn: [...election.withdrawn, actorId] },
  };
  return result(state, updated, emitter);
}

function finishElection(
  state: GameState,
  election: ElectionState,
  emitter: EventCollector,
  winnerId: string | null,
  reason: string,
): { state: GameState; step: DayStep; election: ElectionState } {
  if (winnerId !== null) {
    emitter.emit('sheriff_elected', { seat: seatOf(state, winnerId) }, { kind: 'public' });
  }
  const nextState =
    winnerId === null ? state : { ...state, sheriff: { ...state.sheriff, holderId: winnerId } };
  emitter.emit(
    'election_finished',
    { winnerSeat: winnerId === null ? null : seatOf(state, winnerId), reason },
    { kind: 'public' },
  );
  const next = state.preAnnouncementElection ? { step: 'morning_announcement' as const } : enterSpeechRound(nextState, emitter);
  return {
    state: nextState,
    step: next.step,
    election: { ...election, phase: 'done', winnerId },
  };
}

export function startElectionSpeechIssue(state: GameState): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'election');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const election = (state.day as DayContext).election as ElectionState;
  if (election.phase !== 'signup') {
    return issue('election_not_signup', '竞选报名已结束');
  }
  return null;
}

export function startElectionSpeech(state: GameState): { state: GameState; events: GameEvent[] } {
  const startIssue = startElectionSpeechIssue(state);
  if (startIssue !== null) {
    throw new Error(`开始竞选发言失败：${startIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const election = day.election as ElectionState;
  const effective = election.candidates
    .filter((candidateId) => !election.withdrawn.includes(candidateId))
    .sort((a, b) => seatOf(state, a) - seatOf(state, b));

  let updated: DayContext;
  if (effective.length === 0) {
    const finished = finishElection(state, election, emitter, null, 'no_candidates');
    updated = { ...day, step: finished.step, election: finished.election };
  } else {
    emitter.emit('candidate_speech_started', { seat: seatOf(state, effective[0]) }, { kind: 'public' });
    updated = {
      ...day,
      election: { ...election, phase: 'speech', speechOrder: effective, speechIndex: 0 },
    };
  }
  return result(state, updated, emitter);
}

export function advanceElectionSpeechIssue(state: GameState): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'election');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const election = (state.day as DayContext).election as ElectionState;
  if (election.phase !== 'speech') {
    return issue('election_not_speech', '当前不在候选发言阶段');
  }
  return null;
}

export function advanceElectionSpeech(state: GameState): { state: GameState; events: GameEvent[] } {
  const advanceIssue = advanceElectionSpeechIssue(state);
  if (advanceIssue !== null) {
    throw new Error(`推进候选发言失败：${advanceIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const election = day.election as ElectionState;

  let nextIndex = election.speechIndex + 1;
  while (nextIndex < election.speechOrder.length && election.withdrawn.includes(election.speechOrder[nextIndex])) {
    nextIndex += 1;
  }

  const currentSpeaker = election.speechOrder[election.speechIndex];
  if (currentSpeaker !== undefined && !election.withdrawn.includes(currentSpeaker)) {
    emitter.emit('candidate_speech_finished', { seat: seatOf(state, currentSpeaker) }, { kind: 'public' });
  }

  let updated: DayContext;
  if (nextIndex < election.speechOrder.length) {
    emitter.emit(
      'candidate_speech_started',
      { seat: seatOf(state, election.speechOrder[nextIndex]) },
      { kind: 'public' },
    );
    updated = { ...day, election: { ...election, speechIndex: nextIndex } };
  } else {
    const effective = election.speechOrder.filter(
      (candidateId) => !election.withdrawn.includes(candidateId),
    );
    if (effective.length === 0) {
      const finished = finishElection(state, election, emitter, null, 'no_candidates');
      return result(
        finished.state,
        { ...day, step: finished.step, election: finished.election },
        emitter,
      );
    }
    emitter.emit(
      'election_vote_started',
      { round: 1, eligibleSeats: eligibleVoters(state).map((id) => seatOf(state, id)) },
      { kind: 'public' },
    );
    updated = {
      ...day,
      election: { ...election, phase: 'vote', votes: {}, tiedIds: [], round: 1 },
    };
  }
  return result(state, updated, emitter);
}

function electionTargets(election: ElectionState): readonly string[] {
  if (election.phase === 'revote') {
    return election.tiedIds;
  }
  return election.speechOrder.filter((candidateId) => !election.withdrawn.includes(candidateId));
}

export function submitElectionVoteIssue(
  state: GameState,
  voterId: string,
  targetId: string | null,
): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'election');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const election = (state.day as DayContext).election as ElectionState;
  if (election.phase !== 'vote' && election.phase !== 'revote') {
    return issue('election_not_voting', '当前不在竞选投票阶段');
  }
  const eligibility = voteEligibility(state, voterId);
  if (eligibility !== 'ok') {
    return issue(`vote_forbidden_${eligibility}`, '该玩家没有竞选投票资格');
  }
  if (voterId in election.votes) {
    return issue('already_voted', '已经投过票');
  }
  if (targetId !== null) {
    if (!electionTargets(election).includes(targetId)) {
      return issue('invalid_vote_target', '只能投给候选玩家');
    }
    if (playerOf(state, targetId)?.life === 'dead') {
      return issue('invalid_vote_target', '不能投给已死亡玩家');
    }
  }
  return null;
}

export function submitElectionVote(
  state: GameState,
  voterId: string,
  targetId: string | null,
): { state: GameState; events: GameEvent[] } {
  const voteIssue = submitElectionVoteIssue(state, voterId, targetId);
  if (voteIssue !== null) {
    throw new Error(`竞选投票失败：${voteIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const election = day.election as ElectionState;
  const votes = { ...election.votes, [voterId]: targetId };
  emitter.emit(
    'election_vote_progress',
    { votedCount: Object.keys(votes).length, eligibleCount: eligibleVoters(state).length },
    { kind: 'public' },
  );
  return result(state, { ...day, election: { ...election, votes } }, emitter);
}

export function settleElectionVoteIssue(state: GameState): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'election');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const election = (state.day as DayContext).election as ElectionState;
  if (election.phase !== 'vote' && election.phase !== 'revote') {
    return issue('election_not_voting', '当前不在竞选投票阶段');
  }
  return null;
}

export function settleElectionVote(state: GameState): { state: GameState; events: GameEvent[] } {
  const settleIssue = settleElectionVoteIssue(state);
  if (settleIssue !== null) {
    throw new Error(`竞选结票失败：${settleIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const election = day.election as ElectionState;

  const tally: Record<string, number> = {};
  for (const [voterId, targetId] of Object.entries(election.votes)) {
    if (targetId === null) {
      continue;
    }
    tally[targetId] = (tally[targetId] ?? 0) + voteUnits(state, voterId);
  }

  const voteDetails = Object.entries(election.votes).map(([voterId, targetId]) => ({
    voterSeat: seatOf(state, voterId),
    targetSeat: targetId === null ? null : seatOf(state, targetId),
    units: targetId === null ? 0 : voteUnits(state, voterId),
  }));
  const tallyDetails = Object.entries(tally)
    .map(([targetId, units]) => ({ seat: seatOf(state, targetId), units }))
    .sort((a, b) => a.seat - b.seat);

  const maxUnits = Math.max(0, ...Object.values(tally));
  const topIds =
    maxUnits === 0
      ? []
      : Object.entries(tally)
          .filter(([, units]) => units === maxUnits)
          .map(([targetId]) => targetId);

  let nextState = state;
  let updated: DayContext;
  if (topIds.length === 1) {
    emitter.emit(
      'election_result',
      {
        round: election.round,
        votes: voteDetails,
        tally: tallyDetails,
        tiedSeats: [],
        winnerSeat: seatOf(state, topIds[0]),
      },
      { kind: 'public' },
    );
    const finished = finishElection(state, election, emitter, topIds[0], 'elected');
    nextState = finished.state;
    updated = { ...day, step: finished.step, election: finished.election };
  } else if (topIds.length >= 2 && election.round === 1) {
    emitter.emit(
      'election_result',
      {
        round: election.round,
        votes: voteDetails,
        tally: tallyDetails,
        tiedSeats: topIds.map((id) => seatOf(state, id)).sort((a, b) => a - b),
        winnerSeat: null,
      },
      { kind: 'public' },
    );
    emitter.emit(
      'election_revote_started',
      {
        seats: topIds.map((id) => seatOf(state, id)).sort((a, b) => a - b),
        eligibleSeats: eligibleVoters(state).map((id) => seatOf(state, id)),
      },
      { kind: 'public' },
    );
    updated = {
      ...day,
      election: { ...election, phase: 'revote', round: 2, votes: {}, tiedIds: topIds },
    };
  } else {
    const reason = topIds.length >= 2 ? 'tie_again' : 'no_votes';
    emitter.emit(
      'election_result',
      {
        round: election.round,
        votes: voteDetails,
        tally: tallyDetails,
        tiedSeats: topIds.map((id) => seatOf(state, id)).sort((a, b) => a - b),
        winnerSeat: null,
      },
      { kind: 'public' },
    );
    const finished = finishElection(state, election, emitter, null, reason);
    nextState = finished.state;
    updated = { ...day, step: finished.step, election: finished.election };
  }
  return result(nextState, updated, emitter);
}

export function designateSpeechRoundIssue(
  state: GameState,
  actorId: string,
  startPlayerId: string,
  direction: 'asc' | 'desc',
): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'speech_round');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const day = state.day as DayContext;
  if (day.speechRound !== null) {
    return issue('speech_round_started', '发言轮已经开始');
  }
  const sheriffId = state.sheriff.holderId;
  if (sheriffId === null || sheriffId !== actorId) {
    return issue('not_sheriff', '只有天理可以指定发言轮');
  }
  if (playerOf(state, actorId)?.life === 'dead') {
    return issue('sheriff_dead', '天理已死亡');
  }
  const start = playerOf(state, startPlayerId);
  if (start === undefined) {
    return issue('unknown_target', '发言起点玩家不存在');
  }
  if (start.life === 'dead') {
    return issue('target_dead', '发言起点必须是存活玩家');
  }
  if (direction !== 'asc' && direction !== 'desc') {
    return issue('invalid_direction', '发言方向只能是 asc 或 desc');
  }
  return null;
}

export function designateSpeechRound(
  state: GameState,
  actorId: string,
  startPlayerId: string,
  direction: 'asc' | 'desc',
): { state: GameState; events: GameEvent[] } {
  const designateIssue = designateSpeechRoundIssue(state, actorId, startPlayerId, direction);
  if (designateIssue !== null) {
    throw new Error(`指定发言轮失败：${designateIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const round = beginSpeechRound(state, emitter, actorId, startPlayerId, direction);
  return result(state, { ...day, speechRound: round }, emitter);
}

export function startDefaultSpeechRoundIssue(state: GameState): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'speech_round');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const day = state.day as DayContext;
  if (day.speechRound !== null) {
    return issue('speech_round_started', '发言轮已经开始');
  }
  return null;
}

export function startDefaultSpeechRound(state: GameState): { state: GameState; events: GameEvent[] } {
  const defaultIssue = startDefaultSpeechRoundIssue(state);
  if (defaultIssue !== null) {
    throw new Error(`开始默认发言轮失败：${defaultIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const first = aliveSorted(state)[0];
  if (first === undefined) {
    throw new Error('没有存活玩家可以发言');
  }
  const round = beginSpeechRound(state, emitter, null, first.playerId, 'asc');
  return result(state, { ...day, speechRound: round }, emitter);
}

function beginSpeechRound(
  state: GameState,
  emitter: EventCollector,
  designatedBy: string | null,
  startPlayerId: string,
  direction: 'asc' | 'desc',
): SpeechRoundState {
  const order = buildSpeechOrder(state, startPlayerId, direction);
  const startSeat = seatOf(state, startPlayerId);
  emitter.emit(
    'speech_round_started',
    {
      orderSeats: order.map((playerId) => seatOf(state, playerId)),
      startSeat,
      direction,
      designatedBySeat: designatedBy === null ? null : seatOf(state, designatedBy),
    },
    { kind: 'public' },
  );
  emitter.emit('speech_turn_started', { seat: startSeat }, { kind: 'public' });
  return { order, index: 0, designatedBy, startSeat, direction };
}

export function advanceSpeechIssue(state: GameState, actorId: string): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'speech_round');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const day = state.day as DayContext;
  if (day.speechRound === null) {
    return issue('speech_round_not_started', '发言轮尚未开始');
  }
  const speaker = currentSpeechRoundSpeaker(state);
  if (speaker === null) {
    return issue('speech_round_finished', '发言轮已经结束');
  }
  if (speaker !== actorId) {
    return issue('not_current_speaker', '只有当前发言者可以结束自己的发言');
  }
  return null;
}

export function advanceSpeech(
  state: GameState,
  actorId: string,
): { state: GameState; events: GameEvent[] } {
  const advanceIssue = advanceSpeechIssue(state, actorId);
  if (advanceIssue !== null) {
    throw new Error(`推进发言失败：${advanceIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const round = day.speechRound as SpeechRoundState;
  emitter.emit('speech_turn_finished', { seat: seatOf(state, actorId) }, { kind: 'public' });

  const nextIndex = round.index + 1;
  let updated: DayContext;
  if (nextIndex < round.order.length) {
    emitter.emit(
      'speech_turn_started',
      { seat: seatOf(state, round.order[nextIndex]) },
      { kind: 'public' },
    );
    updated = { ...day, speechRound: { ...round, index: nextIndex } };
  } else {
    emitter.emit(
      'day_vote_started',
      { round: 1, eligibleSeats: eligibleVoters(state).map((id) => seatOf(state, id)) },
      { kind: 'public' },
    );
    const ballot: BallotState = {
      phase: 'vote',
      round: 1,
      votes: {},
      tiedIds: [],
      tieSpeechIndex: 0,
      eliminatedId: null,
    };
    updated = { ...day, step: 'vote', speechRound: { ...round, index: nextIndex }, ballot };
  }
  return result(state, updated, emitter);
}

export function submitDayVoteIssue(
  state: GameState,
  voterId: string,
  targetId: string | null,
): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'vote');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const ballot = (state.day as DayContext).ballot as BallotState;
  if (ballot.phase !== 'vote' && ballot.phase !== 'revote') {
    return issue('vote_not_open', '当前不在放逐投票阶段');
  }
  const eligibility = voteEligibility(state, voterId);
  if (eligibility !== 'ok') {
    return issue(`vote_forbidden_${eligibility}`, '该玩家没有放逐投票资格');
  }
  if (voterId in ballot.votes) {
    return issue('already_voted', '已经投过票');
  }
  if (targetId !== null) {
    const target = playerOf(state, targetId);
    if (target === undefined) {
      return issue('unknown_target', '投票目标不存在');
    }
    if (target.life === 'dead') {
      return issue('invalid_vote_target', '不能投给已死亡玩家');
    }
  }
  return null;
}

export function submitDayVote(
  state: GameState,
  voterId: string,
  targetId: string | null,
): { state: GameState; events: GameEvent[] } {
  const voteIssue = submitDayVoteIssue(state, voterId, targetId);
  if (voteIssue !== null) {
    throw new Error(`放逐投票失败：${voteIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const ballot = day.ballot as BallotState;
  const votes = { ...ballot.votes, [voterId]: targetId };
  emitter.emit(
    'vote_progress',
    { votedCount: Object.keys(votes).length, eligibleCount: eligibleVoters(state).length },
    { kind: 'public' },
  );
  return result(state, { ...day, ballot: { ...ballot, votes } }, emitter);
}

export function settleDayVoteIssue(state: GameState): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'vote');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const ballot = (state.day as DayContext).ballot as BallotState;
  if (ballot.phase !== 'vote' && ballot.phase !== 'revote') {
    return issue('vote_not_open', '当前不在放逐投票阶段');
  }
  return null;
}

export function settleDayVote(state: GameState): { state: GameState; events: GameEvent[] } {
  const settleIssue = settleDayVoteIssue(state);
  if (settleIssue !== null) {
    throw new Error(`放逐结票失败：${settleIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const ballot = day.ballot as BallotState;

  const tally: Record<string, number> = {};
  for (const [voterId, targetId] of Object.entries(ballot.votes)) {
    if (targetId === null) {
      continue;
    }
    tally[targetId] = (tally[targetId] ?? 0) + voteUnits(state, voterId);
  }
  const voteDetails = Object.entries(ballot.votes).map(([voterId, targetId]) => ({
    voterSeat: seatOf(state, voterId),
    targetSeat: targetId === null ? null : seatOf(state, targetId),
    units: targetId === null ? 0 : voteUnits(state, voterId),
  }));
  const tallyDetails = Object.entries(tally)
    .map(([targetId, units]) => ({ seat: seatOf(state, targetId), units }))
    .sort((a, b) => a.seat - b.seat);

  const maxUnits = Math.max(0, ...Object.values(tally));
  const topIds =
    maxUnits === 0
      ? []
      : Object.entries(tally)
          .filter(([, units]) => units === maxUnits)
          .map(([targetId]) => targetId)
          .sort((a, b) => seatOf(state, a) - seatOf(state, b));

  let players = state.players;
  let updatedDay: DayContext;

  if (topIds.length === 1) {
    const eliminatedId = topIds[0];
    emitter.emit(
      'vote_result',
      {
        round: ballot.round,
        votes: voteDetails,
        tally: tallyDetails,
        tiedSeats: [],
        eliminatedSeat: seatOf(state, eliminatedId),
      },
      { kind: 'public' },
    );
    players = players.map((player) =>
      player.playerId === eliminatedId ? { ...player, life: 'dead' as const } : player,
    );
    emitter.emit('elimination_announced', { seat: seatOf(state, eliminatedId) }, { kind: 'public' });

    if (state.ruleset.version === '2.0') {
      const revealed = applyReveals(players, emitter);
      players = revealed.players;
      if (revealed.researcherRevealed) announceResearcherCount(state, players, emitter);
      const transition = applyStageTransition(state, players, detectStageTrigger(players), emitter);
      players = transition.players;
      state = { ...state, players, stage: transition.stage, factionRoom: transition.factionRoom };
      const win = checkVictory(state);
      if (win !== null) {
        emitter.emit('game_ended', { winner: win.winner, reason: win.reason, dayNumber: win.dayNumber }, { kind: 'public' });
        const { events, eventSeq } = emitter.result();
        return { state: { ...state, day: null, phase: 'ended', win, eventSeq }, events };
      }
    }

    const dayWithHandover: DayContext = {
      ...day,
      handover: handoverAfterDeath(state, players, 'day_elimination'),
    };
    const elimination = afterElimination(state, dayWithHandover, eliminatedId, emitter);
    updatedDay = {
      ...dayWithHandover,
      step: elimination.step,
      ballot: { ...ballot, phase: 'done', eliminatedId },
      eliminatedIds: [...day.eliminatedIds, eliminatedId],
      lastWordsScope: elimination.lastWords === null ? null : 'elimination',
      lastWords: elimination.lastWords,
    };
  } else if (topIds.length >= 2 && ballot.round === 1) {
    const tiedSeats = topIds.map((id) => seatOf(state, id));
    emitter.emit(
      'vote_result',
      {
        round: ballot.round,
        votes: voteDetails,
        tally: tallyDetails,
        tiedSeats,
        eliminatedSeat: null,
      },
      { kind: 'public' },
    );
    emitter.emit('tie_speech_started', { seats: tiedSeats }, { kind: 'public' });
    emitter.emit('tie_speech_turn_started', { seat: tiedSeats[0] }, { kind: 'public' });
    updatedDay = {
      ...day,
      ballot: { ...ballot, phase: 'tie_speech', tiedIds: topIds, tieSpeechIndex: 0 },
    };
  } else {
    emitter.emit(
      'vote_result',
      {
        round: ballot.round,
        votes: voteDetails,
        tally: tallyDetails,
        tiedSeats: topIds.map((id) => seatOf(state, id)),
        eliminatedSeat: null,
      },
      { kind: 'public' },
    );
    const step = enterHandoverOrSettle(state, day, emitter);
    updatedDay = { ...day, step, ballot: { ...ballot, phase: 'done', eliminatedId: null } };
  }

  const { events, eventSeq } = emitter.result();
  return { state: { ...state, players, day: updatedDay, eventSeq }, events };
}

function afterElimination(
  state: GameState,
  day: DayContext,
  eliminatedId: string,
  emitter: EventCollector,
): { step: DayStep; lastWords: PacedQueue | null } {
  if (state.ruleset.lastWords.dayEliminated) {
    emitter.emit(
      'last_words_started',
      { scope: 'elimination', seat: seatOf(state, eliminatedId) },
      { kind: 'public' },
    );
    return { step: 'elimination_last_words', lastWords: { queue: [eliminatedId], index: 0 } };
  }
  return { step: enterHandoverOrSettle(state, day, emitter), lastWords: null };
}

export function advanceTieSpeechIssue(state: GameState, actorId: string): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'vote');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const ballot = (state.day as DayContext).ballot as BallotState;
  if (ballot.phase !== 'tie_speech') {
    return issue('no_tie_speech', '当前没有平票发言环节');
  }
  const speaker = currentTieSpeechSpeaker(state);
  if (speaker === null) {
    return issue('tie_speech_finished', '平票发言已结束');
  }
  if (speaker !== actorId) {
    return issue('not_current_speaker', '只有当前发言者可以结束发言');
  }
  return null;
}

export function advanceTieSpeech(
  state: GameState,
  actorId: string,
): { state: GameState; events: GameEvent[] } {
  const tieIssue = advanceTieSpeechIssue(state, actorId);
  if (tieIssue !== null) {
    throw new Error(`推进平票发言失败：${tieIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  const ballot = day.ballot as BallotState;
  emitter.emit('tie_speech_turn_finished', { seat: seatOf(state, actorId) }, { kind: 'public' });

  const nextIndex = ballot.tieSpeechIndex + 1;
  let updated: DayContext;
  if (nextIndex < ballot.tiedIds.length) {
    emitter.emit(
      'tie_speech_turn_started',
      { seat: seatOf(state, ballot.tiedIds[nextIndex]) },
      { kind: 'public' },
    );
    updated = { ...day, ballot: { ...ballot, tieSpeechIndex: nextIndex } };
  } else {
    emitter.emit(
      'revote_started',
      {
        seats: ballot.tiedIds.map((id) => seatOf(state, id)),
        eligibleSeats: eligibleVoters(state).map((id) => seatOf(state, id)),
      },
      { kind: 'public' },
    );
    updated = {
      ...day,
      ballot: { ...ballot, phase: 'revote', round: 2, votes: {}, tieSpeechIndex: nextIndex },
    };
  }
  return result(state, updated, emitter);
}

export function submitHandoverIssue(
  state: GameState,
  actorId: string,
  targetId: string | null,
): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'handover');
  if (stepIssue !== null) {
    return stepIssue;
  }
  const handover = (state.day as DayContext).handover;
  if (handover === null || handover.resolved) {
    return issue('no_handover_window', '当前没有天理移交流程');
  }
  if (handover.deadSheriffId !== actorId) {
    return issue('not_sheriff', '只有卸任天理本人可以指定继承');
  }
  if (targetId !== null) {
    const target = playerOf(state, targetId);
    if (target === undefined) {
      return issue('unknown_target', '继承目标不存在');
    }
    if (target.life === 'dead') {
      return issue('target_dead', '死者不能继承天理');
    }
  }
  return null;
}

export function submitHandover(
  state: GameState,
  actorId: string,
  targetId: string | null,
): { state: GameState; events: GameEvent[] } {
  const handoverIssue = submitHandoverIssue(state, actorId, targetId);
  if (handoverIssue !== null) {
    throw new Error(`天理移交失败：${handoverIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);
  return performHandover(state, day, targetId, emitter);
}

export function resolveHandover(state: GameState): { state: GameState; events: GameEvent[] } {
  const stepIssue = requireStep(state, 'handover');
  if (stepIssue !== null) {
    throw new Error(`天理移交超时结算失败：${stepIssue.message}`);
  }
  const day = requireDay(state);
  const handover = day.handover;
  if (handover === null || handover.resolved) {
    throw new Error('当前没有天理移交流程');
  }
  const emitter = emitterFor(state);
  return performHandover(state, day, null, emitter);
}

function performHandover(
  state: GameState,
  day: DayContext,
  targetId: string | null,
  emitter: EventCollector,
): { state: GameState; events: GameEvent[] } {
  const handover = day.handover as HandoverState;
  const fromSeat = seatOf(state, handover.deadSheriffId);
  const heirSeat = targetId === null ? null : seatOf(state, targetId);
  emitter.emit('sheriff_handover', { fromSeat, heirSeat }, { kind: 'public' });

  const nextState: GameState = {
    ...state,
    sheriff: { ...state.sheriff, holderId: targetId },
  };
  const updated: DayContext = {
    ...day,
    step: handover.resumeStep ?? 'settle',
    handover: { ...handover, resolved: true, heirId: targetId },
  };
  if (updated.step === 'speech_round') enterSpeechRound(nextState, emitter);
  return result(nextState, updated, emitter);
}

export function resolveDaySettleIssue(state: GameState): DayValidationIssue | null {
  const stepIssue = requireStep(state, 'settle');
  if (stepIssue !== null) {
    return stepIssue;
  }
  return null;
}

/** R-33 投票结算收尾：翻牌、阶段转换与立即回归 → 判胜负 → 入夜或终局 */
export function resolveDaySettle(state: GameState): { state: GameState; events: GameEvent[] } {
  const settleIssue = resolveDaySettleIssue(state);
  if (settleIssue !== null) {
    throw new Error(`白天结算失败：${settleIssue.message}`);
  }
  const day = requireDay(state);
  const emitter = emitterFor(state);

  const revealOutcome = applyReveals(state.players, emitter);
  let players = revealOutcome.players;
  if (revealOutcome.researcherRevealed) {
    announceResearcherCount(state, players, emitter);
  }

  const trigger = detectStageTrigger(players);
  const transition = applyStageTransition(state, players, trigger, emitter);
  players = transition.players;

  const staged: GameState = {
    ...state,
    players,
    stage: transition.stage,
    factionRoom: transition.factionRoom,
  };
  const win = checkVictory(staged);
  if (win !== null) {
    emitter.emit(
      'game_ended',
      { winner: win.winner, reason: win.reason, dayNumber: win.dayNumber },
      { kind: 'public' },
    );
    const { events, eventSeq } = emitter.result();
    return {
      state: { ...staged, phase: 'ended', win, day, eventSeq },
      events,
    };
  }

  emitter.emit(
    'day_ended',
    { dayNumber: state.dayNumber, nextNightNumber: state.dayNumber + 1 },
    { kind: 'public' },
  );
  const { events, eventSeq } = emitter.result();
  return {
    state: {
      ...staged,
      dayNumber: state.dayNumber + 1,
      phase: 'night',
      night: null,
      nightStage: transition.stage,
      day: null,
      eventSeq,
    },
    events,
  };
}
