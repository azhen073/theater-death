import { memo, type CSSProperties } from 'react';
import type { SeatDTO, TaskDTO } from '../../../../contracts/v2.ts';
import type { BadgeItem } from '../../presentation/badges.ts';
import type { PlayerMark } from '../../state/player-marks.ts';
import { playerMarkTooltip } from '../../state/player-marks.ts';
import { Avatar } from '../../components/ui.tsx';
import { BadgeStrip } from '../../components/badge-strip.tsx';
import { presenceLabels } from '../../presentation/labels.ts';
import { DeathMark } from './death-effects-layer.tsx';

interface StageSeatProps {
  seat: SeatDTO;
  position: CSSProperties | undefined;
  picked: boolean;
  inDraft: boolean;
  selectable: TaskDTO['targets'] | undefined;
  eligible: boolean;
  capacityBlocked: boolean;
  locked: boolean;
  speaking: boolean;
  arcSelf: boolean;
  subject: boolean;
  readOnly: boolean;
  dying: boolean;
  badges: readonly BadgeItem[];
  deathEffects: boolean;
  candidacy: 'withdrawn' | 'candidate' | null;
  revealed: string | null;
  mark: PlayerMark | null;
  speechPreparing: boolean;
  onSelect: (playerId: string) => void;
  onInfo: (seat: SeatDTO) => void;
}

export const StageSeat = memo(function StageSeat({
  seat, position, picked, inDraft, selectable, eligible, capacityBlocked, locked, speaking, arcSelf,
  subject, readOnly, dying, badges, deathEffects, candidacy, revealed, mark, speechPreparing, onSelect, onInfo,
}: StageSeatProps) {
  return <div
    data-player-id={seat.playerId}
    style={position}
    className={`stage-seat ${picked ? 'stage-seat--selected' : ''} ${inDraft ? 'stage-seat--draft' : ''} ${
      selectable && !eligible ? 'stage-seat--unavailable' : ''} ${!seat.alive ? 'stage-seat--dead' : ''} ${
      speaking ? 'stage-seat--speaking' : ''} ${arcSelf ? 'stage-seat--self' : ''}`}
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
      aria-label={`${seat.seat}号 ${seat.nickname}${subject && !readOnly ? '，你的座位' : ''}${dying ? '，濒死' : ''}${inDraft ? '，在队伍草稿中' : ''}${
        selectable ? !eligible ? '，当前不可选' : capacityBlocked ? '，目标配额已满' : '，可选目标' : '，查看信息'}`}
    >
      <span className="seat-number">
        {String(seat.seat).padStart(2, '0')}
        {subject && readOnly && <small>视角</small>}
        <BadgeStrip items={badges}/>
      </span>
      <span className="seat-avatar-halo">
        <span className="seat-avatar" data-death-seat={seat.seat} data-death-alive={String(seat.alive)}>
          <Avatar url={seat.avatarUrl} name={seat.nickname}/>
          {!seat.alive && deathEffects && <DeathMark/>}
          {candidacy && <span
            className={`seat-candidacy ${candidacy === 'withdrawn' ? 'seat-candidacy--withdrawn' : ''}`}
            role="img"
            title={candidacy === 'withdrawn' ? '已退选' : '参选天理'}
            aria-label={candidacy === 'withdrawn' ? '已退选' : '参选天理'}
          >{candidacy === 'withdrawn' ? '退' : '选'}</span>}
        </span>
      </span>
      {speaking && <span className="seat-speaking">{speechPreparing ? '准备发言' : '正在发言'}</span>}
      <strong title={`${seat.nickname} · UID ${seat.uid}`}>
        <span className="seat-name-text">{seat.nickname}</span>
        {mark && <span className={`seat-mark seat-mark--${mark.color ?? 'gold'}`} role="img" aria-label={playerMarkTooltip(mark)} title={playerMarkTooltip(mark)}/>}
      </strong>
      <span className="seat-status">
        {!seat.alive ? '已死亡' : revealed ?? '存活'}
        {seat.presence !== 'online' ? ` · ${presenceLabels[seat.presence]}` : ''}
      </span>
      {inDraft && <span className="seat-draft">草稿</span>}
      {picked && <span className="seat-count">已选</span>}
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
      >详情</button>
    </div>
  </div>;
}, (previous, next) => {
  for (const key of Object.keys(previous) as Array<keyof StageSeatProps>) {
    if (key === 'position' || key === 'badges' || key === 'mark') {
      if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) return false;
    } else if (!Object.is(previous[key], next[key])) return false;
  }
  return true;
});
