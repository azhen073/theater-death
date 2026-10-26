import { useEffect, useRef, useState } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot, SeatDTO, TaskDTO } from '../../../../contracts/v2.ts';
import { Notice } from '../../components/ui.tsx';
import { formatCountdown } from '../../presentation/labels.ts';
import { ApiFailure } from '../../transport/http.ts';
import { useCommands } from '../actions/use-commands.ts';
import { actionIssue, commandIntent, currentTask, emptyDraft, proposalEditAndConfirmIntent, taskKey, updateSelection } from '../actions/model.ts';
import type { ActionDraft } from '../actions/model.ts';
import { actionScopeKey, areTargetSetsEqual, deriveActionPresentation, type SubmissionEvidence } from '../actions/presentation.ts';
import { StageActionCard } from '../actions/stage-action-card.tsx';
import { Proposal } from '../actions/proposal.tsx';
import { Lobby } from '../room/lobby.tsx';
import { Stage } from './stage.tsx';
import { authorizedPrivate } from './identity.tsx';
import { GameSidebar } from './sidebar.tsx';
import { SpeechAttention } from './speech-attention.tsx';
import { useSpeakingSeats } from '../voice/speaking-seats.ts';
import { ObservedActions } from '../spectator/actions.tsx';
import { PhaseTransition } from './phase-transition.tsx';
import { SnowfallLayer } from './snowfall-layer.tsx';
import { VoteTallyLive, VoteProgress } from './vote-tally.tsx';
import { IdentityEntryReveal } from './identity-entry-reveal.tsx';
import { claimIdentityReveal, identityRevealHasUrgentAction, identityRevealKey } from './identity-reveal-model.ts';
import { reconcileDraft } from '../actions/draft-reconciliation.ts';
import { newRequestId } from '../../transport/ids.ts';
import { COPY } from '../../presentation/copy.ts';
import { GameHUD } from './game-hud.tsx';
import { GameOverlayContext, GameOverlays, type GameOverlay } from './game-overlays.tsx';

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
  const [overlay, setOverlay] = useState<GameOverlay>(null);
  const [identityEntryReveal, setIdentityEntryReveal] = useState(false);
  const [manage, setManage] = useState(false);
  const [managementVisited, setManagementVisited] = useState(false);

  useEffect(() => {
    if (!active) setOverlay(null);
  }, [active]);

  const [, tick] = useState(0);
  const mountedView = useRef(view);
  mountedView.current = view;

  // 自由发言阶段没有唯一发言者：用本机远端电平判定「谁在说话」并给座位亮光环（其余阶段为空）。
  const liveSpeakingSeats = useSpeakingSeats();

  // 窄屏滚动后把 HUD 收成细条（工具行收进「更多」），避免吸附的头条盖住座位。
  const [compact, setCompact] = useState(false);
  const [hudMenu, setHudMenu] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 680px)');
    let frame = 0;
    const sync = () => {
      frame = 0;
      const narrow = query.matches;
      const top = Math.round(window.scrollY);
      // 滞回：下滑超过 120px 才收起，回到 24px 以内才展开，避免临界抖动。
      setCompact(previous => (narrow ? (previous ? top > 24 : top > 120) : false));
    };
    const schedule = () => { if (frame === 0) frame = requestAnimationFrame(sync); };
    sync();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    if (typeof query.addEventListener === 'function') query.addEventListener('change', schedule);
    else query.addListener?.(schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (typeof query.removeEventListener === 'function') query.removeEventListener('change', schedule);
      else query.removeListener?.(schedule);
    };
  }, []);
  useEffect(() => { if (!compact) setHudMenu(false); }, [compact]);
  // 「更多」菜单：Esc 或点击菜单/按钮之外的任意处关闭。
  useEffect(() => {
    if (!hudMenu) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setHudMenu(false); };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && !target.closest('.hud-menu') && !target.closest('.hud-more')) setHudMenu(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [hudMenu]);

  // 死亡公告等固定横幅按 HUD 实际下沿定位（HUD 是 sticky：高度随宽度/显示缩放变化，
  // 未滚动时还带有场景的顶部内边距，写死 top 会压住工具行）。
  const hud = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = hud.current;
    if (!element) return;
    let frame = 0;
    const publish = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      // 管理视图会把整个场景隐藏（高度 0）：保留上一次的真实下沿，避免横幅跳到顶部。
      if (Math.round(rect.height) <= 0) return;
      document.documentElement.style.setProperty('--hud-bottom', `${Math.round(rect.bottom)}px`);
    };
    const schedule = () => { if (frame === 0) frame = requestAnimationFrame(publish); };
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(element);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.documentElement.style.removeProperty('--hud-bottom');
    };
  }, [active, manage]);

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
  const revealKey = identityRevealKey(view);
  const revealUrgent = identityRevealHasUrgentAction(authorizedTasks, remaining);

  useEffect(() => {
    if (!active || !revealKey || !catalog.roles.some(role => role.roleId === view.private?.self.roleId)) {
      setIdentityEntryReveal(false);
      return;
    }
    const decision = claimIdentityReveal(window.sessionStorage, revealKey, revealUrgent);
    if (decision === 'show') {
      setOverlay(null);
      setManage(false);
      setIdentityEntryReveal(true);
    } else if (decision === 'skip') {
      setIdentityEntryReveal(false);
    }
  }, [active, catalog.roles, revealKey, revealUrgent, view.private?.self.roleId]);

  useEffect(() => {
    if (identityEntryReveal && revealUrgent) setIdentityEntryReveal(false);
  }, [identityEntryReveal, revealUrgent]);
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

  const choose = (playerId: string) => {
    if (!locked && task?.targets) {
      setDraft({ ...draft, targets: updateSelection(task.targets, draft.targets, playerId) });
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
        // 单一动作按钮：本地目标为空时这一格承担「空刀」，有目标时由 primary 承担「发布并确认方案」。
        // 空刀不再与方案按钮并列（先「清空选择」再发布），v0 无草稿时的两个同载荷按钮也随之消失。
        emptyAction: basePresentation.emptyAction && draft.targets.length === 0 ? {
          ...basePresentation.emptyAction,
          label: proposal.revision > 0 && !proposalModified
            ? proposalConfirmedBySelf ? `已同意 v${proposal.revision}`
              : proposalConfirmationSyncing ? confirmationSyncLabel
              : `同意方案 v${proposal.revision}`
            : COPY.action.confirmEmptyProposal,
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
  const subject = view.public?.seats.find(seat => seat.playerId === view.viewer.subjectPlayerId);

  const returnToStage = () => {
    setOverlay(null);
    setManage(false);
  };
  const context = <GameOverlayContext view={view} task={task} remaining={remaining} onReturn={returnToStage}/>;

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

  // HUD 操作在展开态与窄屏「更多」菜单里共用同一组按钮（同一时刻只渲染一处，避免重名）。
  const hudChoose = (action: () => void) => () => { setHudMenu(false); action(); };
  const hudActions = (
    <>
      {privateView && (
        <button type="button" className="button" onClick={hudChoose(() => setOverlay({ kind: 'identity' }))}>
          {view.viewer.readOnly ? COPY.spectator.currentIdentity : '我的身份'}
        </button>
      )}
      <button type="button" className="button" onClick={hudChoose(() => setOverlay({ kind: 'navigation' }))}>
        导航
      </button>
      <button type="button" className="button" onClick={hudChoose(() => setOverlay({ kind: 'second-screen' }))}>
        第二屏
      </button>
      <button
        type="button"
        className="button"
        onClick={hudChoose(() => {
          setManagementVisited(true);
          setManage(true);
        })}
      >
        房间管理
      </button>
    </>
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
      <div className={`game-scene ${view.room.phase === 'playing' && view.public?.phase === 'night' ? 'game-scene--night' : ''}`} hidden={!active || manage}>
        <SnowfallLayer view={view} active={active && online} />
        <PhaseTransition view={view} enabled={online && active} urgent={revealUrgent} occupied={identityEntryReveal || overlay !== null || manage} />
        <VoteTallyLive view={view} enabled={online && active} hasTask={!!task} occupied={identityEntryReveal || overlay !== null || manage} />
        {active && identityEntryReveal && (
          <IdentityEntryReveal view={view} catalog={catalog} onEnter={() => setIdentityEntryReveal(false)} />
        )}
        <GameHUD
          view={view}
          remaining={remaining}
          publicWindow={publicWindow}
          compact={compact}
          hudMenu={hudMenu}
          hud={hud}
          onToggleMenu={() => setHudMenu(value => !value)}
          actions={hudActions}
        />

        {view.viewer.readOnly && (
          <Notice>
            正在观战 · {privateView ? `${COPY.spectator.private}：${privateView.self.seat}号 ${privateView.self.nickname}` : COPY.spectator.public} ·
            只读
          </Notice>
        )}
        {!view.viewer.readOnly && subject && !subject.alive && (
          <Notice>你已死亡，仍可查看获准的信息；当前可用能力以舞台行动为准。</Notice>
        )}
        <SpeechAttention view={view} active={active && online} window={publicWindow} remaining={remaining} />
        {view.public?.day?.election && ['vote', 'revote'].includes(view.public.day.election.phase) && (
          <VoteProgress
            label="天理投票"
            voted={view.public.day.election.votedCount}
            eligible={view.public.day.election.eligibleCount}
          />
        )}
        {view.public?.day?.ballot && ['vote', 'revote'].includes(view.public.day.ballot.phase) && (
          <VoteProgress
            label="放逐投票"
            voted={view.public.day.ballot.votedCount}
            eligible={view.public.day.ballot.eligibleCount}
          />
        )}

        <div className="game-columns">
          <div className="game-play-area">
            <Stage
              active={active && online}
              view={view}
              catalog={catalog}
              task={task}
              selected={draft.targets}
              locked={locked}
              actionSlot={actionSlot}
              onSelect={choose}
              onInfo={(seat: SeatDTO) => setOverlay({ kind: 'player', playerId: seat.playerId })}
              liveSpeakingPlayerIds={liveSpeakingSeats}
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
            onTally={event => setOverlay({ kind: 'vote-tally', event })}
          />
        </div>

        <GameOverlays
          active={active}
          online={online}
          overlay={overlay}
          view={view}
          catalog={catalog}
          privateView={privateView}
          context={context}
          remaining={remaining}
          refresh={refresh}
          onOverlay={setOverlay}
        />
      </div>
    </>
  );
}
