import type { CommandAction, RoomSnapshot, TaskDTO } from '../../../../contracts/v2.ts';
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
  unresolvedOldRecords: TrackedCommand[];
  recentOutcome: string | null;
}

export interface ActionPresentationParams {
  view: RoomSnapshot;
  task: TaskDTO | null;
  draft: ActionDraft;
  records: TrackedCommand[];
  online: boolean;
  remainingMs: number | null;
}

/**
 * Returns a stable scope key to detect when view/account/role/game has changed,
 * preventing drafts or recovery states from leaking across perspectives.
 */
export function actionScopeKey(view: RoomSnapshot): string {
  return [
    view.room.code,
    view.gameId ?? 'nogame',
    view.viewer.subjectPlayerId ?? 'nosubject',
    view.viewer.readOnly ? 'ro' : 'formal',
    view.viewer.kind,
  ].join(':');
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
export function deriveActionPresentation({
  view,
  task,
  draft,
  records,
  online,
  remainingMs,
}: ActionPresentationParams): ActionPresentation {
  const isReadOnly = !!view.viewer.readOnly;
  const expired = remainingMs !== null && remainingMs <= 0;

  // Recent outcome from accepted records (even if current task is idle)
  const lastAccepted = records.findLast(r => r.status === 'accepted');
  const recentOutcome = lastAccepted
    ? `最近操作：「${actionLabels[lastAccepted.intent.action]}」指令已接收（非最终结算结果）`
    : null;

  // Unresolved records from old windows (they don't block current task, but show query buttons)
  const unresolvedOldRecords = records.filter(
    r =>
      !['accepted', 'rejected', 'sending'].includes(r.status) &&
      !view.tasks.some(t => taskKey(t) === taskKey(r.intent))
  );

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
      unresolvedOldRecords: [],
      recentOutcome,
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
      unresolvedOldRecords,
      recentOutcome,
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

  // Compare draft against prior submission and latest accepted record
  const priorMatches = !!priorSubmission && matchesSubmission(validTask.action, draft, priorSubmission);
  const latestAcceptedMatches =
    latestRecord?.status === 'accepted' &&
    matchesSubmission(validTask.action, draft, latestRecord.intent);

  const isSameAccepted = priorMatches || latestAcceptedMatches;
  const hasPrior = !!priorSubmission || latestRecord?.status === 'accepted';
  const isChanged = hasPrior && !isSameAccepted;

  // Derive Server Summary text (what the server currently has accepted)
  let serverSummary: string | null = null;
  if (priorSubmission) {
    if (targetActions.has(validTask.action)) {
      serverSummary = `服务端已确认：${targetSummary(view, priorSubmission.targets)}${
        priorSubmission.revision !== null && priorSubmission.revision !== undefined ? ` · v${priorSubmission.revision}` : ''
      }`;
    } else {
      serverSummary = `服务端已确认：${actionLabels[priorSubmission.action]}`;
    }
  } else if (latestRecord?.status === 'accepted') {
    serverSummary = '本地已确认，正在与服务端同步…';
  }

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

  if (!online) {
    status = 'offline';
    statusText = '当前离线';
    disabledReason = '连接尚未恢复，暂时不能提交。';
  } else if (expired) {
    status = 'expired';
    statusText = '时间已到';
    disabledReason = '时间已到，等待服务端结算；不会自动提交你的选择。';
  } else if (pendingRecord) {
    queryRequestId = pendingRecord.intent.requestId;
    if (pendingRecord.status === 'sending') {
      status = 'sending';
      statusText = '正在提交…';
      disabledReason = '正在提交，请等待服务端确认…';
    } else if (['unknown', 'not_seen'].includes(pendingRecord.status)) {
      status = 'recovering';
      statusText = pendingRecord.status === 'not_seen' ? '暂未查询到记录' : '回执丢失，待确认';
      disabledReason = pendingRecord.status === 'not_seen'
        ? '暂未查询到记录，结果尚未确定。'
        : '连接中断，正在确认行动结果。';
      retryRequestId = pendingRecord.intent.requestId;
    } else {
      // pending
      status = 'recovering';
      statusText = '处理中…';
      disabledReason = '服务器正在处理，继续确认结果…';
    }
  } else if (latestRecord?.status === 'rejected' && !isSameAccepted) {
    status = 'rejected';
    statusText = '请求未被接受';
    disabledReason = errorMessage(new ApiFailure(400, latestRecord.code ?? 'unknown_error'));
  } else if (isSameAccepted) {
    status = 'accepted';
    statusText = latestRecord?.status === 'accepted' && (!priorSubmission || priorSubmission.requestId !== latestRecord.intent.requestId)
      ? '已提交，正在同步'
      : '已确认提交';
    disabledReason = '当前选择与已接受内容相同，无需重复提交。';
  } else if (isChanged) {
    status = 'changed';
    statusText = '选择已更改，尚未提交';
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
  const primaryLabel = status === 'sending'
    ? '正在提交…'
    : isSameAccepted
      ? '已确认提交'
      : isSkipAction
        ? (skipLabels[validTask.action] ?? '确认跳过')
        : '确认提交';

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
    emptyAction = {
      label: skipLabel,
      disabled: locked || emptyAlreadyAccepted,
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
    unresolvedOldRecords,
    recentOutcome,
  };
}
