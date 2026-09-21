import type { RoomSnapshot } from '../../../contracts/v2.ts';

/**
 * 音量表现层纯模型（无 React、无 SDK）。
 * 音量只在本机可见：不上报服务端、不入日志与复盘；这里只做数值归一与"该不该显示"的判定。
 */

/** 电平条段数：离散段而不是连续宽度，减少动画时天然不抖。 */
export const VOICE_LEVEL_SEGMENTS = 5;
export const VOICE_LEVEL_MIN = 0;
export const VOICE_LEVEL_MAX = 100;

/** 音量唯一的合法性定义（偏好持久化与 UI 共用）。非法值回落到 fallback。 */
export function clampVoiceLevel(value: unknown, fallback = VOICE_LEVEL_MAX): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(VOICE_LEVEL_MAX, Math.max(VOICE_LEVEL_MIN, Math.round(value)));
}

/** 0–100 量化成 0…segments；只要能听见就至少亮一段，0 表示静默。 */
export function levelSegments(level: number, segments = VOICE_LEVEL_SEGMENTS): number {
  const value = clampVoiceLevel(level, 0);
  if (value <= 0) return 0;
  return Math.min(segments, Math.max(1, Math.ceil((value / VOICE_LEVEL_MAX) * segments)));
}

/**
 * 当前发言者：R-43 的四个开麦时段（竞选发言 / 发言轮 / 遗言 / 平票发言）才非空，
 * 其余窗口（投票、重投、夜间、晨间结算、指定顺序、移交、结算）服务端给 null。
 */
export function speakingPlayerId(view: RoomSnapshot | null): string | null {
  if (!view?.public || view.public.phase !== 'day') return null;
  return view.public.day?.currentSpeakerId ?? null;
}

export interface VoiceLevelInput {
  readonly view: RoomSnapshot | null;
  /** 远端音量指示里最高的一项（无 uid↔座位映射，发言窗口内只有一人有发布权，故可归属为当前发言者）。 */
  readonly remoteLevel: number;
  readonly outputVolume: number;
  readonly muted: boolean;
  readonly showLevels: boolean;
}

export interface VoiceLevelDisplay {
  /** 输出静音时仍要保留"谁在发言"，只把电平换成「已静音」。 */
  readonly speakingPlayerId: string | null;
  readonly speakerLevel: number;
  readonly muted: boolean;
}

export function voiceLevelDisplay(input: VoiceLevelInput): VoiceLevelDisplay {
  const speaker = input.showLevels ? speakingPlayerId(input.view) : null;
  return {
    speakingPlayerId: speaker,
    speakerLevel: speaker === null ? 0 : clampVoiceLevel(input.remoteLevel, 0),
    muted: input.muted || clampVoiceLevel(input.outputVolume, VOICE_LEVEL_MAX) === VOICE_LEVEL_MIN,
  };
}

/** 自己的电平只在"已开麦"且未关闭音量指示时出现。 */
export function ownLevelVisible(microphoneEnabled: boolean, showLevels: boolean): boolean {
  return microphoneEnabled && showLevels;
}
