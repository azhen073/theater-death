import type { CSSProperties, ReactNode } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot, SeatDTO, TaskDTO } from '../../../../contracts/v2.ts';
import { Avatar } from '../../components/ui.tsx';
import { presenceLabels } from '../../presentation/labels.ts';

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
  const selectable = task?.targets;
  // Taller task/observation content needs its own row rather than covering ring seats.
  const needsFlowLayout = view.viewer.readOnly || !!task &&
    ['EDIT_PROPOSAL', 'CONFIRM_PROPOSAL', 'DESIGNATE_SPEECH'].includes(task.action);
  const ring = seats.length <= 13 && !needsFlowLayout;
  return (
    <section
      className={`theater-stage ${ring ? 'theater-stage--ring' : 'theater-stage--grid'} ${
        view.public?.phase === 'night' ? 'theater-stage--night' : ''
      }`}
      style={{ '--ring-height': `${Math.max(880, seats.length * 68)}px` } as CSSProperties}
      aria-label="玩家舞台"
    >
      {actionSlot && <div className="stage-action-slot">{actionSlot}</div>}
      {!actionSlot && (
        <div className="stage-center" aria-hidden="true">
          <span>THEATER DEATH</span>
          <strong>{view.public?.phase === 'night' ? '夜幕' : '舞台'}</strong>
          <small>{seats.length} 位玩家</small>
        </div>
      )}
      <div className={`stage-seats ${ring ? 'stage-seats--ring' : 'stage-seats--grid'}`}>
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
                <Avatar url={seat.avatarUrl} name={seat.nickname} />
                <strong title={`${seat.nickname} · UID ${seat.uid}`}>{seat.nickname}</strong>
                <span className="seat-status">
                  {!seat.alive ? '已死亡' : revealed ?? '存活'}
                  {seat.presence !== 'online' ? ` · ${presenceLabels[seat.presence]}` : ''}
                </span>
                {view.public?.sheriff.holderId === seat.playerId && <span className="seat-sheriff">天理</span>}
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
