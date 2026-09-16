import { describe, expect, it } from 'vitest';
import {
  rescueSelectionIssue,
  resolveAttackPhase,
  resolveNightEnd,
  resolveRescue,
  startNight,
  validateAttackPhase,
  type AttackPhaseInput,
} from '../engine/night.ts';
import type { GameState, GuardRecord } from '../engine/types.ts';
import { DEFAULT_SEATS, overrideLife, overridePlayer, scenario } from './helpers.ts';

function startedNight(seatRoles = DEFAULT_SEATS): GameState {
  return startNight(scenario(seatRoles)).state;
}

function attackInput(overrides: Partial<AttackPhaseInput> = {}): AttackPhaseInput {
  return {
    guardTargetIds: [],
    stage1DeathTargetIds: [],
    stage1SpiritTargetIds: [],
    stage2JointTargetIds: [],
    laikeTargetId: null,
    ...overrides,
  };
}

function issueCodes(state: GameState, input: AttackPhaseInput): string[] {
  return validateAttackPhase(state, input).map((issue) => issue.code);
}

function stage2(state: GameState): GameState {
  return { ...state, stage: 2, nightStage: 2 };
}

describe('夜晚攻击阶段：配额与目标范围（R-27–R-30、R-48、R-49）', () => {
  it('T-03：一阶段 2 名魂灵存活时共享上限 2 刀，3 刀拒绝', () => {
    const state = startedNight();
    expect(issueCodes(state, attackInput({ stage1SpiritTargetIds: ['p_6', 'p_7'] }))).toEqual([]);
    expect(
      issueCodes(state, attackInput({ stage1SpiritTargetIds: ['p_6', 'p_7', 'p_8'] })),
    ).toContain('spirit_targets_exceeded');
  });

  it('T-04：一阶段仅 1 名魂灵存活时上限 1', () => {
    const state = overrideLife(startedNight(), 'p_12', 'dead');
    expect(issueCodes(state, attackInput({ stage1SpiritTargetIds: ['p_6'] }))).toEqual([]);
    expect(
      issueCodes(state, attackInput({ stage1SpiritTargetIds: ['p_6', 'p_7'] })),
    ).toContain('spirit_targets_exceeded');
  });

  it('死神一阶段上限 2；二阶段联合上限 2', () => {
    const state = startedNight();
    expect(issueCodes(state, attackInput({ stage1DeathTargetIds: ['p_6', 'p_7'] }))).toEqual([]);
    expect(
      issueCodes(state, attackInput({ stage1DeathTargetIds: ['p_6', 'p_7', 'p_8'] })),
    ).toContain('death_targets_exceeded');

    const state2 = stage2(startedNight());
    expect(issueCodes(state2, attackInput({ stage2JointTargetIds: ['p_6', 'p_7'] }))).toEqual([]);
    expect(
      issueCodes(state2, attackInput({ stage2JointTargetIds: ['p_6', 'p_7', 'p_8'] })),
    ).toContain('joint_targets_exceeded');
  });

  it('T-36：一阶段 2 魂灵存活且死神未失技 → 共 4 个攻击名额，不强制用满', () => {
    const state = startedNight();
    const four = attackInput({
      stage1DeathTargetIds: ['p_6', 'p_7'],
      stage1SpiritTargetIds: ['p_8', 'p_9'],
    });
    expect(issueCodes(state, four)).toEqual([]);

    const resolved = resolveAttackPhase(state, four).state;
    for (const targetId of ['p_6', 'p_7', 'p_8', 'p_9']) {
      expect(resolved.players.find((player) => player.playerId === targetId)?.life).toBe('dying');
    }

    expect(issueCodes(state, attackInput({ stage1DeathTargetIds: ['p_6'] }))).toEqual([]);
    expect(
      issueCodes(
        state,
        attackInput({
          stage1DeathTargetIds: ['p_6', 'p_7', 'p_8'],
          stage1SpiritTargetIds: ['p_9'],
        }),
      ),
    ).toContain('death_targets_exceeded');
  });

  it('T-44：攻击类目标可以是任意存活玩家，包含自己与队友', () => {
    const state = startedNight();
    expect(issueCodes(state, attackInput({ stage1DeathTargetIds: ['p_10'] }))).toEqual([]);
    expect(issueCodes(state, attackInput({ laikeTargetId: 'p_1' }))).toEqual([]);
    expect(issueCodes(state, attackInput({ stage1SpiritTargetIds: ['p_11'] }))).toEqual([]);
  });

  it('已死亡玩家不能作为攻击目标', () => {
    const state = overrideLife(startedNight(), 'p_6', 'dead');
    expect(issueCodes(state, attackInput({ stage1DeathTargetIds: ['p_6'] }))).toContain('target_dead');
  });

  it('R-48：袭击事件按目标座位升序，同目标按来源优先级（魂灵 → 死神 → 莱莱可）', () => {
    const result = resolveAttackPhase(
      startedNight(),
      attackInput({
        stage1DeathTargetIds: ['p_7'],
        stage1SpiritTargetIds: ['p_6', 'p_6'],
        laikeTargetId: 'p_6',
      }),
    );
    expect(result.state.night?.attacks.map((attack) => [attack.targetPlayerId, attack.sourceRoleId])).toEqual([
      ['p_6', 'spirit'],
      ['p_6', 'spirit'],
      ['p_6', 'laike'],
      ['p_7', 'death'],
    ]);
  });
});

