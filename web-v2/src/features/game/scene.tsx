import { useEffect, useRef, useState } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { EventDTO, RoomSnapshot, SeatDTO, TaskDTO } from '../../../../contracts/v2.ts';
import { Avatar, Modal, Notice } from '../../components/ui.tsx';
import { actionLabels, formatCountdown, presenceLabels, publicPhaseLabel } from '../../presentation/labels.ts';
import { describeEvent } from '../../presentation/events.ts';
import { ApiFailure } from '../../transport/http.ts';
import { navigate } from '../../app/navigation.ts';
import { useCommands } from '../actions/use-commands.ts';
import { actionIssue, commandIntent, currentTask, emptyDraft, proposalEditAndConfirmIntent, taskKey, updateSelection } from '../actions/model.ts';
import type { ActionDraft } from '../actions/model.ts';
import { actionScopeKey, areTargetSetsEqual, deriveActionPresentation, type SubmissionEvidence } from '../actions/presentation.ts';
import { StageActionCard } from '../actions/stage-action-card.tsx';
import { Proposal } from '../actions/proposal.tsx';
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

type Overlay =
  | { kind: 'identity' | 'rules' | 'navigation' | 'second-screen' | 'settings' }
  | { kind: 'player'; playerId: string }
  | { kind: 'event'; event: EventDTO }
  | null;

