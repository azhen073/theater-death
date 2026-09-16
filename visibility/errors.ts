import type { NightValidationIssue } from '../engine/night.ts';

export interface ClientError {
  readonly code: string;
  readonly message: string;
}

/**
 * 引擎 issue → 客户端错误。
 * 文案取自引擎的受控消息：只解释自身限制（如"不在本次可选范围"），
 * 不解释"目标被保护""目标是水妖"等未授权秘密（R-19、需求 §07）。
 */
export function toClientError(issue: NightValidationIssue): ClientError {
  return { code: issue.code, message: issue.message };
}
