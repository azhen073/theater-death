import { describe, expect, it } from 'vitest';
import { resolveMorning } from '../engine/morning.ts';
import type { GameState } from '../engine/types.ts';
import { createFakeClock } from '../server/clock.ts';
import { createDayDriver } from '../server/day-driver.ts';
import { createNightDriver } from '../server/night-driver.ts';
import { runNight, scenario } from './helpers.ts';

function morningState(): GameState {
  return resolveMorning(runNight(scenario(), {})).state;
}

function strictDay() {
  const clock = createFakeClock();
  const driver = createDayDriver({
    clock,
    strictWindows: true,
    onStep: () => undefined,
  });
  const state = morningState();
  driver.start({ ...state, dayNumber: 2, sheriff: { ...state.sheriff, holderId: 'p_6' } });
  return { clock, driver };
}

function strictNight() {
  const clock = createFakeClock();
  const driver = createNightDriver({
    clock,
    strictWindows: true,
    onStep: () => undefined,
  });
  driver.start(scenario());
  return { clock, driver };
}

describe('strict window instance 校验', () => {
  it('白天缺失、错误或跨窗口 instanceId 都拒绝为 stale_window', () => {
    const { driver } = strictDay();
    const current = driver.windows()[0];
    expect(current?.id).toBe('speech_order');

    expect(driver.submit({ type: 'DESIGNATE_SPEECH', playerId: 'p_6', startPlayerId: 'p_5', direction: 'asc' }).code).toBe('stale_window');
    expect(driver.submit({ type: 'DESIGNATE_SPEECH', playerId: 'p_6', startPlayerId: 'p_5', direction: 'asc', windowInstanceId: 'wrong' }).code).toBe('stale_window');

    driver.submit({ type: 'DESIGNATE_SPEECH', playerId: 'p_6', startPlayerId: 'p_5', direction: 'asc', windowInstanceId: current?.instanceId });
    const speech = driver.windows()[0];
    expect(driver.submit({ type: 'SUBMIT_DAY_VOTE', playerId: 'p_1', targetId: null, windowInstanceId: speech?.instanceId }).code).toBe('stale_window');
  });

  it('同一窗口多次读取 instanceId 稳定，合法请求提交后旧 ID 失效且连续发言换 ID', () => {
    const { driver } = strictDay();
    const prepare = driver.windows()[0]?.instanceId;
    expect(driver.windows()[0]?.instanceId).toBe(prepare);

    driver.submit({ type: 'DESIGNATE_SPEECH', playerId: 'p_6', startPlayerId: 'p_5', direction: 'asc', windowInstanceId: prepare });
    const firstSpeech = driver.windows()[0]?.instanceId;
    expect(firstSpeech).toBeDefined();
    expect(firstSpeech).not.toBe(prepare);

    expect(driver.submit({ type: 'END_SPEECH', playerId: 'p_5', windowInstanceId: firstSpeech }).accepted).toBe(true);
    const secondSpeech = driver.windows()[0]?.instanceId;
    expect(secondSpeech).toBeDefined();
    expect(secondSpeech).not.toBe(firstSpeech);
    expect(driver.submit({ type: 'END_SPEECH', playerId: 'p_5', windowInstanceId: firstSpeech }).code).toBe('stale_window');
  });

  it('夜间并行 guard/faction 使用不同实例，不能跨 command 借用；旧 guard ID 换段后失效', () => {
    const { clock, driver } = strictNight();
    const windows = driver.windows();
    const guard = windows.find((window) => window.id === 'guard');
    const faction = windows.find((window) => window.id === 'faction');
    expect(guard?.instanceId).toBeDefined();
    expect(faction?.instanceId).toBeDefined();
    expect(guard?.instanceId).not.toBe(faction?.instanceId);

    expect(driver.submit({ type: 'SUBMIT_GUARD', playerId: 'p_2', targetIds: ['p_6'] }).code).toBe('stale_window');
    expect(driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_10', targets: ['p_5'], windowInstanceId: guard?.instanceId }).code).toBe('stale_window');
    expect(driver.submit({ type: 'SUBMIT_GUARD', playerId: 'p_2', targetIds: ['p_6'], windowInstanceId: guard?.instanceId }).accepted).toBe(true);
    expect(driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_10', targets: ['p_5'], windowInstanceId: faction?.instanceId }).accepted).toBe(true);

    clock.advance(90_000);
    expect(driver.submit({ type: 'SUBMIT_GUARD', playerId: 'p_2', targetIds: ['p_6'], windowInstanceId: guard?.instanceId }).code).toBe('stale_window');
  });
});