describe('守护与牺牲（R-16–R-19）', () => {
  it('T-09：守护目标受 1 刀被挡存活；受 2 刀被挡一刀后仍濒死', () => {
    const one = resolveAttackPhase(
      startedNight(),
      attackInput({ guardTargetIds: ['p_6'], stage1DeathTargetIds: ['p_6'] }),
    ).state;
    expect(one.players.find((player) => player.playerId === 'p_6')?.life).toBe('alive');
    expect(one.night?.attacks[0]?.blocked).toBe(true);

    const two = resolveAttackPhase(
      startedNight(),
      attackInput({ guardTargetIds: ['p_6'], stage1DeathTargetIds: ['p_6', 'p_6'] }),
    ).state;
    expect(two.players.find((player) => player.playerId === 'p_6')?.life).toBe('dying');
    expect(two.night?.attacks.map((attack) => attack.blocked)).toEqual([true, false]);
  });

  it('T-10：一阶段守护两个目标均受攻击触发牺牲；二阶段不牺牲', () => {
    const stage1Result = resolveAttackPhase(
      startedNight(),
      attackInput({
        guardTargetIds: ['p_6', 'p_7'],
        stage1DeathTargetIds: ['p_6'],
        stage1SpiritTargetIds: ['p_7'],
      }),
    ).state;
    expect(stage1Result.night?.sacrificeTriggered).toBe(true);
    expect(stage1Result.players.find((player) => player.roleId === 'door')?.life).toBe('dying');
    expect(
      stage1Result.night?.fatalRecords.find((record) => record.playerId === 'p_2')?.primaryCauseKind,
    ).toBe('guard_sacrifice');

    const stage2Result = resolveAttackPhase(
      stage2(startedNight()),
      attackInput({
        guardTargetIds: ['p_6', 'p_7'],
        stage2JointTargetIds: ['p_6', 'p_7'],
      }),
    ).state;
    expect(stage2Result.night?.sacrificeTriggered).toBe(false);
  });

  it('T-11：门先生先被直接攻击致濒死时，双守成功不改主死因', () => {
    const state = resolveAttackPhase(
      startedNight(),
      attackInput({
        guardTargetIds: ['p_6', 'p_7'],
        stage1DeathTargetIds: ['p_2', 'p_6'],
        stage1SpiritTargetIds: ['p_7'],
      }),
    ).state;
    expect(state.night?.sacrificeTriggered).toBe(true);
    const record = state.night?.fatalRecords.find((item) => item.playerId === 'p_2');
    expect(record?.primaryCauseKind).toBe('direct_attack');
    expect(record?.primaryFatalEventId).not.toBeNull();
  });

  it('T-13：同目标多刀只认首个有效主死因', () => {
    const state = resolveAttackPhase(
      startedNight(),
      attackInput({
        stage1DeathTargetIds: ['p_6', 'p_6'],
        stage1SpiritTargetIds: ['p_6'],
      }),
    ).state;
    const attacks = state.night?.attacks ?? [];
    expect(attacks.map((attack) => attack.blocked)).toEqual([false, false, false]);
    const record = state.night?.fatalRecords.find((item) => item.playerId === 'p_6');
    expect(record?.primaryFatalEventId).toBe(attacks[0]?.eventId);
  });

  it('T-14：不能连续两晚守护同一对（顺序无关）；不能连续三晚守同一人；死亡中断后重置', () => {
    const base = startedNight();
    const withHistory = (history: GuardRecord[], dayNumber: number): GameState => ({
      ...base,
      dayNumber,
      players: base.players.map((player) =>
        player.playerId === 'p_2' ? { ...player, guardHistory: history } : player,
      ),
    });

    const pair = withHistory(
      [
        { nightNumber: 1, targetPlayerIds: ['p_6', 'p_7'] },
        { nightNumber: 2, targetPlayerIds: ['p_6', 'p_7'] },
      ],
      3,
    );
    expect(issueCodes(pair, attackInput({ guardTargetIds: ['p_7', 'p_6'] }))).toContain(
      'guard_same_pair_consecutive',
    );

    const single = withHistory(
      [
        { nightNumber: 1, targetPlayerIds: ['p_6'] },
        { nightNumber: 2, targetPlayerIds: ['p_6'] },
      ],
      3,
    );
    expect(issueCodes(single, attackInput({ guardTargetIds: ['p_6'] }))).toContain(
      'guard_same_target_three_nights',
    );

    const interrupted = withHistory(
      [
        { nightNumber: 1, targetPlayerIds: ['p_6'] },
        { nightNumber: 2, targetPlayerIds: ['p_6'] },
      ],
      4,
    );
    expect(issueCodes(interrupted, attackInput({ guardTargetIds: ['p_6'] }))).toEqual([]);
  });

  it('守护历史逐夜记录，空守不记录', () => {
    const guarded = resolveAttackPhase(
      startedNight(),
      attackInput({ guardTargetIds: ['p_6', 'p_7'] }),
    ).state;
    expect(guarded.players.find((player) => player.roleId === 'door')?.guardHistory).toEqual([
      { nightNumber: 1, targetPlayerIds: ['p_6', 'p_7'] },
    ]);

    const empty = resolveAttackPhase(startedNight(), attackInput()).state;
    expect(empty.players.find((player) => player.roleId === 'door')?.guardHistory).toEqual([]);
  });
});

