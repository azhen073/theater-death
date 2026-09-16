import type { GameEvent } from '../engine/events.ts';
import {
  resolveAttackPhase,
  resolveDescenderCheck,
  resolveNightEnd,
  resolveRescue,
  startNight,
  validateAttackPhase,
  type AttackPhaseInput,
} from '../engine/night.ts';
import { resolveMorning, reviveSelectionIssue, selectReviveTarget } from '../engine/morning.ts';
import {
  confirmProposal,
  createProposalState,
  editProposal,
  lockedVersion,
  type ProposalState,
} from '../engine/proposal.ts';
import type { GameState, PlayerState } from '../engine/types.ts';
import type { Clock, ClockHandle } from './clock.ts';
import type { GameCommand, NightCommand } from './commands.ts';
import type { NightValidationIssue } from '../engine/night.ts';

export type NightWindowId = 'guard' | 'faction' | 'laike' | 'check' | 'rescue' | 'revive';

export interface LiveWindow {
  readonly id: string;
  readonly closesAt: number;
}

/** R-47 阵营协商的本人视角：同池成员可见草稿版本、目标与确认进度 */
export interface ProposalView {
  readonly pool: 'death' | 'spirit' | 'joint';
  readonly activeMemberIds: readonly string[];
  readonly revision: number;
  readonly targetPlayerIds: readonly string[];
  readonly confirmedBy: readonly string[];
  readonly locked: boolean;
}

export interface NightStepResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export interface SubmitResult {
  readonly accepted: boolean;
  readonly code: string | null;
  readonly message: string | null;
}

export interface NightDriver {
  start(state: GameState): void;
  submit(command: GameCommand): SubmitResult;
  windows(): readonly LiveWindow[];
  proposalState(playerId: string): ProposalView | null;
  snapshot(): GameState | null;
  done(): boolean;
  dispose(): void;
}

type Phase = 'idle' | 'segment1' | 'segment2' | 'revive' | 'done';

interface PoolRef {
  readonly kind: 'death' | 'spirit' | 'joint';
  readonly memberIds: readonly string[];
  get(): ProposalState;
  set(next: ProposalState): void;
}

