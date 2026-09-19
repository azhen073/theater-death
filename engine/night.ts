import { createEmitter } from './emit.ts';
import type { GameEvent } from './events.ts';
import { ROLE_DEFINITIONS } from '../rulesets/roles.ts';
import type {
  AttackEvent,
  AttackSourceRoleId,
  CheckKind,
  FatalRecord,
  GamePhase,
  GameState,
  LifeState,
  NightContext,
  PlayerState,
} from './types.ts';

export interface NightValidationIssue {
  readonly code: string;
  readonly message: string;
}

export interface AttackPhaseInput {
  readonly guardTargetIds: readonly string[];
  readonly stage1DeathTargetIds: readonly string[];
  readonly stage1SpiritTargetIds: readonly string[];
  readonly stage2JointTargetIds: readonly string[];
  readonly laikeTargetId: string | null;
}

const SOURCE_PRIORITY: Readonly<Record<AttackSourceRoleId, number>> = {
  spirit: 0,
  death: 1,
  joint: 1,
  laike: 2,
};

export function startNight(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'night') {
    throw new Error(`当前阶段 ${state.phase} 不能进入夜晚`);
  }

  const emitter = createEmitter({
    dayNumber: state.dayNumber,
    stage: state.stage,
    startSeq: state.eventSeq,
  });

  const night: NightContext = {
    ...(state.ruleset.version === '2.0' ? { eligibleAtStart: state.players.filter((p) => p.life !== 'dead').map((p) => p.playerId) } : {}),
    nightNumber: state.dayNumber,
    guardSelections: [],
    attacks: [],
    rescue: null,
    revive: null,
    descenderCheck: null,
    fatalRecords: [],
    dyingSet: [],
    deaths: [],
    sacrificeTriggered: false,
  };

  emitter.emit('night_started', { nightNumber: state.dayNumber, stage: state.stage }, { kind: 'public' });

  const { events, eventSeq } = emitter.result();
  return { state: { ...state, nightStage: state.stage, night, eventSeq }, events };
}

