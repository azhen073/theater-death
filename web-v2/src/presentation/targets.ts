import type { RoomSnapshot } from '../../../contracts/v2.ts';

export function targetSummary(view: RoomSnapshot, ids: readonly string[]): string {
  if (!ids.length) return '空选择';
  const counts = new Map<string, number>(); for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, count]) => {
    const seat = view.public?.seats.find(item => item.playerId === id);
    return `${seat ? `${seat.seat}号 ${seat.nickname}` : '该玩家'}${count > 1 ? ` ×${count}` : ''}`;
  }).join('、');
}
