import { describe, expect, it } from 'vitest';
import { resolveMorning, reviveSelectionIssue, selectReviveTarget } from '../engine/morning.ts';
import { resolveAttackPhase, startNight } from '../engine/night.ts';
import type { GameState } from '../engine/types.ts';
import { checkVictory } from '../engine/victory.ts';
import { overrideLife, overridePlayer, runNight, scenario } from './helpers.ts';

function stage2(state: GameState): GameState {
  return { ...state, stage: 2, nightStage: 2 };
}

function killPlayers(state: GameState, playerIds: readonly string[]): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      playerIds.includes(player.playerId) ? { ...player, life: 'dead' as const } : player,
    ),
  };
}

describe('晨间结算（R-33、R-12、R-23）', () => {
  it('T-12：门先生仅因双守牺牲死亡时，转阶段立即回归且不重复', () => {
    const morning = runNight(scenario(), {
      guardTargetIds: ['p_6', 'p_7'],
      stage1DeathTargetIds: ['p_6', 'p_7'],
      stage1SpiritTargetIds: ['p_5'],
    });
    const doorBefore = morning.players.find((player) => player.roleId === 'door');
    expect(doorBefore?.life).toBe('dead');
    expect(doorBefore?.lastFatalCause).toBe('guard_sacrifice');

    const result = resolveMorning(morning);
    expect(result.state.stage).toBe(2);
    const doorAfter = result.state.players.find((player) => player.roleId === 'door');
    expect(doorAfter?.life).toBe('alive');
    expect(doorAfter?.lastFatalCause).toBeNull();
    expect(result.events.find((event) => event.type === 'door_returned')).toBeDefined();
  });

  it('门先生先被直接攻击致死时，转阶段不回归', () => {
    const morning = runNight(scenario(), {
      stage1DeathTargetIds: ['p_2', 'p_5'],
      stage1SpiritTargetIds: ['p_8'],
    });
    expect(morning.players.find((player) => player.roleId === 'door')?.lastFatalCause).toBe(
      'direct_attack',
    );

    const result = resolveMorning(morning);
    expect(result.state.stage).toBe(2);
    expect(result.state.players.find((player) => player.roleId === 'door')?.life).toBe('dead');
    expect(result.events.find((event) => event.type === 'door_returned')).toBeUndefined();
  });

  it('T-24：一阶段末夜水妖死亡不追溯触发回归选择', () => {
    const morning = runNight(scenario(), {
      stage1DeathTargetIds: ['p_3', 'p_5'],
    });
    expect(reviveSelectionIssue(morning, 'p_6')?.code).toBe('stage1_no_revive');

    const result = resolveMorning(morning);
    expect(result.state.stage).toBe(2);
    expect(result.state.players.find((player) => player.roleId === 'water')?.life).toBe('dead');
    expect(result.events.find((event) => event.type === 'revive_announced')).toBeUndefined();
  });

  it('T-22 / T-26：二阶段水妖回归救回科研员后，死神胜利前置不成立且阶段保持二', () => {
    const base = killPlayers(stage2(scenario()), ['p_6', 'p_7', 'p_8', 'p_9']);
    const morning = runNight(base, { stage2JointTargetIds: ['p_3', 'p_5'] });
    expect(morning.night?.deaths).toEqual(['p_3', 'p_5']);

    const selected = selectReviveTarget(morning, 'p_5');
    expect(selected.events.find((event) => event.type === 'revive_selected')).toBeDefined();

    const result = resolveMorning(selected.state);
    expect(result.state.players.find((player) => player.playerId === 'p_5')?.life).toBe('alive');
    expect(result.state.win).toBeNull();
    expect(result.state.stage).toBe(2);
    expect(result.state.phase).toBe('day');

    const reviveEvent = result.events.find((event) => event.type === 'revive_announced');
    expect(reviveEvent?.payload).toEqual({ nightNumber: 1, byWaterSeat: 3, targetSeat: 5 });
  });

  it('回归选择校验：不能选自己、不能选活人、未知目标拒绝', () => {
    const base = killPlayers(stage2(scenario()), ['p_6', 'p_7', 'p_8', 'p_9']);
    const morning = runNight(base, { stage2JointTargetIds: ['p_3', 'p_5'] });
    expect(reviveSelectionIssue(morning, 'p_3')?.code).toBe('revive_self_forbidden');
    expect(reviveSelectionIssue(morning, 'p_1')?.code).toBe('target_not_dead');
    expect(reviveSelectionIssue(morning, 'nope')?.code).toBe('unknown_target');
  });

  it('T-23：水妖不是本夜死亡时没有回归窗口（含白天死亡情形）', () => {
    const morning = runNight(stage2(scenario()), { stage2JointTargetIds: ['p_6'] });
    const simulatedDayDeath = overrideLife(morning, 'p_3', 'dead');
    expect(reviveSelectionIssue(simulatedDayDeath, 'p_6')?.code).toBe('water_not_dead_at_night');
  });

  it('T-35：夜间不提前判胜负，晨间结算才判定且只产生一个结果事件', () => {
    const base = killPlayers(scenario(), ['p_6', 'p_7', 'p_8', 'p_9']);
    const morning = runNight(base, { stage1DeathTargetIds: ['p_5'] });
    expect(morning.win).toBeNull();
    expect(morning.phase).toBe('morning');

    const result = resolveMorning(morning);
    expect(result.state.win?.winner).toBe('death_faction');
    expect(result.state.phase).toBe('ended');
    expect(result.events.filter((event) => event.type === 'game_ended')).toHaveLength(1);
  });

  it('T-25：科研员夜间濒死后被还魂曲救回，不翻牌也不触发阶段转换', () => {
    const morning = runNight(scenario(), { stage1DeathTargetIds: ['p_5'] }, 'p_5');
    const result = resolveMorning(morning);
    expect(result.state.players.find((player) => player.roleId === 'researcher')?.revealed).toBe(
      false,
    );
    expect(result.state.stage).toBe(1);
    expect(result.events.find((event) => event.type === 'stage_changed')).toBeUndefined();
    expect(result.events.find((event) => event.type === 'researcher_announcement')).toBeUndefined();
  });

  it('T-45：科研员公告为公告时点存活数且包含丧亲者，整局限一次', () => {
    const first = resolveMorning(runNight(scenario(), { stage1DeathTargetIds: ['p_5'] }));
    const firstPayload = first.events.find((event) => event.type === 'researcher_announcement')
      ?.payload as { count: number };
    expect(firstPayload.count).toBe(4);

    const base = overrideLife(scenario(), 'p_12', 'dead');
    const second = resolveMorning(runNight(base, { stage1DeathTargetIds: ['p_5'] }));
    const secondPayload = second.events.find((event) => event.type === 'researcher_announcement')
      ?.payload as { count: number };
    expect(secondPayload.count).toBe(3);

    const alreadyRevealed = overridePlayer(
      runNight(scenario(), { stage1DeathTargetIds: ['p_5'] }),
      'p_5',
      { revealed: true },
    );
    const third = resolveMorning(alreadyRevealed);
    expect(third.events.find((event) => event.type === 'researcher_announcement')).toBeUndefined();
  });

  it('常规晨间：死亡公告、无阶段转换、进入白天', () => {
    const morning = runNight(scenario(), { stage1DeathTargetIds: ['p_6'] });
    const result = resolveMorning(morning);
    expect(result.state.phase).toBe('day');
    expect(result.state.win).toBeNull();
    const deathsEvent = result.events.find((event) => event.type === 'deaths_announced');
    expect(deathsEvent?.payload).toEqual({ nightNumber: 1, seats: [6] });
  });

  it('晨间结算防误：阶段不对直接抛错', () => {
    expect(() => resolveMorning(scenario())).toThrow();
    expect(() => resolveMorning({ ...scenario(), phase: 'day' })).toThrow();
  });
});

