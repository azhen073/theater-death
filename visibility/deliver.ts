import type { GameEvent } from '../engine/events.ts';
import type { ViewerContext } from './context.ts';

/**
 * 事件投递规则：服务端先裁剪再发送，禁止先发全量再由页面隐藏。
 * - public：所有局内玩家可见（含死者）
 * - players：仅名单内玩家可见（已合法获得的知识不因死亡清空）
 * - faction：阵营级信息，投递给该阵营玩家；阵营房消息不走此通道，
 *   房间的成员资格与历史边界由 rooms.ts 单独判定（R-34、R-52）
 * - server：服务端内部事件，永不投递给玩家
 */
export function isVisibleTo(event: GameEvent, viewer: ViewerContext): boolean {
  switch (event.visibility.kind) {
    case 'public':
      return true;
    case 'players':
      return event.visibility.playerIds.includes(viewer.playerId);
    case 'faction':
      return event.visibility.factionId === viewer.factionId;
    case 'server':
      return false;
  }
}

export function filterVisible(
  events: readonly GameEvent[],
  viewer: ViewerContext,
): readonly GameEvent[] {
  return events.filter((event) => isVisibleTo(event, viewer));
}
