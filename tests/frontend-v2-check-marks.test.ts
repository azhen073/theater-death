import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../contracts/v2.ts';
import { checkMarks } from '../web-v2/src/features/game/seat-check-marks.ts';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/contract-2.1/${name}`, import.meta.url), 'utf8')) as T;
}

const base = fixture<RoomSnapshot>('night-spirit-full.json');

/** 降临者视角：私有知识只来自本人事件流，spiritSeats 为空。 */
function descenderView(): RoomSnapshot {
  const next = structuredClone(base);
  next.private!.self = { ...next.private!.self, roleId: 'descender' };
  next.private!.knowledge = { spiritSeats: [] };
  next.private!.events = [];
  return next;
}

function record(
  view: RoomSnapshot,
  night: number,
  seatNumber: number,
  kind: 'is_spirit' | 'in_death_faction',
  answer: boolean,
): void {
  const target = view.public!.seats.find(item => item.seat === seatNumber);
  if (!target) throw new Error(`夹具缺少 ${seatNumber} 号座位`);
  view.private!.events = [...view.private!.events, {
    cursor: view.private!.events.length + 1,
    type: 'descender_check_result',
    dayNumber: night,
    stage: kind === 'is_spirit' ? 1 : 2,
    payload: { nightNumber: night, targetPlayerId: target.playerId, targetSeat: seatNumber, kind, answer },
  }];
}

function idOf(view: RoomSnapshot, seatNumber: number): string {
  const target = view.public!.seats.find(item => item.seat === seatNumber);
  if (!target) throw new Error(`夹具缺少 ${seatNumber} 号座位`);
  return target.playerId;
}

describe('降临者查验结果派生（checkMarks）', () => {
  it('没有私有事件（或没有私有视图）时没有任何徽标', () => {
    expect(checkMarks(descenderView()).size).toBe(0);
    const publicOnly = structuredClone(base);
    publicOnly.private = null;
    expect(checkMarks(publicOnly).size).toBe(0);
  });

  it('一阶段：是魂灵 → 魂灵，不是魂灵 → 非魂灵', () => {
    const view = descenderView();
    record(view, 1, 3, 'is_spirit', true);
    record(view, 1, 4, 'is_spirit', false);
    const marks = checkMarks(view);
    expect(marks.get(idOf(view, 3))).toMatchObject({ tone: 'spirit', label: '魂灵' });
    expect(marks.get(idOf(view, 4))).toMatchObject({ tone: 'checked-not-spirit', label: '非魂灵' });
  });

  it('二阶段：属于死神阵营 → 死神阵营，不属于 → 人类阵营', () => {
    const view = descenderView();
    record(view, 3, 5, 'in_death_faction', true);
    record(view, 3, 6, 'in_death_faction', false);
    const marks = checkMarks(view);
    expect(marks.get(idOf(view, 5))).toMatchObject({ tone: 'checked-death', label: '死神阵营' });
    expect(marks.get(idOf(view, 6))).toMatchObject({ tone: 'checked-human', label: '人类阵营' });
  });

  it('同一座位只保留最近一次（先比夜次，同夜取后者）', () => {
    const view = descenderView();
    record(view, 1, 7, 'is_spirit', false);
    record(view, 5, 7, 'in_death_faction', true);
    expect(checkMarks(view).get(idOf(view, 7))).toMatchObject({ tone: 'checked-death', label: '死神阵营' });
    // 同夜重复查验：后提交的覆盖先提交的
    record(view, 5, 7, 'in_death_faction', false);
    expect(checkMarks(view).get(idOf(view, 7))).toMatchObject({ tone: 'checked-human', label: '人类阵营' });
    // 夜次更早的旧事件不会反向覆盖
    record(view, 2, 7, 'is_spirit', true);
    expect(checkMarks(view).get(idOf(view, 7))).toMatchObject({ tone: 'checked-human', label: '人类阵营' });
  });

  it('每个座位最多一枚，且互不影响', () => {
    const view = descenderView();
    record(view, 1, 8, 'is_spirit', true);
    record(view, 1, 9, 'is_spirit', false);
    const marks = checkMarks(view);
    expect(marks.size).toBe(2);
    expect([...marks.values()].map(item => item.label).sort()).toEqual(['非魂灵', '魂灵']);
  });

  it('未知类别、非布尔答案、缺目标或非法载荷一律跳过（不猜、不显示）', () => {
    const view = descenderView();
    const target = view.public!.seats[0]!;
    const payloads = [
      { nightNumber: 1, targetPlayerId: target.playerId, targetSeat: target.seat, kind: 'unknown_kind', answer: true },
      { nightNumber: 1, targetPlayerId: target.playerId, targetSeat: target.seat, kind: 'is_spirit', answer: 'yes' },
      { nightNumber: 1, kind: 'is_spirit', answer: true },
      null,
      'text',
    ];
    for (const payload of payloads) {
      view.private!.events = [...view.private!.events, {
        cursor: view.private!.events.length + 1, type: 'descender_check_result', dayNumber: 1, stage: 1, payload: payload as never,
      }];
    }
    expect(checkMarks(view).size).toBe(0);
  });

  it('只看 descender_check_result：其它私有事件不产生徽标，且只读不改原视图', () => {
    const view = descenderView();
    view.private!.events = [...view.private!.events, {
      cursor: 1, type: 'role_assigned', dayNumber: 0, stage: 1, payload: { roleId: 'descender' },
    }];
    const before = JSON.stringify(view);
    expect(checkMarks(view).size).toBe(0);
    expect(JSON.stringify(view)).toBe(before);
  });

  it('第二屏（只读绑定视角）沿用同一份私有事件流', () => {
    const view = descenderView();
    record(view, 1, 2, 'is_spirit', true);
    view.viewer = { ...view.viewer, kind: 'private_spectator', readOnly: true };
    expect(checkMarks(view).get(idOf(view, 2))).toMatchObject({ tone: 'spirit', label: '魂灵' });
  });
});
