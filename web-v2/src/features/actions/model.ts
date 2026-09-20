import type { CommandAction, CommandIntent, RoomSnapshot, SeatDTO, TargetSelection, TaskDTO } from '../../../../contracts/v2.ts';

export interface ActionDraft { targets: string[]; direction: 'asc' | 'desc'; revision: number | null }
export const targetActions = new Set<CommandAction>(['SUBMIT_GUARD', 'SUBMIT_LAIKE', 'EDIT_PROPOSAL', 'SUBMIT_CHECK', 'SUBMIT_RESCUE', 'SUBMIT_REVIVE', 'SUBMIT_ELECTION_VOTE', 'DESIGNATE_SPEECH', 'SUBMIT_DAY_VOTE', 'SUBMIT_HANDOVER']);
export const taskKey = (task: Pick<TaskDTO, 'action' | 'windowInstanceId'>) => `${task.windowInstanceId}/${task.action}`;
export const emptyDraft = (): ActionDraft => ({ targets: [], direction: 'asc', revision: null });

export function selectionIssue(selection: TargetSelection, targets: readonly string[]): string | null {
  if (!targets.length && !selection.canSkip) return '请选择一个有效目标。';
  if (targets.length > selection.maxTargets) return `最多选择 ${selection.maxTargets} 个目标。`;
  if (targets.some(id => !selection.playerIds.includes(id))) return '选择中有当前不可用的目标，请重新选择。';
  if (!selection.allowRepeated && new Set(targets).size !== targets.length) return '同一目标不能重复选择。';
  if (selection.forbiddenPairs.some(pair => pair.length > 0 && pair.every(id => targets.includes(id)))) return '这组目标不能同时选择，请调整。';
  return null;
}

export function updateSelection(selection: TargetSelection, targets: readonly string[], playerId: string, change: 1 | -1 = 1): string[] {
  if (change < 0) { const index = targets.lastIndexOf(playerId); return targets.filter((_, i) => i !== index); }
  if (!selection.playerIds.includes(playerId)) return [...targets];
  if (!selection.allowRepeated && targets.includes(playerId)) return targets.filter(id => id !== playerId);
  if (selection.maxTargets === 1) return [playerId];
  if (targets.length >= selection.maxTargets) return [...targets];
  return [...targets, playerId];
}

export function currentTask(view: RoomSnapshot, task: Pick<TaskDTO, 'action' | 'windowInstanceId'>): TaskDTO | null {
  if (!view.gameId || view.room.phase !== 'playing' || view.viewer.readOnly || !view.capabilities.allowedCommands.includes(task.action)) return null;
  return view.tasks.find(candidate => taskKey(candidate) === taskKey(task) && view.windows.some(window => window.instanceId === candidate.windowInstanceId)) ?? null;
}

export function actionIssue(view: RoomSnapshot, task: TaskDTO, draft: ActionDraft): string | null {
  const latest = currentTask(view, task);
  if (!latest) return '当前行动或权限已变化，请同步状态。';
  if (targetActions.has(task.action)) {
    if (!latest.targets) return '当前目标信息尚未就绪，请同步状态。';
    const issue = selectionIssue(latest.targets, draft.targets); if (issue) return issue;
  }
  if (task.action === 'CONFIRM_PROPOSAL') {
    if (draft.revision === null || !Number.isSafeInteger(draft.revision) || draft.revision <= 0 || draft.revision !== view.private?.proposal?.revision) return '请确认当前最新的团队草稿版本。';
  }
  if (task.action === 'DESIGNATE_SPEECH' && !['asc', 'desc'].includes(draft.direction)) return '请选择发言方向。';
  return null;
}

export function commandIntent(view: RoomSnapshot, task: TaskDTO, draft: ActionDraft, requestId: string): CommandIntent {
  const issue = actionIssue(view, task, draft); if (issue) throw new Error(issue);
  const result: CommandIntent = { requestId, gameId: view.gameId!, windowInstanceId: task.windowInstanceId, action: task.action };
  if (targetActions.has(task.action)) result.targets = [...draft.targets];
  if (task.action === 'CONFIRM_PROPOSAL') result.revision = draft.revision!;
  if (task.action === 'DESIGNATE_SPEECH') result.direction = draft.direction;
  return result;
}

export function proposalEditAndConfirmIntent(view: RoomSnapshot, task: TaskDTO, draft: ActionDraft, requestId: string, expectedRevision: number): CommandIntent {
  const intent = commandIntent(view, task, draft, requestId);
  if (task.action !== 'EDIT_PROPOSAL' || !view.capabilities.supportsProposalEditConfirmation ||
    !view.capabilities.allowedCommands.includes('CONFIRM_PROPOSAL') || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('当前不能提交并确认团队方案。');
  }
  return { ...intent, confirmSelf: true, expectedRevision };
}

export function speechPreview(view: RoomSnapshot, task: TaskDTO, draft: ActionDraft): SeatDTO[] {
  if (task.action !== 'DESIGNATE_SPEECH' || !currentTask(view, task) || !task.targets || draft.targets.length !== 1) return [];
  const candidates = (view.public?.seats ?? []).filter(seat => task.targets!.playerIds.includes(seat.playerId)).sort((a, b) => a.seat - b.seat);
  if (draft.direction === 'desc') candidates.reverse();
  const start = candidates.findIndex(seat => seat.playerId === draft.targets[0]);
  return start < 0 ? [] : [...candidates.slice(start), ...candidates.slice(0, start)];
}

export const skipLabels: Partial<Record<CommandAction, string>> = {
  SUBMIT_GUARD: '确认空守', SUBMIT_LAIKE: '放弃刺杀', EDIT_PROPOSAL: '提交空刀草稿', SUBMIT_RESCUE: '不使用还魂曲',
  SUBMIT_REVIVE: '放弃回归选择', SUBMIT_ELECTION_VOTE: '确认弃票', SUBMIT_DAY_VOTE: '确认弃票', SUBMIT_HANDOVER: '销毁天理职务',
};