export function validateAttackPhase(state: GameState, input: AttackPhaseInput): NightValidationIssue[] {
  const issues: NightValidationIssue[] = [];
  const add = (code: string, message: string): void => {
    issues.push({ code, message });
  };

  if (state.phase !== 'night' || state.night === null) {
    add('night_not_started', '夜晚尚未开始，不能提交攻击阶段行动');
    return issues;
  }

  const byId = new Map(state.players.map((player) => [player.playerId, player]));
  const door = state.players.find((player) => player.roleId === 'door' && player.life !== 'dead');
  const livingSpirits = state.players.filter((player) => player.roleId === 'spirit' && player.life !== 'dead');
  const death = state.players.find((player) => player.roleId === 'death');

  if (new Set(input.guardTargetIds).size !== input.guardTargetIds.length) {
    add('guard_duplicate_target', '守护目标不能重复');
  }
  if (input.guardTargetIds.length > state.ruleset.guardTargets) {
    add('guard_targets_exceeded', `守护目标最多 ${state.ruleset.guardTargets} 人`);
  }
  if (door === undefined && input.guardTargetIds.length > 0) {
    add('no_eligible_guardian', '当前没有可行动的门先生');
  }
  if (door !== undefined) {
    for (const targetId of input.guardTargetIds) {
      if (targetId === door.playerId) {
        add('guard_self_forbidden', '门先生不能守护自己');
      }
      const target = byId.get(targetId);
      if (target === undefined) {
        add('unknown_target', `守护目标 ${targetId} 不存在`);
      } else if (target.life === 'dead') {
        add('target_dead', `守护目标 ${targetId} 已死亡`);
      }
    }

    const previousNight = door.guardHistory.find((record) => record.nightNumber === state.dayNumber - 1);
    if (
      input.guardTargetIds.length === 2 &&
      previousNight !== undefined &&
      previousNight.targetPlayerIds.length === 2 &&
      samePlayerSet(input.guardTargetIds, previousNight.targetPlayerIds)
    ) {
      add('guard_same_pair_consecutive', '不能连续两晚守护同一对人');
    }

    for (const targetId of input.guardTargetIds) {
      const twoNightsAgo = door.guardHistory.find((record) => record.nightNumber === state.dayNumber - 2);
      if (previousNight?.targetPlayerIds.includes(targetId) === true && twoNightsAgo?.targetPlayerIds.includes(targetId) === true) {
        add('guard_same_target_three_nights', `不能连续三晚守护同一个人（${targetId}）`);
      }
    }
  }

  if (state.nightStage === 1) {
    if (input.stage2JointTargetIds.length > 0) {
      add('joint_field_in_stage1', '一阶段不产生联合行动');
    }
    if (input.stage1DeathTargetIds.length > state.ruleset.stage1DeathQuota) {
      add('death_targets_exceeded', `一阶段死神袭击最多 ${state.ruleset.stage1DeathQuota} 人`);
    }
    if (input.stage1SpiritTargetIds.length > livingSpirits.length) {
      add('spirit_targets_exceeded', `一阶段魂灵团队上限为存活魂灵数 ${livingSpirits.length}`);
    }
    if (state.stage1AttackDisabled && input.stage1DeathTargetIds.length > 0) {
      add('death_disabled', '死神一阶段已失技，本阶段不能继续袭击');
    }
    if ((death === undefined || death.life === 'dead') && input.stage1DeathTargetIds.length > 0) {
      add('death_unavailable', '死神不存在或已死亡');
    }
  } else {
    if (input.stage1DeathTargetIds.length > 0 || input.stage1SpiritTargetIds.length > 0) {
      add('stage1_field_in_stage2', '二阶段不再分开发起袭击');
    }
    if (input.stage2JointTargetIds.length > state.ruleset.stage2JointQuota) {
      add('joint_targets_exceeded', `二阶段联合袭击最多 ${state.ruleset.stage2JointQuota} 刀`);
    }
    const anyAttackerAlive = (death !== undefined && death.life !== 'dead') || livingSpirits.length > 0;
    if (!anyAttackerAlive && input.stage2JointTargetIds.length > 0) {
      add('no_attacker_alive', '没有可行动的死神阵营成员');
    }
  }

  for (const targetId of [
    ...input.stage1DeathTargetIds,
    ...input.stage1SpiritTargetIds,
    ...input.stage2JointTargetIds,
  ]) {
    const target = byId.get(targetId);
    if (target === undefined) {
      add('unknown_target', `袭击目标 ${targetId} 不存在`);
    } else if (target.life === 'dead') {
      add('target_dead', `袭击目标 ${targetId} 已死亡`);
    }
  }

  if (input.laikeTargetId !== null) {
    const laike = state.players.find((player) => player.roleId === 'laike');
    if (laike === undefined || laike.life === 'dead') {
      add('laike_unavailable', '莱莱可不存在或已死亡');
    } else {
      const target = byId.get(input.laikeTargetId);
      if (target === undefined) {
        add('unknown_target', `刺杀目标 ${input.laikeTargetId} 不存在`);
      } else if (target.life === 'dead') {
        add('target_dead', `刺杀目标 ${input.laikeTargetId} 已死亡`);
      }
      if (state.nightStage === 1 && laike.abilities.laikeBladeUsed) {
        add('laike_blade_used', '一阶段刺杀整局限一次，已经使用');
      }
      if (state.nightStage === 2 && laike.revealed) {
        add('laike_revealed_in_stage2', '二阶段已翻牌的莱莱可没有刺杀能力');
      }
    }
  }

  return issues;
}

