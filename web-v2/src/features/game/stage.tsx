import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot, SeatDTO, TaskDTO } from '../../../../contracts/v2.ts';
import { Avatar } from '../../components/ui.tsx';
import { presenceLabels } from '../../presentation/labels.ts';
import { taskKey } from '../actions/model.ts';
import { isDegenerateRect, ringFits, type Rect, type StageLayout } from './stage-layout.ts';
import { usePreferences } from '../../state/preferences.ts';
import { DeathMark } from './death-effects-layer.tsx';

export function Stage({
  view,
  catalog,
  task,
  selected,
  locked,
  actionSlot,
  onSelect,
  onInfo,
}: {
  view: RoomSnapshot;
  catalog: CatalogDTO;
  task: TaskDTO | null;
  selected: string[];
  locked: boolean;
  actionSlot?: ReactNode;
  onSelect: (playerId: string, change: 1 | -1) => void;
  onInfo: (seat: SeatDTO) => void;
}) {
  const seats = view.public?.seats ?? [];
  const { preferences } = usePreferences();
  const selectable = task?.targets;
  const knownSpirits = new Set(view.private?.knowledge?.spiritSeats ?? []);
  // Taller task/observation content needs its own row rather than covering ring seats.
  const needsFlowLayout = view.viewer.readOnly || (!!task &&
    ['EDIT_PROPOSAL', 'CONFIRM_PROPOSAL', 'DESIGNATE_SPEECH'].includes(task.action));
  const isCandidate = seats.length <= 13 && !needsFlowLayout;

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
    ? `${selectable.allowRepeated}:${selectable.maxTargets}:${selectable.playerIds.join(',')}`
    : 'none';
  const lastCycleKey = useRef(`${currentTaskKey}:${seatComposition}:${view.viewer.readOnly}`);
  const lastStageWidth = useRef<number>(0);

  const cycleKey = `${currentTaskKey}:${seatComposition}:${view.viewer.readOnly}`;

  // Only trustworthy while the ring geometry is actually rendered: a card measured in flow position always fails.
  const measureRingFit = useCallback((): boolean | null => {
    const stageEl = stageRef.current;
    const cardEl = actionSlotRef.current;
    const seatsEl = seatsRef.current;
    if (!stageEl || !cardEl || !seatsEl) return null;

    const stageRect = stageEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();

    if (isDegenerateRect(stageRect) || isDegenerateRect(cardRect)) {
      return null;
    }

    const seatNodes = seatsEl.querySelectorAll<HTMLElement>(
      '.seat-main, .seat-tools, .seat-count, .seat-sheriff'
    );
    const seatRects: Rect[] = [];
    for (const node of seatNodes) {
      const rect = node.getBoundingClientRect();
      if (!isDegenerateRect(rect)) {
        seatRects.push(rect);
      }
    }

    const zoom = stageEl.offsetWidth > 0 ? stageRect.width / stageEl.offsetWidth : 1;
    return ringFits(cardRect, seatRects, stageRect, 8 * zoom);
  }, []);

  // Verify synchronously after every commit that keeps the ring candidate on screen, before paint.
  useLayoutEffect(() => {
    if (!isCandidate || layoutMode !== 'ring') return;
    if (measureRingFit() === false) {
      flowLockedRef.current = true;
      setLayoutMode('flow');
    }
  }, [isCandidate, layoutMode, cycleKey, selectionSignature, toolSignature, measureRingFit]);

  const evaluateLayout = useCallback(() => {
    if (!isCandidate || (typeof window !== 'undefined' && window.innerWidth <= 1180)) {
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
    if (layoutModeRef.current === 'flow') {
      if (flowLockedRef.current) return;
      setLayoutMode('ring');
      return;
    }
    if (measureRingFit() === false) {
      flowLockedRef.current = true;
      setLayoutMode('flow');
    }
  }, [isCandidate, measureRingFit]);

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
      rafId = requestAnimationFrame(() => {
        evaluateLayout();
      });
    };
    const observer = new ResizeObserver(scheduleEvaluation);

    if (stageRef.current) observer.observe(stageRef.current);
    if (actionSlotRef.current) observer.observe(actionSlotRef.current);
    if (seatsRef.current) {
      observer.observe(seatsRef.current);
      for (const node of seatsRef.current.querySelectorAll<HTMLElement>(
        '.seat-main, .seat-tools, .seat-count, .seat-sheriff'
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

  const ring = isCandidate && layoutMode === 'ring';
  return (
    <section
      ref={stageRef}
      className={`theater-stage ${ring ? 'theater-stage--ring' : 'theater-stage--grid'} ${
        view.public?.phase === 'night' ? 'theater-stage--night' : ''
      }`}
      style={{ '--ring-height': `${Math.max(880, seats.length * 68)}px` } as CSSProperties}
      aria-label="玩家舞台"
    >
      {actionSlot && <div ref={actionSlotRef} className="stage-action-slot">{actionSlot}</div>}
      {!actionSlot && (
        <div className="stage-center" aria-hidden="true">
          <span>THEATER DEATH</span>
          <strong>{view.public?.phase === 'night' ? '夜幕' : '舞台'}</strong>
          <small>{seats.length} 位玩家</small>
        </div>
      )}
      <div ref={seatsRef} className={`stage-seats ${ring ? 'stage-seats--ring' : 'stage-seats--grid'}`}>
        {seats.map((seat, index) => {
          const count = selected.filter(id => id === seat.playerId).length;
          const eligible = !!selectable?.playerIds.includes(seat.playerId);
          const capacityBlocked =
            !!selectable &&
            selectable.maxTargets > 1 &&
            selected.length >= selectable.maxTargets &&
            (selectable.allowRepeated || count === 0);
          const angle = -Math.PI / 2 + (index / seats.length) * Math.PI * 2;
          // Reserve card half-width and focus/badge space at both stage edges.
          const position = ring
            ? ({
                '--seat-x': `calc(${50 + Math.cos(angle) * 50}% - ${Math.cos(angle) * 76}px)`,
                '--seat-y': `${50 + Math.sin(angle) * 42}%`,
              } as CSSProperties)
            : undefined;
          const subject = seat.playerId === view.viewer.subjectPlayerId;
          const revealed = seat.revealedRoleId
            ? catalog.roles.find(role => role.roleId === seat.revealedRoleId)?.name
            : null;
          return (
            <div
              key={seat.playerId}
              data-player-id={seat.playerId}
              style={position}
              className={`stage-seat ${count ? 'stage-seat--selected' : ''} ${
                selectable && !eligible ? 'stage-seat--unavailable' : ''
              } ${!seat.alive ? 'stage-seat--dead' : ''} ${
                view.public?.day?.currentSpeakerId === seat.playerId ? 'stage-seat--speaking' : ''
              }`}
            >
              <button
                type="button"
                className="seat-main"
                disabled={!!selectable && (locked || !eligible || capacityBlocked)}
                onClick={event => {
                  if (selectable) onSelect(seat.playerId, 1);
                  else {
                    event.currentTarget.focus({ preventScroll: true });
                    onInfo(seat);
                  }
                }}
                aria-pressed={selectable ? count > 0 : undefined}
                aria-label={`${seat.seat}号 ${seat.nickname}${
                  selectable
                    ? !eligible
                      ? '，当前不可选'
                      : capacityBlocked
                      ? '，目标配额已满'
                      : '，可选目标'
                    : '，查看信息'
                }`}
              >
                <span className="seat-number">
                  {String(seat.seat).padStart(2, '0')}
                  {subject && <small>{view.viewer.readOnly ? '视角' : '你'}</small>}
                </span>
                <span className="seat-avatar-halo">
                  <span className="seat-avatar" data-death-seat={seat.seat} data-death-alive={String(seat.alive)}>
                    <Avatar url={seat.avatarUrl} name={seat.nickname} />
                    {!seat.alive && preferences.deathEffects && <DeathMark />}
                  </span>
                </span>
                {view.public?.day?.currentSpeakerId === seat.playerId && <span className="seat-speaking">{view.public.day.speechPreparing ? '准备发言' : '正在发言'}</span>}
                <strong title={`${seat.nickname} · UID ${seat.uid}`}>{seat.nickname}</strong>
                <span className="seat-status">
                  {!seat.alive ? '已死亡' : revealed ?? '存活'}
                  {seat.presence !== 'online' ? ` · ${presenceLabels[seat.presence]}` : ''}
                </span>
                {view.public?.sheriff.holderId === seat.playerId && <span className="seat-sheriff">天理</span>}
                {knownSpirits.has(seat.seat) && <span className="seat-known">魂灵</span>}
                {count > 0 && <span className="seat-count">已选{selectable?.allowRepeated ? ` ×${count}` : ''}</span>}
              </button>
              <div className="seat-tools">
                <button
                  type="button"
                  aria-label={`查看${seat.seat}号玩家信息`}
                  onClick={event => {
                    event.currentTarget.focus({ preventScroll: true });
                    onInfo(seat);
                  }}
                >
                  详情
                </button>
                {selectable?.allowRepeated && eligible && (
                  <>
                    <button
                      type="button"
                      aria-label={`减少${seat.seat}号目标次数`}
                      disabled={locked || !count}
                      onClick={() => onSelect(seat.playerId, -1)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label={`增加${seat.seat}号目标次数`}
                      disabled={locked || selected.length >= selectable.maxTargets}
                      onClick={() => onSelect(seat.playerId, 1)}
                    >
                      ＋
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
