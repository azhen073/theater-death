import type { GameEvent } from '../engine/events.ts';
import {
  advanceElectionSpeech,
  advanceSpeech,
  advanceTieSpeech,
  beginDay,
  currentElectionSpeaker,
  currentLastWordsSpeaker,
  currentSpeechRoundSpeaker,
  currentTieSpeechSpeaker,
  designateSpeechRound,
  designateSpeechRoundIssue,
  endLastWords,
  endLastWordsIssue,
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
  withdrawCandidacy,
  withdrawCandidacyIssue,
  type DayValidationIssue,
} from '../engine/day.ts';
import type { DayContext, ElectionState, GameState } from '../engine/types.ts';
import type { Clock, ClockHandle } from './clock.ts';
import type { GameCommand } from './commands.ts';
import type { LiveWindow, ProposalView, SubmitResult } from './night-driver.ts';
import { windowIssue } from './windows.ts';
import { resolveMorning } from '../engine/morning.ts';

export type DayWindowId =
  | 'speech_prepare'
  | 'last_words'
  | 'election_signup'
  | 'election_speech'
  | 'election_vote'
  | 'speech_order'
  | 'speech_round'
  | 'vote'
  | 'tie_speech'
  | 'handover';

export interface DayStepResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export interface DayDriver {
  start(state: GameState): void;
  submit(command: GameCommand): SubmitResult;
  windows(): readonly LiveWindow[];
  proposalState(playerId: string): ProposalView | null;
  snapshot(): GameState | null;
  done(): boolean;
  dispose(): void;
}

type Phase = 'idle' | DayWindowId | 'done';