export function resolveAttackPhase(
  state: GameState,
  input: AttackPhaseInput,
): { state: GameState; events: GameEvent[] } {
  const issues = validateAttackPhase(state, input);
  if (issues.length > 0) {
    throw new Error(`攻击阶段行动不合法：${issues.map((issue) => issue.message).join('；')}`);
  }
  if (state.night === null) {
    throw new Error('夜晚尚未开始');
  }

  const emitter = createEmitter({
    dayNumber: state.dayNumber,
    stage: state.stage,
    startSeq: state.eventSeq,
  });

  const byId = new Map(state.players.map((player) => [player.playerId, player]));
  const seatOf = (playerId: string): number => {
    const player = byId.get(playerId);
    if (player === undefined) throw new Error(`未知玩家 ${playerId}`);
    return player.seat;
  };

  const intents: Array<{ sourceRoleId: AttackSourceRoleId; targetPlayerId: string }> = [];
  if (state.nightStage === 1) {
    for (const targetId of input.stage1DeathTargetIds) {
      intents.push({ sourceRoleId: 'death', targetPlayerId: targetId });
    }
    for (const targetId of input.stage1SpiritTargetIds) {
      intents.push({ sourceRoleId: 'spirit', targetPlayerId: targetId });
    }
  } else {
    for (const targetId of input.stage2JointTargetIds) {
      intents.push({ sourceRoleId: 'joint', targetPlayerId: targetId });
    }
  }
  if (input.laikeTargetId !== null) {
    intents.push({ sourceRoleId: 'laike', targetPlayerId: input.laikeTargetId });
  }

  const sorted = [...intents].sort(
    (left, right) =>
      seatOf(left.targetPlayerId) - seatOf(right.targetPlayerId) ||
      SOURCE_PRIORITY[left.sourceRoleId] - SOURCE_PRIORITY[right.sourceRoleId],
  );

  const guardBlocks = new Map<string, number>();
  for (const targetId of input.guardTargetIds) {
    guardBlocks.set(targetId, state.ruleset.guardBlocksPerTarget);
  }

  const lifeUpdates = new Map<string, LifeState>();
  const lifeOf = (playerId: string): LifeState => {
    const updated = lifeUpdates.get(playerId);
    if (updated !== undefined) return updated;
    const player = byId.get(playerId);
    if (player === undefined) throw new Error(`未知玩家 ${playerId}`);
    return player.life;
  };

  const attacks: AttackEvent[] = [];
  const fatalRecords = new Map<string, FatalRecord>();

  let attackSeq = 0;
  for (const intent of sorted) {
    attackSeq += 1;
    const remaining = guardBlocks.get(intent.targetPlayerId) ?? 0;
    const blocked = remaining > 0;
    if (blocked) {
      guardBlocks.set(intent.targetPlayerId, remaining - 1);
    }

    const attack: AttackEvent = {
      eventId: `n${state.dayNumber}_a${attackSeq}`,
      nightNumber: state.dayNumber,
      sourceActionId: `n${state.dayNumber}_${intent.sourceRoleId}`,
      sourceRoleId: intent.sourceRoleId,
      targetPlayerId: intent.targetPlayerId,
      orderKey: `${String(seatOf(intent.targetPlayerId)).padStart(2, '0')}:${SOURCE_PRIORITY[intent.sourceRoleId]}`,
      blocked,
    };
    attacks.push(attack);

    if (!blocked && lifeOf(intent.targetPlayerId) === 'alive') {
      lifeUpdates.set(intent.targetPlayerId, 'dying');
      fatalRecords.set(intent.targetPlayerId, {
        playerId: intent.targetPlayerId,
        nightNumber: state.dayNumber,
        primaryFatalEventId: attack.eventId,
        primaryCauseKind: 'direct_attack',
        preventedByRescue: false,
        committedAsDeath: false,
      });
    }
  }

  const door = state.players.find((player) => player.roleId === 'door' && player.life !== 'dead');
  let sacrificeTriggered = false;
  if (state.nightStage === 1 && door !== undefined) {
    const successTargets = input.guardTargetIds.filter((targetId) =>
      attacks.some((attack) => attack.targetPlayerId === targetId),
    );
    if (successTargets.length === 2) {
      sacrificeTriggered = true;
      if (lifeOf(door.playerId) === 'alive') {
        lifeUpdates.set(door.playerId, 'dying');
        fatalRecords.set(door.playerId, {
          playerId: door.playerId,
          nightNumber: state.dayNumber,
          primaryFatalEventId: null,
          primaryCauseKind: 'guard_sacrifice',
          preventedByRescue: false,
          committedAsDeath: false,
        });
      }
    }
  }

  const dyingSet = state.players
    .map((player) => player.playerId)
    .filter((playerId) => lifeOf(playerId) === 'dying')
    .sort((left, right) => seatOf(left) - seatOf(right));

  const players: PlayerState[] = state.players.map((player) => {
    let next = player;

    const life = lifeUpdates.get(player.playerId);
    if (life !== undefined) {
      next = { ...next, life };
    }

    if (player.playerId === door?.playerId && input.guardTargetIds.length > 0) {
      next = {
        ...next,
        guardHistory: [
          ...next.guardHistory,
          { nightNumber: state.dayNumber, targetPlayerIds: [...input.guardTargetIds] },
        ],
      };
    }

    if (player.roleId === 'laike' && input.laikeTargetId !== null && state.nightStage === 1) {
      next = { ...next, abilities: { ...next.abilities, laikeBladeUsed: true } };
    }

    return next;
  });

  emitter.emit(
    'attack_events',
    {
      nightNumber: state.dayNumber,
      attacks: attacks.map((attack) => ({
        eventId: attack.eventId,
        sourceRoleId: attack.sourceRoleId,
        targetPlayerId: attack.targetPlayerId,
        orderKey: attack.orderKey,
        blocked: attack.blocked,
      })),
    },
    { kind: 'server' },
  );

  if (sacrificeTriggered && door !== undefined) {
    emitter.emit(
      'guard_sacrifice',
      { nightNumber: state.dayNumber, doorId: door.playerId, targets: input.guardTargetIds },
      { kind: 'server' },
    );
  }

  if (state.nightStage === 1) {
    const viewers: string[] = [];
    const water = state.players.find((player) => player.roleId === 'water' && player.life !== 'dead');
    if (water !== undefined && !water.abilities.waterRescueUsed) {
      viewers.push(water.playerId);
    }
    const descender = state.players.find((player) => player.roleId === 'descender' && player.life !== 'dead');
    if (descender !== undefined) {
      viewers.push(descender.playerId);
    }
    if (viewers.length > 0) {
      emitter.emit(
        'dying_list',
        { nightNumber: state.dayNumber, seats: dyingSet.map((playerId) => seatOf(playerId)) },
        { kind: 'players', playerIds: viewers },
      );
    }
  }

  const night: NightContext = {
    ...state.night,
    guardSelections:
      input.guardTargetIds.length > 0
        ? [
            ...state.night.guardSelections,
            { nightNumber: state.dayNumber, targetPlayerIds: [...input.guardTargetIds] },
          ]
        : state.night.guardSelections,
    attacks,
    fatalRecords: [...fatalRecords.values()],
    dyingSet,
    sacrificeTriggered,
  };

  const { events, eventSeq } = emitter.result();
  return {
    state: { ...state, players, night, eventSeq },
    events,
  };
}

