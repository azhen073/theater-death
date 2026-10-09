/**
 * 徽标（badge）通用模型：色调注册表、拼装、无障碍文案与「等分底色框」判定。
 *
 * 复用方式（新增一枚徽标只需要三处，不改组件）：
 *   1. 在 `BadgeTone` 加色调、在 `BADGE_TONES` 加默认文案；
 *   2. 在 `main.css` 加一条 `.badge-strip__item--{tone}` 底色；
 *   3. 在业务侧写一个派生函数（如 `features/game/seat-badges.ts`）返回 `BadgeItem[]`。
 * 组件 `components/badge-strip.tsx` 只认识「色调 + 文案」，不关心业务来源。
 */
import type { Faction } from './faction.ts';
export type BadgeTone = 'identity' | 'sheriff' | 'spirit';

export interface BadgeToneSpec {
  /** 默认文案（业务可覆盖）。 */
  label: string;
}

/** 已知色调。色调类名恒为 `badge-strip__item--{tone}`（见 `styles/main.css`）。 */
export const BADGE_TONES: Record<BadgeTone, BadgeToneSpec> = {
  identity: { label: '身份' },
  sheriff: { label: '天理' },
  spirit: { label: '魂灵' },
};

export interface BadgeItem {
  /** 列表内稳定 key（同一座位不重复色调即可）。 */
  id: string;
  tone: BadgeTone;
  label: string;
  /** 可选原生 tooltip。 */
  title?: string;
  /** 可选阵营：用于按阵营配色（`badge-strip__item--faction-human|death`）。 */
  faction?: Faction;
}

/** 由色调生成徽标项；文案/标题/阵营可覆盖。 */
export function badge(tone: BadgeTone, overrides: { id?: string; label?: string; title?: string; faction?: Faction } = {}): BadgeItem {
  const item: BadgeItem = { id: overrides.id ?? tone, tone, label: overrides.label ?? BADGE_TONES[tone].label };
  if (overrides.title !== undefined) item.title = overrides.title;
  if (overrides.faction !== undefined) item.faction = overrides.faction;
  return item;
}

/** 多枚徽标共用一个底色框、按色调等分（左→右即数组顺序）。 */
export function isSplitStrip(items: readonly BadgeItem[]): boolean {
  return items.length > 1;
}

/** 无障碍名：顿号分隔，避免读屏把「天理魂灵」连读成一个词；空列表返回空串。 */
export function badgeStripLabel(items: readonly BadgeItem[]): string {
  return items.map(item => item.label).join('、');
}
