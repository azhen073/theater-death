import type { RoomSnapshot, SeatDTO } from '../../../../contracts/v2.ts';

/**
 * 本夜濒死标记（R-20 / R-24）：名单由**服务端按授权裁剪**后放在 `private.knowledge.dyingSeats`
 * （只有一阶段夜间、名单已产生时，才下发给未死亡的降临者与未使用还魂曲的水妖）。
 *
 * 因此这里只读不推断：字段不存在（其他身份 / 观众 / 二阶段 / 白天 / 名单未产生 / 水妖已用还魂曲）
 * 就恒为 false；绝不会因为公开数据而显示。只读推导，无副作用、不读时间。
 */
export function seatDyingMark(view: RoomSnapshot, seat: SeatDTO): boolean {
  return (view.private?.knowledge?.dyingSeats ?? []).includes(seat.seat);
}
