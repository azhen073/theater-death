import { describe, expect, it } from 'vitest';
import type { TargetSelection } from '../contracts/v2.ts';
import type { ActionDraft } from '../web-v2/src/features/actions/model.ts';
import { reconcileDraft } from '../web-v2/src/features/actions/draft-reconciliation.ts';

const selection = (overrides: Partial<TargetSelection> = {}): TargetSelection => ({
  playerIds: ['p_a', 'p_b', 'p_c', 'p_d'], maxTargets: 3, allowRepeated: false, canSkip: true, forbiddenPairs: [], ...overrides,
});
const draft = (targets: string[], overrides: Partial<ActionDraft> = {}): ActionDraft => ({ targets, direction: 'desc', revision: 7, ...overrides });

describe('v2 action draft reconciliation', () => {
  it('returns the same legal draft reference and preserves metadata', () => {
    const value = draft(['p_b', 'p_a']);
    const result = reconcileDraft(selection(), value);
    expect(result).toBe(value);
    expect(result).toEqual({ targets: ['p_b', 'p_a'], direction: 'desc', revision: 7 });
  });

  it('removes unavailable IDs in original order without mutating the draft or inventing targets', () => {
    const value = draft(['p_b', 'missing', 'p_d']);
    const original = structuredClone(value);
    const result = reconcileDraft(selection(), value);
    expect(result).toEqual({ targets: ['p_b', 'p_d'], direction: 'desc', revision: 7 });
    expect(value).toEqual(original);
    expect(result.targets.every(id => selection().playerIds.includes(id))).toBe(true);
    expect(reconcileDraft(selection({ playerIds: ['p_a'] }), draft([])).targets).toEqual([]);
  });

  it('trims at maxTargets while preserving legal prefix and metadata', () => {
    const value = draft(['p_a', 'p_b', 'p_c', 'p_d']);
    expect(reconcileDraft(selection({ maxTargets: 2 }), value)).toEqual({ targets: ['p_a', 'p_b'], direction: 'desc', revision: 7 });
  });

  it('removes duplicate targets when repetition is disallowed and keeps repeats when allowed', () => {
    expect(reconcileDraft(selection(), draft(['p_a', 'p_a', 'p_b']))).toEqual({ targets: ['p_a', 'p_b'], direction: 'desc', revision: 7 });
    expect(reconcileDraft(selection({ allowRepeated: true }), draft(['p_a', 'p_a', 'p_b']))).toBeInstanceOf(Object);
    expect(reconcileDraft(selection({ allowRepeated: true }), draft(['p_a', 'p_a', 'p_b']))).toEqual({ targets: ['p_a', 'p_a', 'p_b'], direction: 'desc', revision: 7 });
  });

  it('removes only targets that would complete a forbidden pair', () => {
    const value = draft(['p_a', 'p_b', 'p_c', 'p_d']);
    expect(reconcileDraft(selection({ forbiddenPairs: [['p_a', 'p_b'], ['p_c', 'p_d']] }), value)).toEqual({ targets: ['p_a', 'p_c'], direction: 'desc', revision: 7 });
    expect(value.targets).toEqual(['p_a', 'p_b', 'p_c', 'p_d']);
  });
});
