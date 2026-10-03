import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { badge, type BadgeItem } from '../../presentation/badges.ts';

/**
 * 降临者查验结果（R-24）→ 座位徽标。
 *
 * 数据来源＝本人私有事件流里的 `descender_check_result`（`engine/night.ts` 的
 * `resolveDescenderCheck` 只把该事件发给查验者本人，服务端已完成裁剪），因此这里不需要再做权限判断：
 * - 一阶段 `kind='is_spirit'`：`answer=true` → 魂灵，`false` → 非魂灵；
 * - 二阶段 `kind='in_death_faction'`：`answer=true` → 死神阵营，`false` → 人类阵营；
 * - 其它/未知载荷一律跳过（不猜、不显示）。
 *
 * **一个座位只保留最近一次查验结果**（先比 `nightNumber`，同夜按事件顺序取后者，用户裁定 2026-10-03）。
 * 只读推导，无副作用、不读时间。
 */
export function checkMarks(view: RoomSnapshot): Map<string, BadgeItem> {
  const latest = new Map<string, { night: number; order: number; item: BadgeItem }>();
  let order = 0;
  for (const event of view.private?.events ?? []) {
    order += 1;
    if (event.type !== 'descender_check_result') continue;
    const payload = event.payload as { targetPlayerId?: unknown; nightNumber?: unknown; kind?: unknown; answer?: unknown } | null;
    if (payload === null || typeof payload !== 'object') continue;
    if (typeof payload.targetPlayerId !== 'string' || typeof payload.answer !== 'boolean') continue;
    const item = checkBadge(payload.kind, payload.answer);
    if (item === null) continue;
    const night = typeof payload.nightNumber === 'number' ? payload.nightNumber : 0;
    const previous = latest.get(payload.targetPlayerId);
    if (previous !== undefined && (previous.night > night || (previous.night === night && previous.order > order))) continue;
    latest.set(payload.targetPlayerId, { night, order, item });
  }
  return new Map([...latest].map(([playerId, entry]) => [playerId, entry.item]));
}

function checkBadge(kind: unknown, answer: boolean): BadgeItem | null {
  if (kind === 'is_spirit') return badge(answer ? 'spirit' : 'checked-not-spirit');
  if (kind === 'in_death_faction') return badge(answer ? 'checked-death' : 'checked-human');
  return null;
}