export function descenderCheckIssue(
  state: GameState,
  actorId: string,
  targetPlayerId: string,
): NightValidationIssue | null {
  if (state.phase !== 'night' || state.night === null) {
    return { code: 'night_not_started', message: '夜晚尚未开始' };
  }
  const actor = state.players.find((player) => player.playerId === actorId);
  if (actor === undefined || actor.roleId !== 'descender') {
    return { code: 'not_descender', message: '只有降临者可以执行查验' };
  }
  if (actor.life === 'dead') {
    return { code: 'descender_unavailable', message: '降临者已死亡，不能执行查验' };
  }
  if (state.night.descenderCheck !== null) {
    return { code: 'check_already_done', message: '本夜已完成查验，每晚限一次' };
  }
  const target = state.players.find((player) => player.playerId === targetPlayerId);
  if (target === undefined) {
    return { code: 'unknown_target', message: `查验目标 ${targetPlayerId} 不存在` };
  }
  if (target.life === 'dead') {
    return { code: 'target_dead', message: '查验目标已死亡' };
  }
  return null;
}

export function resolveDescenderCheck(
  state: GameState,
  actorId: string,
  targetPlayerId: string,
): { state: GameState; events: GameEvent[] } {
  const issue = descenderCheckIssue(state, actorId, targetPlayerId);
  if (issue !== null) {
    throw new Error(`查验不合法：${issue.message}`);
  }
  if (state.night === null) {
    throw new Error('夜晚尚未开始');
  }
  const target = state.players.find((player) => player.playerId === targetPlayerId);
  if (target === undefined) {
    throw new Error(`未知玩家 ${targetPlayerId}`);
  }

  const kind: CheckKind = state.nightStage === 1 ? 'is_spirit' : 'in_death_faction';
  const answer =
    kind === 'is_spirit'
      ? target.roleId === 'spirit'
      : ROLE_DEFINITIONS[target.roleId].factionId === 'death_faction';

  const emitter = createEmitter({
    dayNumber: state.dayNumber,
    stage: state.stage,
    startSeq: state.eventSeq,
  });
  emitter.emit(
    'descender_check_result',
    {
      nightNumber: state.dayNumber,
      targetPlayerId,
      targetSeat: target.seat,
      kind,
      answer,
    },
    { kind: 'players', playerIds: [actorId] },
  );

  const night: NightContext = {
    ...state.night,
    descenderCheck: { actorId, targetPlayerId, kind, answer },
  };
  const { events, eventSeq } = emitter.result();
  return { state: { ...state, night, eventSeq }, events };
}

export function rescueSelectionIssue(state: GameState, targetId: string): NightValidationIssue | null {
  if (state.phase !== 'night' || state.night === null) {
    return { code: 'night_not_started', message: '夜晚尚未开始' };
  }
  if (state.nightStage !== 1) {
    return { code: 'rescue_wrong_stage', message: '二阶段不使用还魂曲' };
  }
  const water = state.players.find((player) => player.roleId === 'water');
  if (water === undefined || water.life === 'dead') {
    return { code: 'water_unavailable', message: '水妖不存在或已死亡' };
  }
  if (water.abilities.waterRescueUsed) {
    return { code: 'rescue_used', message: '还魂曲整局限一次，已经使用' };
  }
  if (targetId === water.playerId) {
    return { code: 'rescue_self_forbidden', message: '还魂曲不能救自己' };
  }
  if (!state.night.dyingSet.includes(targetId)) {
    return { code: 'target_not_dying', message: '目标不在本夜濒死名单内' };
  }
  return null;
}

