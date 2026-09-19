import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoleId } from '../../../../rulesets/types.ts';

export function roleTotal(roles: Record<RoleId, number>): number {
  return Object.values(roles).reduce((total, count) => total + count, 0);
}

/** Form feedback only. The service remains the authority for every submitted board. */
export function boardIssues(roles: Record<RoleId, number>, catalog: CatalogDTO): string[] {
  const issues: string[] = [];
  const names = new Map(catalog.roles.map(role => [role.roleId, role.name]));
  const known = new Set<string>(names.keys());
  if (Object.keys(roles).some(id => !known.has(id))) issues.push('配置中包含未知角色。');
  for (const role of catalog.roles) {
    const count = roles[role.roleId];
    if (!Number.isSafeInteger(count) || count < 0) { issues.push(`${role.name}人数须为非负整数。`); continue; }
    if (!catalog.constraints.repeatableRoleIds.includes(role.roleId) && count > 1) issues.push(`${role.name}最多一名。`);
    if (catalog.constraints.requiredRoleIds.includes(role.roleId) && count < 1) issues.push(`至少需要一名${role.name}。`);
  }
  const total = roleTotal(roles);
  if (!Number.isSafeInteger(total) || total < catalog.constraints.minPlayers || total > catalog.constraints.maxPlayers) {
    issues.push(`玩家总数须在 ${catalog.constraints.minPlayers}–${catalog.constraints.maxPlayers} 人之间。`);
  }
  if (!catalog.constraints.requiresAnyOf.some(id => roles[id] > 0)) {
    issues.push(`至少包含一种神职：${catalog.constraints.requiresAnyOf.map(id => names.get(id)).join('、')}。`);
  }
  return issues;
}