export function createDayDriver(options: {
  readonly strictWindows?: boolean;
  readonly clock: Clock;
  readonly onStep: (result: DayStepResult) => void;
  readonly onComplete?: (state: GameState) => void;
}): DayDriver {
  const { clock, onStep, onComplete } = options;

  let state: GameState | null = null;
  let phase: Phase = 'idle';
  let closesAt = 0;
  let generation = 0;
  let preparedKind: 'election_speech' | 'speech_round' | null = null;
  function liveWindows(): LiveWindow[] {
    if (!state || phase === 'idle' || phase === 'done') return [];
    return [{ id: phase, closesAt, ...(options.strictWindows ? { type: phase, instanceId: `${state.gameId}:day:${state.dayNumber}:${generation}` } : {}) }];
  }
  const handles: ClockHandle[] = [];

  function accepted(): SubmitResult {
    return { accepted: true, code: null, message: null };
  }

  function rejected(code: string, message: string): SubmitResult {
    return { accepted: false, code, message };
  }

  function rejectedIssue(issue: DayValidationIssue): SubmitResult {
    return { accepted: false, code: issue.code, message: issue.message };
  }

  function current(): GameState {
    if (state === null) {
      throw new Error('白天驱动尚未启动');
    }
    return state;
  }

  function day(): DayContext {
    const context = current().day;
    if (context === null) {
      throw new Error('白天流程尚未初始化');
    }
    return context;
  }

  function timers() {
    return current().ruleset.timersSeconds;
  }

  function step(result: { state: GameState; events: GameEvent[] }): void {
    state = result.state;
    onStep(result);
  }

  function apply(result: { state: GameState; events: GameEvent[] }): void {
    step(result);
    openNext();
  }

  function scheduleWindow(id: DayWindowId, seconds: number, callback: () => void): void {
    // 白天窗口同一时刻只有一个：切换窗口时取消旧定时器，
    // 防止被事件驱动提前结束的窗口在超时时刻再次触发（曾导致进程崩溃）。
    for (const handle of handles.splice(0)) {
      clock.cancel(handle);
    }
    phase = id;
    generation += 1;
    closesAt = clock.now() + seconds * 1000;
    const scheduledGeneration = generation;
    handles.push(clock.schedule(seconds * 1000, () => { if (generation === scheduledGeneration && phase !== 'done') callback(); }));
  }

  function eligibleVoterCount(game: GameState): number {
    return game.players.filter(
      (player) => voteEligibility(game, player.playerId) === 'ok',
    ).length;
  }

  function beginPreparedSpeech(): void {
    if (phase !== 'speech_prepare' || preparedKind === null) return;
    const kind = preparedKind;
    preparedKind = null;
    step({ state: { ...current(), day: { ...day(), speechPreparing: false } }, events: [] });
    scheduleWindow(kind, timers().speech, kind === 'election_speech' ? advanceElection : timeoutSpeech);
  }

  function openSpeech(kind: 'election_speech' | 'speech_round'): void {
    if (current().ruleset.version !== '2.0') {
      scheduleWindow(kind, timers().speech, kind === 'election_speech' ? advanceElection : timeoutSpeech);
      return;
    }
    preparedKind = kind;
    step({ state: { ...current(), day: { ...day(), speechPreparing: true } }, events: [] });
    scheduleWindow('speech_prepare', timers().speechPrepare ?? 15, beginPreparedSpeech);
  }

  function openNext(): void {
    if (current().win !== null || current().phase === 'ended') {
      for (const handle of handles.splice(0)) clock.cancel(handle);
      phase = 'done';
      onComplete?.(current());
      return;
    }
    const context = day();
    switch (context.step) {
      case 'morning_announcement': {
        const announced = resolveMorning({ ...current(), phase: 'morning', day: null, preAnnouncementElection: false, firstDayElectionDone: true });
        step(announced);
        if (announced.state.win === null) step(beginDay(announced.state));
        openNext();
        return;
      }
      case 'first_night_last_words':
      case 'elimination_last_words':
        scheduleWindow('last_words', timers().lastWords, timeoutLastWords);
        return;
      case 'election':
        openElectionWindow(context);
        return;
      case 'speech_round':
        openSpeechRoundWindow(context);
        return;
      case 'vote':
        openVoteWindow(context);
        return;
      case 'handover':
        scheduleWindow('handover', timers().handover, timeoutHandover);
        return;
      case 'settle':
        settleDay();
        return;
    }
  }

  function openElectionWindow(context: DayContext): void {
    const election: ElectionState | null = context.election;
    if (election === null) {
      throw new Error('竞选状态缺失');
    }
    if (election.phase === 'signup') {
      scheduleWindow('election_signup', timers().election, () => {
        if (phase !== 'election_signup') {
          return;
        }
        apply(startElectionSpeech(current()));
      });
      return;
    }
    if (election.phase === 'speech') {
      openSpeech('election_speech');
      return;
    }
    if (election.phase === 'vote' || election.phase === 'revote') {
      scheduleWindow('election_vote', timers().vote, () => {
        if (phase !== 'election_vote') {
          return;
        }
        apply(settleElectionVote(current()));
      });
      return;
    }
    throw new Error(`竞选阶段异常：${election.phase}`);
  }

  function openSpeechRoundWindow(context: DayContext): void {
    if (context.speechRound === null) {
      scheduleWindow('speech_order', timers().speechOrder ?? timers().ability, () => {
        if (phase !== 'speech_order') {
          return;
        }
        apply(startDefaultSpeechRound(current()));
      });
      return;
    }
    openSpeech('speech_round');
  }

  function openVoteWindow(context: DayContext): void {
    const ballot = context.ballot;
    if (ballot === null) {
      throw new Error('投票状态缺失');
    }
    if (ballot.phase === 'tie_speech') {
      scheduleWindow('tie_speech', timers().tieSpeech, () => {
        if (phase !== 'tie_speech') {
          return;
        }
        const speaker = currentTieSpeechSpeaker(current());
        if (speaker !== null) {
          apply(advanceTieSpeech(current(), speaker));
        }
      });
      return;
    }
    if (ballot.phase === 'vote' || ballot.phase === 'revote') {
      scheduleWindow('vote', timers().vote, () => {
        if (phase !== 'vote') {
          return;
        }
        apply(settleDayVote(current()));
      });
      return;
    }
    throw new Error(`投票阶段异常：${ballot.phase}`);
  }

  function timeoutLastWords(): void {
    if (phase !== 'last_words') {
      return;
    }
    const speaker = currentLastWordsSpeaker(current());
    if (speaker !== null) {
      apply(endLastWords(current(), speaker));
    }
  }

  function advanceElection(): void {
    if (phase !== 'election_speech') {
      return;
    }
    apply(advanceElectionSpeech(current()));
  }

  function timeoutSpeech(): void {
    if (phase !== 'speech_round') {
      return;
    }
    const speaker = currentSpeechRoundSpeaker(current());
    if (speaker !== null) {
      apply(advanceSpeech(current(), speaker));
    }
  }

  function timeoutHandover(): void {
    if (phase !== 'handover') {
      return;
    }
    apply(resolveHandover(current()));
  }

  function settleDay(): void {
    step(resolveDaySettle(current()));
    phase = 'done';
    onComplete?.(current());
  }

  function requireWindow(expected: Phase, closedMessage: string): SubmitResult | null {
    if (phase !== expected) {
      return rejected('window_not_open', '当前不在该行动窗口');
    }
    if (clock.now() >= closesAt) return rejected('window_closed', closedMessage);
    const game = current();
    if (game.win !== null) {
      return rejected('game_ended', '对局已经结束');
    }
    return null;
  }

  function submit(command: GameCommand): SubmitResult {
    if (options.strictWindows) {
      const issue = windowIssue(command, liveWindows(), clock.now());
      if (issue) return issue;
    }
    if (state === null || phase === 'idle') {
      return rejected('day_not_started', '白天流程尚未开始');
    }
    if (phase === 'done') {
      return rejected('day_finished', '白天流程已结束');
    }
    switch (command.type) {
      case 'START_SPEECH': {
        const issue = requireWindow('speech_prepare', '准备时间已截止');
        if (issue) return issue;
        const speaker = preparedKind === 'election_speech' ? currentElectionSpeaker(current()) : currentSpeechRoundSpeaker(current());
        if (speaker !== command.playerId) return rejected('not_current_speaker', '只有当前发言者可开始');
        beginPreparedSpeech();
        return accepted();
      }
      case 'END_LAST_WORDS':
        return submitEndLastWords(command.playerId);
      case 'REGISTER_CANDIDACY':
        return submitRegisterCandidacy(command.playerId);
      case 'WITHDRAW_CANDIDACY':
        return submitWithdrawCandidacy(command.playerId);
      case 'END_ELECTION_SPEECH':
        return submitEndElectionSpeech(command.playerId);
      case 'SUBMIT_ELECTION_VOTE':
        return submitElectionBallot(command.playerId, command.targetId);
      case 'DESIGNATE_SPEECH':
        return submitDesignateSpeech(command.playerId, command.startPlayerId, command.direction);
      case 'END_SPEECH':
        return submitEndSpeech(command.playerId);
      case 'SUBMIT_DAY_VOTE':
        return submitDayBallot(command.playerId, command.targetId);
      case 'END_TIE_SPEECH':
        return submitEndTieSpeech(command.playerId);
      case 'SUBMIT_HANDOVER':
        return submitHandoverCommand(command.playerId, command.targetId);
      default:
        return rejected('window_not_open', '该操作不属于当前阶段');
    }
  }

  function submitEndLastWords(playerId: string): SubmitResult {
    const windowIssue = requireWindow('last_words', '遗言窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const issue = endLastWordsIssue(current(), playerId);
    if (issue !== null) {
      return rejectedIssue(issue);
    }
    apply(endLastWords(current(), playerId));
    return accepted();
  }

  function submitRegisterCandidacy(playerId: string): SubmitResult {
    const windowIssue = requireWindow('election_signup', '竞选报名已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const issue = registerCandidacyIssue(current(), playerId);
    if (issue !== null) {
      return rejectedIssue(issue);
    }
    step(registerCandidacy(current(), playerId));
    return accepted();
  }

  function submitWithdrawCandidacy(playerId: string): SubmitResult {
    const game = current();
    if (phase !== 'election_signup' && phase !== 'election_speech' && !(phase === 'speech_prepare' && preparedKind === 'election_speech')) {
      return rejected('window_not_open', '当前不在竞选报名或发言窗口');
    }
    if (clock.now() >= closesAt) return rejected('window_closed', '竞选窗口已截止');
    const issue = withdrawCandidacyIssue(game, playerId);
    if (issue !== null) {
      return rejectedIssue(issue);
    }
    const speaking = phase === 'election_speech' || (phase === 'speech_prepare' && preparedKind === 'election_speech');
    const wasSpeaker = speaking && currentElectionSpeaker(game) === playerId;
    const withdrawal = withdrawCandidacy(game, playerId);
    const after = withdrawal.state;
    const election = after.day?.election;
    const remaining =
      election === undefined || election === null
        ? 0
        : election.speechOrder.filter((candidateId) => !election.withdrawn.includes(candidateId))
            .length;
    if (speaking && (wasSpeaker || remaining === 0)) {
      apply(advanceElectionSpeech(after));
      return accepted();
    }
    step(withdrawal);
    return accepted();
  }

  function submitEndElectionSpeech(playerId: string): SubmitResult {
    const windowIssue = requireWindow('election_speech', '候选发言窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const speaker = currentElectionSpeaker(current());
    if (speaker !== playerId) {
      return rejected('not_current_speaker', '只有当前候选可以结束发言');
    }
    apply(advanceElectionSpeech(current()));
    return accepted();
  }

  function submitElectionBallot(playerId: string, targetId: string | null): SubmitResult {
    const windowIssue = requireWindow('election_vote', '竞选投票已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const issue = submitElectionVoteIssue(current(), playerId, targetId);
    if (issue !== null) {
      return rejectedIssue(issue);
    }
    step(submitElectionVote(current(), playerId, targetId));
    maybeSettleElection();
    return accepted();
  }

  function maybeSettleElection(): void {
    const game = current();
    const election = game.day?.election;
    if (election === undefined || election === null) {
      return;
    }
    if (election.phase !== 'vote' && election.phase !== 'revote') {
      return;
    }
    if (Object.keys(election.votes).length >= eligibleVoterCount(game)) {
      apply(settleElectionVote(game));
    }
  }

  function submitDesignateSpeech(
    playerId: string,
    startPlayerId: string,
    direction: 'asc' | 'desc',
  ): SubmitResult {
    const windowIssue = requireWindow('speech_order', '发言轮指定窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const issue = designateSpeechRoundIssue(current(), playerId, startPlayerId, direction);
    if (issue !== null) {
      return rejectedIssue(issue);
    }
    apply(designateSpeechRound(current(), playerId, startPlayerId, direction));
    return accepted();
  }

  function submitEndSpeech(playerId: string): SubmitResult {
    const windowIssue = requireWindow('speech_round', '发言窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const speaker = currentSpeechRoundSpeaker(current());
    if (speaker !== playerId) {
      return rejected('not_current_speaker', '只有当前发言者可以结束发言');
    }
    apply(advanceSpeech(current(), playerId));
    return accepted();
  }

  function submitDayBallot(playerId: string, targetId: string | null): SubmitResult {
    const windowIssue = requireWindow('vote', '放逐投票已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const issue = submitDayVoteIssue(current(), playerId, targetId);
    if (issue !== null) {
      return rejectedIssue(issue);
    }
    step(submitDayVote(current(), playerId, targetId));
    maybeSettleDayVote();
    return accepted();
  }

  function maybeSettleDayVote(): void {
    const game = current();
    const ballot = game.day?.ballot;
    if (ballot === undefined || ballot === null) {
      return;
    }
    if (ballot.phase !== 'vote' && ballot.phase !== 'revote') {
      return;
    }
    if (Object.keys(ballot.votes).length >= eligibleVoterCount(game)) {
      apply(settleDayVote(game));
    }
  }

  function submitEndTieSpeech(playerId: string): SubmitResult {
    const windowIssue = requireWindow('tie_speech', '平票发言窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const speaker = currentTieSpeechSpeaker(current());
    if (speaker !== playerId) {
      return rejected('not_current_speaker', '只有当前平票者可以结束发言');
    }
    apply(advanceTieSpeech(current(), playerId));
    return accepted();
  }

  function submitHandoverCommand(playerId: string, targetId: string | null): SubmitResult {
    const windowIssue = requireWindow('handover', '天理移交窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const issue = submitHandoverIssue(current(), playerId, targetId);
    if (issue !== null) {
      return rejectedIssue(issue);
    }
    apply(submitHandover(current(), playerId, targetId));
    return accepted();
  }

  return {
    start(initial) {
      if (phase !== 'idle') {
        throw new Error('白天驱动已经启动过');
      }
      if (initial.phase !== 'day' || initial.day !== null) {
        throw new Error('当前状态不能开始白天流程');
      }
      step(beginDay(initial));
      openNext();
    },
    submit,
    windows() {
      if (state === null || phase === 'idle' || phase === 'done') {
        return [];
      }
      return liveWindows();
    },
    proposalState(_playerId) {
      return null;
    },
    snapshot() {
      return state;
    },
    done() {
      return phase === 'done';
    },
    dispose() {
      for (const handle of handles) {
        clock.cancel(handle);
      }
      handles.length = 0;
      phase = 'done';
    },
  };
}
