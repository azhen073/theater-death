/**
 * 阵营的统一定义与配色口径（catalog 的 `role.faction` 为准）。
 *
 * 配色只有一处来源：`styles/main.css` 的 `--faction-human` / `--faction-death` 两个变量，
 * 徽标（`.badge-strip__item--faction-*`）与文字标签（`.faction-tag--*`）共用，
 * 因此座位徽标与「我的身份」「开局身份卡」等处的阵营颜色始终一致。
 */
export type Faction = 'human' | 'death_faction';

export const FACTION_LABELS: Record<Faction, string> = {
  human: '人类阵营',
  death_faction: '死神阵营',
};

/** CSS 修饰后缀：`human` / `death`；未知阵营返回 null（不猜）。 */
export function factionKey(faction: Faction | null | undefined): 'human' | 'death' | null {
  if (faction === 'human') return 'human';
  if (faction === 'death_faction') return 'death';
  return null;
}

/** 阵营中文名；未知返回空串（与既有界面口径一致，不显示占位词）。 */
export function factionLabel(faction: Faction | null | undefined): string {
  const key = factionKey(faction);
  return key === null ? '' : FACTION_LABELS[key === 'human' ? 'human' : 'death_faction'];
}