export function resolveRescue(
  state: GameState,
  targetId: string | null,
): { state: GameState; events: GameEvent[] } {
  if (state.night === null) {
    throw new Error('夜晚尚未开始');
  }

  const emitter = createEmitter({
    dayNumber: state.dayNumber,
    stage: state.stage,
    startSeq: state.eventSeq,
  });

  if (targetId === null) {
    emitter.emit(
      'rescue_declined',
      { nightNumber: state.dayNumber },
      { kind: 'server' },
    );
    const { events, eventSeq } = emitter.result();
    return { state: { ...state, eventSeq }, events };
  }

  const issue = rescueSelectionIssue(state, targetId);
  if (issue !== null) {
    throw new Error(`还魂曲选择不合法：${issue.message}`);
  }

  const water = state.players.find((player) => player.roleId === 'water');
  if (water === undefined) {
    throw new Error('水妖不存在');
  }

  const players: PlayerState[] = state.players.map((player) => {
    if (player.playerId === targetId) {
      return { ...player, life: 'alive' as LifeState };
    }
    if (player.playerId === water.playerId) {
      return { ...player, abilities: { ...player.abilities, waterRescueUsed: true } };
    }
    return player;
  });

  const fatalRecords = state.night.fatalRecords.map((record) =>
    record.playerId === targetId
      ? { ...record, preventedByRescue: true, committedAsDeath: false }
      : record,
  );

  const night: NightContext = {
    ...state.night,
    rescue: { targetPlayerId: targetId },
    fatalRecords,
  };

  emitter.emit(
    'rescue_applied',
    { nightNumber: state.dayNumber, targetPlayerId: targetId },
    { kind: 'players', playerIds: [water.playerId, targetId] },
  );

  const { events, eventSeq } = emitter.result();
  return { state: { ...state, players, night, eventSeq }, events };
}

export function resolveNightEnd(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'night' || state.night === null) {
    throw new Error('夜晚尚未开始，不能进行夜末确认');
  }

  const emitter = createEmitter({
    dayNumber: state.dayNumber,
    stage: state.stage,
    startSeq: state.eventSeq,
  });

  const seatOf = new Map(state.players.map((player) => [player.playerId, player.seat]));
  const deaths = state.players
    .filter((player) => player.life === 'dying')
    .map((player) => player.playerId)
    .sort((left, right) => (seatOf.get(left) ?? 0) - (seatOf.get(right) ?? 0));

  const players: PlayerState[] = state.players.map((player) =>
    player.life === 'dying'
      ? {
          ...player,
          life: 'dead' as LifeState,
          lastFatalCause:
            state.night?.fatalRecords.find((record) => record.playerId === player.playerId)
              ?.primaryCauseKind ?? null,
        }
      : player,
  );

  const fatalRecords = state.night.fatalRecords.map((record) => ({
    ...record,
    committedAsDeath: deaths.includes(record.playerId),
  }));

  let stage1AttackDisabled = state.stage1AttackDisabled;
  if (state.nightStage === 1 && !stage1AttackDisabled) {
    const attackedByFaction = new Set(
      state.night.attacks
        .filter((attack) => attack.sourceRoleId === 'death' || attack.sourceRoleId === 'spirit')
        .map((attack) => attack.targetPlayerId),
    );
    const overlap = deaths.filter((playerId) => attackedByFaction.has(playerId)).length;
    const threshold = state.ruleset.roles.spirit;
    if (overlap > threshold) {
      stage1AttackDisabled = true;
      emitter.emit(
        'stage1_attack_disabled',
        { nightNumber: state.dayNumber, overlap, threshold },
        { kind: 'server' },
      );
    }
  }

  emitter.emit(
    'night_deaths_confirmed',
    {
      nightNumber: state.dayNumber,
      deaths: deaths.map((playerId) => ({ playerId, seat: seatOf.get(playerId) ?? 0 })),
    },
    { kind: 'server' },
  );

  const night: NightContext = { ...state.night, fatalRecords, deaths };
  const { events, eventSeq } = emitter.result();

  return {
    state: {
      ...state,
      players,
      night,
      stage1AttackDisabled,
      phase: 'morning' as GamePhase,
      eventSeq,
    },
    events,
  };
}

function samePlayerSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((playerId) => rightSet.has(playerId));
}
