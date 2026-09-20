import { describe, expect, it } from 'vitest';
import {
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
