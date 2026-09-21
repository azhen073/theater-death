import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../contracts/v2.ts';
import {
  VOICE_LEVEL_SEGMENTS,
  clampVoiceLevel,
  levelSegments,
  ownLevelVisible,
  speakingPlayerId,
  voiceLevelDisplay,
} from '../web-v2/src/presentation/voice-levels.ts';

function snapshot(overrides: { phase?: 'day' | 'night' | 'morning' | 'ended'; speaker?: string | null } = {}): RoomSnapshot {
  return {
    public: { phase: overrides.phase ?? 'day', day: { currentSpeakerId: overrides.speaker ?? null } },
  } as unknown as RoomSnapshot;
}

describe('v2 voice level model（A+B：自己的电平 + 当前发言者电平）', () => {
  it('clamps any stored or reported volume into 0–100 and falls back on non-numbers', () => {
    expect(clampVoiceLevel(0)).toBe(0);
    expect(clampVoiceLevel(60.4)).toBe(60);
    expect(clampVoiceLevel(60.6)).toBe(61);
    expect(clampVoiceLevel(-5)).toBe(0);
    expect(clampVoiceLevel(999)).toBe(100);
    for (const value of [undefined, null, 'x', Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(clampVoiceLevel(value, 100)).toBe(100);
    }
  });

  it('quantizes levels into discrete segments, so reduced motion needs no extra branch', () => {
    expect(levelSegments(0)).toBe(0);
    expect(levelSegments(1)).toBe(1);
    expect(levelSegments(20)).toBe(1);
    expect(levelSegments(100)).toBe(VOICE_LEVEL_SEGMENTS);
    expect(levelSegments(1000)).toBe(VOICE_LEVEL_SEGMENTS);
    expect(levelSegments(-10)).toBe(0);
  });

  it('exposes the current speaker only during the day phase（R-43 开麦时段）', () => {
    expect(speakingPlayerId(snapshot({ speaker: 'p_1' }))).toBe('p_1');
    expect(speakingPlayerId(snapshot({ speaker: null }))).toBeNull();
    expect(speakingPlayerId(snapshot({ phase: 'night', speaker: 'p_1' }))).toBeNull();
    expect(speakingPlayerId(snapshot({ phase: 'morning', speaker: 'p_1' }))).toBeNull();
    expect(speakingPlayerId(snapshot({ phase: 'ended', speaker: 'p_1' }))).toBeNull();
    expect(speakingPlayerId(null)).toBeNull();
  });

  it('keeps the speaker identity while the output is muted（答案 4：显示「已静音」但保留"谁在发言"）', () => {
    const muted = voiceLevelDisplay({ view: snapshot({ speaker: 'p_4' }), remoteLevel: 72, outputVolume: 100, muted: true, showLevels: true });
    expect(muted).toEqual({ speakingPlayerId: 'p_4', speakerLevel: 72, showLevel: true, muted: true });
    expect(voiceLevelDisplay({ view: snapshot({ speaker: 'p_4' }), remoteLevel: 72, outputVolume: 0, muted: false, showLevels: true }).muted).toBe(true);
    expect(voiceLevelDisplay({ view: snapshot({ speaker: 'p_4' }), remoteLevel: 72, outputVolume: 100, muted: false, showLevels: true })).toMatchObject({ speakerLevel: 72, muted: false });
    expect(voiceLevelDisplay({ view: snapshot({ phase: 'night', speaker: 'p_4' }), remoteLevel: 72, outputVolume: 100, muted: false, showLevels: true })).toEqual({ speakingPlayerId: null, speakerLevel: 0, showLevel: true, muted: false });
  });

  it('hides only the level meters when the preference is off, keeping "who is speaking"', () => {
    expect(voiceLevelDisplay({ view: snapshot({ speaker: 'p_4' }), remoteLevel: 72, outputVolume: 100, muted: false, showLevels: false })).toEqual({ speakingPlayerId: 'p_4', speakerLevel: 0, showLevel: false, muted: false });
    expect(voiceLevelDisplay({ view: snapshot({ speaker: 'p_4' }), remoteLevel: 72, outputVolume: 100, muted: true, showLevels: false })).toMatchObject({ speakingPlayerId: 'p_4', showLevel: false, muted: true });
    expect(ownLevelVisible(true, true)).toBe(true);
    expect(ownLevelVisible(false, true)).toBe(false);
    expect(ownLevelVisible(true, false)).toBe(false);
  });
});
