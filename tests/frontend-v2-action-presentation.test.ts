import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoomSnapshot, TargetSelection, TaskDTO } from '../contracts/v2.ts';
import type { TrackedCommand } from '../web-v2/src/features/actions/commands.ts';
import type { ActionDraft } from '../web-v2/src/features/actions/model.ts';
import {
  actionScopeKey,
  areTargetSetsEqual,
  deriveActionPresentation,
  matchesSubmission,
} from '../web-v2/src/features/actions/presentation.ts';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/contract-2.1/night-door-full.json', import.meta.url), 'utf8')
) as RoomSnapshot;

function viewCopy(): RoomSnapshot {
  return structuredClone(fixture);
}

const selection: TargetSelection = {
  playerIds: ['p_a', 'p_b', 'p_c'],
  maxTargets: 2,
  allowRepeated: false,
  canSkip: true,
  forbiddenPairs: [],
};

function prepareTask(
  view: RoomSnapshot,
  action: TaskDTO['action'] = 'SUBMIT_GUARD',
  targets: TargetSelection | null = selection
): TaskDTO {
  const task: TaskDTO = {
    action,
    windowInstanceId: `window:${action}:1`,
    closesAt: view.serverTime + 30_000,
    targets,
  };
  view.room.phase = 'playing';
  view.tasks = [task];
  view.windows = [{ id: action, type: action, instanceId: task.windowInstanceId, closesAt: task.closesAt }];
  view.capabilities.allowedCommands = [action];
  view.viewer.readOnly = false;
  return task;
}

