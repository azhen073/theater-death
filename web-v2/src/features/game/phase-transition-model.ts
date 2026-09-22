import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import type { SessionStore } from './identity-reveal-model.ts';

export interface PublicPhaseStamp {
  scope: string;
  day: number;
  stage: 1 | 2;
  light: 'night' | 'day';
}

/** Deliberately excludes private tasks, window names, and night segment deadlines. */
export function publicPhaseStamp(view: RoomSnapshot): PublicPhaseStamp | null {
  const game = view.public;
  if (!view.gameId || view.room.phase !== 'playing' || !game || game.phase === 'ended') return null;
  return {
    scope: JSON.stringify([view.viewer.userId, view.roomId, view.gameId, view.viewer.kind, view.viewer.subjectPlayerId]),
    day: game.dayNumber,
    stage: game.stage,
    light: game.phase === 'night' ? 'night' : 'day',
  };
}

export function phaseTransitionTitle(previous: PublicPhaseStamp | null, next: PublicPhaseStamp | null): string | null {
  if (!previous || !next || previous.scope !== next.scope || next.day < previous.day) return null;
  if (previous.stage === 1 && next.stage === 2) return '第二阶段开启';
  if (previous.light === next.light) return null;
  return next.light === 'night' ? '夜幕降临' : '天光初现';
}

/** Consume both shown and suppressed phases; never persist any private identity data. */
export function claimPublicPhase(store: SessionStore, stamp: PublicPhaseStamp): boolean {
  const key = 'theater-death:public-phase:v1:' + JSON.stringify([stamp.scope, stamp.day, stamp.stage, stamp.light]);
  try {
    if (store.getItem(key) !== null) return false;
    store.setItem(key, 'seen');
    return true;
  } catch {
    return false;
  }
}
