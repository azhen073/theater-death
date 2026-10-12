import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot, SeatDTO, TaskDTO } from '../../../../contracts/v2.ts';
import { Avatar } from '../../components/ui.tsx';
import { BadgeStrip } from '../../components/badge-strip.tsx';
import { NightAtmosphere } from './night-atmosphere.tsx';
import { presenceLabels } from '../../presentation/labels.ts';
import { taskKey } from '../actions/model.ts';
import { seatDyingMark } from './seat-dying.ts';
import { seatBadges } from './seat-badges.ts';
import { ARC_SELF_POSITION, arcSeatPosition, isDegenerateRect, ringFits, type Rect, type StageLayout } from './stage-layout.ts';
import { usePreferences } from '../../state/preferences.ts';
import { playerMarkTooltip } from '../../state/player-marks.ts';
import { usePlayerMarks } from './player-marks.tsx';
import { DeathMark } from './death-effects-layer.tsx';

export function Stage({
  view,
  catalog,
  task,
  selected,
  locked,
  actionSlot,
  active = true,
  onSelect,
  onInfo,
  liveSpeakingPlayerIds = [],
}: {
  view: RoomSnapshot;
  catalog: CatalogDTO;
  task: TaskDTO | null;
  selected: string[];
  locked: boolean;
  actionSlot?: ReactNode;
  active?: boolean;
  onSelect: (playerId: string) => void;
  onInfo: (seat: SeatDTO) => void;
  /** 自由发言阶段：由本机远端电平判定的「正在说话」座位（其他阶段为空，由服务端 currentSpeakerId 决定）。 */
  liveSpeakingPlayerIds?: readonly string[];
}) {
  const seats = view.public?.seats ?? [];
  const speaking = (seat: SeatDTO): boolean => view.public?.day?.currentSpeakerId === seat.playerId || liveSpeakingPlayerIds.includes(seat.playerId);
  const { preferences } = usePreferences();
  const selectable = task?.targets;
  const playerMarks = usePlayerMarks(view);
  // 参选角标与侧栏竞选名单同一公开数据源；夜间与竞选结束后不显示。
  const election = view.room.phase === 'playing' && view.public?.phase !== 'night' && view.public?.day?.election?.phase !== 'done'
    ? view.public?.day?.election ?? null : null;
  // 队伍方案草稿的目标（队友或自己已发布的版本）；只在提案窗口内高亮，避免其他阶段误读。
  const draftTargets = new Set(
    task && (task.action === 'EDIT_PROPOSAL' || task.action === 'CONFIRM_PROPOSAL')
      ? view.private?.proposal?.targetPlayerIds ?? []
      : [],
  );
  // Taller task/observation content needs its own row rather than covering ring seats.
  const needsFlowLayout = view.viewer.readOnly || (!!task &&
    ['EDIT_PROPOSAL', 'CONFIRM_PROPOSAL', 'DESIGNATE_SPEECH'].includes(task.action));
  const isCandidate = seats.length <= 13 && !needsFlowLayout;
  // 竖屏半环只服务常规 13 人局（观战/第二屏同样走半环）；更多座位的夹具场景仍回退网格。
  const arcCapable = seats.length >= 2 && seats.length <= 14;

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
      '.seat-main, .seat-tools, .seat-count, .badge-strip'
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
    const width = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    // 竖屏半环（601–900px）：行动卡保持文档流在座位区上方，不会遮挡座位，无需 ringFits 测量。
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

  const ring = isCandidate && layoutMode === 'ring';
  const arc = layoutMode === 'arc';
  // 半环模式：本人座位固定在底部中央，其余座位按座位顺序交替上弧（观战/第二屏没有本人位，全部上弧）。
  const arcSelfId = arc && !view.viewer.readOnly ? view.viewer.subjectPlayerId : null;
  const arcCount = arc ? seats.filter(seat => seat.playerId !== arcSelfId).length : 0;
  return (
    <section
      ref={stageRef}
      className={`theater-stage ${ring ? 'theater-stage--ring' : arc ? 'theater-stage--arc' : 'theater-stage--grid'} ${
        view.public?.phase === 'night' ? 'theater-stage--night' : ''
      }`}
      style={{ '--ring-height': `${Math.max(880, seats.length * 68)}px` } as CSSProperties}
      aria-label="玩家舞台"
    >
      <NightAtmosphere view={view} active={active} />
      {actionSlot && <div ref={actionSlotRef} className="stage-action-slot">{actionSlot}</div>}
      {!actionSlot && (
        <div className="stage-center" aria-hidden="true">
          <span>THEATER DEATH</span>
          <strong>{view.public?.phase === 'night' ? '夜幕' : '舞台'}</strong>
          <small>{seats.length} 位玩家</small>
        </div>
      )}
      <div ref={seatsRef} className={`stage-seats ${ring ? 'stage-seats--ring' : arc ? 'stage-seats--arc' : 'stage-seats--grid'}`}>
        {(() => { let arcIndex = 0; return seats.map((seat, index) => {
          const picked = selected.includes(seat.playerId);
          const eligible = !!selectable?.playerIds.includes(seat.playerId);
          const capacityBlocked =
            !!selectable &&
            selectable.maxTargets > 1 &&
            selected.length >= selectable.maxTargets &&
            !picked;
          const angle = -Math.PI / 2 + (index / seats.length) * Math.PI * 2;
          const arcPoint = arc
            ? seat.playerId === arcSelfId ? ARC_SELF_POSITION : arcSeatPosition(arcIndex++, arcCount)
            : null;
          // Reserve card half-width and focus/badge space at both stage edges.
          const position = ring
            ? ({
                '--seat-x': `calc(${50 + Math.cos(angle) * 50}% - ${Math.cos(angle) * 76}px)`,
                '--seat-y': `${50 + Math.sin(angle) * 42}%`,
              } as CSSProperties)
            : arcPoint
              ? ({ '--seat-x': `${arcPoint.x}%`, '--seat-y': `${arcPoint.y}%` } as CSSProperties)
              : undefined;
          const subject = seat.playerId === view.viewer.subjectPlayerId;
          const inDraft = draftTargets.has(seat.playerId);
          const badges = seatBadges(view, seat, catalog);
          const dying = seatDyingMark(view, seat);
          const revealed = seat.revealedRoleId
            ? catalog.roles.find(role => role.roleId === seat.revealedRoleId)?.name
            : null;
          const candidacy = election
            ? election.withdrawn.includes(seat.playerId) ? 'withdrawn'
              : election.candidates.includes(seat.playerId) ? 'candidate' : null
            : null;
          const mark = playerMarks.get(seat.playerId) ?? null;
          return (
            <div
              key={seat.playerId}
              data-player-id={seat.playerId}
              style={position}
              className={`stage-seat ${picked ? 'stage-seat--selected' : ''} ${
                inDraft ? 'stage-seat--draft' : ''
              } ${
                selectable && !eligible ? 'stage-seat--unavailable' : ''
              } ${!seat.alive ? 'stage-seat--dead' : ''} ${
                speaking(seat) ? 'stage-seat--speaking' : ''
              } ${arc && seat.playerId === arcSelfId ? 'stage-seat--self' : ''}`}
            >
              <button
                type="button"
                className="seat-main"
                disabled={!!selectable && (locked || !eligible || capacityBlocked)}
                onClick={event => {
                  if (selectable) onSelect(seat.playerId);
                  else {
                    event.currentTarget.focus({ preventScroll: true });
                    onInfo(seat);
                  }
                }}
                aria-pressed={selectable ? picked : undefined}
                aria-label={`${seat.seat}号 ${seat.nickname}${subject && !view.viewer.readOnly ? '，你的座位' : ''}${dying ? '，濒死' : ''}${inDraft ? '，在队伍草稿中' : ''}${
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
                  {/* 本人座位不再标「你」：身份徽标本身就只出现在自己座位上；第二屏保留「视角」 */}
                  {subject && view.viewer.readOnly && <small>视角</small>}
                  <BadgeStrip items={badges}/>
                </span>
                <span className="seat-avatar-halo">
                  <span className="seat-avatar" data-death-seat={seat.seat} data-death-alive={String(seat.alive)}>
                    <Avatar url={seat.avatarUrl} name={seat.nickname} />
                    {!seat.alive && preferences.deathEffects && <DeathMark />}
                    {candidacy && (
                      <span
                        className={`seat-candidacy ${candidacy === 'withdrawn' ? 'seat-candidacy--withdrawn' : ''}`}
                        role="img"
                        title={candidacy === 'withdrawn' ? '已退选' : '参选天理'}
                        aria-label={candidacy === 'withdrawn' ? '已退选' : '参选天理'}
                      >{candidacy === 'withdrawn' ? '退' : '选'}</span>
                    )}
                  </span>
                </span>
                {speaking(seat) && <span className="seat-speaking">{view.public?.day?.speechPreparing ? '准备发言' : '正在发言'}</span>}
                <strong title={`${seat.nickname} · UID ${seat.uid}`}>
                  <span className="seat-name-text">{seat.nickname}</span>
                  {mark && <span className={`seat-mark seat-mark--${mark.color ?? 'gold'}`} role="img" aria-label={playerMarkTooltip(mark)} title={playerMarkTooltip(mark)} />}
                </strong>
                <span className="seat-status">
                  {!seat.alive ? '已死亡' : revealed ?? '存活'}
                  {seat.presence !== 'online' ? ` · ${presenceLabels[seat.presence]}` : ''}
                </span>
                {inDraft && <span className="seat-draft">草稿</span>}
                {picked && <span className="seat-count">已选</span>}
                {/* 本夜濒死（R-20/R-24）：仅对有名单视野的人可见，服务端已按授权裁剪 */}
                {dying && <span className="seat-dying" aria-hidden="true">濒死</span>}
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
              </div>
            </div>
          );
        })})()}
      </div>
      <div className="stage-backdrop" aria-hidden="true" />
    </section>
  );
}
