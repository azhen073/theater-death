import { describe, expect, it } from 'vitest';
import { resolveMorning } from '../engine/morning.ts';
import type { GameState } from '../engine/types.ts';
import { createFakeClock } from '../server/clock.ts';
import { createDayDriver } from '../server/day-driver.ts';
import { queuedClock } from '../server/queued-clock.ts';
import { runNight, scenario } from './helpers.ts';

function morningState(): GameState {
  return resolveMorning(runNight(scenario(), {})).state;
}

function electionDriver() {
  const clock = createFakeClock();
  const driver = createDayDriver({ clock, onStep: () => undefined });
  driver.start(morningState());
  return { clock, driver };
}

describe('窗口截止与排队 timer', () => {
  it('T 时刻即使超时 callback 尚未触发也拒绝报名，T+1 同样拒绝', () => {
    const exact = electionDriver();
    exact.clock.elapse(30_000);
    expect(exact.driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_6' }).code).toBe('window_closed');

    const after = electionDriver();
    after.clock.elapse(30_001);
    expect(after.driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_6' }).code).toBe('window_closed');
  });

  it('退选在截止 T/T+1 也拒绝，即使截止回调尚未执行', () => {
    const exact = electionDriver();
    expect(exact.driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_6' }).accepted).toBe(true);
    exact.clock.elapse(30_000);
    expect(exact.driver.submit({ type: 'WITHDRAW_CANDIDACY', playerId: 'p_6' }).code).toBe('window_closed');

    const after = electionDriver();
    expect(after.driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_6' }).accepted).toBe(true);
    after.clock.elapse(30_001);
    expect(after.driver.submit({ type: 'WITHDRAW_CANDIDACY', playerId: 'p_6' }).code).toBe('window_closed');
  });

  it('timer 已入 room queue 但尚未执行时取消，释放队列后旧 callback 不执行', async () => {
    const clock = createFakeClock();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let callbackRuns = 0;
    const queued = queuedClock(clock, (callback) => blocked.then(callback));
    const handle = queued.schedule(1_000, () => { callbackRuns += 1; });

    clock.advance(1_000);
    queued.cancel(handle);
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(callbackRuns).toBe(0);
  });

  it('dispose 后截止 timer 不再推进白天流程', () => {
    const clock = createFakeClock();
    const steps: GameState[] = [];
    const driver = createDayDriver({
      clock,
      onStep: (result) => steps.push(result.state),
    });
    driver.start({ ...morningState(), dayNumber: 2 });
    expect(steps).toHaveLength(1);

    driver.dispose();
    clock.advance(120_000);

    expect(driver.done()).toBe(true);
    expect(steps).toHaveLength(1);
  });
});
