import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { JsonValue, RoomSnapshot } from '../../../../contracts/v2.ts';
import type { RoleId } from '../../../../rulesets/types.ts';
import { describeEvent } from '../../presentation/events.ts';
import type { EventText } from '../../presentation/events.ts';
import { parseVoteTally, type VoteTally } from '../../presentation/vote-tally.ts';

export interface ReviewPlayer { playerId: string; uid: string; seat: number; roleId: RoleId; life: 'alive' | 'dead'; revealed: boolean; nickname: string; avatarUrl: string | null }
export interface ReviewEvent { dayNumber: number; stage: 1 | 2; type: string; payload: JsonValue }
export interface ReviewMessage { id: number; messageId?: string; senderId: string; senderSeat: number | null; text: string; at: number }
export interface ReviewDTO {
  gameId: string; winner: 'human' | 'death_faction'; reason: string; endedAtDay: number;
  players: ReviewPlayer[]; timeline: ReviewEvent[]; chat: { public: ReviewMessage[]; faction: ReviewMessage[] };
  startedAt: number; endedAt: number; durationMs: number;
}
export const reviewScope = (view: RoomSnapshot) => JSON.stringify([view.viewer.userId, view.roomId, view.gameId, view.viewer.memberId, view.viewer.kind, view.viewer.subjectPlayerId, view.room.phase]);

const seatNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

/** 复盘时间线携带原始引擎 payload（visibility/review.ts 不过滤），与公共票型事件同构；补 cursor 0 复用公共解析。 */
export function reviewVoteTally(event: ReviewEvent): VoteTally | null {
  return parseVoteTally({ type: event.type, payload: event.payload, cursor: 0, dayNumber: event.dayNumber, stage: event.stage });
}

/** 死亡类事件的座位号列表（渲染座位徽标横排）；非死亡事件返回 null，空名单返回 []（保留原文字行如「无人」）。 */
export function reviewDeathSeats(event: ReviewEvent, review: ReviewDTO): number[] | null {
  const p = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload as Record<string, JsonValue> : {};
  switch (event.type) {
    case 'deaths_announced':
      return (Array.isArray(p.seats) ? p.seats : []).map(seatNumber).filter((seat): seat is number => seat !== null);
    case 'elimination_announced': {
      const seat = seatNumber(p.seat);
      return seat === null ? [] : [seat];
    }
    case 'night_deaths_confirmed':
      return (Array.isArray(p.deaths) ? p.deaths : []).map(item => {
        const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, JsonValue> : {};
        return review.players.find(player => player.playerId === row.playerId)?.seat ?? null;
      }).filter((seat): seat is number => seat !== null);
    default: return null;
  }
}

/** 时间线轮次锚点：按首次出现顺序的去重 dayNumber（用于「第 N 轮」跳转 chip）。 */
export function reviewDayAnchors(timeline: readonly ReviewEvent[]): number[] {
  const days: number[] = [];
  for (const event of timeline) if (!days.includes(event.dayNumber)) days.push(event.dayNumber);
  return days;
}

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

export type ReviewEventCategory = 'death' | 'vote' | 'action';
export interface ReviewFilters {
  dayNumber: number | null;
  category: ReviewEventCategory | null;
  playerId: string | null;
}

const actionEvents = new Set([
  'attack_events', 'guard', 'guard_sacrifice', 'laike', 'faction', 'proposal_updated', 'proposal_confirmed',
  'check', 'descender_check', 'descender_check_result', 'rescue_declined', 'rescue_selected', 'revive_selected',
  'stage1_attack_disabled', 'speech_order', 'last_words', 'handover',
]);

export function reviewEventCategory(event: ReviewEvent): ReviewEventCategory | null {
  if (['deaths_announced', 'elimination_announced', 'night_deaths_confirmed'].includes(event.type)) return 'death';
  if (reviewVoteTally(event) !== null || /vote|election|ballot|candidacy/.test(event.type)) return 'vote';
  return actionEvents.has(event.type) ? 'action' : null;
}

export function reviewEventPlayerIds(event: ReviewEvent, review: ReviewDTO): Set<string> {
  const ids = new Set<string>();
  const seats = new Map(review.players.map(player => [player.seat, player.playerId]));
  const visit = (value: JsonValue, key = '') => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
      return;
    }
    if (/playerIds?$/i.test(key) && typeof value === 'string') ids.add(value);
    if (/(?:^seat$|^seats$|Seats?$)/.test(key)) {
      const seat = seatNumber(value);
      const playerId = seat === null ? undefined : seats.get(seat);
      if (playerId) ids.add(playerId);
    }
  };
  visit(event.payload);
  return ids;
}

export function filterReviewTimeline(timeline: readonly ReviewEvent[], review: ReviewDTO, filters: ReviewFilters): ReviewEvent[] {
  return timeline.filter(event => {
    if (filters.dayNumber !== null && event.dayNumber !== filters.dayNumber) return false;
    if (filters.category !== null && reviewEventCategory(event) !== filters.category) return false;
    if (filters.playerId !== null && !reviewEventPlayerIds(event, review).has(filters.playerId)) return false;
    return true;
  });
}
