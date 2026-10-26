import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SeatDTO, TaskDTO } from '../../../../contracts/v2.ts';
import { taskKey } from '../actions/model.ts';
import { isDegenerateRect, ringFits, type Rect, type StageLayout } from './stage-layout.ts';

export function useStageLayout({ seats, task, selected, readOnly }: {
  seats: readonly SeatDTO[];
  task: TaskDTO | null;
  selected: readonly string[];
  readOnly: boolean;
}) {
  const needsFlowLayout = readOnly || (!!task &&
    ['EDIT_PROPOSAL', 'CONFIRM_PROPOSAL', 'DESIGNATE_SPEECH'].includes(task.action));
  const isCandidate = seats.length <= 13 && !needsFlowLayout;
  const arcCapable = seats.length >= 2 && seats.length <= 14;
  const selectable = task?.targets;

  const [layoutMode, setLayoutMode] = useState<StageLayout>('ring');
  const layoutModeRef = useRef<StageLayout>(layoutMode);
  layoutModeRef.current = layoutMode;
  const flowLockedRef = useRef(false);
  const stageRef = useRef<HTMLElement | null>(null);
  const actionSlotRef = useRef<HTMLDivElement | null>(null);
  const seatsRef = useRef<HTMLDivElement | null>(null);

  const currentTaskKey = task ? taskKey(task) : 'notask';
  const seatComposition = seats.map(seat => seat.playerId).join(',');
  const selectionSignature = selected.join(',');
  const toolSignature = selectable
    ? `${selectable.maxTargets}:${selectable.playerIds.join(',')}`
    : 'none';
  const lastCycleKey = useRef(`${currentTaskKey}:${seatComposition}:${readOnly}`);
  const lastStageWidth = useRef<number>(0);
  const cycleKey = `${currentTaskKey}:${seatComposition}:${readOnly}`;

  const measureRingFit = useCallback((): boolean | null => {
    const stageEl = stageRef.current;
    const cardEl = actionSlotRef.current;
    const seatsEl = seatsRef.current;
    if (!stageEl || !cardEl || !seatsEl) return null;

    const stageRect = stageEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    if (isDegenerateRect(stageRect) || isDegenerateRect(cardRect)) return null;

    const seatNodes = seatsEl.querySelectorAll<HTMLElement>(
      '.seat-main, .seat-tools, .seat-count, .badge-strip'
    );
    const seatRects: Rect[] = [];
    for (const node of seatNodes) {
      const rect = node.getBoundingClientRect();
      if (!isDegenerateRect(rect)) seatRects.push(rect);
    }

    const zoom = stageEl.offsetWidth > 0 ? stageRect.width / stageEl.offsetWidth : 1;
    return ringFits(cardRect, seatRects, stageRect, 8 * zoom);
  }, []);

  useLayoutEffect(() => {
    if (!isCandidate || layoutMode !== 'ring') return;
    if (measureRingFit() === false) {
      flowLockedRef.current = true;
      setLayoutMode('flow');
    }
  }, [isCandidate, layoutMode, cycleKey, selectionSignature, toolSignature, measureRingFit]);

  const evaluateLayout = useCallback(() => {
    const width = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    if (arcCapable && width > 600 && width <= 900) {
      if (layoutModeRef.current !== 'arc') setLayoutMode('arc');
      return;
    }
    if (!isCandidate || width <= 1180) {
      if (layoutModeRef.current !== 'flow') setLayoutMode('flow');
      return;
    }
    const stageEl = stageRef.current;
    if (!stageEl) return;
    const stageRect = stageEl.getBoundingClientRect();
    if (isDegenerateRect(stageRect)) return;
    if (lastStageWidth.current > 0 && Math.abs(stageRect.width - lastStageWidth.current) > 1) {
      flowLockedRef.current = false;
    }
    lastStageWidth.current = stageRect.width;
    if (layoutModeRef.current === 'flow' || layoutModeRef.current === 'arc') {
      if (flowLockedRef.current) return;
      setLayoutMode('ring');
      return;
    }
    if (measureRingFit() === false) {
      flowLockedRef.current = true;
      setLayoutMode('flow');
    }
  }, [isCandidate, arcCapable, measureRingFit]);

  useLayoutEffect(() => {
    if (cycleKey !== lastCycleKey.current) {
      lastCycleKey.current = cycleKey;
      flowLockedRef.current = false;
      lastStageWidth.current = 0;
    }
    evaluateLayout();
  }, [cycleKey, evaluateLayout]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    let rafId: number | null = null;
    const scheduleEvaluation = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(evaluateLayout);
    };
    const observer = new ResizeObserver(scheduleEvaluation);
    if (stageRef.current) observer.observe(stageRef.current);
    if (actionSlotRef.current) observer.observe(actionSlotRef.current);
    if (seatsRef.current) {
      observer.observe(seatsRef.current);
      for (const node of seatsRef.current.querySelectorAll<HTMLElement>(
        '.seat-main, .seat-tools, .seat-count, .badge-strip'
      )) observer.observe(node);
    }
    window.addEventListener('resize', scheduleEvaluation);
    document.addEventListener('visibilitychange', scheduleEvaluation);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', scheduleEvaluation);
      document.removeEventListener('visibilitychange', scheduleEvaluation);
    };
  }, [evaluateLayout, cycleKey, selectionSignature, toolSignature]);

  return {
    stageRef,
    actionSlotRef,
    seatsRef,
    ring: isCandidate && layoutMode === 'ring',
    arc: layoutMode === 'arc',
  };
}
