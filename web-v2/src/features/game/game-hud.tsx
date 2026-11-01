import type { ReactNode, RefObject } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { COPY } from '../../presentation/copy.ts';
import { formatCountdown, publicPhaseLabel } from '../../presentation/labels.ts';

export function GameHUD({ view, remaining, publicWindow, compact, hudMenu, hud, onToggleMenu, actions }: {
  view: RoomSnapshot;
  remaining: (deadline: number) => number | null;
  publicWindow: RoomSnapshot['windows'][number] | null;
  compact: boolean;
  hudMenu: boolean;
  hud: RefObject<HTMLElement | null>;
  onToggleMenu: () => void;
  actions: ReactNode;
}) {
  return <header className={`game-hud${compact ? ' game-hud--compact' : ''}`} ref={hud}>
    <div>
      <span className="eyebrow">
        第 {view.public?.dayNumber ?? 1} 轮 · {view.public?.phase === 'night' ? '夜晚' : '白天'} · 第{' '}
        {view.public?.stage ?? 1} 阶段
      </span>
      <h1>{publicPhaseLabel(view)}</h1>
    </div>
    <div className="hud-meta">
      <strong>{publicWindow ? formatCountdown(remaining(publicWindow.closesAt)) : view.public?.night ? formatCountdown(remaining(view.public.night.closesAt)) : '以当前任务为准'}</strong>
      <span>
        {COPY.game.alive} {view.public?.seats.filter(seat => seat.alive).length ?? 0} /{' '}
        {view.public?.seats.length ?? 0}
      </span>
    </div>
    {compact ? (
      <div className="hud-tools hud-tools--compact">
        <button type="button" className="button hud-more" aria-expanded={hudMenu} onClick={onToggleMenu}>更多</button>
      </div>
    ) : (
      <div className="hud-tools">
        <span className="hud-room-code" title={`房间 ${view.room.code} · ${view.room.config.mode === 'formal' ? '正式模式' : '实验模式'}`}>
          房间 {view.room.code} · {view.room.config.mode === 'formal' ? '正式' : '实验'}
        </span>
        {actions}
      </div>
    )}
    {compact && hudMenu && (
      <div className="hud-menu" aria-label="对局操作">
        <span className="hud-menu__room">房间 {view.room.code} · {view.public?.seats.filter(seat => seat.alive).length ?? 0} / {view.public?.seats.length ?? 0} {COPY.game.alive}</span>
        {actions}
      </div>
    )}
  </header>;
}
