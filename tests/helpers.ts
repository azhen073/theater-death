import { FACTION_ROOM_ID, type GameState, type LifeState, type PlayerState } from '../engine/types.ts';
import type { AttackPhaseInput } from '../engine/night.ts';
import { resolveAttackPhase, resolveNightEnd, resolveRescue, startNight } from '../engine/night.ts';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import type { RoleId } from '../rulesets/types.ts';

export const DEFAULT_SEATS: readonly RoleId[] = [
  'laike',
  'door',
  'water',
  'descender',
  'researcher',
  'civilian',
  'civilian',
  'civilian',
  'civilian',
  'death',
  'spirit',
  'spirit',
  'mourner',
];

export function scenario(seatRoles: readonly RoleId[] = DEFAULT_SEATS): GameState {
  const players: PlayerState[] = seatRoles.map((roleId, index) => ({
    playerId: `p_${index + 1}`,
    seat: index + 1,
    nickname: `玩家${index + 1}`,
    roleId,
    life: 'alive',
    revealed: false,
    abilities: {
      laikeBladeUsed: false,
      waterRescueUsed: false,
    },
    guardHistory: [],
    voteFrozen: false,
    lastFatalCause: null,
  }));

  return {
    gameId: 'g_scenario',
    ruleset: THEATER_DEATH_13,
    seed: 1,
    dayNumber: 1,
    phase: 'night',
    stage: 1,
    nightStage: 1,
    players,
    sheriff: { enabled: true, holderId: null },
    night: null,
    day: null,
    factionRoom: {
      roomId: FACTION_ROOM_ID,
      deathJoinDecided: false,
      deathJoined: false,
      deathReadOnly: false,
      deathJoinedEventSeq: null,
    },
    stage1AttackDisabled: false,
    win: null,
    eventSeq: 0,
  };
}

export function playerIdAt(state: GameState, seat: number): string {
  const player = state.players.find((item) => item.seat === seat);
  if (player === undefined) throw new Error(`座位 ${seat} 不存在`);
  return player.playerId;
}

export function seatOf(state: GameState, playerId: string): number {
  const player = state.players.find((item) => item.playerId === playerId);
  if (player === undefined) throw new Error(`玩家 ${playerId} 不存在`);
  return player.seat;
}

export function overridePlayer(
  state: GameState,
  playerId: string,
  patch: Partial<PlayerState>,
): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.playerId === playerId ? { ...player, ...patch } : player,
    ),
  };
}

export function overrideLife(state: GameState, playerId: string, life: LifeState): GameState {
  return overridePlayer(state, playerId, { life });
}

export function runNight(
  state: GameState,
  input: Partial<AttackPhaseInput>,
  rescueTargetId: string | null = null,
): GameState {
  const started = startNight(state).state;
  const attacked = resolveAttackPhase(started, {
    guardTargetIds: [],
    stage1DeathTargetIds: [],
    stage1SpiritTargetIds: [],
    stage2JointTargetIds: [],
    laikeTargetId: null,
    ...input,
  }).state;
  const rescued = resolveRescue(attacked, rescueTargetId).state;
  return resolveNightEnd(rescued).state;
}
