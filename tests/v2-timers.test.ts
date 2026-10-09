import { describe, expect, it } from 'vitest';
import { resolveMorning } from '../engine/morning.ts';
import type { GameState } from '../engine/types.ts';
import { createFakeClock } from '../server/clock.ts';
import { createDayDriver } from '../server/day-driver.ts';
import { createNightDriver } from '../server/night-driver.ts';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { runNight, scenario } from './helpers.ts';

function v2Day(dayNumber = 2): GameState {
  return {
    ...resolveMorning(runNight(scenario(), {})).state,
    ruleset: THEATER_DEATH_13_V2,
    dayNumber,
  };
}

function speechDriver() {
  const clock = createFakeClock();
  const driver = createDayDriver({ clock, onStep: () => undefined });
  driver.start(v2Day());
  return { clock, driver };
}

describe('v2 白天发言计时', () => {
  it('普通发言先有 45 秒指定窗口，再有 15 秒准备；陌生人不能开始，当前发言者可提前开始', () => {
    const { clock, driver } = speechDriver();
    expect(driver.windows()).toEqual([{ id: 'speech_order', closesAt: 45_000 }]);

    clock.advance(45_000);
    expect(driver.windows()).toEqual([{ id: 'speech_prepare', closesAt: 60_000 }]);
    expect(driver.snapshot()?.day?.speechPreparing).toBe(true);
    expect(driver.submit({ type: 'START_SPEECH', playerId: 'p_2' }).code).toBe('not_current_speaker');
    expect(driver.submit({ type: 'START_SPEECH', playerId: 'p_1' }).accepted).toBe(true);
    expect(driver.snapshot()?.day?.speechPreparing).toBe(false);
    expect(driver.windows()).toEqual([{ id: 'speech_round', closesAt: 165_000 }]);
    expect(driver.submit({ type: 'START_SPEECH', playerId: 'p_1' }).code).toBe('window_not_open');
  });

  it('准备窗口到期后自动开始 120 秒发言，且下一位重新进入准备', () => {
    const { clock, driver } = speechDriver();
    clock.advance(45_000);
    clock.advance(14_999);
    expect(driver.windows()).toEqual([{ id: 'speech_prepare', closesAt: 60_000 }]);
    clock.advance(1);
    expect(driver.windows()).toEqual([{ id: 'speech_round', closesAt: 180_000 }]);

    clock.advance(120_000);
    expect(driver.snapshot()?.day?.speechPreparing).toBe(true);
    expect(driver.windows()).toEqual([{ id: 'speech_prepare', closesAt: 195_000 }]);
  });

  it('竞选候选发言也使用准备窗口，准备期间仍可退选', () => {
    const clock = createFakeClock();
    const driver = createDayDriver({ clock, onStep: () => undefined });
    driver.start(v2Day(1));
    expect(driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_6' }).accepted).toBe(true);
    expect(driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_7' }).accepted).toBe(true);

    clock.advance(30_000);
    expect(driver.windows()).toEqual([{ id: 'speech_prepare', closesAt: 45_000 }]);
    expect(driver.snapshot()?.day?.speechPreparing).toBe(true);
    expect(driver.submit({ type: 'WITHDRAW_CANDIDACY', playerId: 'p_7' }).accepted).toBe(true);
    expect(driver.submit({ type: 'START_SPEECH', playerId: 'p_7' }).code).toBe('not_current_speaker');
  });

  it('开启白天自由发言：发言轮走完后插入 120 秒窗口，截止才进入放逐投票', () => {
    const clock = createFakeClock();
    const driver = createDayDriver({ clock, onStep: () => undefined });
    const base = v2Day();
    driver.start({ ...base, ruleset: { ...THEATER_DEATH_13_V2, timersSeconds: { ...THEATER_DEATH_13_V2.timersSeconds, freeSpeech: 120 } } });
    // 逐个窗口推进（指定顺序 → 每人 15 秒准备 + 120 秒发言），直到出现自由发言窗口
    let guard = 0;
    while (driver.windows()[0]?.id !== 'free_speech' && guard < 80) {
      const window = driver.windows()[0]!;
      clock.advance(Math.max(1, window.closesAt - clock.now()));
      guard += 1;
    }
    expect(driver.windows().map(window => window.id)).toEqual(['free_speech']);
    const opensAt = clock.now();
    expect(driver.windows()[0]!.closesAt).toBe(opensAt + 120_000);
    expect(driver.snapshot()?.day?.step).toBe('free_speech');
    clock.advance(120_000);
    expect(driver.windows().map(window => window.id)).toEqual(['vote']);
    expect(driver.snapshot()?.day?.step).toBe('vote');
  });

  it('首夜固定窗口不因 v2 白天计时提前结束', () => {
    const clock = createFakeClock();
    const driver = createNightDriver({
      clock,
      onStep: () => undefined,
    });
    driver.start({ ...scenario(), ruleset: THEATER_DEATH_13_V2 });

    clock.advance(60_000);
    expect(driver.done()).toBe(false);
    expect(driver.snapshot()?.phase).toBe('night');
    clock.advance(29_999);
    expect(driver.done()).toBe(false);
    clock.advance(1);
    expect(driver.done()).toBe(true);
    expect(driver.snapshot()?.phase).toBe('day');
  });
});
