import type { CatalogRoleDTO } from '../../../../contracts/catalog.ts';

export function phaseAbility(role: CatalogRoleDTO, stage: 1 | 2) {
  const current = role.abilities.find(ability => ability.stage === stage);
  const other = role.abilities.find(ability => ability.stage !== stage);
  if (!current || !other) throw new Error(`Incomplete ability content for ${role.roleId}`);
  return { current: current.summary, other: other.summary, clauses: current.clauses };
}
