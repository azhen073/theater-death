import type { RoomSnapshot, TaskDTO } from '../../../../contracts/v2.ts';

export const IDENTITY_REVEAL_URGENT_MS = 10_000;
const prefix = 'theater-death:identity-reveal:v1:';

export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function identityRevealKey(view: RoomSnapshot): string | null {
  const subject = view.viewer.subjectPlayerId;
  if (view.room.phase !== 'playing' || !view.gameId || view.viewer.kind !== 'formal' || view.viewer.readOnly ||
      !subject || view.private?.self.playerId !== subject) return null;
  return prefix + JSON.stringify([view.roomId, view.gameId, subject]);
}

export function identityRevealHasUrgentAction(
  tasks: readonly TaskDTO[],
  remaining: (deadline: number) => number | null,
): boolean {
  return tasks.some(task => {
    const value = remaining(task.closesAt);
    return value === null || value <= IDENTITY_REVEAL_URGENT_MS;
  });
}

export function claimIdentityReveal(store: SessionStore, key: string, urgent: boolean): 'show' | 'skip' | 'none' {
  try {
    if (store.getItem(key) !== null) return 'none';
    // Claim before rendering so refresh during the reveal cannot replay it.
    store.setItem(key, urgent ? 'skipped-for-action' : 'shown');
    return urgent ? 'skip' : 'show';
  } catch {
    // Storage failure must never create a repeatedly blocking private overlay.
    return 'none';
  }
}