describe('莱莱可（R-15）', () => {
  it('T-15：莱莱可濒死仍可完成本夜刺杀', () => {
    const state = overrideLife(startedNight(), 'p_1', 'dying');
    expect(issueCodes(state, attackInput({ laikeTargetId: 'p_6' }))).toEqual([]);
    const resolved = resolveAttackPhase(state, attackInput({ laikeTargetId: 'p_6' })).state;
    expect(
      resolved.players.find((player) => player.playerId === 'p_1')?.abilities.laikeBladeUsed,
    ).toBe(true);
  });

  it('T-16：一阶段使用后不再可用；二阶段由翻牌分支决定刺杀能力', () => {
    const used = overridePlayer(startedNight(), 'p_1', {
      abilities: { laikeBladeUsed: true, waterRescueUsed: false },
    });
    expect(issueCodes(used, attackInput({ laikeTargetId: 'p_6' }))).toContain('laike_blade_used');

    const revealedStage2 = stage2(overridePlayer(startedNight(), 'p_1', { revealed: true }));
    expect(issueCodes(revealedStage2, attackInput({ laikeTargetId: 'p_6' }))).toContain(
      'laike_revealed_in_stage2',
    );

    expect(issueCodes(stage2(startedNight()), attackInput({ laikeTargetId: 'p_6' }))).toEqual([]);
  });

  it('T-17：二阶段未翻牌莱莱可每晚可刺杀，跨夜保留使用记录不设限', () => {
    const usedPreviousNight = stage2(
      overridePlayer(startedNight(), 'p_1', {
        abilities: { laikeBladeUsed: true, waterRescueUsed: false },
      }),
    );
    expect(issueCodes(usedPreviousNight, attackInput({ laikeTargetId: 'p_6' }))).toEqual([]);

    const resolved = resolveAttackPhase(
      usedPreviousNight,
      attackInput({ laikeTargetId: 'p_6' }),
    ).state;
    expect(resolved.players.find((player) => player.playerId === 'p_6')?.life).toBe('dying');
  });
});

