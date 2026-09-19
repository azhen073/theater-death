export interface DisplayPreferences { motion: 'system' | 'reduced' | 'full'; deathEffects: boolean; scale: 90 | 100 | 110 }
export const defaultPreferences: DisplayPreferences = { motion: 'system', deathEffects: true, scale: 100 };
export function parsePreferences(value: unknown): DisplayPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    motion: input.motion === 'reduced' || input.motion === 'full' ? input.motion : 'system',
    deathEffects: typeof input.deathEffects === 'boolean' ? input.deathEffects : true,
    scale: input.scale === 90 || input.scale === 110 ? input.scale : 100,
  };
}
