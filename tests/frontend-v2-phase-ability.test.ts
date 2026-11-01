import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CatalogDTO } from '../contracts/catalog.ts';
import { ROLE_IDS, type RoleId } from '../rulesets/types.ts';
import { phaseAbility } from '../web-v2/src/features/game/phase-ability-model.ts';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/contract-2.1/catalog-full.json', import.meta.url), 'utf8')) as CatalogDTO;
function role(roleId: RoleId) {
  const value = catalog.roles.find(item => item.roleId === roleId);
  if (!value) throw new Error(`Missing role ${roleId}`);
  return value;
}

describe('phase-specific identity rule summaries', () => {
  it.each(ROLE_IDS)('%s has both phases and traceable clauses', roleId => {
    const first = phaseAbility(role(roleId), 1), second = phaseAbility(role(roleId), 2);
    expect(first.current).toBeTruthy(); expect(second.current).toBeTruthy();
    expect(first.other).toBe(second.current); expect(second.other).toBe(first.current);
    expect(first.clauses).toMatch(/R-\d+/);
  });
  it('keeps the descender stage-two loss of death-list knowledge explicit', () => {
    expect(phaseAbility(role('descender'), 1).current).toContain('是否为魂灵');
    expect(phaseAbility(role('descender'), 2).current).toContain('不再获得濒死名单');
  });
  it('does not conflate water rescue and stage-two return', () => {
    expect(phaseAbility(role('water'), 1).current).toContain('当夜濒死者');
    expect(phaseAbility(role('water'), 2).current).toContain('白天出局及一阶段夜死不能补触发');
  });
  it('preserves laike exclusive branches and faction shared quota', () => {
    expect(phaseAbility(role('laike'), 2).current).toContain('两个分支不叠加');
    expect(phaseAbility(role('spirit'), 2).current).toContain('联合每夜最多两个');
    expect(phaseAbility(role('death'), 2).current).toContain('已死则只读');
  });
});
