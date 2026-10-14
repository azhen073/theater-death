import type { RoomSnapshot } from '../../../contracts/v2.ts';

/** Page-wide ambient snowfall for stage 2. Derived from public state only, never from private tasks. */
export interface Snowflake {
  /** Viewport fraction 0–1. */
  left: number;
  /** Diameter in CSS px. Deliberately tiny: the effect is minimal, not a weather simulation. */
  size: number;
  /** One full fall, in milliseconds. */
  duration: number;
  /** Negative: every flake is already mid-flight at first paint. */
  delay: number;
  /** Total horizontal travel over the fall, in px. */
  drift: number;
  /** Horizontal offset at the halfway mark, in px (sway). */
  sway: number;
  opacity: number;
}

/** 极简形态、小颗粒、低密度（用户裁定 2026-10-02；同日两次追加增大尺寸与密度后按此取值）。 */
export const SNOW_MIN_FLAKES = 45;
export const SNOW_MAX_FLAKES = 150;
export const SNOW_MIN_SIZE = 3;
export const SNOW_MAX_SIZE = 6;
const AREA_PER_FLAKE = 13_000;
const NARROW_WIDTH = 680;
const NARROW_RATIO = 0.6;

/** 对局内二阶段（白天与夜晚都飘雪）；大厅、复盘、一阶段与离场一律不出现。 */
export function snowActive(view: RoomSnapshot): boolean {
  return view.room.phase === 'playing'
    && !!view.gameId
    && !!view.public
    && view.public.phase !== 'ended'
    && view.public.stage === 2;
}

export function snowflakeCount(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  const area = width * height / AREA_PER_FLAKE;
  const scaled = width <= NARROW_WIDTH ? area * NARROW_RATIO : area;
  return Math.max(SNOW_MIN_FLAKES, Math.min(SNOW_MAX_FLAKES, Math.round(scaled)));
}

/** Stable per game/day/room pattern so re-renders and reconnects do not reshuffle an existing scene. */
export function snowSeed(view: RoomSnapshot): number {
  const text = `${view.gameId ?? ''}|${view.roomId}|${view.public?.dayNumber ?? 0}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0 || 1;
}

export function makeSnowflakes(seed: number, count: number): Snowflake[] {
  let state = (seed >>> 0) || 1;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const total = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return Array.from({ length: total }, () => {
    const duration = 11_000 + random() * 9_000;
    return {
      left: random(),
      size: SNOW_MIN_SIZE + random() * (SNOW_MAX_SIZE - SNOW_MIN_SIZE),
      duration,
      delay: -random() * duration,
      drift: (random() - .5) * 26,
      sway: (random() - .5) * 18,
      opacity: .12 + random() * .22,
    };
  });
}
