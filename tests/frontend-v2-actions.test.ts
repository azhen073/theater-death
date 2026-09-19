import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CommandAction, CommandIntent, RoomSnapshot, TargetSelection, TaskDTO } from '../contracts/v2.ts';
import { COMMAND_ACTIONS } from '../contracts/v2.ts';
import { actionIssue, commandIntent, currentTask, emptyDraft, selectionIssue, speechPreview, targetActions, taskKey, updateSelection } from '../web-v2/src/features/actions/model.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/contract-2.1/night-door-full.json', import.meta.url), 'utf8')) as RoomSnapshot;

function viewCopy(): RoomSnapshot {
  return structuredClone(fixture);
}

const selection: TargetSelection = { playerIds: ['p_a', 'p_b', 'p_c'], maxTargets: 2, allowRepeated: false, canSkip: true, forbiddenPairs: [] };

function prepare(view: RoomSnapshot, action: CommandAction, targets: TargetSelection | null = null): TaskDTO {
  const task: TaskDTO = { action, windowInstanceId: `window:${action}`, closesAt: view.serverTime + 10_000, targets };
  view.room.phase = 'playing';
  view.tasks = [task];
  view.windows = [{ id: action, type: action, instanceId: task.windowInstanceId, closesAt: task.closesAt }];
  view.capabilities.allowedCommands = [action];
  view.viewer.readOnly = false;
  return task;
}

