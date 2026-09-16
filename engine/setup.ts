import { ROLE_IDS, type RoleId, type RulesetConfig } from '../rulesets/types.ts';
import {
  type GameEvent,
  type GameStartedPayload,
  type RoleAssignedPayload,
  type SeatInfo,
} from './events.ts';
import { createEmitter } from './emit.ts';
import { createRng, shuffle } from './random.ts';
import { FACTION_ROOM_ID, type GameState, type PlayerState } from './types.ts';

export interface PlayerInput {
  readonly playerId: string;
  readonly nickname: string;
}

export interface CreateGameInput {
  readonly gameId: string;
  readonly ruleset: RulesetConfig;
  readonly players: readonly PlayerInput[];
  readonly seed: number;
}

export interface CreateGameResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export function createGame(input: CreateGameInput): CreateGameResult {
  const { gameId, ruleset, players, seed } = input;

  const expectedPlayers = ROLE_IDS.reduce((sum, roleId) => sum + ruleset.roles[roleId], 0);
  if (players.length !== expectedPlayers) {
    throw new Error(`玩家数 ${players.length} 与配置角色总数 ${expectedPlayers} 不一致`);
  }
  if (new Set(players.map((player) => player.playerId)).size !== players.length) {
    throw new Error('playerId 重复，无法分配唯一席位');
  }

  const rng = createRng(seed);
  const seatedPlayers = shuffle(players, rng);

  const rolePool: RoleId[] = [];
  for (const roleId of ROLE_IDS) {
    for (let index = 0; index < ruleset.roles[roleId]; index += 1) {
      rolePool.push(roleId);
    }
  }
  const assignedRoles = shuffle(rolePool, rng);

  const playersState: PlayerState[] = seatedPlayers.map((player, index) => ({
    playerId: player.playerId,
    seat: index + 1,
    nickname: player.nickname,
    roleId: assignedRoles[index],
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

  const seats: SeatInfo[] = playersState.map((player) => ({
    playerId: player.playerId,
    nickname: player.nickname,
    seat: player.seat,
  }));

  const emitter = createEmitter({ dayNumber: 1, stage: 1, startSeq: 0 });

  emitter.emit(
    'game_started',
    { dayNumber: 1, seats } satisfies GameStartedPayload,
    { kind: 'public' },
  );
  for (const player of playersState) {
    emitter.emit(
      'role_assigned',
      { playerId: player.playerId, roleId: player.roleId } satisfies RoleAssignedPayload,
      { kind: 'players', playerIds: [player.playerId] },
    );
  }

  const spirits = playersState.filter((player) => player.roleId === 'spirit');
  const spiritSeats = spirits.map((player) => player.seat);
  const spiritIds = spirits.map((player) => player.playerId);
  const informedIds = playersState
    .filter(
      (player) =>
        player.roleId === 'spirit' || player.roleId === 'death' || player.roleId === 'mourner',
    )
    .map((player) => player.playerId);
  if (informedIds.length > 0) {
    emitter.emit('spirit_knowledge', { seats: spiritSeats }, { kind: 'players', playerIds: informedIds });
  }
  if (spiritIds.length > 0) {
    emitter.emit(
      'faction_room_created',
      { roomId: FACTION_ROOM_ID, memberSeats: spiritSeats },
      { kind: 'players', playerIds: spiritIds },
    );
  }

  const { events, eventSeq } = emitter.result();

  const state: GameState = {
    gameId,
    ruleset,
    seed,
    dayNumber: 1,
    phase: 'night',
    stage: 1,
    nightStage: 1,
    players: playersState,
    sheriff: {
      enabled: ruleset.sheriff.enabled,
      holderId: null,
    },
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
    eventSeq,
  };

  return { state, events };
}