describe('v2 action presentation layer (A1)', () => {
  it('handles read-only perspective and idle formal player without tasks', () => {
    const view = viewCopy();
    const task = prepareTask(view);
    const draft: ActionDraft = { targets: ['p_a'], direction: 'asc', revision: null };

    // 1. Read-only viewer
    view.viewer.readOnly = true;
    const roResult = deriveActionPresentation({
      view,
      task,
      draft,
      records: [],
      online: true,
      remainingMs: 30_000,
    });
    expect(roResult.mode).toBe('readonly');
    expect(roResult.primary).toBeNull();
    expect(roResult.emptyAction).toBeNull();
    expect(roResult.disabledReason).toContain('只读观战');

    // 2. Formal player with no valid task
    view.viewer.readOnly = false;
    view.tasks = [];
    view.windows = [];
    const idleResult = deriveActionPresentation({
      view,
      task,
      draft,
      records: [],
      online: true,
      remainingMs: 30_000,
    });
    expect(idleResult.mode).toBe('idle');
    expect(idleResult.primary).toBeNull();
    expect(idleResult.disabledReason).toContain('当前无可执行');
  });

  it('correctly isolates pending commands to current window and task', () => {
    const view = viewCopy();
    const task = prepareTask(view, 'SUBMIT_GUARD');
    const draft: ActionDraft = { targets: ['p_a'], direction: 'asc', revision: null };

    // Pending record for THIS window and task
    const currentPending: TrackedCommand = {
      intent: {
        requestId: 'req-current',
        gameId: view.gameId!,
        windowInstanceId: task.windowInstanceId,
        action: 'SUBMIT_GUARD',
        targets: ['p_a'],
      },
      status: 'sending',
      sentAt: Date.now(),
      attempts: 1,
      checking: false,
    };

    const sendingResult = deriveActionPresentation({
      view,
      task,
      draft,
      records: [currentPending],
      online: true,
      remainingMs: 30_000,
    });
    expect(sendingResult.status).toBe('sending');
    expect(sendingResult.primary?.disabled).toBe(true);

    // Unresolved unknown record for this task allows retry
    currentPending.status = 'unknown';
    const unknownResult = deriveActionPresentation({
      view,
      task,
      draft,
      records: [currentPending],
      online: true,
      remainingMs: 30_000,
    });
    expect(unknownResult.status).toBe('recovering');
    expect(unknownResult.retryRequestId).toBe('req-current');
    expect(unknownResult.queryRequestId).toBe('req-current');

    // Old window record does NOT block new window task
    const oldWindowRecord: TrackedCommand = {
      intent: {
        requestId: 'req-old',
        gameId: view.gameId!,
        windowInstanceId: 'window:old:999',
        action: 'SUBMIT_GUARD',
        targets: ['p_b'],
      },
      status: 'pending',
      sentAt: Date.now() - 50_000,
      attempts: 1,
      checking: false,
    };

    const newWindowResult = deriveActionPresentation({
      view,
      task,
      draft,
      records: [oldWindowRecord],
      online: true,
      remainingMs: 30_000,
    });
    expect(newWindowResult.status).toBe('editing');
    expect(newWindowResult.primary?.disabled).toBe(false);
    expect(newWindowResult.unresolvedOldRecords).toHaveLength(1);
    expect(newWindowResult.unresolvedOldRecords[0]?.intent.requestId).toBe('req-old');
  });

  it('preserves prior server summary when offline or expired', () => {
    const view = viewCopy();
    const task = prepareTask(view, 'SUBMIT_GUARD');
    const draft: ActionDraft = { targets: ['p_a'], direction: 'asc', revision: null };

    // Simulate prior accepted submission in snapshot
    view.submissionState = [
      {
        action: 'SUBMIT_GUARD',
        windowInstanceId: task.windowInstanceId,
        targets: ['p_b'],
        revision: null,
        direction: null,
        requestId: 'prior-req',
        acceptedAt: Date.now() - 5000,
      },
    ];

    // Offline: disables submission but keeps server summary
    const offlineResult = deriveActionPresentation({
      view,
      task,
      draft,
      records: [],
      online: false,
      remainingMs: 30_000,
    });
    expect(offlineResult.status).toBe('offline');
    expect(offlineResult.primary?.disabled).toBe(true);
    expect(offlineResult.serverSummary).toContain('服务端已确认');

    // Expired: disables submission but keeps server summary
    const expiredResult = deriveActionPresentation({
      view,
      task,
      draft,
      records: [],
      online: true,
      remainingMs: 0,
    });
    expect(expiredResult.status).toBe('expired');
    expect(expiredResult.primary?.disabled).toBe(true);
    expect(expiredResult.serverSummary).toContain('服务端已确认');
  });

  it('performs semantic comparison for multiset targets, speech direction, and proposal revisions', () => {
    // 1. Multiset target comparison (order-insensitive)
    expect(areTargetSetsEqual(['p_a', 'p_b'], ['p_b', 'p_a'])).toBe(true);
    expect(areTargetSetsEqual(['p_a', 'p_a', 'p_b'], ['p_a', 'p_b'])).toBe(false);
    expect(areTargetSetsEqual(['p_a', 'p_a', 'p_b'], ['p_b', 'p_a', 'p_a'])).toBe(true);

    // 2. DESIGNATE_SPEECH is order and direction sensitive
    const speechDraft: ActionDraft = { targets: ['p_a'], direction: 'asc', revision: null };
    expect(matchesSubmission('DESIGNATE_SPEECH', speechDraft, { targets: ['p_a'], direction: 'asc' })).toBe(true);
    expect(matchesSubmission('DESIGNATE_SPEECH', speechDraft, { targets: ['p_a'], direction: 'desc' })).toBe(false);
    expect(matchesSubmission('DESIGNATE_SPEECH', speechDraft, { targets: ['p_b'], direction: 'asc' })).toBe(false);

    // 3. CONFIRM_PROPOSAL compares revision
    const confirmDraft: ActionDraft = { targets: [], direction: 'asc', revision: 5 };
    expect(matchesSubmission('CONFIRM_PROPOSAL', confirmDraft, { revision: 5 })).toBe(true);
    expect(matchesSubmission('CONFIRM_PROPOSAL', confirmDraft, { revision: 4 })).toBe(false);

    // 4. EDIT_PROPOSAL does not treat server-generated revision as draft change
    const editDraft: ActionDraft = { targets: ['p_a', 'p_b'], direction: 'asc', revision: null };
    expect(matchesSubmission('EDIT_PROPOSAL', editDraft, { targets: ['p_b', 'p_a'], revision: 12 })).toBe(true);
  });

  it('disables duplicate submission when content is already accepted and detects changed drafts', () => {
    const view = viewCopy();
    const task = prepareTask(view, 'SUBMIT_GUARD');

    // Currently accepted target is p_a
    view.submissionState = [
      {
        action: 'SUBMIT_GUARD',
        windowInstanceId: task.windowInstanceId,
        targets: ['p_a'],
        revision: null,
        direction: null,
        requestId: 'req-accepted',
        acceptedAt: Date.now() - 2000,
      },
    ];

    // Same target p_a -> accepted, primary disabled
    const sameDraft: ActionDraft = { targets: ['p_a'], direction: 'asc', revision: null };
    const acceptedResult = deriveActionPresentation({
      view,
      task,
      draft: sameDraft,
      records: [],
      online: true,
      remainingMs: 25_000,
    });
    expect(acceptedResult.status).toBe('accepted');
    expect(acceptedResult.primary?.disabled).toBe(true);
    expect(acceptedResult.statusText).toContain('已确认提交');

    // Changed target to p_b -> changed, primary enabled
    const changedDraft: ActionDraft = { targets: ['p_b'], direction: 'asc', revision: null };
    const changedResult = deriveActionPresentation({
      view,
      task,
      draft: changedDraft,
      records: [],
      online: true,
      remainingMs: 25_000,
    });
    expect(changedResult.status).toBe('changed');
    expect(changedResult.primary?.disabled).toBe(false);
    expect(changedResult.statusText).toContain('选择已更改');
  });

  it('shows syncing status when accepted locally but not yet in snapshot submissionState', () => {
    const view = viewCopy();
    const task = prepareTask(view, 'SUBMIT_GUARD');
    const draft: ActionDraft = { targets: ['p_a'], direction: 'asc', revision: null };

    // Submission state in snapshot is empty (server hasn't pushed view update yet)
    view.submissionState = [];

    // Local tracker recorded accepted
    const localAccepted: TrackedCommand = {
      intent: {
        requestId: 'req-local',
        gameId: view.gameId!,
        windowInstanceId: task.windowInstanceId,
        action: 'SUBMIT_GUARD',
        targets: ['p_a'],
      },
      status: 'accepted',
      sentAt: Date.now() - 200,
      attempts: 1,
      checking: false,
    };

    const syncResult = deriveActionPresentation({
      view,
      task,
      draft,
      records: [localAccepted],
      online: true,
      remainingMs: 25_000,
    });
    expect(syncResult.status).toBe('accepted');
    expect(syncResult.statusText).toBe('已提交，正在同步');
    expect(syncResult.serverSummary).toContain('本地已确认');
  });

  it('handles rejected command while retaining old accepted submission', () => {
    const view = viewCopy();
    const task = prepareTask(view, 'SUBMIT_GUARD');
    const draft: ActionDraft = { targets: ['p_c'], direction: 'asc', revision: null };

    // Prior accepted was p_a
    view.submissionState = [
      {
        action: 'SUBMIT_GUARD',
        windowInstanceId: task.windowInstanceId,
        targets: ['p_a'],
        revision: null,
        direction: null,
        requestId: 'req-old-accepted',
        acceptedAt: Date.now() - 10_000,
      },
    ];

    // Modifying to p_c was rejected
    const rejectedCommand: TrackedCommand = {
      intent: {
        requestId: 'req-modify',
        gameId: view.gameId!,
        windowInstanceId: task.windowInstanceId,
        action: 'SUBMIT_GUARD',
        targets: ['p_c'],
      },
      status: 'rejected',
      code: 'action_forbidden',
      sentAt: Date.now() - 1000,
      attempts: 1,
      checking: false,
    };

    const rejectedResult = deriveActionPresentation({
      view,
      task,
      draft,
      records: [rejectedCommand],
      online: true,
      remainingMs: 20_000,
    });
    expect(rejectedResult.status).toBe('rejected');
    expect(rejectedResult.statusText).toBe('请求未被接受');
    expect(rejectedResult.disabledReason).toBe('当前不能执行此行动。');
    // Prior server submission is still displayed!
    expect(rejectedResult.serverSummary).toContain('服务端已确认');
  });

  it('manages emptyAction and clearAction correctly according to canSkip and targets', () => {
    const view = viewCopy();
    const task = prepareTask(view, 'SUBMIT_GUARD', { ...selection, canSkip: true });

    // With targets: clearAction is available, emptyAction is available
    const draftWithTarget: ActionDraft = { targets: ['p_a'], direction: 'asc', revision: null };
    const withTargetResult = deriveActionPresentation({
      view,
      task,
      draft: draftWithTarget,
      records: [],
      online: true,
      remainingMs: 20_000,
    });
    expect(withTargetResult.clearAction?.label).toBe('清空选择');
    expect(withTargetResult.clearAction?.disabled).toBe(false);
    expect(withTargetResult.emptyAction?.label).toBe('确认空守');
    expect(withTargetResult.emptyAction?.disabled).toBe(false);

    // Empty targets: clearAction is null, emptyAction is still available
    const emptyDraft: ActionDraft = { targets: [], direction: 'asc', revision: null };
    const emptyResult = deriveActionPresentation({
      view,
      task,
      draft: emptyDraft,
      records: [],
      online: true,
      remainingMs: 20_000,
    });
    expect(emptyResult.clearAction).toBeNull();
    expect(emptyResult.emptyAction?.label).toBe('确认空守');
    expect(emptyResult.emptyAction?.disabled).toBe(false);

    // When task does not allow skip: emptyAction is null
    const noSkipTask = prepareTask(view, 'SUBMIT_GUARD', { ...selection, canSkip: false });
    const noSkipResult = deriveActionPresentation({
      view,
      task: noSkipTask,
      draft: emptyDraft,
      records: [],
      online: true,
      remainingMs: 20_000,
    });
    expect(noSkipResult.emptyAction).toBeNull();
  });

  it('generates unique scope keys across perspective changes to isolate drafts and state', () => {
    const view1 = viewCopy();
    const key1 = actionScopeKey(view1);

    const view2 = viewCopy();
    view2.gameId = 'diff-game-id';
    const key2 = actionScopeKey(view2);
    expect(key1).not.toBe(key2);

    const view3 = viewCopy();
    view3.viewer.readOnly = true;
    const key3 = actionScopeKey(view3);
    expect(key1).not.toBe(key3);

    const view4 = viewCopy();
    view4.viewer.subjectPlayerId = 'diff-subject';
    const key4 = actionScopeKey(view4);
    expect(key1).not.toBe(key4);
  });
});
