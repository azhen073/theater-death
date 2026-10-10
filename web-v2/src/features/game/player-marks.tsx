import { useEffect, useMemo, useState } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import {
  PLAYER_MARK_COLORS, PLAYER_MARK_LABELS, PLAYER_MARK_NOTE_MAX,
  playerMarkKey, playerMarkTooltip, readPlayerMark, writePlayerMark,
  type PlayerMark, type PlayerMarkColor,
} from '../../state/player-marks.ts';

const changedEvent = 'theater-death-marks-changed';

const colorNames: Record<PlayerMarkColor, string> = { red: '红', gold: '金', green: '绿', blue: '蓝' };

function localStore() {
  try { return window.localStorage; } catch { return null; }
}

/** 读取本机标记表（玩家 playerId → 标记）；本组件内编辑或他页签写入都会触发刷新。 */
export function usePlayerMarks(view: RoomSnapshot): Map<string, PlayerMark> {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const sync = () => setRevision(value => value + 1);
    window.addEventListener(changedEvent, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(changedEvent, sync); window.removeEventListener('storage', sync); };
  }, []);
  const seats = view.public?.seats ?? [];
  return useMemo(() => {
    const marks = new Map<string, PlayerMark>();
    const store = localStore();
    if (!view.gameId || !store) return marks;
    for (const seat of seats) {
      const mark = readPlayerMark(store, playerMarkKey(view.roomId, view.gameId, seat.playerId));
      if (mark) marks.set(seat.playerId, mark);
    }
    return marks;
    // revision 驱动 localStorage 重读；seats 引用随快照变化。
  }, [revision, view.roomId, view.gameId, seats]);
}

function savePlayerMark(view: RoomSnapshot, playerId: string, mark: PlayerMark | null): PlayerMark | null {
  const store = localStore();
  if (!view.gameId || !store) return mark;
  const clean = mark && (mark.label || mark.color || mark.note) ? mark : null;
  if (writePlayerMark(store, playerMarkKey(view.roomId, view.gameId, playerId), clean)) {
    window.dispatchEvent(new CustomEvent(changedEvent));
    return clean;
  }
  return mark;
}

/** 座位详情弹层内的标记编辑区；复盘等只读场景仅展示。 */
export function PlayerMarkEditor({ view, playerId, readOnly = false }: {
  view: RoomSnapshot; playerId: string; readOnly?: boolean;
}) {
  const key = view.gameId ? playerMarkKey(view.roomId, view.gameId, playerId) : null;
  const [mark, setMark] = useState<PlayerMark | null>(() => {
    const store = localStore();
    return key && store ? readPlayerMark(store, key) : null;
  });
  useEffect(() => {
    const store = localStore();
    setMark(key && store ? readPlayerMark(store, key) : null);
  }, [key]);
  if (!key) return null;
  const seat = view.public?.seats.find(item => item.playerId === playerId);

  if (readOnly) {
    return <section className="player-marks" aria-label="我的玩家标记">
      <h3>我的标记</h3>
      {mark ? <p>
        {mark.color && <span className={`seat-mark seat-mark--${mark.color}`} aria-hidden="true" />}
        {mark.label ?? '未设标签'}{mark.note ? ` · ${mark.note}` : ''}
      </p> : <p className="muted">本机没有保存该玩家的标记。</p>}
      <p className="muted">标记仅保存在本机，其他玩家看不到。</p>
    </section>;
  }

  const update = (patch: Partial<PlayerMark>) => {
    const next: PlayerMark = { label: mark?.label ?? null, color: mark?.color ?? null, note: mark?.note ?? '', ...patch };
    setMark(savePlayerMark(view, playerId, next));
  };
  return <section className="player-marks" aria-label="我的玩家标记">
    <h3>我的标记{seat ? ` · ${seat.seat}号` : ''}</h3>
    <div className="player-marks__labels" role="group" aria-label="预设标签">
      {PLAYER_MARK_LABELS.map(label => <button
        type="button"
        key={label}
        aria-pressed={mark?.label === label}
        onClick={() => update({ label: mark?.label === label ? null : label })}
      >{label}</button>)}
    </div>
    <div className="player-marks__colors" role="group" aria-label="标记颜色">
      {PLAYER_MARK_COLORS.map(color => <button
        type="button"
        key={color}
        className={`seat-mark seat-mark--${color} ${mark?.color === color ? 'seat-mark--active' : ''}`}
        aria-label={`${colorNames[color]}色标记`}
        aria-pressed={mark?.color === color}
        onClick={() => update({ color: mark?.color === color ? null : color })}
      />)}
    </div>
    <label className="player-marks__note">
      备注（{PLAYER_MARK_NOTE_MAX} 字内）
      <input
        value={mark?.note ?? ''}
        maxLength={PLAYER_MARK_NOTE_MAX}
        placeholder="例如：昨夜发言矛盾"
        onChange={event => update({ note: event.target.value.slice(0, PLAYER_MARK_NOTE_MAX) })}
      />
    </label>
    <div className="player-marks__foot">
      <p className="muted">标记仅保存在本机，其他玩家看不到。</p>
      {mark && <button type="button" className="text-button" onClick={() => setMark(savePlayerMark(view, playerId, null))}>清除标记</button>}
    </div>
    {mark && <p className="muted" aria-live="polite">当前：{playerMarkTooltip(mark)}</p>}
  </section>;
}
