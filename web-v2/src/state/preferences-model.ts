import { clampInputGain, clampVoiceLevel } from '../presentation/voice-levels.ts';

export interface DisplayPreferences {
  motion: 'system' | 'reduced' | 'full';
  deathEffects: boolean;
  scale: 90 | 100 | 110;
  /** 是否显示音量指示（自己的电平与当前发言者电平）。 */
  voiceLevels: boolean;
  /** 远端播放音量 0–100；本地偏好，不上报服务端。 */
  voiceOutput: number;
  /** 自己麦克风采集增益 0–150（>125 时关闭 AGC）；本地偏好，不上报服务端。 */
  voiceInput: number;
  /** 输出静音开关；静音时仍保留"谁在发言"的指示。 */
  voiceMuted: boolean;
}

export const defaultPreferences: DisplayPreferences = {
  motion: 'system',
  deathEffects: true,
  scale: 100,
  voiceLevels: true,
  voiceOutput: 100,
  voiceInput: 100,
  voiceMuted: false,
};

export function parsePreferences(value: unknown): DisplayPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    motion: input.motion === 'reduced' || input.motion === 'full' ? input.motion : 'system',
    deathEffects: typeof input.deathEffects === 'boolean' ? input.deathEffects : true,
    scale: input.scale === 90 || input.scale === 110 ? input.scale : 100,
    voiceLevels: typeof input.voiceLevels === 'boolean' ? input.voiceLevels : true,
    voiceOutput: clampVoiceLevel(input.voiceOutput, defaultPreferences.voiceOutput),
    voiceInput: clampInputGain(input.voiceInput, defaultPreferences.voiceInput),
    voiceMuted: typeof input.voiceMuted === 'boolean' ? input.voiceMuted : false,
  };
}
