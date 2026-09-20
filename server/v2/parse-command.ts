import type { GameCommand } from '../commands.ts';
import { ApiError } from './errors.ts';
import { textField } from './auth.ts';

export function parseCommand(body: Record<string, unknown>, playerId: string): GameCommand {
  const type = textField(body.action, 'action', 1, 48);
  const windowInstanceId = textField(body.windowInstanceId, 'window_instance', 1, 180);
  const targets = body.targets ?? [];
  if (!Array.isArray(targets) || targets.length > 64 || targets.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 128)) throw new ApiError(400, 'invalid_targets');
  const ids = targets as string[];
  const base = { playerId, windowInstanceId };
  if (type !== 'EDIT_PROPOSAL' && (body.confirmSelf !== undefined || body.expectedRevision !== undefined)) throw new ApiError(400, 'invalid_proposal_options');
  switch (type) {
    case 'SUBMIT_GUARD': return { ...base, type, targetIds: ids };
    case 'EDIT_PROPOSAL': {
      const hasConfirmSelf = body.confirmSelf !== undefined;
      const hasExpectedRevision = body.expectedRevision !== undefined;
      if (hasConfirmSelf !== hasExpectedRevision || hasConfirmSelf &&
        (body.confirmSelf !== true || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 || !Array.isArray(body.targets))) {
        throw new ApiError(400, 'invalid_proposal_options');
      }
      return hasConfirmSelf
        ? { ...base, type, targets: ids, confirmSelf: true as const, expectedRevision: Number(body.expectedRevision) }
        : { ...base, type, targets: ids };
    }
    case 'CONFIRM_PROPOSAL':
      if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1) throw new ApiError(400, 'invalid_revision');
      return { ...base, type, revision: Number(body.revision) };
    case 'SUBMIT_CHECK':
      if (ids.length !== 1) throw new ApiError(400, 'target_required');
      return { ...base, type, targetId: ids[0] };
    case 'SUBMIT_LAIKE': case 'SUBMIT_RESCUE': case 'SUBMIT_REVIVE': case 'SUBMIT_DAY_VOTE': case 'SUBMIT_ELECTION_VOTE': case 'SUBMIT_HANDOVER':
      if (ids.length > 1) throw new ApiError(400, 'too_many_targets');
      return { ...base, type, targetId: ids[0] ?? null };
    case 'DESIGNATE_SPEECH':
      if (ids.length !== 1 || (body.direction !== 'asc' && body.direction !== 'desc')) throw new ApiError(400, 'invalid_speech_order');
      return { ...base, type, startPlayerId: ids[0], direction: body.direction };
    case 'START_SPEECH': case 'REGISTER_CANDIDACY': case 'WITHDRAW_CANDIDACY': case 'END_ELECTION_SPEECH': case 'END_SPEECH': case 'END_TIE_SPEECH': case 'END_LAST_WORDS': return { ...base, type };
    default: throw new ApiError(400, 'unknown_action');
  }
}