describe('跨夜刷新与名单视野（T-21）', () => {
  it('水妖使用还魂曲后，下一夜不再获得濒死名单', () => {
    const base = overridePlayer(scenario(), 'p_3', {
      abilities: { laikeBladeUsed: false, waterRescueUsed: true },
    });
    const night2: GameState = { ...base, dayNumber: 2 };
    const started = startNight(night2).state;
    const result = resolveAttackPhase(started, {
      guardTargetIds: [],
      stage1DeathTargetIds: ['p_6'],
      stage1SpiritTargetIds: [],
      stage2JointTargetIds: [],
      laikeTargetId: null,
    });
    expect(result.events.find((event) => event.type === 'dying_list')?.visibility).toEqual({
      kind: 'players',
      playerIds: ['p_4'],
    });
  });
});

describe('胜负判定（R-02、R-03、R-04）', () => {
  it('T-27：双方同时满足时死神阵营优先', () => {
    const state = killPlayers(scenario(), [
      'p_1',
      'p_2',
      'p_3',
      'p_4',
      'p_5',
      'p_6',
      'p_7',
      'p_8',
      'p_9',
      'p_10',
      'p_11',
      'p_12',
    ]);
    expect(checkVictory(state)?.winner).toBe('death_faction');
  });

  it('T-28：仅丧亲者存活时人类获胜，不要求淘汰丧亲者', () => {
    const state = killPlayers(scenario(), ['p_10', 'p_11', 'p_12']);
    expect(checkVictory(state)?.winner).toBe('human');
  });

  it('科研员回归后死神胜利前置不成立', () => {
    const oneSideDead = killPlayers(scenario(), ['p_6', 'p_7', 'p_8', 'p_9']);
    expect(checkVictory(oneSideDead)).toBeNull();

    const researcherDead = killPlayers(oneSideDead, ['p_5']);
    expect(checkVictory(researcherDead)?.winner).toBe('death_faction');
  });

  it('未满足条件时对局继续', () => {
    expect(checkVictory(scenario())).toBeNull();
  });
});
