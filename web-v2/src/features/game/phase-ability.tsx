import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoleId } from '../../../../rulesets/types.ts';
import { phaseAbility } from './phase-ability-model.ts';
import '../../styles/phase-ability.css';

/** Call only inside an authorized private view; never mounted in the public panel. */
export function PhaseAbility({ roleId, stage, catalog, readOnly }: { roleId: RoleId; stage: 1 | 2; catalog: CatalogDTO; readOnly: boolean }) {
  const role = catalog.roles.find(item => item.roleId === roleId);
  if (!role) return null;
  const ability = phaseAbility(roleId, stage);
  return <section className="phase-ability" aria-label="当前阶段身份能力">
    <p className="phase-ability__scope">{readOnly ? '当前观察视角' : '仅自己可见'} · {role.name}</p>
    <h3>第 {stage} 阶段 · 身份能力说明</h3>
    <p className="phase-ability__current">{ability.current}</p>
    <p className="phase-ability__boundary">这是规则说明，不代表此刻可行动；生死、技能次数和当前操作以服务端下发的舞台任务为准。</p>
    <details><summary>第 {stage === 1 ? 2 : 1} 阶段说明（非当前阶段）</summary><p>{ability.other}</p></details>
    <small>规则 {catalog.rulesVersion} · {ability.clauses}</small>
  </section>;
}
