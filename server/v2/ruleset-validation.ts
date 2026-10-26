import type { RulesetConfig } from '../../rulesets/types.ts';
import { validateRuleset, type ValidationIssue, type ValidationResult } from '../../rulesets/validate.ts';

export function validateBoard(config: RulesetConfig, playerCount?: unknown): ValidationResult {
  const issues: ValidationIssue[] = [...validateRuleset(config).issues];
  const values = Object.values(config.roles);
  const count = values.every(value => typeof value === 'number' && Number.isSafeInteger(value)) ? values.reduce((sum, value) => sum + value, 0) : null;
  if (count !== null && count > 64) issues.push({ code: 'player_limit', message: '玩家总数不能超过 64 人' });
  if (playerCount !== undefined && count !== playerCount) issues.push({ code: 'player_count_mismatch', message: '玩家人数与角色数量不一致' });
  return { ok: issues.length === 0, issues };
}
