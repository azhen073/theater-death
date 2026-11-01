import type { RulesetConfig } from '../../rulesets/types.ts';
import { validateRuleset, type ValidationIssue, type ValidationResult } from '../../rulesets/validate.ts';

/**
 * 校验实验板子，并在通用规则校验之上补两项只跟 HTTP 入口有关的判断：
 * 总人数上限，以及「声明的玩家人数」是否与角色数量一致。
 *
 * 为什么先做类型守卫：调用方把请求体原样传进来，`roles` 可能是 null、字符串或数字。
 * 之前的实现直接 `Object.values(config.roles)`，遇到 null 会抛 TypeError，
 * 让本该 400 的坏请求变成 500（`/rooms` 与 `/rulesets/validate` 共用本函数）。
 * `validateRuleset` 自身能处理非法 roles（返回 missing_roles 等），所以这里只负责
 * 在取键之前挡一下，并把「数不清总数」的情况显式记为 null。
 */
export function validateBoard(config: RulesetConfig, playerCount?: unknown): ValidationResult {
  const issues: ValidationIssue[] = [...validateRuleset(config).issues];
  // roles 非对象（缺失 / null / 数组 / 原始值）时不去枚举，交给 validateRuleset 产出具体错误码。
  const roles: unknown = config.roles;
  const values = roles !== null && typeof roles === 'object' && !Array.isArray(roles) ? Object.values(roles) : [];
  const countable = roles !== null && typeof roles === 'object' && !Array.isArray(roles) && values.every(value => typeof value === 'number' && Number.isSafeInteger(value));
  const count = countable ? (values as number[]).reduce((sum, value) => sum + value, 0) : null;
  if (count !== null && count > 64) issues.push({ code: 'player_limit', message: '玩家总数不能超过 64 人' });
  // 总数数不清时已经有 invalid_role_count / missing_roles 之类的错误，不再叠加人数不一致的噪音。
  if (count !== null && playerCount !== undefined && count !== playerCount) issues.push({ code: 'player_count_mismatch', message: '玩家人数与角色数量不一致' });
  return { ok: issues.length === 0, issues };
}
