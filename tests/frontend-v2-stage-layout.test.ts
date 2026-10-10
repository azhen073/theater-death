import { describe, expect, it } from 'vitest';
import {
  ARC_SELF_POSITION,
  arcSeatPosition,
  isDegenerateRect,
  rectsIntersect,
  ringFits,
  type Rect,
} from '../web-v2/src/features/game/stage-layout.ts';

describe('stage layout geometric safety checks', () => {
  it('correctly identifies degenerate rects with 0 or negative dimensions', () => {
    expect(isDegenerateRect({ left: 10, top: 10, right: 10, bottom: 20 })).toBe(true);
    expect(isDegenerateRect({ left: 10, top: 10, right: 20, bottom: 10 })).toBe(true);
    expect(isDegenerateRect({ left: 20, top: 10, right: 10, bottom: 20 })).toBe(true);
    expect(isDegenerateRect({ left: 10, top: 10, right: 20, bottom: 20 })).toBe(false);
  });

  it('detects intersection between rects with gap', () => {
    const a: Rect = { left: 100, top: 100, right: 200, bottom: 200 };
    // Intersects directly
    const b: Rect = { left: 150, top: 150, right: 250, bottom: 250 };
    expect(rectsIntersect(a, b, 0)).toBe(true);

    // Outside without gap, but touches with gap = 10
    const c: Rect = { left: 205, top: 100, right: 300, bottom: 200 };
    expect(rectsIntersect(a, c, 0)).toBe(false);
    expect(rectsIntersect(a, c, 10)).toBe(true);

    // Completely separated
    const d: Rect = { left: 300, top: 300, right: 400, bottom: 400 };
    expect(rectsIntersect(a, d, 10)).toBe(false);
  });

  it('determines when action card safely fits in ring mode', () => {
    const stage: Rect = { left: 0, top: 0, right: 1000, bottom: 800 };
    const card: Rect = { left: 300, top: 200, right: 700, bottom: 500 };
    // Seats in ring around center
    const seats: Rect[] = [
      { left: 450, top: 20, right: 550, bottom: 100 }, // top seat
      { left: 450, top: 650, right: 550, bottom: 730 }, // bottom seat
      { left: 50, top: 350, right: 150, bottom: 430 }, // left seat
      { left: 850, top: 350, right: 950, bottom: 430 }, // right seat
    ];

    expect(ringFits(card, seats, stage, 8)).toBe(true);

    // Seat 3 collision on top-left
    const collidingSeat: Rect = { left: 280, top: 180, right: 320, bottom: 250 };
    expect(ringFits(card, [...seats, collidingSeat], stage, 8)).toBe(false);

    // Card exceeds bottom boundary of stage
    const tallCard: Rect = { left: 300, top: 200, right: 700, bottom: 810 };
    expect(ringFits(tallCard, seats, stage, 8)).toBe(false);

    // Degenerate card or stage is rejected
    const degenerateCard: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    expect(ringFits(degenerateCard, seats, stage, 8)).toBe(false);
  });
});

describe('arc layout (portrait half-ring, 601–900px)', () => {
  // 与 main.css 的 arc 媒体块同源的卡片预算；详情按钮的实际边界另由 35-p2-usability E2E 验证。
  const HEIGHT = 500;
  const CARD = { width: 64, height: 96 };
  const SELF = { width: 92, height: 120 };
  const overlap = (a: Rect, b: Rect) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const box = (point: { x: number; y: number }, width: number, size: { width: number; height: number }): Rect => ({
    left: (point.x / 100) * width - size.width / 2,
    right: (point.x / 100) * width + size.width / 2,
    top: (point.y / 100) * HEIGHT - size.height / 2,
    bottom: (point.y / 100) * HEIGHT + size.height / 2,
  });

  it('centers a single seat and keeps endpoints on the upper arcs', () => {
    expect(arcSeatPosition(0, 1)).toEqual({ x: 50, y: 42 });
    const seats = Array.from({ length: 12 }, (_, index) => arcSeatPosition(index, 12));
    for (const [index, point] of seats.entries()) {
      expect(point.x).toBeGreaterThanOrEqual(10);
      expect(point.x).toBeLessThanOrEqual(90);
      expect(point.y).toBeGreaterThanOrEqual(30);
      expect(point.y).toBeLessThanOrEqual(72);
      // 偶数 index 在后排弧（y ≤ 44），奇数在前排弧（y ≥ 60）
      if (index % 2 === 0) expect(point.y).toBeLessThanOrEqual(44);
      else expect(point.y).toBeGreaterThanOrEqual(60);
    }
    // 弧顶朝上：每排正中最高（y 最小），两端对称下沉
    expect(seats[6]!.y).toBeLessThan(seats[0]!.y);
    expect(seats[0]!.y).toBeCloseTo(seats[10]!.y, 5);
  });

  it('keeps every seat plus the self seat clear of overlaps at both band edges', () => {
    // 601px 视口：座位区净宽 ≈ 575px；900px：≈ 844px
    for (const width of [575, 844]) {
      const seats = Array.from({ length: 12 }, (_, index) => box(arcSeatPosition(index, 12), width, CARD));
      for (let a = 0; a < seats.length; a += 1) {
        for (let b = a + 1; b < seats.length; b += 1) {
          expect(overlap(seats[a]!, seats[b]!), `seats ${a}/${b} overlap at ${width}px`).toBe(false);
        }
        expect(overlap(seats[a]!, box(ARC_SELF_POSITION, width, SELF)), `seat ${a} hits self at ${width}px`).toBe(false);
      }
      // 所有座位完整落在座位区内
      for (const seat of [...seats, box(ARC_SELF_POSITION, width, SELF)]) {
        expect(seat.left).toBeGreaterThanOrEqual(0);
        expect(seat.right).toBeLessThanOrEqual(width);
        expect(seat.top).toBeGreaterThanOrEqual(0);
        expect(seat.bottom).toBeLessThanOrEqual(HEIGHT);
      }
    }
  });
});
