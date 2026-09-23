import type { RoleId } from '../../../../rulesets/types.ts';

/** Presentation summaries of rules-v2-full.md, not an ability/permission engine. */
const summaries: Record<RoleId, { clauses: string; phases: [string, string] }> = {
  laike: { clauses: 'R-15', phases: ['整局一次夜间刺杀；使用后晨间翻牌并冻结票权。', '已翻牌者恢复票权；未翻牌者可每夜刺杀。两个分支不叠加。'] },
  door: { clauses: 'R-16–R-19、R-49', phases: ['每夜守护自己以外最多两人，每人抵挡一刀；两名对象都守护成功时自身牺牲。连续目标限制仍适用。', '保留守护与连续目标限制，取消双守成功的自我牺牲；转换时，因守护牺牲而当前死亡的门先生立即回归。'] },
  water: { clauses: 'R-20–R-23', phases: ['尚未使用还魂曲时获得濒死名单，可整局一次救自己以外一名当夜濒死者；使用后失去名单视野。', '仅在采用二阶段规则的夜晚死亡时，可选择自己以外一名已死者在紧接着的白天回归。白天出局及一阶段夜死不能补触发。'] },
  descender: { clauses: 'R-24', phases: ['每夜查验一人是否为魂灵，并获得濒死名单。', '每夜查验一人是否属于死神阵营；不再获得濒死名单，也不揭示完整身份。'] },
  researcher: { clauses: 'R-25、R-50', phases: ['死亡后翻牌并触发阶段转换，公告当前存活死神阵营人数（含丧亲者），整局一次。', '回归不撤销翻牌或阶段转换，也不刷新整局一次的公告；胜负条件仍按当前生命状态判断。'] },
  civilian: { clauses: 'R-03、R-26', phases: ['没有特殊技能；按当前权限参与讨论和投票。', '没有新增特殊技能；仍按当前权限参与讨论和投票。'] },
  death: { clauses: 'R-27–R-29、R-52', phases: ['知晓魂灵，独立每夜最多袭击两人；不进入魂灵私聊，过量击杀可能令后续一阶段袭击失技。', '与魂灵联合每夜最多两个攻击名额，不继承一阶段失技。转阶段时仍有魂灵未淘汰才加入阵营房，已死则只读，之后不补拉。'] },
  spirit: { clauses: 'R-29、R-30、R-47', phases: ['魂灵互知并协商；团队当夜攻击名额上限等于存活魂灵人数，可少刀或空刀。', '与死神联合每夜最多两个攻击名额，不与一阶段额度叠加；保留团队方案确认与截止兜底规则。'] },
  mourner: { clauses: 'R-31', phases: ['知晓魂灵，不知晓死神；无夜间技能，永不进入阵营房。', '没有新增夜间技能，仍不进入阵营房；人类获胜不要求淘汰丧亲者。'] },
};

export function phaseAbility(roleId: RoleId, stage: 1 | 2) {
  const entry = summaries[roleId];
  return { current: entry.phases[stage - 1], other: entry.phases[stage === 1 ? 1 : 0], clauses: entry.clauses };
}
