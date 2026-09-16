import type { EventCollector } from './emit.ts';
import type { RoleId } from '../rulesets/types.ts';
import type { FactionRoomState, GameState, PlayerState, Stage } from './types.ts';

export interface StageTrigger {
  readonly reason: 'all_spirits_dead' | 'researcher_dead';
}

/** 阶段触发以死亡事件为准（R-51）：调用方用死亡已生效的快照判定，回归不撤销 */
export function detectStageTrigger(players: readonly PlayerState[]): StageTrigger | null {
  const spirits = players.filter((player) => player.roleId === 'spirit');
  const researcher = players.find((player) => player.roleId === 'researcher');

  if (spirits.length > 0 && spirits.every((player) => player.life === 'dead')) {
    return { reason: 'all_spirits_dead' };
  }
  if (researcher !== undefined && researcher.life === 'dead') {
    return { reason: 'researcher_dead' };
  }
  return null;
}

export interface RevealOutcome {
  readonly players: readonly PlayerState[];
  readonly researcherRevealed: boolean;
}

/** 翻牌：莱莱可使用技能后翻牌、科研员出局后翻牌（R-15、R-25） */
export function applyReveals(
  players: readonly PlayerState[],
  emitter: EventCollector,
): RevealOutcome {
  const reveals: Array<{ playerId: string; seat: number; roleId: RoleId }> = [];
  for (const player of players) {
    const shouldReveal =
      (player.roleId === 'laike' && player.abilities.laikeBladeUsed && !player.revealed) ||
      (player.roleId === 'researcher' && player.life === 'dead' && !player.revealed);
    if (shouldReveal) {
      reveals.push({ playerId: player.playerId, seat: player.seat, roleId: player.roleId });
    }
  }
  if (reveals.length === 0) {
    return { players, researcherRevealed: false };
  }
  const revealIds = new Set(reveals.map((item) => item.playerId));
  const updated = players.map((player) =>
    revealIds.has(player.playerId) ? { ...player, revealed: true } : player,
  );
  emitter.emit('reveal_announced', { reveals }, { kind: 'public' });
  return {
    players: updated,
    researcherRevealed: reveals.some((item) => item.roleId === 'researcher'),
  };
}

export function countDeathFactionAlive(state: GameState, players: readonly PlayerState[]): number {
  const { count, includesMourner } = state.ruleset.researcherAnnouncement;
  const roles: readonly RoleId[] = includesMourner
    ? ['death', 'spirit', 'mourner']
    : ['death', 'spirit'];

  if (count === 'initial_total') {
    return roles.reduce((sum, roleId) => sum + state.ruleset.roles[roleId], 0);
  }
  return players.filter(
    (player) => roles.includes(player.roleId) && player.life !== 'dead',
  ).length;
}

/** 科研员公告：公告时点存活死神阵营人数，整局限一次（R-25、R-50） */
export function announceResearcherCount(
  state: GameState,
  players: readonly PlayerState[],
  emitter: EventCollector,
): void {
  emitter.emit(
    'researcher_announcement',
    { count: countDeathFactionAlive(state, players) },
    { kind: 'public' },
  );
}

export interface StageTransitionOutcome {
  readonly players: readonly PlayerState[];
  readonly stage: Stage;
  readonly factionRoom: FactionRoomState;
  readonly changed: boolean;
}

/** 判定并执行阶段转换、门先生立即回归与阵营房死神加入判定（R-33、R-51、R-19、Q-07） */
export function applyStageTransition(
  state: GameState,
  players: readonly PlayerState[],
  trigger: StageTrigger | null,
  emitter: EventCollector,
): StageTransitionOutcome {
  let stage = state.stage;
  let stageChanged = false;
  if (stage === 1 && trigger !== null) {
    stage = 2;
    stageChanged = true;
    emitter.emit('stage_changed', { to: 2, reason: trigger.reason }, { kind: 'public' });
  }

  let updated = players;
  if (stageChanged) {
    const door = updated.find((player) => player.roleId === 'door');
    if (door !== undefined && door.life === 'dead' && door.lastFatalCause === 'guard_sacrifice') {
      updated = updated.map((player) =>
        player.playerId === door.playerId
          ? { ...player, life: 'alive' as const, lastFatalCause: null }
          : player,
      );
      emitter.emit('door_returned', { seat: door.seat }, { kind: 'public' });
    }
  }

  let factionRoom = state.factionRoom;
  if (stageChanged && !factionRoom.deathJoinDecided) {
    const death = updated.find((player) => player.roleId === 'death');
    const anySpiritAlive = updated.some(
      (player) => player.roleId === 'spirit' && player.life !== 'dead',
    );
    const joined = death !== undefined && anySpiritAlive;
    const readOnly = death !== undefined && death.life === 'dead';
    let deathJoinedEventSeq: number | null = null;
    if (joined && death !== undefined) {
      const event = emitter.emit(
        'faction_room_joined',
        { roomId: factionRoom.roomId, readOnly },
        { kind: 'players', playerIds: [death.playerId] },
      );
      deathJoinedEventSeq = event.seq;
    }
    factionRoom = {
      ...factionRoom,
      deathJoinDecided: true,
      deathJoined: joined,
      deathReadOnly: readOnly,
      deathJoinedEventSeq,
    };
  }

  return { players: updated, stage, factionRoom, changed: stageChanged };
}
