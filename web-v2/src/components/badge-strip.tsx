import type { BadgeItem } from '../presentation/badges.ts';
import { badgeStripLabel, isSplitStrip } from '../presentation/badges.ts';
import { factionKey } from '../presentation/faction.ts';

/**
 * 通用徽标条（可复用）：
 * - 一枚徽标 = 一个圆角底色块；
 * - 多枚徽标 = **共用一个底色框、按色调等分**（左→右即 `items` 顺序），半块之间用细白线分隔。
 *
 * 只负责呈现：文案与顺序来自传入的 `items`，底色来自 `styles/main.css` 的 `.badge-strip__item--{tone}`。
 * 尺寸用 `size`（`sm` 10px / `md` 12px），宿主容器可通过 CSS 再覆盖字号。
 */
export function BadgeStrip({ items, size = 'sm', className = '', ariaLabel }: {
  items: readonly BadgeItem[];
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}) {
  if (items.length === 0) return null;
  const classes = ['badge-strip', `badge-strip--${size}`];
  if (isSplitStrip(items)) classes.push('badge-strip--split');
  if (className) classes.push(className);
  return <span className={classes.join(' ')} aria-label={ariaLabel ?? badgeStripLabel(items)}>
    {items.map(item => {
      const key = factionKey(item.faction);
      return <span
        key={item.id}
        className={`badge-strip__item badge-strip__item--${item.tone}${key ? ` badge-strip__item--faction-${key}` : ''}`}
        data-badge={item.tone}
        {...(key ? { 'data-faction': key } : {})}
        title={item.title}
        aria-hidden="true"
      >{item.label}</span>;
    })}
  </span>;
}
