import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { JsonValue, RoomSnapshot } from '../../../../contracts/v2.ts';
import type { RoleId } from '../../../../rulesets/types.ts';
import { describeEvent } from '../../presentation/events.ts';
import type { EventText } from '../../presentation/events.ts';

export interface ReviewPlayer { playerId: string; uid: string; seat: number; roleId: RoleId; life: 'alive' | 'dead'; revealed: boolean; nickname: string; avatarUrl: string | null }
export interface ReviewEvent { dayNumber: number; stage: 1 | 2; type: string; payload: JsonValue }
export interface ReviewMessage { id: number; messageId?: string; senderId: string; senderSeat: number | null; text: string; at: number }
export interface ReviewDTO {
  gameId: string; winner: 'human' | 'death_faction'; reason: string; endedAtDay: number;
  players: ReviewPlayer[]; timeline: ReviewEvent[]; chat: { public: ReviewMessage[]; faction: ReviewMessage[] };
  startedAt: number; endedAt: number; durationMs: number;
}
export const reviewScope = (view: RoomSnapshot) => JSON.stringify([view.viewer.userId, view.roomId, view.gameId, view.viewer.memberId, view.viewer.kind, view.viewer.subjectPlayerId, view.room.phase]);

/** Server-only events become visible only through the authorized end-game review. */
export function reviewEventText(event: ReviewEvent, review: ReviewDTO, view: RoomSnapshot, catalog: CatalogDTO): EventText {
  const p = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
  const player = (id: unknown) => { const found = review.players.find(item => item.playerId === id); return found ? `${found.seat}号 ${found.nickname}` : '未提供玩家'; };
  const array = (value: JsonValue | undefined): JsonValue[] => Array.isArray(value) ? value : [];
  const object = (value: JsonValue): Record<string, JsonValue> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  switch (event.type) {
    case 'attack_events': return { title: '本夜攻击与抵挡', details: array(p.attacks).map(item => {
      const attack = object(item), role = catalog.roles.find(role => role.roleId === attack.sourceRoleId)?.name ?? '攻击者';
      return `${role} → ${player(attack.targetPlayerId)}：${attack.blocked === true ? '已抵挡' : '未抵挡'}`;
    }) };
    case 'guard_sacrifice': return { title: '门先生双守牺牲', details: [`${player(p.doorId)}；守护目标：${array(p.targets).map(player).join('、') || '未提供'}`] };
    case 'rescue_declined': return { title: '未使用还魂曲', details: [] };
    case 'revive_selected': return { title: '深海召回目标', details: [player(p.targetPlayerId)] };
    case 'stage1_attack_disabled': return { title: '一阶段攻击能力失效', details: [`本夜重合死亡 ${p.overlap ?? '—'} 人，阈值 ${p.threshold ?? '—'} 人。`] };
    case 'night_deaths_confirmed': return { title: '夜末死亡确认', details: [array(p.deaths).map(item => player(object(item).playerId)).join('、') || '无人'] };
    case 'role_assigned': return { title: '身份分配', details: [`${player(p.playerId)}：${catalog.roles.find(role => role.roleId === p.roleId)?.name ?? '未提供身份'}`] };
    default: return describeEvent(event, view, catalog);
  }
}
