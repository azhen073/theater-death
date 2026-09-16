import { createEmitter } from './emit.ts';
import type { GameEvent } from './events.ts';
import type { NightValidationIssue } from './night.ts';
import {
  announceResearcherCount,
  applyReveals,
  applyStageTransition,
  detectStageTrigger,
} from './stage.ts';
import type { GamePhase, GameState, NightContext } from './types.ts';
import { checkVictory } from './victory.ts';

export function reviveSelectionIssue(state: GameState, targetId: string): NightValidationIssue | null {
  if (state.phase !== 'morning' || state.night === null) {
    return { code: 'not_morning', message: '当前不在晨间结算阶段' };
  }
  if (state.nightStage !== 2) {
    return { code: 'stage1_no_revive', message: '一阶段死亡不触发回归选择' };
  }
  const water = state.players.find((player) => player.roleId === 'water');
  if (
    water === undefined ||
    water.life !== 'dead' ||
    !state.night.deaths.includes(water.playerId)
  ) {
    return { code: 'water_not_dead_at_night', message: '水妖不是本夜死亡，没有回归选择窗口' };
  }
  if (targetId === water.playerId) {
    return { code: 'revive_self_forbidden', message: '不能选择自己回归' };
  }
  const target = state.players.find((player) => player.playerId === targetId);
  if (target === undefined) {
    return { code: 'unknown_target', message: `目标 ${targetId} 不存在` };
  }
  if (target.life !== 'dead') {
    return { code: 'target_not_dead', message: '回归目标必须是已死亡角色' };
  }
  return null;
}

export function selectReviveTarget(
  state: GameState,
  targetId: string,
): { state: GameState; events: GameEvent[] } {
  const issue = reviveSelectionIssue(state, targetId);
  if (issue !== null) {
    throw new Error(`回归选择不合法：${issue.message}`);
  }
  if (state.night === null) {
    throw new Error('夜晚尚未开始');
  }
  const water = state.players.find((player) => player.roleId === 'water');
  if (water === undefined) {
    throw new Error('水妖不存在');
  }

  const emitter = createEmitter({
    dayNumber: state.dayNumber,
    stage: state.stage,
    startSeq: state.eventSeq,
  });
  const night: NightContext = {
    ...state.night,
    revive: { actorId: water.playerId, targetPlayerId: targetId },
  };
  emitter.emit('revive_selected', { targetPlayerId: targetId }, { kind: 'server' });

  const { events, eventSeq } = emitter.result();
  return { state: { ...state, night, eventSeq }, events };
}

export function resolveMorning(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'morning' || state.night === null) {
    throw new Error(`当前阶段 ${state.phase} 不能进行晨间结算`);
  }

  const night = state.night;
  const emitter = createEmitter({
    dayNumber: state.dayNumber,
    stage: state.stage,
    startSeq: state.eventSeq,
  });
  const seatOf = (playerId: string): number => {
    const player = state.players.find((item) => item.playerId === playerId);
    if (player === undefined) throw new Error(`未知玩家 ${playerId}`);
    return player.seat;
  };

  const trigger = detectStageTrigger(state.players);

  let players = state.players;

  if (night.revive !== null) {
    const { actorId, targetPlayerId } = night.revive;
    players = players.map((player) =>
      player.playerId === targetPlayerId
        ? { ...player, life: 'alive' as const, lastFatalCause: null }
        : player,
    );
    emitter.emit(
      'revive_announced',
      {
        nightNumber: night.nightNumber,
        byWaterSeat: seatOf(actorId),
        targetSeat: seatOf(targetPlayerId),
      },
      { kind: 'public' },
    );
  }

  if (night.deaths.length > 0) {
    emitter.emit(
      'deaths_announced',
      { nightNumber: night.nightNumber, seats: night.deaths.map((playerId) => seatOf(playerId)) },
      { kind: 'public' },
    );
  }

  const revealOutcome = applyReveals(players, emitter);
  players = revealOutcome.players;
  if (revealOutcome.researcherRevealed) {
    announceResearcherCount(state, players, emitter);
  }

  const transition = applyStageTransition(state, players, trigger, emitter);
  players = transition.players;
  const stage = transition.stage;
  const factionRoom = transition.factionRoom;

  const nextState: GameState = { ...state, players, stage, factionRoom };
  const win = checkVictory(nextState);
  let phase: GamePhase = 'day';
  if (win !== null) {
    phase = 'ended';
    emitter.emit(
      'game_ended',
      { winner: win.winner, reason: win.reason, dayNumber: win.dayNumber },
      { kind: 'public' },
    );
  }

  const { events, eventSeq } = emitter.result();
  return {
    state: { ...state, players, stage, factionRoom, phase, win, eventSeq },
    events,
  };
}
