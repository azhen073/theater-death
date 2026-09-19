import type { Room } from '../rooms.ts';
import { publishedState } from '../../visibility/knowledge.ts';
import { buildPlayerView, publicEventLog } from '../../visibility/projection.ts';
import { capabilities } from '../capabilities.ts';
import { legalTargets, type TargetAction } from '../../engine/targets.ts';

export interface ViewIdentity { subjectPlayerId: string | null; readOnly: boolean }
const targeted = new Set<string>(['SUBMIT_GUARD', 'SUBMIT_LAIKE', 'EDIT_PROPOSAL', 'SUBMIT_CHECK', 'SUBMIT_RESCUE', 'SUBMIT_REVIVE', 'SUBMIT_DAY_VOTE', 'SUBMIT_ELECTION_VOTE', 'SUBMIT_HANDOVER', 'DESIGNATE_SPEECH']);

export function gameView(room: Room, identity: ViewIdentity, now: number) {
  const state = room.state;
  if (state === null) return {
    apiVersion: 2, rulesVersion: room.ruleset.version, serverTime: now, gameId: room.gameId, roomCode: room.code,
    public: { phase: 'lobby', mode: room.ruleset.mode, requiredPlayers: room.requiredPlayerCount(), members: room.members.map((m) => ({ playerId: m.playerId, nickname: m.nickname, ready: m.ready, isHost: m.playerId === room.hostPlayerId })) },
    private: identity.subjectPlayerId === null ? null : { playerId: identity.subjectPlayerId }, windows: [],
  };
  const known = publishedState(state, room.events);
  const windows = room.driver?.windows() ?? [];
  const view = identity.subjectPlayerId === null ? null : buildPlayerView({ state: known, events: room.events, playerId: identity.subjectPlayerId });
  // Global audit sequence numbers must never become a hidden-event count side channel.
  const factionRoom = view?.room ? { roomId: view.room.roomId, readOnly: view.room.readOnly, canWrite: view.room.canWrite, members: view.room.members } : null;
  const subject = identity.subjectPlayerId;
  const subjectCaps = capabilities(known, subject, windows, now);
  // Only the water role is entitled to learn the unannounced dead roster for its return choice.
  const actualCaps = capabilities(state, subject, windows, now);
  if (actualCaps.allowedCommands.includes('SUBMIT_REVIVE')) subjectCaps.allowedCommands.push('SUBMIT_REVIVE');
  const allowedTargets = Object.fromEntries(subjectCaps.allowedCommands.filter((c) => targeted.has(c)).map((action) => [action, legalTargets(action === 'SUBMIT_REVIVE' ? state : known, subject!, action as TargetAction)]));
  const callerCaps = identity.readOnly ? capabilities(known, null, windows, now, true) : subjectCaps;
  return {
    apiVersion: 2, rulesVersion: state.ruleset.version, serverTime: now, gameId: room.gameId, roomCode: room.code,
    public: { phase: state.phase, dayNumber: state.dayNumber, stage: state.stage, sheriff: state.sheriff, seats: known.players.map((p) => ({ playerId: p.playerId, seat: p.seat, nickname: p.nickname, alive: p.life !== 'dead', revealedRoleId: p.revealed ? p.roleId : null })), events: publicEventLog(room.events) },
    private: view === null ? null : { self: view.self, events: view.personalEvents, factionRoom, targets: allowedTargets, proposal: subjectCaps.allowedCommands.includes('EDIT_PROPOSAL') ? room.driver?.proposalState(subject!) ?? null : null },
    capabilities: callerCaps,
    windows: windows.filter((w) => w.closesAt > now && (w.id !== 'revive' || subjectCaps.allowedCommands.includes('SUBMIT_REVIVE'))),
  };
}
