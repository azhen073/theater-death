import * as day from '../engine/day.ts';
import type { GameState } from '../engine/types.ts';
import { canPostPublic } from '../visibility/chat.ts';
import { roomMembership } from '../visibility/rooms.ts';
import { voicePermission } from '../voice/policy.ts';
import type { GameCommandType } from './commands.ts';
import type { LiveWindow } from './night-driver.ts';

export interface Capabilities {
  canPostPublic: boolean;
  canPostFaction: boolean;
  canPublishVoice: boolean;
  canVote: boolean;
  allowedCommands: GameCommandType[];
}

/** A single policy query, also consumed by the v2 command boundary. Never accepts client identity. */
export function capabilities(state: GameState, playerId: string | null, windows: readonly LiveWindow[], now: number, readOnly = false): Capabilities {
  const result: Capabilities = { canPostPublic: false, canPostFaction: false, canPublishVoice: false, canVote: false, allowedCommands: [] };
  const me = state.players.find((p) => p.playerId === playerId);
  if (readOnly || !me || state.win !== null || state.phase === 'ended') return result;
  result.canPostPublic = canPostPublic(state, me.playerId);
  result.canPostFaction = roomMembership(state, me.playerId)?.canWrite ?? false;
  result.canPublishVoice = voicePermission(state, me.playerId).canPublish;
  const open = new Set(windows.filter((w) => now < w.closesAt).map((w) => w.id));
  const allow = (id: GameCommandType, ok: boolean) => { if (ok) result.allowedCommands.push(id); };
  if (state.phase === 'night' && me.life !== 'dead') {
    allow('SUBMIT_GUARD', open.has('guard') && me.roleId === 'door');
    allow('SUBMIT_LAIKE', open.has('laike') && me.roleId === 'laike' && (state.nightStage === 1 ? !me.abilities.laikeBladeUsed : !me.revealed));
    const attack = open.has('faction') && (me.roleId === 'spirit' || (me.roleId === 'death' && (state.nightStage === 2 || !state.stage1AttackDisabled)));
    allow('EDIT_PROPOSAL', attack);
    allow('CONFIRM_PROPOSAL', attack);
    allow('SUBMIT_CHECK', open.has('check') && me.roleId === 'descender' && state.night?.descenderCheck === null);
    allow('SUBMIT_RESCUE', open.has('rescue') && me.roleId === 'water' && state.nightStage === 1 && !me.abilities.waterRescueUsed);
  }
  allow('SUBMIT_REVIVE', open.has('revive') && state.phase === 'morning' && state.nightStage === 2 && me.roleId === 'water' && me.life === 'dead' && (state.night?.deaths.includes(me.playerId) ?? false));
  if (state.phase === 'day') {
    allow('REGISTER_CANDIDACY', open.has('election_signup') && day.registerCandidacyIssue(state, me.playerId) === null);
    allow('WITHDRAW_CANDIDACY', (open.has('election_signup') || open.has('election_speech') || open.has('speech_prepare')) && day.withdrawCandidacyIssue(state, me.playerId) === null);
    allow('START_SPEECH', open.has('speech_prepare') && (state.day?.step === 'election' ? day.currentElectionSpeaker(state) : day.currentSpeechRoundSpeaker(state)) === me.playerId);
    allow('END_ELECTION_SPEECH', open.has('election_speech') && day.currentElectionSpeaker(state) === me.playerId);
    allow('END_SPEECH', open.has('speech_round') && day.currentSpeechRoundSpeaker(state) === me.playerId);
    allow('END_LAST_WORDS', open.has('last_words') && day.endLastWordsIssue(state, me.playerId) === null);
    allow('END_TIE_SPEECH', open.has('tie_speech') && day.currentTieSpeechSpeaker(state) === me.playerId);
    allow('SUBMIT_ELECTION_VOTE', open.has('election_vote') && day.submitElectionVoteIssue(state, me.playerId, null) === null);
    allow('SUBMIT_DAY_VOTE', open.has('vote') && day.submitDayVoteIssue(state, me.playerId, null) === null);
    allow('SUBMIT_HANDOVER', open.has('handover') && day.submitHandoverIssue(state, me.playerId, null) === null);
    allow('DESIGNATE_SPEECH', open.has('speech_order') && day.designateSpeechRoundIssue(state, me.playerId, me.playerId, 'asc') === null);
  }
  result.canVote = result.allowedCommands.some((action) => action === 'SUBMIT_ELECTION_VOTE' || action === 'SUBMIT_DAY_VOTE');
  if (open.size === 0) result.canPublishVoice = false;
  return result;
}