export function createNightDriver(options: {
  readonly clock: Clock;
  readonly onStep: (result: NightStepResult) => void;
  readonly onComplete?: (state: GameState) => void;
}): NightDriver {
  const { clock, onStep, onComplete } = options;

  let state: GameState | null = null;
  let phase: Phase = 'idle';
  let guardClosesAt = 0;
  let factionClosesAt = 0;
  let laikeClosesAt = 0;
  let checkClosesAt = 0;
  let rescueClosesAt = 0;
  let reviveClosesAt = 0;

  let guardSubmission: { targetIds: readonly string[] } | null = null;
  let laikeSubmission: { targetId: string | null } | null = null;
  let checkSubmission: { actorId: string; targetId: string } | null = null;
  let rescueSubmission: { actorId: string; targetId: string | null } | null = null;
  let reviveSubmission: { targetId: string | null } | null = null;
  let deathProposal = createProposalState();
  let spiritProposal = createProposalState();
  let jointProposal = createProposalState();

  const handles: ClockHandle[] = [];

  function accepted(): SubmitResult {
    return { accepted: true, code: null, message: null };
  }

  function rejected(code: string, message: string): SubmitResult {
    return { accepted: false, code, message };
  }

  function rejectedIssue(issue: NightValidationIssue): SubmitResult {
    return { accepted: false, code: issue.code, message: issue.message };
  }

  function current(): GameState {
    if (state === null) {
      throw new Error('夜晚尚未启动');
    }
    return state;
  }

  function step(result: { state: GameState; events: GameEvent[] }): void {
    state = result.state;
    onStep(result);
  }

  function requireWindow(
    expected: Phase,
    closesAt: number,
    closedMessage: string,
  ): SubmitResult | null {
    if (phase !== expected) {
      return rejected('window_not_open', '当前不在该行动窗口');
    }
    if (clock.now() >= closesAt) {
      return rejected('window_closed', closedMessage);
    }
    return null;
  }

  function localIssues(partial: Partial<AttackPhaseInput>): NightValidationIssue[] {
    return validateAttackPhase(current(), {
      guardTargetIds: [],
      stage1DeathTargetIds: [],
      stage1SpiritTargetIds: [],
      stage2JointTargetIds: [],
      laikeTargetId: null,
      ...partial,
    });
  }

  function livingIds(roleId: PlayerState['roleId']): readonly string[] {
    return current()
      .players.filter((player) => player.roleId === roleId && player.life !== 'dead')
      .map((player) => player.playerId);
  }

  function poolFor(player: PlayerState): PoolRef | null {
    if (player.life === 'dead') {
      return null;
    }
    if (current().nightStage === 1) {
      if (player.roleId === 'death') {
        return {
          kind: 'death',
          memberIds: livingIds('death'),
          get: () => deathProposal,
          set: (next) => {
            deathProposal = next;
          },
        };
      }
      if (player.roleId === 'spirit') {
        return {
          kind: 'spirit',
          memberIds: livingIds('spirit'),
          get: () => spiritProposal,
          set: (next) => {
            spiritProposal = next;
          },
        };
      }
      return null;
    }
    if (player.roleId === 'death' || player.roleId === 'spirit') {
      return {
        kind: 'joint',
        memberIds: [...livingIds('death'), ...livingIds('spirit')],
        get: () => jointProposal,
        set: (next) => {
          jointProposal = next;
        },
      };
    }
    return null;
  }

  function assembleAttackInput(): AttackPhaseInput {
    const game = current();
    if (game.nightStage === 1) {
      const deathLocked = lockedVersion(deathProposal, livingIds('death'));
      const spiritLocked = lockedVersion(spiritProposal, livingIds('spirit'));
      return {
        guardTargetIds: guardSubmission?.targetIds ?? [],
        stage1DeathTargetIds: deathLocked?.targetPlayerIds ?? [],
        stage1SpiritTargetIds: spiritLocked?.targetPlayerIds ?? [],
        stage2JointTargetIds: [],
        laikeTargetId: laikeSubmission?.targetId ?? null,
      };
    }
    const jointLocked = lockedVersion(jointProposal, [...livingIds('death'), ...livingIds('spirit')]);
    return {
      guardTargetIds: guardSubmission?.targetIds ?? [],
      stage1DeathTargetIds: [],
      stage1SpiritTargetIds: [],
      stage2JointTargetIds: jointLocked?.targetPlayerIds ?? [],
      laikeTargetId: laikeSubmission?.targetId ?? null,
    };
  }

  function openSegment1(): void {
    phase = 'segment1';
    const now = clock.now();
    const timers = current().ruleset.timersSeconds;
    guardClosesAt = now + timers.ability * 1000;
    laikeClosesAt = guardClosesAt;
    factionClosesAt = now + timers.faction * 1000;
    handles.push(clock.schedule(timers.faction * 1000, resolveSegment1));
  }

  function resolveSegment1(): void {
    if (phase !== 'segment1') {
      return;
    }
    step(resolveAttackPhase(current(), assembleAttackInput()));
    openSegment2();
  }

  function openSegment2(): void {
    phase = 'segment2';
    const now = clock.now();
    const timers = current().ruleset.timersSeconds;
    checkClosesAt = now + timers.ability * 1000;
    rescueClosesAt = checkClosesAt;
    handles.push(clock.schedule(timers.ability * 1000, resolveSegment2));
  }

  function resolveSegment2(): void {
    if (phase !== 'segment2') {
      return;
    }
    if (checkSubmission !== null) {
      step(resolveDescenderCheck(current(), checkSubmission.actorId, checkSubmission.targetId));
    }
    step(resolveRescue(current(), rescueSubmission?.targetId ?? null));
    step(resolveNightEnd(current()));
    if (shouldOpenRevive()) {
      openRevive();
    } else {
      finishNight();
    }
  }

  function shouldOpenRevive(): boolean {
    const game = current();
    if (game.nightStage !== 2 || game.night === null) {
      return false;
    }
    const water = game.players.find((player) => player.roleId === 'water');
    return (
      water !== undefined &&
      water.life === 'dead' &&
      game.night.deaths.includes(water.playerId)
    );
  }

  function openRevive(): void {
    phase = 'revive';
    const now = clock.now();
    reviveClosesAt = now + current().ruleset.timersSeconds.ability * 1000;
    handles.push(clock.schedule(current().ruleset.timersSeconds.ability * 1000, resolveRevive));
  }

  function resolveRevive(): void {
    if (phase !== 'revive') {
      return;
    }
    if (reviveSubmission !== null && reviveSubmission.targetId !== null) {
      step(selectReviveTarget(current(), reviveSubmission.targetId));
    }
    finishNight();
  }

  function finishNight(): void {
    step(resolveMorning(current()));
    phase = 'done';
    onComplete?.(current());
  }

  function submitGuard(command: Extract<NightCommand, { type: 'SUBMIT_GUARD' }>): SubmitResult {
    const windowIssue = requireWindow('segment1', guardClosesAt, '守护窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const door = current().players.find(
      (player) => player.roleId === 'door' && player.life !== 'dead',
    );
    if (door === undefined) {
      return rejected('no_eligible_guardian', '当前没有可行动的门先生');
    }
    if (command.playerId !== door.playerId) {
      return rejected('not_guardian', '只有门先生可以提交守护');
    }
    const issues = localIssues({ guardTargetIds: command.targetIds });
    if (issues.length > 0) {
      return rejectedIssue(issues[0]);
    }
    guardSubmission = { targetIds: [...command.targetIds] };
    return accepted();
  }

  function submitLaike(command: Extract<NightCommand, { type: 'SUBMIT_LAIKE' }>): SubmitResult {
    const windowIssue = requireWindow('segment1', laikeClosesAt, '刺杀窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const laike = current().players.find((player) => player.roleId === 'laike');
    if (laike === undefined || laike.life === 'dead') {
      return rejected('laike_unavailable', '莱莱可不存在或已死亡');
    }
    if (command.playerId !== laike.playerId) {
      return rejected('not_laike', '只有莱莱可可以提交刺杀');
    }
    if (command.targetId !== null) {
      const issues = localIssues({ laikeTargetId: command.targetId });
      if (issues.length > 0) {
        return rejectedIssue(issues[0]);
      }
    }
    laikeSubmission = { targetId: command.targetId };
    return accepted();
  }

  function submitProposalEdit(
    command: Extract<NightCommand, { type: 'EDIT_PROPOSAL' }>,
  ): SubmitResult {
    const windowIssue = requireWindow('segment1', factionClosesAt, '阵营协商窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const actor = current().players.find((player) => player.playerId === command.playerId);
    const pool = actor === undefined ? null : poolFor(actor);
    if (pool === null) {
      return rejected('not_faction_member', '当前没有阵营协商资格');
    }
    const partial: Partial<AttackPhaseInput> =
      pool.kind === 'death'
        ? { stage1DeathTargetIds: command.targets }
        : pool.kind === 'spirit'
          ? { stage1SpiritTargetIds: command.targets }
          : { stage2JointTargetIds: command.targets };
    const issues = localIssues(partial);
    if (issues.length > 0) {
      return rejectedIssue(issues[0]);
    }
    pool.set(editProposal(pool.get(), pool.memberIds, command.playerId, command.targets));
    return accepted();
  }

  function submitProposalConfirm(
    command: Extract<NightCommand, { type: 'CONFIRM_PROPOSAL' }>,
  ): SubmitResult {
    const windowIssue = requireWindow('segment1', factionClosesAt, '阵营协商窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const actor = current().players.find((player) => player.playerId === command.playerId);
    const pool = actor === undefined ? null : poolFor(actor);
    if (pool === null) {
      return rejected('not_faction_member', '当前没有阵营协商资格');
    }
    const version = pool.get().versions.find((item) => item.revision === command.revision);
    if (version === undefined) {
      return rejected('unknown_revision', `方案版本 ${command.revision} 不存在`);
    }
    pool.set(confirmProposal(pool.get(), pool.memberIds, command.playerId, command.revision));
    return accepted();
  }

  function submitCheck(command: Extract<NightCommand, { type: 'SUBMIT_CHECK' }>): SubmitResult {
    const windowIssue = requireWindow('segment2', checkClosesAt, '查验窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const descender = current().players.find(
      (player) => player.roleId === 'descender' && player.life !== 'dead',
    );
    if (descender === undefined) {
      return rejected('descender_unavailable', '降临者不存在或已死亡');
    }
    if (command.playerId !== descender.playerId) {
      return rejected('not_descender', '只有降临者可以提交查验');
    }
    const issue = descenderCheckIssueLocal(command.targetId);
    if (issue !== null) {
      return rejectedIssue(issue);
    }
    checkSubmission = { actorId: command.playerId, targetId: command.targetId };
    return accepted();
  }

  function descenderCheckIssueLocal(targetId: string): NightValidationIssue | null {
    const game = current();
    const target = game.players.find((player) => player.playerId === targetId);
    if (target === undefined) {
      return { code: 'unknown_target', message: `查验目标 ${targetId} 不存在` };
    }
    if (target.life === 'dead') {
      return { code: 'target_dead', message: '查验目标已死亡' };
    }
    return null;
  }

  function submitRescue(command: Extract<NightCommand, { type: 'SUBMIT_RESCUE' }>): SubmitResult {
    const windowIssue = requireWindow('segment2', rescueClosesAt, '还魂曲窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    if (current().nightStage !== 1) {
      return rejected('rescue_wrong_stage', '二阶段不使用还魂曲');
    }
    const water = current().players.find((player) => player.roleId === 'water');
    if (water === undefined || water.life === 'dead') {
      return rejected('water_unavailable', '水妖不存在或已死亡');
    }
    if (command.playerId !== water.playerId) {
      return rejected('not_water', '只有水妖可以提交还魂曲');
    }
    if (command.targetId !== null) {
      const issue = rescueIssueLocal(command.targetId);
      if (issue !== null) {
        return rejectedIssue(issue);
      }
    }
    rescueSubmission = { actorId: command.playerId, targetId: command.targetId };
    return accepted();
  }

  function rescueIssueLocal(targetId: string): NightValidationIssue | null {
    const game = current();
    const water = game.players.find((player) => player.roleId === 'water');
    if (water === undefined || water.life === 'dead') {
      return { code: 'water_unavailable', message: '水妖不存在或已死亡' };
    }
    if (water.abilities.waterRescueUsed) {
      return { code: 'rescue_used', message: '还魂曲整局限一次，已经使用' };
    }
    if (targetId === water.playerId) {
      return { code: 'rescue_self_forbidden', message: '还魂曲不能救自己' };
    }
    if (game.night === null || !game.night.dyingSet.includes(targetId)) {
      return { code: 'target_not_dying', message: '目标不在本夜濒死名单内' };
    }
    return null;
  }

  function submitRevive(command: Extract<NightCommand, { type: 'SUBMIT_REVIVE' }>): SubmitResult {
    const windowIssue = requireWindow('revive', reviveClosesAt, '回归选择窗口已结束');
    if (windowIssue !== null) {
      return windowIssue;
    }
    const water = current().players.find((player) => player.roleId === 'water');
    if (water === undefined) {
      return rejected('water_unavailable', '水妖不存在');
    }
    if (command.playerId !== water.playerId) {
      return rejected('not_water', '只有水妖可以选择回归对象');
    }
    if (command.targetId !== null) {
      const issue = reviveSelectionIssue(current(), command.targetId);
      if (issue !== null) {
        return rejectedIssue(issue);
      }
    }
    reviveSubmission = { targetId: command.targetId };
    return accepted();
  }

  return {
    start(initial) {
      if (phase !== 'idle') {
        throw new Error('夜晚驱动已经启动过');
      }
      if (initial.phase !== 'night' || initial.night !== null) {
        throw new Error('当前状态不能开始夜晚');
      }
      step(startNight(initial));
      openSegment1();
    },
    submit(command) {
      if (state === null) {
        return rejected('night_not_started', '夜晚尚未开始');
      }
      switch (command.type) {
        case 'SUBMIT_GUARD':
          return submitGuard(command);
        case 'SUBMIT_LAIKE':
          return submitLaike(command);
        case 'EDIT_PROPOSAL':
          return submitProposalEdit(command);
        case 'CONFIRM_PROPOSAL':
          return submitProposalConfirm(command);
        case 'SUBMIT_CHECK':
          return submitCheck(command);
        case 'SUBMIT_RESCUE':
          return submitRescue(command);
        case 'SUBMIT_REVIVE':
          return submitRevive(command);
        default:
          return rejected('window_not_open', '该操作不属于当前阶段');
      }
    },
    proposalState(playerId) {
      if (state === null) {
        return null;
      }
      const actor = current().players.find((player) => player.playerId === playerId);
      const pool = actor === undefined ? null : poolFor(actor);
      if (pool === null) {
        return null;
      }
      const proposal = pool.get();
      const latest =
        proposal.versions.length > 0 ? proposal.versions[proposal.versions.length - 1] : null;
      return {
        pool: pool.kind,
        activeMemberIds: pool.memberIds,
        revision: latest?.revision ?? 0,
        targetPlayerIds: latest?.targetPlayerIds ?? [],
        confirmedBy: latest?.confirmedBy ?? [],
        locked: lockedVersion(proposal, pool.memberIds) !== null,
      };
    },
    windows() {
      if (state === null || phase === 'idle' || phase === 'done') {
        return [];
      }
      const now = clock.now();
      if (phase === 'segment1') {
        const list: LiveWindow[] = [];
        if (now < guardClosesAt) {
          list.push({ id: 'guard', closesAt: guardClosesAt });
        }
        if (now < factionClosesAt) {
          list.push({ id: 'faction', closesAt: factionClosesAt });
        }
        if (now < laikeClosesAt) {
          list.push({ id: 'laike', closesAt: laikeClosesAt });
        }
        return list;
      }
      if (phase === 'segment2') {
        const list: LiveWindow[] = [];
        if (now < checkClosesAt) {
          list.push({ id: 'check', closesAt: checkClosesAt });
        }
        if (current().nightStage === 1 && now < rescueClosesAt) {
          list.push({ id: 'rescue', closesAt: rescueClosesAt });
        }
        return list;
      }
      return [{ id: 'revive', closesAt: reviveClosesAt }];
    },
    snapshot() {
      return state;
    },
    done() {
      return phase === 'done';
    },
    dispose() {
      for (const handle of handles) {
        clock.cancel(handle);
      }
      handles.length = 0;
      phase = 'done';
    },
  };
}
