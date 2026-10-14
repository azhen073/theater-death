import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../contracts/v2.ts';
import {
  SNOW_MAX_FLAKES, SNOW_MAX_SIZE, SNOW_MIN_FLAKES, SNOW_MIN_SIZE, makeSnowflakes, snowActive, snowSeed, snowflakeCount,
} from '../web-v2/src/presentation/snowfall.ts';

function baseline(): RoomSnapshot {
  return JSON.parse(readFileSync('tests/fixtures/contract-2.1/night-spirit-full.json', 'utf8')) as RoomSnapshot;
}

describe('stage 2 snowfall scope', () => {
  it('只在对局内二阶段出现', () => {
    const view = baseline();
    expect(snowActive(view)).toBe(false);
    expect(snowActive({ ...view, public: { ...view.public!, stage: 2 } })).toBe(true);
    expect(snowActive({ ...view, public: { ...view.public!, stage: 2, phase: 'day' } })).toBe(true);
  });

  it('大厅、复盘、终局、缺公共视图或缺对局时都不出现', () => {
    const view = baseline();
    const two = { ...view, public: { ...view.public!, stage: 2 as const } };
    expect(snowActive({ ...two, room: { ...two.room, phase: 'lobby' } })).toBe(false);
    expect(snowActive({ ...two, room: { ...two.room, phase: 'review' } })).toBe(false);
    expect(snowActive({ ...two, public: { ...two.public, phase: 'ended' } })).toBe(false);
    expect(snowActive({ ...two, public: null })).toBe(false);
    expect(snowActive({ ...two, gameId: null })).toBe(false);
  });

  it('观战与第二屏同样只读公开阶段，照常飘雪', () => {
    const view = baseline();
    const spectator = { ...view, public: { ...view.public!, stage: 2 as const } };
    spectator.viewer = { ...spectator.viewer, readOnly: true, kind: 'private_spectator' };
    expect(snowActive(spectator)).toBe(true);
  });
});

describe('stage 2 snowfall budget', () => {
  it('低密度：按面积增长但始终落在上下界内', () => {
    const desktop = snowflakeCount(1440, 900);
    expect(desktop).toBeGreaterThanOrEqual(SNOW_MIN_FLAKES);
    expect(desktop).toBeLessThanOrEqual(SNOW_MAX_FLAKES);
    expect(desktop).toBeGreaterThanOrEqual(snowflakeCount(900, 600));
    expect(desktop).toBeLessThanOrEqual(SNOW_MAX_FLAKES);
    expect(snowflakeCount(4000, 3000)).toBe(SNOW_MAX_FLAKES);
    expect(snowflakeCount(320, 720)).toBe(SNOW_MIN_FLAKES);
    expect(snowflakeCount(320, 720)).toBeLessThan(desktop);
  });

  it('非法尺寸不产生雪粒', () => {
    expect(snowflakeCount(0, 900)).toBe(0);
    expect(snowflakeCount(1440, -1)).toBe(0);
    expect(snowflakeCount(Number.NaN, 900)).toBe(0);
    expect(snowflakeCount(Number.POSITIVE_INFINITY, 900)).toBe(0);
  });
});

describe('stage 2 snowfall flakes', () => {
  it('同种子完全确定，便于重连/推送不重排既有画面', () => {
    const view = baseline();
    const seed = snowSeed(view);
    expect(seed).toBe(snowSeed({ ...view }));
    expect(snowSeed({ ...view, public: { ...view.public!, dayNumber: 2 } })).not.toBe(seed);
    expect(snowSeed({ ...view, gameId: 'g_other' })).not.toBe(seed);
    expect(makeSnowflakes(seed, 24)).toEqual(makeSnowflakes(seed, 24));
    expect(makeSnowflakes(seed, 24)).not.toEqual(makeSnowflakes(seed + 1, 24));
  });

  it('极简形态：小颗粒、低不透明度、只向下飘且取值为有限数', () => {
    const flakes = makeSnowflakes(snowSeed(baseline()), 48);
    expect(flakes).toHaveLength(48);
    for (const flake of flakes) {
      expect(flake.left).toBeGreaterThanOrEqual(0);
      expect(flake.left).toBeLessThan(1);
      expect(flake.size).toBeGreaterThanOrEqual(SNOW_MIN_SIZE);
      expect(flake.size).toBeLessThanOrEqual(SNOW_MAX_SIZE);
      expect(flake.opacity).toBeGreaterThan(0);
      expect(flake.opacity).toBeLessThanOrEqual(.34);
      expect(flake.duration).toBeGreaterThanOrEqual(11_000);
      expect(flake.duration).toBeLessThanOrEqual(20_000);
      expect(flake.delay).toBeLessThanOrEqual(0);
      expect(flake.delay).toBeGreaterThanOrEqual(-flake.duration);
      expect(Math.abs(flake.drift)).toBeLessThanOrEqual(13);
      expect(Math.abs(flake.sway)).toBeLessThanOrEqual(9);
      expect(Object.values(flake).every(value => Number.isFinite(value))).toBe(true);
    }
  });

  it('数量为零、负数或非有限时不产生雪粒', () => {
    expect(makeSnowflakes(7, 0)).toEqual([]);
    expect(makeSnowflakes(7, -5)).toEqual([]);
    expect(makeSnowflakes(7, Number.NaN)).toEqual([]);
  });
});
