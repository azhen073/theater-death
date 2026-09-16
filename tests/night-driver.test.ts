import { describe, expect, it } from 'vitest';
import type { GameState } from '../engine/types.ts';
import { createFakeClock } from '../server/clock.ts';
import { createNightDriver, type NightStepResult } from '../server/night-driver.ts';
import { overrideLife, scenario } from './helpers.ts';

function setup(state: GameState = scenario()) {
  const clock = createFakeClock();
  const steps: NightStepResult[] = [];
  const driver = createNightDriver({
    clock,
    onStep: (result) => steps.push(result),
  });
  driver.start(state);
  return { clock, driver, steps };
}

function lastState(steps: NightStepResult[]): GameState {
  return steps[steps.length - 1].state;
}

function allEvents(steps: NightStepResult[]) {
  return steps.flatMap((step) => step.events);
}

describe('夜间驱动：一阶段完整流程', () => {
  it('段一行动 → 攻击结算 → 段二救回 → 晨间进入白天', () => {
    const { clock, driver, steps } = setup();

    expect(
      driver.submit({ type: 'SUBMIT_GUARD', playerId: 'p_2', targetIds: ['p_6'] }).accepted,
    ).toBe(true);
    expect(driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_10', targets: ['p_5'] }).accepted).toBe(
      true,
    );
    expect(driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_11', targets: ['p_6'] }).accepted).toBe(
      true,
    );
    expect(driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 1 }).accepted).toBe(
      true,
    );
    expect(driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_12', revision: 1 }).accepted).toBe(
      true,
    );
    expect(driver.submit({ type: 'SUBMIT_LAIKE', playerId: 'p_1', targetId: null }).accepted).toBe(
      true,
    );

    clock.advance(90_000);

    expect(driver.windows().map((window) => window.id)).toEqual(['check', 'rescue']);
    expect(driver.submit({ type: 'SUBMIT_CHECK', playerId: 'p_4', targetId: 'p_11' }).accepted).toBe(
      true,
    );
    expect(driver.submit({ type: 'SUBMIT_RESCUE', playerId: 'p_3', targetId: 'p_5' }).accepted).toBe(
      true,
    );

    clock.advance(45_000);

    const final = lastState(steps);
    expect(final.phase).toBe('day');
    expect(driver.done()).toBe(true);
    expect(final.night?.deaths).toEqual([]);
    expect(final.players.find((player) => player.playerId === 'p_5')?.life).toBe('alive');
    expect(final.players.find((player) => player.playerId === 'p_6')?.life).toBe('alive');

    const events = allEvents(steps);
    expect(events.some((event) => event.type === 'attack_events')).toBe(true);
    expect(events.some((event) => event.type === 'dying_list')).toBe(true);
    expect(events.some((event) => event.type === 'descender_check_result')).toBe(true);
    expect(events.some((event) => event.type === 'rescue_applied')).toBe(true);
    expect(events.some((event) => event.type === 'night_deaths_confirmed')).toBe(true);
  });

  it('超时空行动：不提交也按时推进，全员无动作过夜', () => {
    const { clock, driver, steps } = setup();
    clock.advance(90_000);
    clock.advance(45_000);

    const final = lastState(steps);
    expect(final.phase).toBe('day');
    expect(final.night?.deaths).toEqual([]);
    expect(final.night?.attacks).toEqual([]);
    expect(driver.done()).toBe(true);
  });

  it('窗口时限：守护 45s 截止后拒绝，阵营 90s 内有效，过期即拒绝', () => {
    const { clock, driver } = setup();
    clock.advance(45_000);
    expect(
      driver.submit({ type: 'SUBMIT_GUARD', playerId: 'p_2', targetIds: ['p_6'] }).code,
    ).toBe('window_closed');
    expect(driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_10', targets: ['p_5'] }).accepted).toBe(
      true,
    );

    clock.advance(45_000);
    expect(driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_11', targets: ['p_6'] }).code).toBe(
      'window_not_open',
    );
    expect(driver.submit({ type: 'SUBMIT_LAIKE', playerId: 'p_1', targetId: 'p_6' }).code).toBe(
      'window_not_open',
    );
    expect(driver.windows().map((window) => window.id)).toEqual(['check', 'rescue']);

    clock.advance(45_000);
    expect(driver.submit({ type: 'SUBMIT_CHECK', playerId: 'p_4', targetId: 'p_11' }).code).toBe(
      'window_not_open',
    );
  });

  it('提交身份校验：只有对应角色可以提交各自行动', () => {
    const { clock, driver } = setup();
    expect(driver.submit({ type: 'SUBMIT_GUARD', playerId: 'p_6', targetIds: ['p_7'] }).code).toBe(
      'not_guardian',
    );
    expect(driver.submit({ type: 'SUBMIT_LAIKE', playerId: 'p_6', targetId: 'p_7' }).code).toBe(
      'not_laike',
    );
    expect(driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_6', targets: ['p_7'] }).code).toBe(
      'not_faction_member',
    );

    clock.advance(90_000);
    expect(driver.submit({ type: 'SUBMIT_CHECK', playerId: 'p_6', targetId: 'p_7' }).code).toBe(
      'not_descender',
    );
    expect(driver.submit({ type: 'SUBMIT_RESCUE', playerId: 'p_6', targetId: null }).code).toBe(
      'not_water',
    );
  });

  it('守护提交拒绝非法目标（重复 / 自己 / 死者）', () => {
    const { driver } = setup();
    expect(
      driver.submit({ type: 'SUBMIT_GUARD', playerId: 'p_2', targetIds: ['p_6', 'p_6'] }).code,
    ).toBe('guard_duplicate_target');
    expect(driver.submit({ type: 'SUBMIT_GUARD', playerId: 'p_2', targetIds: ['p_2'] }).code).toBe(
      'guard_self_forbidden',
    );

    const dead = setup(overrideLife(scenario(), 'p_6', 'dead'));
    expect(
      dead.driver.submit({ type: 'SUBMIT_GUARD', playerId: 'p_2', targetIds: ['p_6'] }).code,
    ).toBe('target_dead');
  });
});