describe('v2 action model', () => {
  it('builds the exact envelope for all 18 actions without an operator playerId', () => {
    for (const action of COMMAND_ACTIONS) {
      const view = viewCopy();
      const task = prepare(view, action, targetActions.has(action) ? selection : null);
      if (action === 'CONFIRM_PROPOSAL') view.private!.proposal = { pool: 'death', activeMemberIds: [], revision: 7, targetPlayerIds: [], confirmedBy: [], locked: false, effective: { revision: null, targetPlayerIds: [], basis: 'empty' } };
      const draft = emptyDraft();
      if (targetActions.has(action)) draft.targets = ['p_a'];
      if (action === 'CONFIRM_PROPOSAL') draft.revision = 7;
      if (action === 'DESIGNATE_SPEECH') draft.direction = 'desc';
      const intent = commandIntent(view, task, draft, `request:${action}`);
      expect(intent).toMatchObject({ requestId: `request:${action}`, gameId: view.gameId, windowInstanceId: task.windowInstanceId, action });
      expect(intent).not.toHaveProperty('playerId');
      if (targetActions.has(action)) expect(intent.targets).toEqual(['p_a']);
      else expect(intent).not.toHaveProperty('targets');
      if (action === 'CONFIRM_PROPOSAL') expect(intent.revision).toBe(7); else expect(intent).not.toHaveProperty('revision');
      if (action === 'DESIGNATE_SPEECH') expect(intent.direction).toBe('desc'); else expect(intent).not.toHaveProperty('direction');
    }
  });

  it('rejects read-only, old-game, old-window, missing-capability, and missing-current-task views', () => {
    const base = viewCopy();
    const task = prepare(base, 'SUBMIT_GUARD', selection);
    expect(currentTask(base, task)).toEqual(task);
    base.viewer.readOnly = true;
    expect(currentTask(base, task)).toBeNull();

    const oldGame = viewCopy();
    const oldTask = prepare(oldGame, 'SUBMIT_GUARD', selection);
    oldGame.gameId = null;
    expect(currentTask(oldGame, oldTask)).toBeNull();

    const oldWindow = viewCopy();
    const staleTask = prepare(oldWindow, 'SUBMIT_GUARD', selection);
    oldWindow.windows = [];
    expect(currentTask(oldWindow, staleTask)).toBeNull();

    const noCapability = viewCopy();
    const forbiddenTask = prepare(noCapability, 'SUBMIT_GUARD', selection);
    noCapability.capabilities.allowedCommands = [];
    expect(currentTask(noCapability, forbiddenTask)).toBeNull();

    const missingTask = viewCopy();
    const requested = prepare(missingTask, 'SUBMIT_GUARD', selection);
    missingTask.tasks = [];
    expect(actionIssue(missingTask, requested, { targets: ['p_a'], direction: 'asc', revision: null })).toContain('权限已变化');
  });

  it('enforces target legality, duplicate policy, maxTargets, forbidden pairs, and canSkip', () => {
    expect(selectionIssue({ ...selection, canSkip: false }, [])).toContain('请选择');
    expect(selectionIssue(selection, ['p_a', 'p_b', 'p_c'])).toContain('最多选择');
    expect(selectionIssue(selection, ['p_a', 'p_missing'])).toContain('不可用');
    expect(selectionIssue(selection, ['p_a', 'p_a'])).toContain('不能重复');
    expect(selectionIssue({ ...selection, forbiddenPairs: [['p_a', 'p_b']] }, ['p_a', 'p_b'])).toContain('不能同时');
    expect(selectionIssue(selection, [])).toBeNull();
  });

  it('supports single replacement, multi-select toggles, repeated multi-shot increments, and decrements', () => {
    expect(updateSelection({ ...selection, maxTargets: 1 }, ['p_a'], 'p_b')).toEqual(['p_b']);
    expect(updateSelection(selection, [], 'p_a')).toEqual(['p_a']);
    expect(updateSelection(selection, ['p_a'], 'p_a')).toEqual([]);
    expect(updateSelection(selection, ['p_a'], 'p_b')).toEqual(['p_a', 'p_b']);
    expect(updateSelection(selection, ['p_a', 'p_b'], 'p_c')).toEqual(['p_a', 'p_b']);
    const repeated = { ...selection, allowRepeated: true, maxTargets: 3 };
    expect(updateSelection(repeated, ['p_a'], 'p_a')).toEqual(['p_a', 'p_a']);
    expect(updateSelection(repeated, ['p_a', 'p_a'], 'p_a', -1)).toEqual(['p_a']);
    expect(updateSelection(selection, ['p_a', 'p_b'], 'p_a', -1)).toEqual(['p_b']);
  });

  it('requires the latest positive proposal revision and validates designate direction', () => {
    const confirmView = viewCopy();
    const confirmTask = prepare(confirmView, 'CONFIRM_PROPOSAL');
    confirmView.private!.proposal = { pool: 'death', activeMemberIds: [], revision: 3, targetPlayerIds: [], confirmedBy: [], locked: false, effective: { revision: null, targetPlayerIds: [], basis: 'empty' } };
    expect(actionIssue(confirmView, confirmTask, { targets: [], direction: 'asc', revision: 2 })).toContain('最新');
    expect(actionIssue(confirmView, confirmTask, { targets: [], direction: 'asc', revision: 0 })).toContain('最新');
    expect(actionIssue(confirmView, confirmTask, { targets: [], direction: 'asc', revision: -1 })).toContain('最新');
    expect(actionIssue(confirmView, confirmTask, { targets: [], direction: 'asc', revision: 1.5 })).toContain('最新');
    expect(commandIntent(confirmView, confirmTask, { targets: [], direction: 'asc', revision: 3 }, 'confirm-3').revision).toBe(3);

    const designateView = viewCopy();
    const designateTask = prepare(designateView, 'DESIGNATE_SPEECH', selection);
    expect(actionIssue(designateView, designateTask, { targets: ['p_a'], direction: 'sideways' as 'asc', revision: null })).toContain('方向');
    expect(commandIntent(designateView, designateTask, { targets: ['p_a'], direction: 'asc', revision: null }, 'designate').direction).toBe('asc');
  });

  it('previews authorized speech order from the selected seat and direction', () => {
    const view = viewCopy();
    const seats = view.public!.seats.slice(0, 3);
    const task = prepare(view, 'DESIGNATE_SPEECH', { playerIds: seats.map(seat => seat.playerId), maxTargets: 1, allowRepeated: false, canSkip: false, forbiddenPairs: [] });
    expect(speechPreview(view, task, { targets: [seats[1]!.playerId], direction: 'asc', revision: null }).map(seat => seat.playerId)).toEqual([seats[1]!.playerId, seats[2]!.playerId, seats[0]!.playerId]);
    expect(speechPreview(view, task, { targets: [seats[1]!.playerId], direction: 'desc', revision: null }).map(seat => seat.playerId)).toEqual([seats[1]!.playerId, seats[0]!.playerId, seats[2]!.playerId]);
    expect(speechPreview(view, task, { targets: [], direction: 'asc', revision: null })).toEqual([]);
  });

  it('uses taskKey to isolate action slots by window and action', () => {
    expect(taskKey({ action: 'SUBMIT_GUARD', windowInstanceId: 'w1' })).toBe('w1/SUBMIT_GUARD');
    expect(taskKey({ action: 'SUBMIT_GUARD', windowInstanceId: 'w2' })).not.toBe(taskKey({ action: 'SUBMIT_GUARD', windowInstanceId: 'w1' }));
  });
});
