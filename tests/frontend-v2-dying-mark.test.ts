import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../contracts/v2.ts';
import { seatDyingMark } from '../web-v2/src/features/game/seat-dying.ts';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/contract-2.1/${name}`, import.meta.url), 'utf8')) as T;
}

const base = fixture<RoomSnapshot>('night-spirit-full.json');

function view(dyingSeats?: number[]): RoomSnapshot {
  const next = structuredClone(base);
  if (dyingSeats === undefined) delete (next.private!.knowledge as { dyingSeats?: number[] }).dyingSeats;
  else next.private!.knowledge.dyingSeats = dyingSeats;
  return next;
}

function seatAt(view: RoomSnapshot, seatNumber: number) {
  const seat = view.public!.seats.find(item => item.seat === seatNumber);
  if (!seat) throw new Error(`夹具缺少 ${seatNumber} 号座位`);
  return seat;
}

describe('座位濒死标记（只读服务端裁剪结果）', () => {
  it('名单内座位为 true，名单外为 false', () => {
    const v = view([6, 7]);
    expect(seatDyingMark(v, seatAt(v, 6))).toBe(true);
    expect(seatDyingMark(v, seatAt(v, 7))).toBe(true);
    expect(seatDyingMark(v, seatAt(v, 1))).toBe(false);
  });

  it('没有该字段（其他身份 / 观众 / 二阶段 / 白天 / 水妖已用还魂曲）恒为 false', () => {
    const v = view();
    for (const seat of v.public!.seats) expect(seatDyingMark(v, seat)).toBe(false);
  });

  it('空名单不标任何座位', () => {
    const v = view([]);
    for (const seat of v.public!.seats) expect(seatDyingMark(v, seat)).toBe(false);
  });

  it('公开观众（无私有视图）恒为 false', () => {
    const v = view([6]);
    v.private = null;
    v.viewer = { ...v.viewer, kind: 'public_spectator', readOnly: true, subjectPlayerId: null };
    for (const seat of v.public!.seats) expect(seatDyingMark(v, seat)).toBe(false);
  });

  it('第二屏沿用被绑定玩家的名单（服务端已下发即显示）', () => {
    const v = view([13]);
    v.viewer = { ...v.viewer, kind: 'private_spectator', readOnly: true };
    expect(seatDyingMark(v, seatAt(v, 13))).toBe(true);
    expect(seatDyingMark(v, seatAt(v, 4))).toBe(false);
  });

  it('濒死不影响公开存活状态（座位对外仍 alive）', () => {
    const v = view([6]);
    expect(seatAt(v, 6).alive).toBe(true);
  });
});
