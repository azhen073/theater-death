import { useEffect, useRef, useState } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { EventDTO, RoomSnapshot, SeatDTO } from '../../../../contracts/v2.ts';
import { Avatar, Modal, Notice } from '../../components/ui.tsx';
import { actionLabels, formatCountdown, presenceLabels, publicPhaseLabel } from '../../presentation/labels.ts';
import { describeEvent } from '../../presentation/events.ts';
import { ApiFailure } from '../../transport/http.ts';
import { navigate } from '../../app/navigation.ts';
import { ActionPanel, targetSummary } from '../actions/panel.tsx';
import { useCommands } from '../actions/use-commands.ts';
import { actionIssue, commandIntent, currentTask, emptyDraft, skipLabels, taskKey, updateSelection } from '../actions/model.ts';
import type { ActionDraft } from '../actions/model.ts';
import { Lobby } from '../room/lobby.tsx';
import { RulesBook } from '../rules/book.tsx';
import { Stage } from './stage.tsx';
import { Identity, authorizedPrivate } from './identity.tsx';
import { GameSidebar } from './sidebar.tsx';
import { SecondScreenPanel } from '../spectator/panel.tsx';
import { ObservedActions } from '../spectator/actions.tsx';
import { DisplaySettings } from '../account/display-settings.tsx';
import { DeathNotice } from './death-notice.tsx';
import { reconcileDraft } from '../actions/draft-reconciliation.ts';
import { newRequestId } from '../../transport/ids.ts';

