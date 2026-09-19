import { THEATER_DEATH_13 } from './theater-death-13.ts';
import type { RulesetConfig } from './types.ts';

/** Separately versioned preset. Existing 1.1 games keep their frozen rules. */
export const THEATER_DEATH_13_V2: RulesetConfig = {
  ...structuredClone(THEATER_DEATH_13), version: '2.0',
  teamConfirm: 'unanimous_or_latest',
  timersSeconds: { ...THEATER_DEATH_13.timersSeconds, speech: 120, speechPrepare: 15, speechOrder: 45, ability: 30, faction: 60 },
};
