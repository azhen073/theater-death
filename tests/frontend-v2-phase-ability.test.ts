import { describe, expect, it } from 'vitest';
import { ROLE_IDS } from '../rulesets/types.ts';
import { phaseAbility } from '../web-v2/src/features/game/phase-ability-model.ts';

describe('phase-specific identity rule summaries', () => {
  it.each(ROLE_IDS)('%s has both phases and traceable clauses', role => {
    const first = phaseAbility(role, 1), second = phaseAbility(role, 2);
    expect(first.current).toBeTruthy(); expect(second.current).toBeTruthy();
    expect(first.other).toBe(second.current); expect(second.other).toBe(first.current);
    expect(first.clauses).toMatch(/R-\d+/);
  });
  it('keeps the descender stage-two loss of death-list knowledge explicit', () => {
    expect(phaseAbility('descender', 1).current).toContain('是否为魂灵');
    expect(phaseAbility('descender', 2).current).toContain('不再获得濒死名单');
  });
  it('does not conflate water rescue and stage-two return', () => {
    expect(phaseAbility('water', 1).current).toContain('当夜濒死者');
    expect(phaseAbility('water', 2).current).toContain('白天出局及一阶段夜死不能补触发');
  });
  it('preserves laike exclusive branches and faction shared quota', () => {
    expect(phaseAbility('laike', 2).current).toContain('两个分支不叠加');
    expect(phaseAbility('spirit', 2).current).toContain('联合每夜最多两个');
    expect(phaseAbility('death', 2).current).toContain('已死则只读');
  });
});
