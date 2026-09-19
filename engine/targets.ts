import type { GameState } from './types.ts';
import { descenderCheckIssue, rescueSelectionIssue, validateAttackPhase, type AttackPhaseInput } from './night.ts';
import { reviveSelectionIssue } from './morning.ts';
import { designateSpeechRoundIssue, submitDayVoteIssue, submitElectionVoteIssue, submitHandoverIssue } from './day.ts';

export type TargetAction = 'SUBMIT_GUARD' | 'SUBMIT_LAIKE' | 'EDIT_PROPOSAL' | 'SUBMIT_CHECK' | 'SUBMIT_RESCUE' | 'SUBMIT_REVIVE' | 'SUBMIT_DAY_VOTE' | 'SUBMIT_ELECTION_VOTE' | 'SUBMIT_HANDOVER' | 'DESIGNATE_SPEECH';
const emptyAttack = (): AttackPhaseInput => ({ guardTargetIds: [], stage1DeathTargetIds: [], stage1SpiritTargetIds: [], stage2JointTargetIds: [], laikeTargetId: null });

/** Uses the same engine validators as command execution; list queries do not replace combination validation. */
export function targetSelectionIssue(state: GameState, actorId: string, action: TargetAction, targets: readonly string[]) {
  const actor = state.players.find((p) => p.playerId === actorId);
  if (!actor) return { code: 'unknown_actor', message: '未知玩家' };
  const one = targets[0] ?? null;
  if (action === 'SUBMIT_GUARD' || action === 'SUBMIT_LAIKE' || action === 'EDIT_PROPOSAL') {
    const roleOk = action === 'SUBMIT_GUARD' ? actor.roleId === 'door' : action === 'SUBMIT_LAIKE' ? actor.roleId === 'laike' : actor.roleId === 'death' || actor.roleId === 'spirit';
    if (!roleOk || actor.life === 'dead') return { code: 'action_forbidden', message: '无行动资格' };
    const input = emptyAttack();
    const partial = action === 'SUBMIT_GUARD' ? { guardTargetIds: targets } : action === 'SUBMIT_LAIKE' ? { laikeTargetId: one } : state.nightStage === 2 ? { stage2JointTargetIds: targets } : actor.roleId === 'death' ? { stage1DeathTargetIds: targets } : { stage1SpiritTargetIds: targets };
    if (action === 'SUBMIT_LAIKE' && targets.length > 1) return { code: 'targets_exceeded', message: '至多一个目标' };
    return validateAttackPhase(state, { ...input, ...partial })[0] ?? null;
  }
  if (targets.length > 1) return { code: 'targets_exceeded', message: '至多一个目标' };
  switch (action) {
    case 'SUBMIT_CHECK': return one === null ? { code: 'target_required', message: '需要目标' } : descenderCheckIssue(state, actorId, one);
    case 'SUBMIT_RESCUE':
      if (actor.roleId !== 'water') return { code: 'action_forbidden', message: '无行动资格' };
      return one === null ? null : rescueSelectionIssue(state, one);
    case 'SUBMIT_REVIVE':
      if (actor.roleId !== 'water') return { code: 'action_forbidden', message: '无行动资格' };
      return one === null ? null : reviveSelectionIssue(state, one);
    case 'SUBMIT_DAY_VOTE': return submitDayVoteIssue(state, actorId, one);
    case 'SUBMIT_ELECTION_VOTE': return submitElectionVoteIssue(state, actorId, one);
    case 'SUBMIT_HANDOVER': return submitHandoverIssue(state, actorId, one);
    case 'DESIGNATE_SPEECH': return one === null ? { code: 'target_required', message: '需要目标' } : designateSpeechRoundIssue(state, actorId, one, 'asc');
  }
}

export function legalTargets(state: GameState, actorId: string, action: TargetAction) {
  const actor = state.players.find((p) => p.playerId === actorId);
  const maxTargets = action === 'SUBMIT_GUARD' ? state.ruleset.guardTargets : action === 'EDIT_PROPOSAL' ? state.nightStage === 2 ? state.ruleset.stage2JointQuota : actor?.roleId === 'death' ? state.ruleset.stage1DeathQuota : state.players.filter((p) => p.roleId === 'spirit' && p.life !== 'dead').length : 1;
  const candidates = state.players.filter((p) => targetSelectionIssue(state, actorId, action, [p.playerId]) === null).map((p) => p.playerId);
  // A legal pair is not equivalent to two independently legal targets (consecutive guard rule).
  const forbiddenPairs = action === 'SUBMIT_GUARD' ? candidates.flatMap((a, i) => candidates.slice(i + 1).filter((b) => targetSelectionIssue(state, actorId, action, [a, b]) !== null).map((b) => [a, b])) : [];
  return { playerIds: candidates, maxTargets, allowRepeated: action === 'EDIT_PROPOSAL' && state.ruleset.duplicateTargetPolicy === 'allow', canSkip: !['SUBMIT_CHECK', 'DESIGNATE_SPEECH'].includes(action), forbiddenPairs };
}