describe('夜间驱动：团队确认（T-42 窗口化）', () => {
  it('截止取最新全员确认版本，旧版本确认作为兜底', () => {
    const { clock, driver, steps } = setup();
    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_11', targets: ['p_5'] });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 1 });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_12', revision: 1 });
    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_12', targets: ['p_6'] });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_12', revision: 2 });

    clock.advance(90_000);
    clock.advance(45_000);

    expect(lastState(steps).night?.deaths).toEqual(['p_5']);
  });

  it('从未达成全员确认的团队按空刀处理', () => {
    const { clock, driver, steps } = setup();
    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_11', targets: ['p_5'] });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 1 });
    clock.advance(90_000);
    clock.advance(45_000);
    expect(lastState(steps).night?.deaths).toEqual([]);
  });

  it('一阶段死神与魂灵池独立，方案互不影响', () => {
    const { clock, driver, steps } = setup();
    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_10', targets: ['p_5'] });
    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_11', targets: ['p_6'] });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 1 });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_12', revision: 1 });

    clock.advance(90_000);
    clock.advance(45_000);

    expect(lastState(steps).night?.deaths).toEqual(['p_5', 'p_6']);
  });

  it('确认不存在的版本被拒绝；重复确认幂等', () => {
    const { driver } = setup();
    expect(driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 9 }).code).toBe(
      'unknown_revision',
    );
    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_11', targets: ['p_5'] });
    expect(driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 1 }).accepted).toBe(
      true,
    );
    expect(driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 1 }).accepted).toBe(
      true,
    );
  });
});