describe('死神失技（R-28、R-29）', () => {
  it('T-05 / T-07：命中 3 个不同人全部死亡且开局魂灵 2 → 失技，多刀同目标按人去重', () => {
    const attacked = resolveAttackPhase(
      startedNight(),
      attackInput({
        stage1DeathTargetIds: ['p_6', 'p_6'],
        stage1SpiritTargetIds: ['p_7', 'p_8'],
      }),
    ).state;
    const ended = resolveNightEnd(resolveRescue(attacked, null).state).state;
    expect(ended.night?.deaths).toEqual(['p_6', 'p_7', 'p_8']);
    expect(ended.stage1AttackDisabled).toBe(true);
  });

  it('T-06：守护或还魂曲后实际死亡不超过阈值 → 不失技', () => {
    const guarded = resolveAttackPhase(
      startedNight(),
      attackInput({
        guardTargetIds: ['p_6', 'p_7'],
        stage1DeathTargetIds: ['p_6', 'p_7'],
        stage1SpiritTargetIds: ['p_8'],
      }),
    ).state;
    const ended = resolveNightEnd(resolveRescue(guarded, null).state).state;
    expect(ended.night?.deaths).toEqual(['p_2', 'p_8']);
    expect(ended.stage1AttackDisabled).toBe(false);

    const attacked = resolveAttackPhase(
      startedNight(),
      attackInput({
        stage1DeathTargetIds: ['p_6'],
        stage1SpiritTargetIds: ['p_7', 'p_8'],
      }),
    ).state;
    const rescued = resolveRescue(attacked, 'p_6').state;
    const ended2 = resolveNightEnd(rescued).state;
    expect(ended2.night?.deaths).toEqual(['p_7', 'p_8']);
    expect(ended2.stage1AttackDisabled).toBe(false);
  });

  it('失技后一阶段死神不能再出刀，魂灵不受影响；二阶段不受标记限制', () => {
    const disabled = { ...startedNight(), stage1AttackDisabled: true };
    expect(issueCodes(disabled, attackInput({ stage1DeathTargetIds: ['p_6'] }))).toContain('death_disabled');
    expect(issueCodes(disabled, attackInput({ stage1SpiritTargetIds: ['p_6'] }))).toEqual([]);

    const disabledStage2 = stage2(disabled);
    expect(issueCodes(disabledStage2, attackInput({ stage2JointTargetIds: ['p_6'] }))).toEqual([]);
  });
});

