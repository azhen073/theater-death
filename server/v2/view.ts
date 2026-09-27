import type { Room } from '../rooms.ts';
import { publishedState } from '../../visibility/knowledge.ts';
import { buildPlayerView, publicEventLog } from '../../visibility/projection.ts';
import { capabilities } from '../capabilities.ts';
import type { PublicChatPolicy } from '../../visibility/chat.ts';
import { legalTargets, type TargetAction } from '../../engine/targets.ts';
import type { GameState } from '../../engine/types.ts';

export interface ViewIdentity { subjectPlayerId: string | null; readOnly: boolean }
const targeted = new Set<string>(['SUBMIT_GUARD', 'SUBMIT_LAIKE', 'EDIT_PROPOSAL', 'SUBMIT_CHECK', 'SUBMIT_RESCUE', 'SUBMIT_REVIVE', 'SUBMIT_DAY_VOTE', 'SUBMIT_ELECTION_VOTE', 'SUBMIT_HANDOVER', 'DESIGNATE_SPEECH']);

/** 私人身份知识（R-27/R-30/R-31）：死神与丧亲者知晓魂灵；魂灵互相知晓；其余为空。 */
function knowledgeFor(self: { roleId: string; seat: number }, state: GameState): { spiritSeats: number[]; dyingSeats?: number[] } {
  const spiritSeats = state.players.filter((player) => player.roleId === 'spirit').map((player) => player.seat).sort((a, b) => a - b);
  const dyingSeats = dyingSeatsFor(self.seat, state);
  const base = self.roleId === 'death' || self.roleId === 'mourner'
    ? { spiritSeats }
    : self.roleId === 'spirit'
      ? { spiritSeats: spiritSeats.filter((seat) => seat !== self.seat) }
      : { spiritSeats: [] };
  return dyingSeats === null ? base : { ...base, dyingSeats };
}

/**
 * 本夜濒死名单（R-20/R-24）：与 `engine/night.ts` 发出 `dying_list` 事件的授权口径一致——
 * 一阶段、夜间、名单已产生（攻击结算后），且本人在世；水妖还要求尚未使用还魂曲（用过即失去名单视野）。
 * 不满足时返回 `null`（调用方据此**省略字段**，而不是下发空数组——空数组等于告诉客户端"本夜无人濒死"）。
 */
function dyingSeatsFor(selfSeat: number, state: GameState): number[] | null {
  if (state.stage !== 1 || state.night === null) return null;
  const me = state.players.find((player) => player.seat === selfSeat);
  if (me === undefined || me.life === 'dead') return null;
  if (me.roleId !== 'descender' && !(me.roleId === 'water' && !me.abilities.waterRescueUsed)) return null;
  if (state.night.dyingSet.length === 0) return null;
  return state.players.filter((player) => state.night!.dyingSet.includes(player.playerId)).map((player) => player.seat).sort((a, b) => a - b);
}

export function gameView(room: Room, identity: ViewIdentity, now: number, publicChat: PublicChatPolicy = 'legacy_day_only') {
  const state = room.state;
  if (state === null) return {
    apiVersion: 2, rulesVersion: room.ruleset.version, serverTime: now, gameId: room.gameId, roomCode: room.code,
    public: { phase: 'lobby', mode: room.ruleset.mode, requiredPlayers: room.requiredPlayerCount(), members: room.members.map((m) => ({ playerId: m.playerId, nickname: m.nickname, ready: m.ready, isHost: m.playerId === room.hostPlayerId })), nightDeadline: null },
    private: identity.subjectPlayerId === null ? null : { playerId: identity.subjectPlayerId }, windows: [],
  };
  const known = publishedState(state, room.events);
  const windows = room.driver?.windows() ?? [];
  const view = identity.subjectPlayerId === null ? null : buildPlayerView({ state: known, events: room.events, playerId: identity.subjectPlayerId });
  // Global audit sequence numbers must never become a hidden-event count side channel.
  const factionRoom = view?.room ? { roomId: view.room.roomId, readOnly: view.room.readOnly, canWrite: view.room.canWrite, members: view.room.members } : null;
  const subject = identity.subjectPlayerId;
  const subjectCaps = capabilities(known, subject, windows, now, false, publicChat);
  // Only the water role is entitled to learn the unannounced dead roster for its return choice.
  const actualCaps = capabilities(state, subject, windows, now, false, publicChat);
  if (actualCaps.allowedCommands.includes('SUBMIT_REVIVE')) subjectCaps.allowedCommands.push('SUBMIT_REVIVE');
  const allowedTargets = Object.fromEntries(subjectCaps.allowedCommands.filter((c) => targeted.has(c)).map((action) => [action, legalTargets(action === 'SUBMIT_REVIVE' ? state : known, subject!, action as TargetAction)]));
  const callerCaps = identity.readOnly ? capabilities(known, null, windows, now, true, publicChat) : subjectCaps;
  const nightDeadline = room.driver !== null && 'nightDeadline' in room.driver ? room.driver.nightDeadline() : null;
  return {
    apiVersion: 2, rulesVersion: state.ruleset.version, serverTime: now, gameId: room.gameId, roomCode: room.code,
    public: { phase: state.phase, dayNumber: state.dayNumber, stage: state.stage, sheriff: state.sheriff, seats: known.players.map((p) => ({ playerId: p.playerId, seat: p.seat, nickname: p.nickname, alive: p.life !== 'dead', revealedRoleId: p.revealed ? p.roleId : null })), events: publicEventLog(room.events), nightDeadline },
    private: view === null ? null : { self: view.self, events: view.personalEvents, factionRoom, targets: allowedTargets, knowledge: knowledgeFor(view.self, state), proposal: subjectCaps.allowedCommands.includes('EDIT_PROPOSAL') ? room.driver?.proposalState(subject!) ?? null : null },
    capabilities: callerCaps,
    windows: windows.filter((w) => w.closesAt > now && (w.id !== 'revive' || subjectCaps.allowedCommands.includes('SUBMIT_REVIVE'))),
  };
}
