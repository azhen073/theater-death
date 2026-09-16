import { describe, expect, it } from 'vitest';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import { validateRuleset, type ValidationResult } from '../rulesets/validate.ts';

function experimental(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...THEATER_DEATH_13, mode: 'experimental', ...overrides };
}

function expectIssue(result: ValidationResult, code: string): void {
  expect(result.ok).toBe(false);
  expect(result.issues.map((issue) => issue.code)).toContain(code);
}

describe('规则配置验证器', () => {
  it('默认 13 人预设通过正式模式验证', () => {
    const result = validateRuleset(THEATER_DEATH_13);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('同一预设切换实验模式仍通过', () => {
    expect(validateRuleset(experimental()).ok).toBe(true);
  });

  it('拒绝空神职', () => {
    const result = validateRuleset(
      experimental({ roles: { ...THEATER_DEATH_13.roles, laike: 0, door: 0, water: 0, descender: 0 } }),
    );
    expectIssue(result, 'empty_deity_group');
  });

  it('拒绝空平民', () => {
    const result = validateRuleset(experimental({ roles: { ...THEATER_DEATH_13.roles, civilian: 0 } }));
    expectIssue(result, 'empty_civilian_group');
  });

  it('拒绝零魂灵', () => {
    const result = validateRuleset(experimental({ roles: { ...THEATER_DEATH_13.roles, spirit: 0 } }));
    expectIssue(result, 'zero_spirits');
  });

  it('拒绝零死神', () => {
    const result = validateRuleset(experimental({ roles: { ...THEATER_DEATH_13.roles, death: 0 } }));
    expectIssue(result, 'missing_death_role');
  });

  it('拒绝无科研员却保留死亡前置', () => {
    const result = validateRuleset(experimental({ roles: { ...THEATER_DEATH_13.roles, researcher: 0 } }));
    expectIssue(result, 'researcher_condition_without_researcher');
  });

  it('拒绝特殊角色重复', () => {
    const result = validateRuleset(experimental({ roles: { ...THEATER_DEATH_13.roles, death: 2 } }));
    expectIssue(result, 'duplicate_unsupported_role');
  });

  it('实验配置中魂灵与平民的额外数量结构合法', () => {
    const result = validateRuleset(
      experimental({ roles: { ...THEATER_DEATH_13.roles, spirit: 3, civilian: 5 } }),
    );
    expect(result.ok).toBe(true);
  });

  it('拒绝负数角色数量', () => {
    const result = validateRuleset(experimental({ roles: { ...THEATER_DEATH_13.roles, civilian: -1 } }));
    expectIssue(result, 'invalid_role_count');
  });

  it('拒绝未知角色', () => {
    const result = validateRuleset(experimental({ roles: { ...THEATER_DEATH_13.roles, npc: 1 } }));
    expectIssue(result, 'unknown_role');
  });

  it('拒绝缺失的角色条目', () => {
    const roles: Record<string, number> = { ...THEATER_DEATH_13.roles };
    delete roles.civilian;
    const result = validateRuleset(experimental({ roles }));
    expectIssue(result, 'missing_role_entry');
  });

  it('拒绝非法时限', () => {
    const result = validateRuleset(
      experimental({ timersSeconds: { ...THEATER_DEATH_13.timersSeconds, faction: 0 } }),
    );
    expectIssue(result, 'invalid_timer');
  });

  it('拒绝非法策略值', () => {
    const result = validateRuleset(experimental({ attackOrder: 'bogus' }));
    expectIssue(result, 'invalid_policy_value');
  });

  it('拒绝非法数字策略', () => {
    const result = validateRuleset(experimental({ guardBlocksPerTarget: 0 }));
    expectIssue(result, 'invalid_numeric_policy');
  });

  it('拒绝非对象输入', () => {
    const result = validateRuleset('not a ruleset');
    expectIssue(result, 'not_an_object');
  });

  it('T-49：变体配置在正式模式被拒绝', () => {
    const result = validateRuleset({
      ...THEATER_DEATH_13,
      roles: { ...THEATER_DEATH_13.roles, civilian: 3, spirit: 3 },
    });
    expectIssue(result, 'formal_preset_mismatch');
  });

  it('T-49：同一变体切换实验模式后结构检查通过（实验值由大厅标记保存）', () => {
    const result = validateRuleset(
      experimental({ roles: { ...THEATER_DEATH_13.roles, civilian: 3, spirit: 3 } }),
    );
    expect(result.ok).toBe(true);
  });
});