export function GameScene({
  view,
  catalog,
  online,
  active = true,
  remaining,
  refresh,
  onExit,
  onExpired,
}: {
  view: RoomSnapshot;
  catalog: CatalogDTO;
  online: boolean;
  remaining: (deadline: number) => number | null;
  refresh: () => Promise<void>;
  onExit: (message: string) => void;
  onExpired: () => void;
  active?: boolean;
}) {
  const currentScope = actionScopeKey(view);
  const [activeKey, setActiveKey] = useState('');
  const [draftState, setDraftState] = useState<{ scope: string; values: Record<string, ActionDraft>; changed: boolean }>({
    scope: currentScope,
    values: {},
    changed: false,
  });
  const drafts = draftState.scope === currentScope ? draftState.values : {};
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [manage, setManage] = useState(false);
  const [managementVisited, setManagementVisited] = useState(false);

  useEffect(() => {
    if (!active) setOverlay(null);
  }, [active]);

  const [, tick] = useState(0);
  const mountedView = useRef(view);
  mountedView.current = view;

  useEffect(() => {
    const timer = setInterval(() => tick(value => value + 1), 500);
    return () => clearInterval(timer);
  }, []);

  // Scope isolation: reset drafts and evidence when room/game/user perspective changes
  const lastScope = useRef(currentScope);
  const [evidence, setEvidence] = useState<SubmissionEvidence[]>([]);
  const refreshedConflicts = useRef(new Set<string>());

  useEffect(() => {
    if (lastScope.current !== currentScope) {
      lastScope.current = currentScope;
      setDraftState({ scope: currentScope, values: {}, changed: false });
      setEvidence([]);
      refreshedConflicts.current.clear();
      setActiveKey('');
    }
  }, [currentScope]);

  useEffect(() => {
    setEvidence(old =>
      old.map(ev => {
        if (ev.firstMatchingSnapshotVersion !== null) return ev;
        if (ev.scope !== currentScope) return ev;
        const match = view.submissionState.find(
          s => s.requestId === ev.requestId && taskKey(s) === ev.taskKey
        );
        if (match) {
          return { ...ev, firstMatchingSnapshotVersion: view.viewVersion };
        }
        return ev;
      })
    );
  }, [currentScope, view.submissionState, view.viewVersion]);

  const authorizedTasks = view.viewer.readOnly ? [] : view.tasks.filter(item => currentTask(view, item));
  const proposalEditTask = authorizedTasks.find(item => item.action === 'EDIT_PROPOSAL') ?? null;
  const proposalConfirmTask = authorizedTasks.find(item => item.action === 'CONFIRM_PROPOSAL' &&
    item.windowInstanceId === proposalEditTask?.windowInstanceId) ?? null;
  const combinedProposal = !!view.capabilities.supportsProposalEditConfirmation && !!proposalEditTask && !!proposalConfirmTask;
  const availableTasks = combinedProposal
    ? authorizedTasks.filter(item => item !== proposalConfirmTask)
    : authorizedTasks;
  const taskSignature = JSON.stringify(availableTasks.map(item => [taskKey(item), item.targets]));

  useEffect(() => {
    const current = mountedView.current;
    const tasks = current.viewer.readOnly ? [] : current.tasks.filter(item => currentTask(current, item));
    setDraftState(old => {
      if (old.scope !== currentScope) return { scope: currentScope, values: {}, changed: false };
      const values: Record<string, ActionDraft> = {};
      let changed = false;
      for (const task of tasks) {
        const key = taskKey(task);
        const prior = old.values[key];
        if (!prior) continue;
        values[key] = task.targets ? reconcileDraft(task.targets, prior) : prior;
        if (values[key] !== prior) changed = true;
      }
      return { scope: currentScope, values, changed };
    });
  }, [currentScope, taskSignature]);

  const commands = useCommands(
    view,
    refresh,
    failure => {
      if (failure instanceof ApiFailure && failure.code === 'unauthorized') onExpired();
      else if (failure instanceof ApiFailure) void refresh();
    },
    online
  );

  const task = availableTasks.find(item => taskKey(item) === activeKey) ?? availableTasks[0] ?? null;
  const prior = task && view.submissionState.find(item => taskKey(item) === taskKey(task));
  const privateView = authorizedPrivate(view);

  const proposal = privateView?.proposal ?? null;
  let draft = task
    ? drafts[taskKey(task)] ??
      (prior
        ? (task.targets
            ? reconcileDraft(task.targets, { targets: [...prior.targets], direction: prior.direction ?? 'asc', revision: prior.revision })
            : { targets: [...prior.targets], direction: prior.direction ?? 'asc', revision: prior.revision })
        : combinedProposal && task.action === 'EDIT_PROPOSAL' && proposal
          ? { ...emptyDraft(), targets: [...proposal.targetPlayerIds] }
          : emptyDraft())
    : emptyDraft();

  if (task?.action === 'CONFIRM_PROPOSAL') {
    draft = { ...draft, revision: privateView?.proposal?.revision ?? null };
  }

  const setDraft = (value: ActionDraft) => {
    if (task) {
      setDraftState(old => ({
        scope: currentScope,
        values: { ...(old.scope === currentScope ? old.values : {}), [taskKey(task)]: value },
        changed: false,
      }));
    }
  };

  const pending = task && commands.records.some(record =>
    !['accepted', 'rejected'].includes(record.status) &&
    (taskKey(record.intent) === taskKey(task) || combinedProposal &&
      record.intent.windowInstanceId === task.windowInstanceId &&
      ['EDIT_PROPOSAL', 'CONFIRM_PROPOSAL'].includes(record.intent.action)));
  const remainingMs = task ? remaining(task.closesAt) : null;
  const locked = !online || !!pending || (remainingMs !== null && remainingMs === 0);

  const choose = (playerId: string, change: 1 | -1) => {
    if (!locked && task?.targets) {
      setDraft({ ...draft, targets: updateSelection(task.targets, draft.targets, playerId, change) });
    }
  };

  const submitDraft = (targetTask: TaskDTO, submittedDraft: ActionDraft, buildIntent = commandIntent) => {
    if (!targetTask || locked) return;
    if (!actionIssue(view, targetTask, submittedDraft)) {
      const reqId = newRequestId();
      const priorSub = view.submissionState.find(s => taskKey(s) === taskKey(targetTask));
      setEvidence(old => [
        ...old.filter(e => e.scope === currentScope && e.requestId !== reqId),
        {
          scope: currentScope,
          requestId: reqId,
          taskKey: taskKey(targetTask),
          snapshotVersionAtSend: view.viewVersion,
          snapshotRequestIdAtSend: priorSub?.requestId ?? null,
          firstMatchingSnapshotVersion: null,
        },
      ]);
      void commands.submit(buildIntent(view, targetTask, submittedDraft, reqId));
    }
  };

  const submitEmpty = () => {
    if (task && task.targets?.canSkip) {
      setDraftState(old => ({
        scope: currentScope,
        values: { ...(old.scope === currentScope ? old.values : {}), [taskKey(task)]: { ...draft, targets: [] } },
        changed: false,
      }));
      submitDraft(task, { ...draft, targets: [] });
    }
  };

  const submit = () => {
    if (!task) return;
    if (task.targets?.canSkip && draft.targets.length === 0) {
      submitEmpty();
    } else {
      submitDraft(task, draft);
    }
  };

  const proposalModified = combinedProposal && task?.action === 'EDIT_PROPOSAL' && proposal
    ? !areTargetSetsEqual(draft.targets, proposal.targetPlayerIds) : false;
  const proposalConfirmedBySelf = !!proposal && !!privateView?.self.playerId &&
    proposal.confirmedBy.includes(privateView.self.playerId);
  const proposalConfirmRecord = combinedProposal && proposalConfirmTask && proposal
    ? commands.records.findLast(record => taskKey(record.intent) === taskKey(proposalConfirmTask) &&
        record.intent.revision === proposal.revision && record.status !== 'rejected')
    : null;
  const proposalConfirmationSyncing = !!proposalConfirmRecord && !proposalConfirmedBySelf;
  const proposalEditRecord = combinedProposal && proposalEditTask && proposal
    ? commands.records.findLast(record => taskKey(record.intent) === taskKey(proposalEditTask) &&
        record.intent.confirmSelf === true && record.intent.expectedRevision === proposal.revision &&
        record.status !== 'rejected')
    : null;
  const proposalEditSyncing = !!proposalEditRecord;
  const proposalSyncLabel = proposalEditRecord?.status === 'sending'
    ? '正在提交…'
    : proposalEditRecord && !['accepted', 'rejected'].includes(proposalEditRecord.status)
      ? '方案结果待确认'
      : '方案已提交，正在同步';
  const confirmationSyncLabel = proposalConfirmRecord?.status === 'sending'
    ? '正在提交…'
    : proposalConfirmRecord && !['accepted', 'rejected'].includes(proposalConfirmRecord.status)
      ? '确认结果待定'
      : '同意已提交，正在同步';
  const submitProposal = () => {
    if (!combinedProposal || !proposalEditTask || !proposalConfirmTask || !proposal) return submit();
    if (proposalConfirmationSyncing || proposalEditSyncing) return;
    if (proposal.revision > 0 && !proposalModified) {
      const confirmDraft = { ...emptyDraft(), revision: proposal.revision };
      submitDraft(proposalConfirmTask, confirmDraft);
      return;
    }
    submitDraft(proposalEditTask, draft, (currentView, targetTask, currentDraft, requestId) =>
      proposalEditAndConfirmIntent(currentView, targetTask, currentDraft, requestId, proposal.revision));
  };
  const submitEmptyProposal = () => {
    if (!combinedProposal || !proposalEditTask || !proposal) return submitEmpty();
    if (proposal.revision > 0 && !proposalModified && draft.targets.length === 0) return submitProposal();
    const empty = { ...draft, targets: [] };
    setDraft(empty);
    submitDraft(proposalEditTask, empty, (currentView, targetTask, currentDraft, requestId) =>
      proposalEditAndConfirmIntent(currentView, targetTask, currentDraft, requestId, proposal.revision));
  };

  const basePresentation = deriveActionPresentation({
    view,
    task,
    draft,
    records: commands.records,
    online,
    remainingMs,
    evidence,
  });
  const presentation = combinedProposal && task?.action === 'EDIT_PROPOSAL' && proposal
    ? {
        ...basePresentation,
        title: '团队攻击',
        primary: basePresentation.primary ? {
          ...basePresentation.primary,
          label: proposal.revision > 0 && !proposalModified
            ? proposalConfirmedBySelf ? `已同意 v${proposal.revision}`
              : proposalConfirmationSyncing ? confirmationSyncLabel
              : `同意方案 v${proposal.revision}`
            : proposalEditSyncing ? proposalSyncLabel : '发布并确认方案',
          disabled: locked || !!actionIssue(view, task, draft) ||
            proposalEditSyncing || proposal.revision > 0 && !proposalModified && (proposalConfirmedBySelf || proposalConfirmationSyncing),
        } : null,
        emptyAction: basePresentation.emptyAction ? {
          ...basePresentation.emptyAction,
          label: proposal.revision > 0 && !proposalModified && draft.targets.length === 0
            ? proposalConfirmedBySelf ? `已同意 v${proposal.revision}`
              : proposalConfirmationSyncing ? confirmationSyncLabel
              : `同意方案 v${proposal.revision}`
            : '发布并确认空刀',
          disabled: locked || proposalEditSyncing || proposal.revision > 0 && !proposalModified && (proposalConfirmedBySelf || proposalConfirmationSyncing),
        } : null,
      }
    : basePresentation;

  useEffect(() => {
    const signature = presentation.syncConflictKey;
    if (!signature || !online || refreshedConflicts.current.has(signature)) return;
    refreshedConflicts.current.add(signature);
    void refresh();
  }, [online, presentation.syncConflictKey, refresh]);

  const publicWindows = view.windows.filter(
    window => !['guard', 'laike', 'faction', 'check', 'rescue', 'revive'].includes(window.type)
  );
  const publicWindow = publicWindows.length === 1 ? publicWindows[0] : null;
  const activePlayer = view.public?.seats.find(seat => seat.playerId === view.public?.day?.currentSpeakerId);
  const subject = view.public?.seats.find(seat => seat.playerId === view.viewer.subjectPlayerId);

  const context = (
    <div className="modal-game-context">
      <span>
        {publicPhaseLabel(view)}
        {task ? ` · ${actionLabels[task.action]} · ${formatCountdown(remaining(task.closesAt))}` : ''}
      </span>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          setOverlay(null);
          setManage(false);
        }}
      >
        返回舞台与行动
      </button>
    </div>
  );

  const details =
    overlay?.kind === 'player' ? view.public?.seats.find(seat => seat.playerId === overlay.playerId) : null;
  const eventText = overlay?.kind === 'event' ? describeEvent(overlay.event, view, catalog) : null;

  const actionSlot =
    view.viewer.readOnly &&
    view.viewer.kind === 'private_spectator' &&
    view.private?.self.playerId === view.viewer.subjectPlayerId ? (
      <ObservedActions view={view} remaining={remaining} />
    ) : (
      <StageActionCard
        view={view}
        presentation={presentation}
        task={task}
        draft={draft}
        availableTasks={availableTasks}
        countdown={task ? formatCountdown(remaining(task.closesAt)) : undefined}
        targetChanged={draftState.changed}
        proposalCombined={combinedProposal}
        onSelectTask={setActiveKey}
        onDraftChange={setDraft}
        onSubmit={combinedProposal && task?.action === 'EDIT_PROPOSAL' ? submitProposal : submit}
        onSubmitEmpty={combinedProposal && task?.action === 'EDIT_PROPOSAL' ? submitEmptyProposal : submitEmpty}
        onRetry={id => void commands.retry(id)}
        onQuery={id => void commands.query(id)}
        onRefresh={() => void refresh()}
      >
        {task && ['EDIT_PROPOSAL', 'CONFIRM_PROPOSAL'].includes(task.action) && <Proposal view={view} />}
      </StageActionCard>
    );

  return (
    <>
      {managementVisited && (
        <div hidden={!active || !manage}>
          {context}
          <button type="button" className="button" onClick={() => setManage(false)}>
            返回舞台
          </button>
          <Lobby
            active={active && manage}
            view={view}
            catalog={catalog}
            online={online}
            remaining={remaining}
            refresh={refresh}
            onExit={onExit}
            onExpired={onExpired}
          />
        </div>
      )}
      <div className="game-scene" hidden={!active || manage}>
        <DeathNotice view={view} online={online && active} />
        <header className="game-hud">
          <div>
            <span className="eyebrow">
              第 {view.public?.dayNumber ?? 1} 轮 · {view.public?.phase === 'night' ? '夜晚' : '白天'} · 第{' '}
              {view.public?.stage ?? 1} 阶段
            </span>
            <h1>{publicPhaseLabel(view)}</h1>
          </div>
          <div className="hud-meta">
            <strong>{publicWindow ? formatCountdown(remaining(publicWindow.closesAt)) : '以当前任务为准'}</strong>
            <span>
              公开存活 {view.public?.seats.filter(seat => seat.alive).length ?? 0} /{' '}
              {view.public?.seats.length ?? 0}
            </span>
          </div>
          <div className="hud-tools">
            <span
              className="hud-room-code"
              title={`房间 ${view.room.code} · ${view.room.config.mode === 'formal' ? '正式模式' : '实验模式'}`}
            >
              房间 {view.room.code} · {view.room.config.mode === 'formal' ? '正式' : '实验'}
            </span>
            {privateView && (
              <button type="button" className="button" onClick={() => setOverlay({ kind: 'identity' })}>
                {view.viewer.readOnly ? '当前观察身份' : '我的身份'}
              </button>
            )}
            <button type="button" className="button" onClick={() => setOverlay({ kind: 'navigation' })}>
              导航
            </button>
            <button type="button" className="button" onClick={() => setOverlay({ kind: 'second-screen' })}>
              第二屏
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setManagementVisited(true);
                setManage(true);
              }}
            >
              房间管理
            </button>
          </div>
        </header>

        {view.viewer.readOnly && (
          <Notice>
            正在观战 · {privateView ? `私人第二屏：${privateView.self.seat}号 ${privateView.self.nickname}` : '公开视角'} ·
            只读
          </Notice>
        )}
        {!view.viewer.readOnly && subject && !subject.alive && (
          <Notice>你已死亡，仍可查看获准的信息；当前可用能力以舞台行动为准。</Notice>
        )}
        {activePlayer && (
          <p className="speaker-banner">
            {view.public?.day?.speechPreparing ? '即将发言' : '当前发言'}：{activePlayer.seat}号 {activePlayer.nickname}
          </p>
        )}
        {view.public?.day?.election && ['vote', 'revote'].includes(view.public.day.election.phase) && (
          <p className="speaker-banner">
            天理投票进度：{view.public.day.election.votedCount} / {view.public.day.election.eligibleCount}。结算后公开票型。
          </p>
        )}
        {view.public?.day?.ballot && ['vote', 'revote'].includes(view.public.day.ballot.phase) && (
          <p className="speaker-banner">
            放逐投票进度：{view.public.day.ballot.votedCount} / {view.public.day.ballot.eligibleCount}。结算后公开票型。
          </p>
        )}

        <div className="game-columns">
          <div className="game-play-area">
            <Stage
              view={view}
              catalog={catalog}
              task={task}
              selected={draft.targets}
              locked={locked}
              actionSlot={actionSlot}
              onSelect={choose}
              onInfo={(seat: SeatDTO) => setOverlay({ kind: 'player', playerId: seat.playerId })}
            />
          </div>
          <GameSidebar
            view={view}
            catalog={catalog}
            online={online}
            readingPaused={!active || manage || overlay !== null}
            refresh={refresh}
            onIdentity={() => setOverlay({ kind: 'identity' })}
            onRules={() => setOverlay({ kind: 'rules' })}
            onEvent={event => setOverlay({ kind: 'event', event })}
          />
        </div>

        {active && overlay?.kind === 'rules' && (
          <RulesBook
            catalog={catalog}
            context={context}
            roleId={privateView?.self.roleId}
            phase={view.public?.phase}
            onClose={() => setOverlay(null)}
          />
        )}
        {active && overlay?.kind === 'identity' && (
          <Modal
            title={view.viewer.readOnly ? '当前观察身份' : '我的身份'}
            context={context}
            onClose={() => setOverlay(null)}
          >
            <Identity view={view} catalog={catalog} />
          </Modal>
        )}
        {active && overlay?.kind === 'player' && details && (
          <Modal title={`${details.seat}号玩家`} context={context} onClose={() => setOverlay(null)}>
            <div className="account-profile">
              <Avatar url={details.avatarUrl} name={details.nickname} size="large" />
              <div>
                <h3>{details.nickname}</h3>
                <p className="muted">UID {details.uid}</p>
                <p>
                  {details.alive ? '公开状态：存活' : '公开状态：已死亡'} · {presenceLabels[details.presence]}
                </p>
                <p>
                  {details.revealedRoleId
                    ? `公开身份：${catalog.roles.find(role => role.roleId === details.revealedRoleId)?.name ?? '已翻牌'}`
                    : '身份尚未公开'}
                </p>
                {view.public?.sheriff.holderId === details.playerId && <p>沉睡的天理</p>}
              </div>
            </div>
          </Modal>
        )}
        {active && overlay?.kind === 'event' && eventText && (
          <Modal title={eventText.title} context={context} onClose={() => setOverlay(null)}>
            <p className="muted">
              第 {overlay.event.dayNumber} 轮 · 阶段 {overlay.event.stage}
            </p>
            {eventText.details.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </Modal>
        )}
        {active && overlay?.kind === 'navigation' && (
          <Modal title="剧院导航" context={context} onClose={() => setOverlay(null)}>
            <p className="muted">查看账户或首页不会主动离开房间，对局仍继续计时。</p>
            <div className="button-row">
              <button type="button" className="button" onClick={() => navigate('/')}>
                剧院首页
              </button>
              <button type="button" className="button" onClick={() => navigate('/account')}>
                我的账户
              </button>
              <button type="button" className="button" onClick={() => setOverlay({ kind: 'rules' })}>
                完整规则
              </button>
              <button type="button" className="button" onClick={() => setOverlay({ kind: 'settings' })}>
                显示设置
              </button>
            </div>
          </Modal>
        )}
        {active && overlay?.kind === 'settings' && (
          <Modal title="显示设置" context={context} onClose={() => setOverlay(null)}>
            <DisplaySettings />
          </Modal>
        )}
      </div>
      <SecondScreenPanel
        view={view}
        online={online}
        open={active && overlay?.kind === 'second-screen'}
        onClose={() => setOverlay(null)}
        refresh={refresh}
        remaining={remaining}
        context={context}
      />
    </>
  );
}