describe('夜间驱动：二阶段与回归窗口', () => {
  it('二阶段联合袭击、水妖夜死开回归窗口，窗口内改选最后生效', () => {
    const base: GameState = overrideLife({ ...scenario(), stage: 2 }, 'p_7', 'dead');
    const { clock, driver, steps } = setup(base);

    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_10', targets: ['p_3', 'p_5'] });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_10', revision: 1 });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 1 });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_12', revision: 1 });

    clock.advance(90_000);
    expect(driver.windows().map((window) => window.id)).toEqual(['check']);
    clock.advance(45_000);

    expect(driver.windows().map((window) => window.id)).toEqual(['revive']);
    expect(
      driver.submit({ type: 'SUBMIT_REVIVE', playerId: 'p_3', targetId: 'p_6' }).accepted,
    ).toBe(false);
    expect(
      driver.submit({ type: 'SUBMIT_REVIVE', playerId: 'p_3', targetId: 'p_5' }).accepted,
    ).toBe(true);
    expect(
      driver.submit({ type: 'SUBMIT_REVIVE', playerId: 'p_3', targetId: 'p_7' }).accepted,
    ).toBe(true);

    clock.advance(45_000);

    const final = lastState(steps);
    expect(final.phase).toBe('day');
    expect(final.stage).toBe(2);
    expect(final.players.find((player) => player.playerId === 'p_7')?.life).toBe('alive');
    expect(final.players.find((player) => player.playerId === 'p_5')?.life).toBe('dead');
    expect(final.players.find((player) => player.playerId === 'p_3')?.life).toBe('dead');
    expect(allEvents(steps).some((event) => event.type === 'revive_announced')).toBe(true);
  });

  it('回归窗口超时不选择：死亡维持，正常进入白天', () => {
    const base: GameState = { ...scenario(), stage: 2 };
    const { clock, driver, steps } = setup(base);
    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_10', targets: ['p_3', 'p_5'] });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_10', revision: 1 });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 1 });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_12', revision: 1 });

    clock.advance(90_000);
    clock.advance(45_000);
    expect(driver.windows().map((window) => window.id)).toEqual(['revive']);

    clock.advance(45_000);

    const final = lastState(steps);
    expect(final.phase).toBe('day');
    expect(final.players.find((player) => player.playerId === 'p_5')?.life).toBe('dead');
    expect(allEvents(steps).some((event) => event.type === 'revive_announced')).toBe(false);
  });

  it('水妖不是本夜死亡时不开回归窗口', () => {
    const base: GameState = { ...scenario(), stage: 2 };
    const { clock, driver } = setup(base);
    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_10', targets: ['p_6'] });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_10', revision: 1 });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 1 });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_12', revision: 1 });

    clock.advance(90_000);
    clock.advance(45_000);

    expect(driver.windows()).toEqual([]);
    expect(driver.done()).toBe(true);
  });
});

describe('夜间驱动：生命周期', () => {
  it('重复 start 报错；dispose 清理全部定时器', () => {
    const { driver, clock } = setup();
    expect(() => driver.start(scenario())).toThrow();
    driver.dispose();
    expect(clock.pendingCount()).toBe(0);
    expect(driver.windows()).toEqual([]);
  });
});

describe('夜间驱动：阵营协商视图（R-47、M3d）', () => {
  it('proposalState 反映草稿版本、目标与确认进度', () => {
    const { driver } = setup();

    expect(driver.proposalState('p_10')).toEqual({
      pool: 'death',
      activeMemberIds: ['p_10'],
      revision: 0,
      targetPlayerIds: [],
      confirmedBy: [],
      locked: false,
    });
    expect(driver.proposalState('p_6')).toBeNull();

    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_10', targets: ['p_5'] });
    const deathView = driver.proposalState('p_10');
    expect(deathView?.revision).toBe(1);
    expect(deathView?.targetPlayerIds).toEqual(['p_5']);
    expect(deathView?.locked).toBe(true);

    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_11', targets: ['p_6'] });
    expect(driver.proposalState('p_11')?.locked).toBe(false);
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_11', revision: 1 });
    expect(driver.proposalState('p_12')?.locked).toBe(false);
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_12', revision: 1 });
    const spiritView = driver.proposalState('p_12');
    expect(spiritView?.locked).toBe(true);
    expect(spiritView?.confirmedBy).toEqual(['p_11', 'p_12']);
  });
});
