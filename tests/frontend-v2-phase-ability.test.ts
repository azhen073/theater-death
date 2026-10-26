import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CatalogDTO } from '../contracts/catalog.ts';
import type { RoomSnapshot } from '../contracts/v2.ts';
import { ROLE_IDS, type RoleId } from '../rulesets/types.ts';
import { phaseAbility } from '../web-v2/src/features/game/phase-ability-model.ts';
import { currentOperation, playerRuleChapters } from '../web-v2/src/features/rules/quick-view.tsx';

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

describe('rules quick view', () => {
  const view = JSON.parse(readFileSync(new URL('./fixtures/contract-2.1/night-door-full.json', import.meta.url), 'utf8')) as RoomSnapshot;

  it('offers player chapters without engineering content', () => {
    const chapters = playerRuleChapters(catalog);
    expect(chapters).toHaveLength(9);
    expect(chapters.some(chapter => chapter.id === 'chapter-10')).toBe(false);
  });

  it('uses authorized tasks and spectator state for current operation hints', () => {
    expect(currentOperation(view)).toContain('选择守护目标');
    expect(currentOperation({ ...view, viewer: { ...view.viewer, readOnly: true } })).toEqual(['你正在观战，只能查看当前视角。']);
  });

  it('uses server voice capability when no action task exists', () => {
    const next = structuredClone(view);
    next.tasks = [];
    next.capabilities.canPublishVoice = true;
    expect(currentOperation(next)).toEqual(['可以开麦发言']);
    next.capabilities.canPublishVoice = false;
    expect(currentOperation(next)).toEqual(['现在不需要你操作']);
  });

  it('provides victory text from the catalog', () => {
    expect(role('door').victory).toContain('丧亲者');
    expect(role('death').victory).toContain('科研员');
  });
});
