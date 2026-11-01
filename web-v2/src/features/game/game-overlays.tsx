import type { ReactNode } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { EventDTO, RoomSnapshot } from '../../../../contracts/v2.ts';
import { Avatar, Modal } from '../../components/ui.tsx';
import { COPY } from '../../presentation/copy.ts';
import { describeEvent } from '../../presentation/events.ts';
import { actionLabels, formatCountdown, presenceLabels, publicPhaseLabel } from '../../presentation/labels.ts';
import { parseVoteTally } from '../../presentation/vote-tally.ts';
import { navigate } from '../../app/navigation.ts';
import { DisplaySettings } from '../account/display-settings.tsx';
import { RulesBook } from '../rules/book.tsx';
import { SecondScreenPanel } from '../spectator/panel.tsx';
import { Identity } from './identity.tsx';
import { PlayerMarkEditor } from './player-marks.tsx';
import { VoteTallyCard } from './vote-tally.tsx';

export type GameOverlay =
  | { kind: 'identity' | 'rules' | 'navigation' | 'second-screen' | 'settings' }
  | { kind: 'player'; playerId: string }
  | { kind: 'event'; event: EventDTO }
  | { kind: 'vote-tally'; event: EventDTO }
  | null;

export function GameOverlays({ active, online, overlay, view, catalog, privateView, context, remaining, refresh, onOverlay }: {
  active: boolean;
  online: boolean;
  overlay: GameOverlay;
  view: RoomSnapshot;
  catalog: CatalogDTO;
  privateView: RoomSnapshot['private'];
  context: ReactNode;
  remaining: (deadline: number) => number | null;
  refresh: () => Promise<void>;
  onOverlay: (overlay: GameOverlay) => void;
}) {
  const details = overlay?.kind === 'player' ? view.public?.seats.find(seat => seat.playerId === overlay.playerId) : null;
  const eventText = overlay?.kind === 'event' ? describeEvent(overlay.event, view, catalog) : null;
  const overlayTally = overlay?.kind === 'vote-tally' ? parseVoteTally(overlay.event) : null;
  const close = () => onOverlay(null);

  return <>
    {active && overlay?.kind === 'rules' && (
      <RulesBook catalog={catalog} context={context} roleId={privateView?.self.roleId} phase={view.public?.phase} view={view} onClose={close}/>
    )}
    {active && overlay?.kind === 'identity' && (
      <Modal title={view.viewer.readOnly ? COPY.spectator.currentIdentity : '我的身份'} context={context} onClose={close}>
        <Identity view={view} catalog={catalog}/>
      </Modal>
    )}
    {active && overlay?.kind === 'player' && details && (
      <Modal title={`${details.seat}号玩家`} context={context} onClose={close}>
        <div className="seat-profile">
          <Avatar url={details.avatarUrl} name={details.nickname} size="large"/>
          <div className="seat-profile__details">
            <h3>{details.nickname}</h3>
            <p className="muted">UID {details.uid}</p>
            <p>{details.alive ? '公开状态：存活' : '公开状态：已死亡'} · {presenceLabels[details.presence]}</p>
            <p>{details.revealedRoleId
              ? `公开身份：${catalog.roles.find(role => role.roleId === details.revealedRoleId)?.name ?? '已翻牌'}`
              : '身份尚未公开'}</p>
            {view.public?.sheriff.holderId === details.playerId && <p>沉睡的天理</p>}
          </div>
        </div>
        <PlayerMarkEditor view={view} playerId={details.playerId} readOnly={view.room.phase !== 'playing'}/>
      </Modal>
    )}
    {active && overlay?.kind === 'event' && eventText && (
      <Modal title={eventText.title} context={context} onClose={close}>
        <p className="muted">第 {overlay.event.dayNumber} 轮 · 阶段 {overlay.event.stage}</p>
        {eventText.details.map((line, index) => <p key={index}>{line}</p>)}
      </Modal>
    )}
    {active && overlay?.kind === 'vote-tally' && overlayTally && (
      <Modal title={overlayTally.kind === 'election' ? '天理竞选票型' : '放逐投票票型'} context={context} onClose={close}>
        <VoteTallyCard tally={overlayTally}/>
      </Modal>
    )}
    {active && overlay?.kind === 'navigation' && (
      <Modal title="剧院导航" context={context} onClose={close}>
        <p className="muted">查看账户或首页不会主动离开房间，对局仍继续计时。</p>
        <div className="button-row">
          <button type="button" className="button" onClick={() => navigate('/')}>剧院首页</button>
          <button type="button" className="button" onClick={() => navigate('/account')}>我的账户</button>
          <button type="button" className="button" onClick={() => onOverlay({ kind: 'rules' })}>完整规则</button>
          <button type="button" className="button" onClick={() => onOverlay({ kind: 'settings' })}>显示设置</button>
        </div>
      </Modal>
    )}
    {active && overlay?.kind === 'settings' && (
      <Modal title="显示设置" context={context} onClose={close}><DisplaySettings/></Modal>
    )}
    <SecondScreenPanel
      view={view}
      online={online}
      open={active && overlay?.kind === 'second-screen'}
      onClose={close}
      refresh={refresh}
      remaining={remaining}
      context={context}
    />
  </>;
}

export function GameOverlayContext({ view, task, remaining, onReturn }: {
  view: RoomSnapshot;
  task: RoomSnapshot['tasks'][number] | null;
  remaining: (deadline: number) => number | null;
  onReturn: () => void;
}) {
  return <div className="modal-game-context">
    <span>
      {publicPhaseLabel(view)}
      {task ? ` · ${actionLabels[task.action]} · ${formatCountdown(remaining(task.closesAt))}` : ''}
    </span>
    <button type="button" className="text-button" onClick={onReturn}>返回舞台与行动</button>
  </div>;
}
