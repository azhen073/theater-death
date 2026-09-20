import type { CommandAction, RoomSnapshot, SubmissionDTO, TaskDTO } from '../../../../contracts/v2.ts';
import type { TrackedCommand } from './commands.ts';
import type { ActionDraft } from './model.ts';
import { actionIssue, currentTask, skipLabels, targetActions, taskKey } from './model.ts';
import { actionLabels } from '../../presentation/labels.ts';
import { targetSummary } from '../../presentation/targets.ts';
import { ApiFailure, errorMessage } from '../../transport/http.ts';

export type ActionPresentationMode = 'idle' | 'readonly' | 'action';

export type ActionPresentationStatus =
  | 'editing'
  | 'sending'
  | 'accepted'
  | 'changed'
  | 'rejected'
  | 'recovering'
  | 'expired'
  | 'offline'
  | 'idle';

export interface ActionPresentation {
  mode: ActionPresentationMode;
  title: string;
  summary: string;
  serverSummary: string | null;
  status: ActionPresentationStatus;
  statusText: string;
  disabledReason: string | null;
  primary: { label: string; disabled: boolean } | null;
  emptyAction: { label: string; disabled: boolean } | null;
  clearAction: { label: string; disabled: boolean } | null;
  retryRequestId: string | null;
  queryRequestId: string | null;
  recoveryItems: RecoveryItem[];
  recentOutcome: string | null;
  queryDisabled: boolean;
  syncConflictKey: string | null;
  canRefreshRecord: boolean;
}

export interface RecoveryItem {
  requestId: string;
  action: CommandAction;
  status: TrackedCommand['status'];
  checking: boolean;
  canQuery: boolean;
  canRetry: boolean;
}

export interface SubmissionEvidence {
  scope: string;
  requestId: string;
  taskKey: string;
  snapshotVersionAtSend: number;
  snapshotRequestIdAtSend: string | null;
  firstMatchingSnapshotVersion: number | null;
}

export type SubmissionBasis =
  | { source: 'snapshot'; submission: SubmissionDTO }
  | { source: 'receipt'; record: TrackedCommand; awaitingSnapshot: true }
  | { source: 'ambiguous' }
  | { source: 'none' };

export const actionButtonLabels: Record<CommandAction, { initial: string; modify: string }> = {
  SUBMIT_GUARD: { initial: '确认守护', modify: '更新守护' },
  SUBMIT_LAIKE: { initial: '确认刺杀', modify: '更新刺杀' },
  EDIT_PROPOSAL: { initial: '发布方案', modify: '更新方案' },
  CONFIRM_PROPOSAL: { initial: '同意方案', modify: '同意方案' },
  SUBMIT_CHECK: { initial: '提交查验', modify: '更新查验' },
  SUBMIT_RESCUE: { initial: '确认还魂曲', modify: '更新还魂曲' },
  SUBMIT_REVIVE: { initial: '确认回归对象', modify: '更新回归对象' },
  SUBMIT_ELECTION_VOTE: { initial: '提交天理投票', modify: '更新天理投票' },
  DESIGNATE_SPEECH: { initial: '确认发言顺序', modify: '更新发言顺序' },
  SUBMIT_DAY_VOTE: { initial: '提交放逐投票', modify: '更新放逐投票' },
  SUBMIT_HANDOVER: { initial: '确认移交天理', modify: '更新移交对象' },
  REGISTER_CANDIDACY: { initial: '报名竞选', modify: '报名竞选' },
  WITHDRAW_CANDIDACY: { initial: '退出竞选', modify: '退出竞选' },
  START_SPEECH: { initial: '开始发言', modify: '开始发言' },
  END_ELECTION_SPEECH: { initial: '结束竞选发言', modify: '结束竞选发言' },
  END_SPEECH: { initial: '结束发言', modify: '结束发言' },
  END_TIE_SPEECH: { initial: '结束平票发言', modify: '结束平票发言' },
  END_LAST_WORDS: { initial: '结束遗言', modify: '结束遗言' },
};

