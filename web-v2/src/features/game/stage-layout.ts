export type StageLayout = 'ring' | 'flow';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function isDegenerateRect(rect: Rect): boolean {
  return rect.right <= rect.left || rect.bottom <= rect.top;
}

export function rectsIntersect(a: Rect, b: Rect, gap: number = 0): boolean {
  return (
    a.left - gap < b.right &&
    a.right + gap > b.left &&
    a.top - gap < b.bottom &&
    a.bottom + gap > b.top
  );
}

/**
 * Validates whether the action card fits safely in ring layout:
 * 1. Card is fully contained inside the stage with reserved gap.
 * 2. Card does not overlap with any seats, tools, or badges with reserved gap.
 * 3. Degenerate (zero or negative dimension) rects are safely rejected or skipped.
 */
export function ringFits(
  card: Rect,
  seatsAndTools: readonly Rect[],
  stage: Rect,
  gap: number = 8
): boolean {
  if (isDegenerateRect(card) || isDegenerateRect(stage)) {
    return false;
  }

  if (
    card.left < stage.left + gap ||
    card.right > stage.right - gap ||
    card.top < stage.top + gap ||
    card.bottom > stage.bottom - gap
  ) {
    return false;
  }

  for (const seatRect of seatsAndTools) {
    if (isDegenerateRect(seatRect)) continue;
    if (rectsIntersect(card, seatRect, gap)) {
      return false;
    }
  }

  return true;
}
