export type StageLayout = 'ring' | 'flow' | 'arc';

/** 竖屏半环（601–900px）座位坐标，单位为舞台座位区百分比。 */
export interface ArcPoint {
  x: number;
  y: number;
}

/** 本人座位：固定在半环底部中央（卡片稍大，见 main.css 的 arc 媒体块）。 */
export const ARC_SELF_POSITION: ArcPoint = { x: 50, y: 85 };

/**
 * 竖屏半环：非本人座位按序号交替分到前/后两排浅弧，弧顶朝上、两端下沉。
 *
 * 为什么是双排而不是单排椭圆：601px 下座位区净宽约 575px，12 张紧凑卡（64px）排在
 * 单条椭圆弧上时，端点处切线近乎竖直，相邻卡纵向间距只有约 40–50px（远小于卡高），
 * 必然重叠；双排弧让每排只有 6 张卡，横向间距放宽到 ≥78px，几何上才有解。
 * 几何参数已由 tests/frontend-v2-stage-layout.test.ts 的不重叠用例锁定。
 */
export function arcSeatPosition(index: number, count: number): ArcPoint {
  if (count <= 1) return { x: 50, y: 42 };
  const back = index % 2 === 0;
  const rowCount = back ? Math.ceil(count / 2) : Math.floor(count / 2);
  const rowIndex = Math.floor(index / 2);
  const t = rowCount <= 1 ? 0.5 : rowIndex / (rowCount - 1);
  const bow = (2 * t - 1) ** 2;
  return back ? { x: 10 + 80 * t, y: 30 + 14 * bow } : { x: 16 + 68 * t, y: 60 + 12 * bow };
}

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
