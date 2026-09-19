import type { TargetSelection } from '../../../../contracts/v2.ts';
import type { ActionDraft } from './model.ts';

/** Keep still-legal choices in their original order; never invent a replacement target. */
export function reconcileDraft(selection: TargetSelection, draft: ActionDraft): ActionDraft {
  const targets: string[] = [];
  for (const id of draft.targets) {
    if (!selection.playerIds.includes(id) || targets.length >= selection.maxTargets) continue;
    if (!selection.allowRepeated && targets.includes(id)) continue;
    const next = [...targets, id];
    if (selection.forbiddenPairs.some(pair => pair.length > 0 && pair.every(playerId => next.includes(playerId)))) continue;
    targets.push(id);
  }
  return targets.length === draft.targets.length && targets.every((id, index) => id === draft.targets[index]) ? draft : { ...draft, targets };
}
