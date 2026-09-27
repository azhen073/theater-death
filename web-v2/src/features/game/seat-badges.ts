import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot, SeatDTO } from '../../../../contracts/v2.ts';
import { badge, type BadgeItem } from '../../presentation/badges.ts';

/**
 * 座位卡徽标，**左→右顺序固定为：身份（本人）→ 天理 → 魂灵**（用户裁定）。
 *
 * - 身份：**只出现在本人座位上**，文案取 `private.self.roleId` → `catalog.roles[].name`，
 *   底色**按该身份的阵营**（`role.faction`，人类 / 死神阵营，配色与身份弹窗、复盘的阵营标签统一）；
 *   第二屏（只读绑定视角）看到的是被绑定玩家的私有视图，因此同样显示（座位号行已有「视角」标记区分）；
 *   公开观众没有私有视图 → 不显示。
 * - 天理：公开信息（`public.sheriff.holderId`），所有视角可见；
 * - 魂灵：私有知识（`private.knowledge.spiritSeats`）——服务端只对死神 / 丧亲者（全部魂灵）与魂灵（不含自己）下发，
 *   其余身份与观众拿到空数组，因此这里不需要再做权限判断。
 *
 * 只读推导，无副作用、不读时间。catalog 查不到该身份名时不显示（与「公开翻牌」同口径，不显示原始 roleId）。
 */
export function seatBadges(view: RoomSnapshot, seat: SeatDTO, catalog?: CatalogDTO | null): BadgeItem[] {
  const items: BadgeItem[] = [];
  const self = view.private?.self ?? null;
  if (self && self.playerId === seat.playerId) {
    const role = catalog?.roles.find(item => item.roleId === self.roleId);
    if (role) items.push(badge('identity', { label: role.name, faction: role.faction }));
  }
  if (view.public?.sheriff.holderId === seat.playerId) items.push(badge('sheriff'));
  if ((view.private?.knowledge?.spiritSeats ?? []).includes(seat.seat)) items.push(badge('spirit'));
  return items;
}