describe('还魂曲（R-20、R-21）', () => {
  it('T-19：不能救名单外的人', () => {
    const state = resolveAttackPhase(
      startedNight(),
      attackInput({ stage1DeathTargetIds: ['p_6'] }),
    ).state;
    expect(rescueSelectionIssue(state, 'p_7')?.code).toBe('target_not_dying');
  });

  it('T-20：还魂曲救濒死者免于本夜死亡，不形成死亡记录', () => {
    const attacked = resolveAttackPhase(
      startedNight(),
      attackInput({ stage1DeathTargetIds: ['p_6'] }),
    ).state;
    const rescued = resolveRescue(attacked, 'p_6').state;
    expect(rescued.players.find((player) => player.playerId === 'p_6')?.life).toBe('alive');
    expect(
      rescued.night?.fatalRecords.find((record) => record.playerId === 'p_6')?.preventedByRescue,
    ).toBe(true);
    expect(rescued.players.find((player) => player.roleId === 'water')?.abilities.waterRescueUsed).toBe(true);

    const ended = resolveNightEnd(rescued).state;
    expect(ended.night?.deaths).toEqual([]);
  });

  it('水妖不能救自己；已使用后不能再用；空行动确认不消耗技能', () => {
    const attacked = resolveAttackPhase(
      startedNight(),
      attackInput({ stage1DeathTargetIds: ['p_3'] }),
    ).state;
    expect(rescueSelectionIssue(attacked, 'p_3')?.code).toBe('rescue_self_forbidden');

    const used = overridePlayer(attacked, 'p_3', {
      abilities: { laikeBladeUsed: false, waterRescueUsed: true },
    });
    expect(rescueSelectionIssue(used, 'p_3')?.code).toBe('rescue_used');

    const declined = resolveRescue(attacked, null).state;
    expect(declined.players.find((player) => player.roleId === 'water')?.abilities.waterRescueUsed).toBe(
      false,
    );
  });

  it('T-34：守护目标被挡后不进入濒死名单，不能成为还魂曲目标', () => {
    const attacked = resolveAttackPhase(
      startedNight(),
      attackInput({
        guardTargetIds: ['p_1', 'p_6'],
        stage1SpiritTargetIds: ['p_1'],
        stage1DeathTargetIds: ['p_6', 'p_7'],
      }),
    ).state;
    expect(attacked.night?.dyingSet).toEqual(['p_2', 'p_7']);
    expect(rescueSelectionIssue(attacked, 'p_1')?.code).toBe('target_not_dying');
    expect(rescueSelectionIssue(attacked, 'p_7')).toBeNull();
  });
});

describe('信息可见性与夜末确认（R-33、R-41）', () => {
  it('濒死名单只发给一阶段未用技能的水妖与降临者；二阶段不发', () => {
    const result = resolveAttackPhase(
      startedNight(),
      attackInput({ stage1DeathTargetIds: ['p_6'] }),
    );
    expect(result.events.find((event) => event.type === 'dying_list')?.visibility).toEqual({
      kind: 'players',
      playerIds: ['p_3', 'p_4'],
    });

    const waterUsed = overridePlayer(startedNight(), 'p_3', {
      abilities: { laikeBladeUsed: false, waterRescueUsed: true },
    });
    const second = resolveAttackPhase(waterUsed, attackInput({ stage1DeathTargetIds: ['p_6'] }));
    expect(second.events.find((event) => event.type === 'dying_list')?.visibility).toEqual({
      kind: 'players',
      playerIds: ['p_4'],
    });

    const third = resolveAttackPhase(
      stage2(startedNight()),
      attackInput({ stage2JointTargetIds: ['p_6'] }),
    );
    expect(third.events.find((event) => event.type === 'dying_list')).toBeUndefined();
  });

  it('攻击事实是服务端事件，不直接广播', () => {
    const result = resolveAttackPhase(
      startedNight(),
      attackInput({ stage1DeathTargetIds: ['p_6'] }),
    );
    expect(result.events.find((event) => event.type === 'attack_events')?.visibility).toEqual({
      kind: 'server',
    });
  });

  it('夜末确认：濒死统一转为死亡并进入 morning', () => {
    const attacked = resolveAttackPhase(
      startedNight(),
      attackInput({ stage1DeathTargetIds: ['p_6'] }),
    ).state;
    const ended = resolveNightEnd(resolveRescue(attacked, null).state).state;
    expect(ended.phase).toBe('morning');
    expect(ended.players.find((player) => player.playerId === 'p_6')?.life).toBe('dead');
    expect(
      ended.night?.fatalRecords.find((record) => record.playerId === 'p_6')?.committedAsDeath,
    ).toBe(true);
  });

  it('未开夜或非法行动直接抛错，不产生部分结算', () => {
    const base = scenario();
    expect(() => resolveAttackPhase(base, attackInput())).toThrow();
    const state = startedNight();
    expect(() =>
      resolveAttackPhase(state, attackInput({ stage1DeathTargetIds: ['p_6', 'p_7', 'p_8'] })),
    ).toThrow();
    expect(() => resolveRescue(state, 'p_6')).toThrow();
  });
});