type Overlay = { kind: 'identity' | 'rules' | 'navigation' | 'second-screen' | 'settings' } | { kind: 'player'; playerId: string } | { kind: 'event'; event: EventDTO } | null;
export function GameScene({ view, catalog, online, active = true, remaining, refresh, onExit, onExpired }: {
  view: RoomSnapshot; catalog: CatalogDTO; online: boolean; remaining: (deadline: number) => number | null;
  refresh: () => Promise<void>; onExit: (message: string) => void; onExpired: () => void; active?: boolean;
}) {
  const [activeKey, setActiveKey] = useState('');
  const [draftState, setDraftState] = useState<{ values: Record<string, ActionDraft>; changed: boolean }>({ values: {}, changed: false });
  const drafts = draftState.values;
  const [overlay, setOverlay] = useState<Overlay>(null), [manage, setManage] = useState(false);
  const [managementVisited, setManagementVisited] = useState(false);
  useEffect(() => { if (!active) setOverlay(null); }, [active]);
  const [, tick] = useState(0);
  const actionRef = useRef<HTMLDivElement>(null);
  const mountedView = useRef(view); mountedView.current = view;
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 500); return () => clearInterval(timer); }, []);
  const availableTasks = view.viewer.readOnly ? [] : view.tasks.filter(item => currentTask(view, item));
  const taskSignature = JSON.stringify(availableTasks.map(item => [taskKey(item), item.targets]));
  useEffect(() => {
    const current = mountedView.current;
    const tasks = current.viewer.readOnly ? [] : current.tasks.filter(item => currentTask(current, item));
    setDraftState(old => {
      const values: Record<string, ActionDraft> = {}; let changed = false;
      for (const task of tasks) {
        const key = taskKey(task), prior = old.values[key];
        if (!prior) continue;
        values[key] = task.targets ? reconcileDraft(task.targets, prior) : prior;
        if (values[key] !== prior) changed = true;
      }
      return { values, changed };
    });
  }, [taskSignature]);
  const commands = useCommands(view, refresh, failure => {
    if (failure instanceof ApiFailure && failure.code === 'unauthorized') onExpired();
    else if (failure instanceof ApiFailure) void refresh();
  });
  const task = availableTasks.find(item => taskKey(item) === activeKey) ?? availableTasks[0] ?? null;
  const prior = task && view.submissionState.find(item => taskKey(item) === taskKey(task));
  const privateView = authorizedPrivate(view);
  let draft = task ? drafts[taskKey(task)] ?? (prior ? { targets: [...prior.targets], direction: prior.direction ?? 'asc', revision: prior.revision } : emptyDraft()) : emptyDraft();
  const reconciled = task?.targets ? reconcileDraft(task.targets, draft) : draft;
  const selectionChanged = reconciled !== draft;
  draft = reconciled;
  if (task?.action === 'CONFIRM_PROPOSAL') draft = { ...draft, revision: privateView?.proposal?.revision ?? null };
  const latestCommand = task ? commands.records.findLast(record => taskKey(record.intent) === taskKey(task)) : null;
  const matchesDraft = (value: { targets?: readonly string[]; direction?: string | null; revision?: number | null }) =>
    (value.targets === undefined || JSON.stringify(value.targets) === JSON.stringify(draft.targets)) &&
    (value.direction == null || value.direction === draft.direction) && (value.revision == null || value.revision === draft.revision);
  const feedback = latestCommand
    ? latestCommand.status === 'sending' ? '正在提交'
      : latestCommand.status === 'rejected' ? '未被接受，点击查看原因'
        : latestCommand.status === 'accepted' ? prior && prior.requestId !== latestCommand.intent.requestId ? '服务器记录已更新，点击查看' : matchesDraft(latestCommand.intent) ? '已确认提交' : '当前更改尚未提交'
          : '结果尚未确认，点击查看'
    : prior ? matchesDraft(prior) ? '服务端已确认' : '当前更改尚未提交'
      : commands.records.some(record => !['accepted', 'rejected'].includes(record.status)) ? '另有旧请求待确认' : '';
  const setDraft = (value: ActionDraft) => { if (task) setDraftState(old => ({ values: { ...old.values, [taskKey(task)]: value }, changed: false })); };
  const pending = task && commands.records.some(record => taskKey(record.intent) === taskKey(task) && !['accepted', 'rejected'].includes(record.status));
  const locked = !online || !!pending || !!task && remaining(task.closesAt) === 0;
  const choose = (playerId: string, change: 1 | -1) => { if (!locked && task?.targets) setDraft({ ...draft, targets: updateSelection(task.targets, draft.targets, playerId, change) }); };
  const sendActive = () => { if (task && !locked && !actionIssue(view, task, draft)) void commands.submit(commandIntent(view, task, draft, newRequestId())); };
  const publicWindows = view.windows.filter(window => !['guard', 'laike', 'faction', 'check', 'rescue', 'revive'].includes(window.type));
  const publicWindow = publicWindows.length === 1 ? publicWindows[0] : null;
  const activePlayer = view.public?.seats.find(seat => seat.playerId === view.public?.day?.currentSpeakerId);
  const subject = view.public?.seats.find(seat => seat.playerId === view.viewer.subjectPlayerId);
  const context = <div className="modal-game-context"><span>{publicPhaseLabel(view)}{task ? ` · ${actionLabels[task.action]} · ${formatCountdown(remaining(task.closesAt))}` : ''}</span><button className="text-button" onClick={() => { setOverlay(null); setManage(false); }}>返回舞台与行动</button></div>;
  const details = overlay?.kind === 'player' ? view.public?.seats.find(seat => seat.playerId === overlay.playerId) : null;
  const eventText = overlay?.kind === 'event' ? describeEvent(overlay.event, view, catalog) : null;
  return <>{managementVisited && <div hidden={!active || !manage}>{context}<button className="button" onClick={() => setManage(false)}>返回舞台</button><Lobby active={active && manage} view={view} catalog={catalog} online={online} remaining={remaining} refresh={refresh} onExit={onExit} onExpired={onExpired}/></div>}
    <div className="game-scene" hidden={!active || manage}>
    <DeathNotice view={view} online={online && active}/>
    <header className="game-hud"><div><span className="eyebrow">第 {view.public?.dayNumber ?? 1} 轮 · {view.public?.phase === 'night' ? '夜晚' : '白天'} · 第 {view.public?.stage ?? 1} 阶段</span><h1>{publicPhaseLabel(view)}</h1></div><div className="hud-meta"><strong>{publicWindow ? formatCountdown(remaining(publicWindow.closesAt)) : '以当前任务为准'}</strong><span>公开存活 {view.public?.seats.filter(seat => seat.alive).length ?? 0} / {view.public?.seats.length ?? 0}</span></div><div className="hud-tools"><button className="button" onClick={() => setOverlay({ kind: 'navigation' })}>导航</button><button className="button" onClick={() => setOverlay({ kind: 'second-screen' })}>第二屏</button><button className="button" onClick={() => { setManagementVisited(true); setManage(true); }}>房间管理</button></div></header>
    {view.viewer.readOnly && <Notice>正在观战 · {privateView ? `私人第二屏：${privateView.self.seat}号 ${privateView.self.nickname}` : '公开视角'} · 只读</Notice>}
    {(selectionChanged || draftState.changed) && <Notice>可选目标已更新，不再允许的选择已移除。请核对当前目标后再确认。<button className="text-button" onClick={() => task ? setDraft(draft) : setDraftState(old => ({ ...old, changed: false }))}>知道了</button></Notice>}
    {!view.viewer.readOnly && subject && !subject.alive && <Notice>你已死亡，仍可查看获准的信息；当前可用能力以行动面板为准。</Notice>}
    {activePlayer && <p className="speaker-banner">{view.public?.day?.speechPreparing ? '即将发言' : '当前发言'}：{activePlayer.seat}号 {activePlayer.nickname}</p>}
    {view.public?.day?.election && ['vote', 'revote'].includes(view.public.day.election.phase) && <p className="speaker-banner">天理投票进度：{view.public.day.election.votedCount} / {view.public.day.election.eligibleCount}。结算后公开票型。</p>}
    {view.public?.day?.ballot && ['vote', 'revote'].includes(view.public.day.ballot.phase) && <p className="speaker-banner">放逐投票进度：{view.public.day.ballot.votedCount} / {view.public.day.ballot.eligibleCount}。结算后公开票型。</p>}
    <div className="game-columns"><div className="game-play-area"><Stage view={view} catalog={catalog} task={task} selected={draft.targets} locked={locked} onSelect={choose} onInfo={(seat: SeatDTO) => setOverlay({ kind: 'player', playerId: seat.playerId })}/>
      <div className="perspective-bar"><span>房间 {view.room.code} · {view.room.config.mode === 'formal' ? '正式模式' : '实验模式'} · 舞台状态以公开公告为准</span>{privateView && <button className="text-button" onClick={() => setOverlay({ kind: 'identity' })}>{view.viewer.readOnly ? '当前观察身份' : '我的身份'}</button>}</div>
      <div ref={actionRef} className="action-anchor"><ActionPanel view={view} task={task} draft={draft} setDraft={setDraft} selectTask={setActiveKey} online={online} remaining={remaining} records={commands.records} submit={intent => { void commands.submit(intent); }} retry={id => void commands.retry(id)} query={id => void commands.query(id)}/></div>
      <ObservedActions view={view} remaining={remaining}/>
    </div><GameSidebar view={view} catalog={catalog} online={online} readingPaused={!active || manage || overlay !== null} refresh={refresh} onIdentity={() => setOverlay({ kind: 'identity' })} onRules={() => setOverlay({ kind: 'rules' })} onEvent={event => setOverlay({ kind: 'event', event })}/></div>
    <div className="mobile-action-bar" role="region" aria-label="当前行动快捷栏"><button className="mobile-action-summary" onClick={event => { event.currentTarget.focus({ preventScroll: true }); actionRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' }); }}><strong>{task ? `${actionLabels[task.action]} · ${formatCountdown(remaining(task.closesAt))}` : view.viewer.readOnly ? '只读观战' : '本阶段无需操作'}</strong><span>{feedback && `${feedback} · `}{task?.targets ? draft.targets.length ? targetSummary(view, draft.targets) : '尚未选择目标' : '查看行动与提交状态 ↑'}</span></button>{task && <button className="button button--primary" disabled={locked || !!actionIssue(view, task, draft)} onClick={sendActive}>{task.targets?.canSkip && !draft.targets.length ? skipLabels[task.action] ?? '确认提交' : '确认提交'}</button>}</div>
    {active && overlay?.kind === 'rules' && <RulesBook catalog={catalog} context={context} roleId={privateView?.self.roleId} phase={view.public?.phase} onClose={() => setOverlay(null)}/>}
    {active && overlay?.kind === 'identity' && <Modal title={view.viewer.readOnly ? '当前观察身份' : '我的身份'} context={context} onClose={() => setOverlay(null)}><Identity view={view} catalog={catalog}/></Modal>}
    {active && overlay?.kind === 'player' && details && <Modal title={`${details.seat}号玩家`} context={context} onClose={() => setOverlay(null)}><div className="account-profile"><Avatar url={details.avatarUrl} name={details.nickname} size="large"/><div><h3>{details.nickname}</h3><p className="muted">UID {details.uid}</p><p>{details.alive ? '公开状态：存活' : '公开状态：已死亡'} · {presenceLabels[details.presence]}</p><p>{details.revealedRoleId ? `公开身份：${catalog.roles.find(role => role.roleId === details.revealedRoleId)?.name ?? '已翻牌'}` : '身份尚未公开'}</p>{view.public?.sheriff.holderId === details.playerId && <p>沉睡的天理</p>}</div></div></Modal>}
    {active && overlay?.kind === 'event' && eventText && <Modal title={eventText.title} context={context} onClose={() => setOverlay(null)}><p className="muted">第 {overlay.event.dayNumber} 轮 · 阶段 {overlay.event.stage}</p>{eventText.details.map((line, index) => <p key={index}>{line}</p>)}</Modal>}
    {active && overlay?.kind === 'navigation' && <Modal title="剧院导航" context={context} onClose={() => setOverlay(null)}><p className="muted">查看账户或首页不会主动离开房间，对局仍继续计时。</p><div className="button-row"><button className="button" onClick={() => navigate('/')}>剧院首页</button><button className="button" onClick={() => navigate('/account')}>我的账户</button><button className="button" onClick={() => setOverlay({ kind: 'rules' })}>完整规则</button><button className="button" onClick={() => setOverlay({ kind: 'settings' })}>显示设置</button></div></Modal>}
    {active && overlay?.kind === 'settings' && <Modal title="显示设置" context={context} onClose={() => setOverlay(null)}><DisplaySettings/></Modal>}
  </div><SecondScreenPanel view={view} online={online} open={active && overlay?.kind === 'second-screen'} onClose={() => setOverlay(null)} refresh={refresh} remaining={remaining} context={context}/></>;
}
