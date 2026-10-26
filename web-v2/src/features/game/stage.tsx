import { useCallback, useRef, type CSSProperties, type ReactNode } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot, SeatDTO, TaskDTO } from '../../../../contracts/v2.ts';
import { NightAtmosphere } from './night-atmosphere.tsx';
import { seatDyingMark } from './seat-dying.ts';
import { seatBadges } from './seat-badges.ts';
import { ARC_SELF_POSITION, arcSeatPosition } from './stage-layout.ts';
import { useStageLayout } from './use-stage-layout.ts';
import { usePreferences } from '../../state/preferences.ts';
import { usePlayerMarks } from './player-marks.tsx';
import { StageSeat } from './stage-seat.tsx';

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
  const selectRef = useRef(onSelect), infoRef = useRef(onInfo);
  selectRef.current = onSelect;
  infoRef.current = onInfo;
  const handleSelect = useCallback((playerId: string) => selectRef.current(playerId), []);
  const handleInfo = useCallback((seat: SeatDTO) => infoRef.current(seat), []);
  // 参选角标与侧栏竞选名单同一公开数据源；夜间与竞选结束后不显示。
  const election = view.room.phase === 'playing' && view.public?.phase !== 'night' && view.public?.day?.election?.phase !== 'done'
    ? view.public?.day?.election ?? null : null;
  // 队伍方案草稿的目标（队友或自己已发布的版本）；只在提案窗口内高亮，避免其他阶段误读。
  const draftTargets = new Set(
    task && (task.action === 'EDIT_PROPOSAL' || task.action === 'CONFIRM_PROPOSAL')
      ? view.private?.proposal?.targetPlayerIds ?? []
      : [],
  );
  const { stageRef, actionSlotRef, seatsRef, ring, arc } = useStageLayout({
    seats, task, selected, readOnly: view.viewer.readOnly,
  });
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
          return <StageSeat
            key={seat.playerId}
            seat={seat}
            position={position}
            picked={picked}
            inDraft={inDraft}
            selectable={selectable}
            eligible={eligible}
            capacityBlocked={capacityBlocked}
            locked={locked}
            speaking={speaking(seat)}
            arcSelf={arc && seat.playerId === arcSelfId}
            subject={subject}
            readOnly={view.viewer.readOnly}
            dying={dying}
            badges={badges}
            deathEffects={preferences.deathEffects}
            candidacy={candidacy}
            revealed={revealed ?? null}
            mark={mark}
            speechPreparing={view.public?.day?.speechPreparing === true}
            onSelect={handleSelect}
            onInfo={handleInfo}
          />;
        })})()}
      </div>
      <div className="stage-backdrop" aria-hidden="true" />
    </section>
  );
}