export interface ActionPresentationParams {
  view: RoomSnapshot;
  task: TaskDTO | null;
  draft: ActionDraft;
  records: TrackedCommand[];
  online: boolean;
  remainingMs: number | null;
  evidence?: readonly SubmissionEvidence[];
}

/**
 * Returns a stable scope key to detect when view/account/role/game has changed,
 * preventing drafts or recovery states from leaking across perspectives.
 */
export function actionScopeKey(view: RoomSnapshot): string {
  return JSON.stringify([
    view.viewer.userId,
    view.roomId,
    view.gameId,
    view.viewer.memberId,
    view.viewer.subjectPlayerId,
    view.viewer.readOnly,
  ]);
}

/**
 * Order-insensitive comparison for multiset of player IDs (preserves duplicate counts).
 */
export function areTargetSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const countMap = new Map<string, number>();
  for (const id of a) countMap.set(id, (countMap.get(id) ?? 0) + 1);
  for (const id of b) {
    const current = countMap.get(id);
    if (!current) return false;
    if (current === 1) countMap.delete(id);
    else countMap.set(id, current - 1);
  }
  return countMap.size === 0;
}

/**
 * Compare draft against an existing intent / submission according to action semantics.
 */
export function matchesSubmission(
  action: CommandAction,
  draft: ActionDraft,
  submission: { targets?: readonly string[]; direction?: string | null; revision?: number | null }
): boolean {
  if (targetActions.has(action)) {
    const subTargets = submission.targets ?? [];
    if (action === 'DESIGNATE_SPEECH') {
      // Order and direction are strictly sensitive
      if (draft.targets.length !== subTargets.length) return false;
      for (let i = 0; i < draft.targets.length; i++) {
        if (draft.targets[i] !== subTargets[i]) return false;
      }
      if (submission.direction != null && submission.direction !== draft.direction) return false;
      return true;
    }
    // General target actions: order-insensitive multiset comparison
    return areTargetSetsEqual(draft.targets, subTargets);
  }

  if (action === 'CONFIRM_PROPOSAL') {
    return draft.revision !== null && submission.revision === draft.revision;
  }

  // Targetless actions (START_SPEECH, END_SPEECH, REGISTER_CANDIDACY, etc.)
  return true;
}

/**
 * Pure function to derive UI presentation state for the action card.
 * Does not trigger side effects, API calls, or state updates.
 */
export function deriveSubmissionBasis(
  currentKey: string,
  submissionState: readonly SubmissionDTO[],
  records: readonly TrackedCommand[],
  currentSnapshotVersion: number,
  evidence?: readonly SubmissionEvidence[]
): SubmissionBasis {
  const priorSubmission = submissionState.find(s => taskKey(s) === currentKey);
  const taskRecords = records.filter(r => taskKey(r.intent) === currentKey);
  const acceptedRecords = taskRecords.filter(r => r.status === 'accepted');
  const latestAccepted = acceptedRecords.at(-1);

  if (!priorSubmission && !latestAccepted) {
    return { source: 'none' };
  }

  if (priorSubmission && !latestAccepted) {
    return { source: 'snapshot', submission: priorSubmission };
  }

  if (!priorSubmission && latestAccepted) {
    return { source: 'receipt', record: latestAccepted, awaitingSnapshot: true };
  }

  // Both exist
  if (priorSubmission!.requestId === latestAccepted!.intent.requestId) {
    return { source: 'snapshot', submission: priorSubmission! };
  }

  const priorIdx = acceptedRecords.findIndex(r => r.intent.requestId === priorSubmission!.requestId);
  if (priorIdx !== -1 && priorIdx < acceptedRecords.length - 1) {
    return { source: 'receipt', record: latestAccepted!, awaitingSnapshot: true };
  }

  const ev = evidence?.find(e => e.taskKey === currentKey && e.requestId === latestAccepted!.intent.requestId);
  if (ev) {
    if (ev.snapshotRequestIdAtSend === priorSubmission!.requestId && ev.firstMatchingSnapshotVersion === null) {
      return { source: 'receipt', record: latestAccepted!, awaitingSnapshot: true };
    }
    if (
      ev.firstMatchingSnapshotVersion !== null &&
      currentSnapshotVersion > ev.firstMatchingSnapshotVersion
    ) {
      return { source: 'snapshot', submission: priorSubmission! };
    }
  }

  return { source: 'ambiguous' };
}

