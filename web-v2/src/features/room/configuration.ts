import type { RoleId } from '../../../../rulesets/types.ts';

export function roleTotal(roles: Record<RoleId, number>): number {
  return Object.values(roles).reduce((total, count) => total + count, 0);
}