/**
 * Pure function to derive UI presentation state for the action card.
 * Does not trigger side effects, API calls, or state updates.
 */
export function deriveActionPresentation({
  view,
  task,
  draft,
  records,
  online,
  remainingMs,
  evidence,
}: ActionPresentationParams): ActionPresentation {
  const isReadOnly = !!view.viewer.readOnly;
  const expired = remainingMs !== null && remainingMs <= 0;

  // Recent outcome from accepted records (even if current task is idle)
  const lastOutcome = records.findLast(
    r =>
      (r.status === 'accepted' || r.status === 'rejected') &&
      !view.tasks.some(task => taskKey(task) === taskKey(r.intent))
  );
  const recentOutcome = lastOutcome
    ? lastOutcome.status === 'accepted'
      ? `最近操作：「${actionLabels[lastOutcome.intent.action]}」指令已接收（非最终结算结果）`
      : `最近操作：「${actionLabels[lastOutcome.intent.action]}」未被接受`
    : null;

  // Unresolved records from old windows (they don't block current task, but show query buttons)
  const oldRecords = records.filter(
    r =>
      !['accepted', 'rejected'].includes(r.status) &&
      !view.tasks.some(t => taskKey(t) === taskKey(r.intent))
  );
  const recoveryItems: RecoveryItem[] = oldRecords.map(record => ({
    requestId: record.intent.requestId,
    action: record.intent.action,
    status: record.status,
    checking: record.checking,
    canQuery: online && !record.checking && record.status !== 'sending',
    canRetry: false,
  }));

  // 1. Read-only perspective (Spectator / Private Second Screen)
  if (isReadOnly) {
    return {
      mode: 'readonly',
      title: '你正在只读观战',
      summary: '你可以查看当前视角授权的信息、记录和规则。',
      serverSummary: null,
      status: 'idle',
      statusText: '只读视角',
      disabledReason: '只读观战，不可操作',
      primary: null,
      emptyAction: null,
      clearAction: null,
      retryRequestId: null,
      queryRequestId: null,
      recoveryItems: [],
      recentOutcome: null,
      queryDisabled: true,
      syncConflictKey: null,
      canRefreshRecord: false,
    };
  }

  // 2. Formal player with no valid current task
  const validTask = task ? currentTask(view, task) : null;
  if (!validTask) {
    return {
      mode: 'idle',
      title: '本阶段无需操作',
      summary: '等待其他玩家或服务端推进阶段。',
      serverSummary: null,
      status: 'idle',
      statusText: '无需操作',
      disabledReason: '当前无可执行的行动任务',
      primary: null,
      emptyAction: null,
      clearAction: null,
      retryRequestId: null,
      queryRequestId: null,
      recoveryItems,
      recentOutcome,
      queryDisabled: true,
      syncConflictKey: null,
      canRefreshRecord: false,
    };
  }

  // 3. Active task present
  const currentKey = taskKey(validTask);
  const title = actionLabels[validTask.action] ?? '当前行动';

  // Check pending / unresolved command belonging to THIS specific task & window
  const pendingRecord = records.find(
    r => taskKey(r.intent) === currentKey && !['accepted', 'rejected'].includes(r.status)
  );
  const isPending = !!pendingRecord;

  // Latest record and prior accepted submission in snapshot
  const latestRecord = records.findLast(r => taskKey(r.intent) === currentKey);
  const priorSubmission = view.submissionState.find(s => taskKey(s) === currentKey);

  // Determine authoritative submission basis
  const scopedEvidence = evidence?.filter(item => item.scope === actionScopeKey(view));
  const basis = deriveSubmissionBasis(currentKey, view.submissionState, records, view.viewVersion, scopedEvidence);
  let isSameAccepted = false;
  let hasPrior = false;
  let serverSummary: string | null = null;

  if (basis.source === 'snapshot') {
    hasPrior = true;
    isSameAccepted = matchesSubmission(validTask.action, draft, basis.submission);
    if (targetActions.has(validTask.action)) {
      serverSummary = `服务端已确认：${targetSummary(view, basis.submission.targets)}${
        basis.submission.revision !== null && basis.submission.revision !== undefined ? ` · v${basis.submission.revision}` : ''
      }`;
    } else {
      serverSummary = `服务端已确认：${actionLabels[basis.submission.action]}`;
    }
  } else if (basis.source === 'receipt') {
    hasPrior = true;
    isSameAccepted = matchesSubmission(validTask.action, draft, basis.record.intent);
    serverSummary = '本地已确认，正在与服务端同步…';
  } else if (basis.source === 'ambiguous') {
    hasPrior = true;
    isSameAccepted = false;
    serverSummary = priorSubmission ? '服务端记录与本地回执同步中…' : null;
  }

  const isChanged = hasPrior && !isSameAccepted;

  // Derive Draft Summary
  let summary = '';
  if (targetActions.has(validTask.action)) {
    const count = draft.targets.length;
    const max = validTask.targets?.maxTargets ?? 1;
    summary = count > 0 ? `${targetSummary(view, draft.targets)} · ${count} / ${max}` : '尚未选择目标';
  } else if (validTask.action === 'CONFIRM_PROPOSAL') {
    summary = (view.private?.proposal?.revision ?? 0) > 0
      ? `确认最新草稿 v${view.private!.proposal!.revision}`
      : '目前还没有可确认的草稿';
  } else {
    summary = `准备执行：${title}`;
  }

  // Validation issue check
  const issue = actionIssue(view, validTask, draft);

  // Determine Status, StatusText, and DisabledReason
  let status: ActionPresentationStatus = 'editing';
  let statusText = '草稿尚未提交';
  let disabledReason: string | null = null;
  let retryRequestId: string | null = null;
  let queryRequestId: string | null = null;
  let queryDisabled = false;

  if (!online) {
    status = 'offline';
    statusText = '当前离线';
    disabledReason = '连接尚未恢复，暂时不能提交。';
  } else if (expired) {
    status = 'expired';
    statusText = '时间已到';
    disabledReason = '时间已到，等待服务端结算；不会自动提交你的选择。';
  } else if (pendingRecord) {
    if (pendingRecord.status === 'sending') {
      status = 'sending';
      statusText = '正在提交…';
      disabledReason = '正在提交，请等待服务端确认…';
      queryRequestId = null;
      retryRequestId = null;
    } else if (['unknown', 'not_seen'].includes(pendingRecord.status)) {
      status = 'recovering';
      statusText = pendingRecord.status === 'not_seen' ? '暂未查询到记录' : '回执丢失，待确认';
      disabledReason = pendingRecord.status === 'not_seen'
        ? '暂未查询到记录，结果尚未确定。'
        : '连接中断，正在确认行动结果。';
      queryRequestId = online ? pendingRecord.intent.requestId : null;
      queryDisabled = pendingRecord.checking;
      retryRequestId = online && !expired && !pendingRecord.checking
        ? pendingRecord.intent.requestId
        : null;
    } else {
      // pending
      status = 'recovering';
      statusText = '处理中…';
      disabledReason = '服务器正在处理，继续确认结果…';
      queryRequestId = online ? pendingRecord.intent.requestId : null;
      queryDisabled = pendingRecord.checking;
      retryRequestId = null;
    }
  } else if (latestRecord?.status === 'rejected' && !isSameAccepted) {
    status = 'rejected';
    statusText = '请求未被接受';
    disabledReason = errorMessage(new ApiFailure(400, latestRecord.code ?? 'unknown_error'));
  } else if (isSameAccepted) {
    status = 'accepted';
    statusText = basis.source === 'receipt'
      ? '已提交，正在同步'
      : '服务端已确认';
    disabledReason = '当前选择与已接受内容相同，无需重复提交。';
  } else if (basis.source === 'ambiguous') {
    status = 'editing';
    statusText = '提交记录正在同步';
  } else if (isChanged) {
    status = 'changed';
    statusText = '选择已更改，尚未提交';
  }

  if (expired && pendingRecord && online) {
    queryRequestId = pendingRecord.status === 'sending' ? null : pendingRecord.intent.requestId;
    queryDisabled = pendingRecord.checking;
    retryRequestId = null;
  }

  if (!disabledReason && issue) {
    disabledReason = issue;
  }

  const locked = !online || isPending || expired;

  // Primary action button
  const isSkipAction = !!validTask.targets?.canSkip && draft.targets.length === 0;
  const canSubmitTarget = targetActions.has(validTask.action)
    ? (validTask.targets?.canSkip ? true : draft.targets.length > 0)
    : true;
  const primaryDisabled = locked || !!issue || isSameAccepted || !canSubmitTarget;

  let primaryLabel = actionButtonLabels[validTask.action].initial;
  if (status === 'sending') {
    primaryLabel = '正在提交…';
  } else if (isSameAccepted) {
    primaryLabel = '已提交';
  } else if (isSkipAction) {
    primaryLabel = skipLabels[validTask.action] ?? '确认跳过';
  } else if (validTask.action === 'CONFIRM_PROPOSAL') {
    const rev = view.private?.proposal?.revision;
    primaryLabel = rev ? `同意方案 v${rev}` : '同意方案';
  } else if (hasPrior && isChanged && actionButtonLabels[validTask.action]) {
    primaryLabel = actionButtonLabels[validTask.action].modify;
  } else if (actionButtonLabels[validTask.action]) {
    primaryLabel = actionButtonLabels[validTask.action].initial;
  }

  const primary = {
    label: primaryLabel,
    disabled: primaryDisabled,
  };

  // Clear action button
  const clearAction = targetActions.has(validTask.action) && draft.targets.length > 0
    ? {
        label: '清空选择',
        disabled: locked,
      }
    : null;

  // Empty action (skip) button - only when canSkip is explicitly enabled
  let emptyAction: { label: string; disabled: boolean } | null = null;
  if (validTask.targets?.canSkip) {
    const skipLabel = skipLabels[validTask.action] ?? '确认跳过';
    const emptyAlreadyAccepted = isSameAccepted && draft.targets.length === 0;
    const emptyDraft = { ...draft, targets: [] };
    const emptyIssue = actionIssue(view, validTask, emptyDraft);
    emptyAction = {
      label: skipLabel,
      disabled: locked || !!emptyIssue || emptyAlreadyAccepted,
    };
  }

  return {
    mode: 'action',
    title,
    summary,
    serverSummary,
    status,
    statusText,
    disabledReason,
    primary,
    emptyAction,
    clearAction,
    retryRequestId,
    queryRequestId,
    recoveryItems,
    recentOutcome,
    queryDisabled,
    syncConflictKey: basis.source === 'ambiguous'
      ? [actionScopeKey(view), currentKey, priorSubmission?.requestId ?? 'none', latestRecord?.intent.requestId ?? 'none'].join('|')
      : null,
    canRefreshRecord: online && basis.source === 'ambiguous',
  };
}
