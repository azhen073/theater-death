import { randomUUID } from 'node:crypto';
import { COMMAND_ACTIONS, CONTRACT_VERSION, type CommandAction, type DayDTO, type EventDTO, type JsonValue, type Permission, type Profile, type RoomMemberDTO, type RoomSnapshot, type SeatDTO, type SnapshotCapabilities, type SubmissionDTO } from '../../contracts/v2.ts';
import { currentElectionSpeaker, currentLastWordsSpeaker, currentSpeechRoundSpeaker, currentTieSpeechSpeaker, electionVoterCount, voteEligibility } from '../../engine/day.ts';
import type { GameState } from '../../engine/types.ts';
import type { ClientEvent } from '../../visibility/projection.ts';
import { publishedState } from '../../visibility/knowledge.ts';
import { canReadRoomMessage } from '../../visibility/rooms.ts';
import type { Room } from '../rooms.ts';
import type { AccountSession } from './account-store.ts';
import type { RoomDirectory } from './room-directory.ts';
import type { ActiveMember, StableRoom } from './stable-room.ts';
import type { DeliveryView } from './media.ts';
import { gameView } from './view.ts';
import { ApiError } from './errors.ts';

const actionWindows: Record<CommandAction, readonly string[]> = {
  SUBMIT_GUARD: ['guard'], SUBMIT_LAIKE: ['laike'], EDIT_PROPOSAL: ['faction'], CONFIRM_PROPOSAL: ['faction'],
  SUBMIT_CHECK: ['check'], SUBMIT_RESCUE: ['rescue'], SUBMIT_REVIVE: ['revive'], REGISTER_CANDIDACY: ['election_signup'],
  WITHDRAW_CANDIDACY: ['election_signup', 'election_speech', 'speech_prepare'], START_SPEECH: ['speech_prepare'],
  END_ELECTION_SPEECH: ['election_speech'], SUBMIT_ELECTION_VOTE: ['election_vote'], DESIGNATE_SPEECH: ['speech_order'],
  END_SPEECH: ['speech_round'], SUBMIT_DAY_VOTE: ['vote'], END_TIE_SPEECH: ['tie_speech'], END_LAST_WORDS: ['last_words'], SUBMIT_HANDOVER: ['handover'],
};
const personalWindows = new Set(['guard', 'laike', 'faction', 'check', 'rescue', 'revive']);
const noGameCapabilities = () => ({ canPostPublic: false, canPostFaction: false, canPublishVoice: false, canVote: false, allowedCommands: [] as CommandAction[] });
const permission = (reason: string | null): Permission => ({ allowed: reason === null, reason });
const events = (items: readonly ClientEvent[]): EventDTO[] => items.map((e) => ({ ...e, payload: e.payload as JsonValue }));

function dayView(state: GameState): DayDTO | null {
  const day = state.day;
  if (!day) return null;
  const eligibleCount = state.players.filter((p) => voteEligibility(state, p.playerId) === 'ok').length;
  const electionEligibleCount = electionVoterCount(state);
  return {
    step: day.step, speechPreparing: day.speechPreparing ?? false,
    currentSpeakerId: currentElectionSpeaker(state) ?? currentLastWordsSpeaker(state) ?? currentTieSpeechSpeaker(state) ?? currentSpeechRoundSpeaker(state),
    election: day.election ? { phase: day.election.phase, candidates: day.election.candidates, withdrawn: day.election.withdrawn, speechOrder: day.election.speechOrder, round: day.election.round, votedCount: Object.keys(day.election.votes).length, eligibleCount: electionEligibleCount, tiedIds: day.election.tiedIds, winnerId: day.election.winnerId } : null,
    ballot: day.ballot ? { phase: day.ballot.phase, round: day.ballot.round, votedCount: Object.keys(day.ballot.votes).length, eligibleCount, tiedIds: day.ballot.tiedIds, eliminatedId: day.ballot.eliminatedId } : null,
    speechRound: day.speechRound, lastWords: day.lastWords,
    handover: day.handover ? { deadSheriffId: day.handover.deadSheriffId, resolved: day.handover.resolved, heirId: day.handover.heirId } : null,
  };
}

export interface SnapshotDeps {
  directory: RoomDirectory;
  profile: (userId: string) => Profile;
  submissions?: (room: StableRoom, subjectPlayerId: string) => SubmissionDTO[];
  /** C 组：当前发言窗口的送达聚合（只为「此刻持有发布权」的人读取） */
  voice?: { deliveryFor: (gameId: string) => DeliveryView | null };
}

/** Viewer-specific fingerprints never use global engine/audit sequence counters. */
export class RoomSnapshots {
  readonly deps: SnapshotDeps;
  readonly versions = new Map<string, { fingerprint: string; version: number }>();
  readonly messageIds = new WeakMap<Room, Map<number, string>>();
  constructor(deps: SnapshotDeps) { this.deps = deps; }
  private member(room: StableRoom, member: ActiveMember): RoomMemberDTO {
    return { ...this.deps.profile(member.userId), memberId: member.memberId, kind: member.kind,
      playerId: room.participants.get(member.userId)?.playerId ?? null,
      ready: member.kind === 'formal' ? member.ready : null, presence: member.presence,
      joinedAt: member.joinedAt, isHost: member.memberId === room.hostMemberId };
  }
  private roomCapabilities(room: StableRoom, member: ActiveMember): SnapshotCapabilities['room'] {
    const formal = member.kind === 'formal'; const host = formal && member.memberId === room.hostMemberId;
    const lobby = room.phase === 'lobby'; const count = room.formalMembers().length;
    const myPlayerId = room.participants.get(member.userId)?.playerId;
    const screenPresent = myPlayerId !== undefined && [...(room.access?.watchers.values() ?? [])].some((w) => w.subject === myPlayerId);
    const formalReason = !formal ? 'spectator_read_only' : null;
    const hostReason = !host ? 'not_host' : null;
    return {
      ready: permission(formalReason ?? (!lobby ? 'lobby_required' : null)),
      start: permission(hostReason ?? (!lobby ? 'lobby_required' : count !== room.requiredPlayers() ? 'room_not_full' : room.formalMembers().some((m) => !m.ready) ? 'not_ready' : null)),
      promote: permission(formal ? 'already_formal' : !lobby ? 'lobby_required' : count >= room.requiredPlayers() ? 'room_full' : null),
      leave: permission(null), transferHost: permission(hostReason), dissolve: permission(hostReason),
      endReview: permission(hostReason ?? (room.phase !== 'review' ? 'review_required' : null)),
      kickFormal: permission(hostReason ?? (!lobby ? 'lobby_required' : null)), kickSpectator: permission(hostReason),
      inviteSecondScreen: permission(formalReason ?? (lobby ? 'game_not_started' : screenPresent ? 'second_screen_unavailable' : null)),
      revokeSecondScreen: permission(formalReason ?? (lobby ? 'game_not_started' : null)),
    };
  }
  read(room: StableRoom, session: AccountSession): RoomSnapshot {
    const now = this.deps.directory.deps.clock.now();
    if (room.dissolved || (room.emptyDeadline !== null && now >= room.emptyDeadline && room.formalMembers().length === 0)) throw new ApiError(404, 'room_not_found');
    const member = this.deps.directory.member(room, session);
    const readOnly = member.kind !== 'formal';
    const viewer = room.access?.resolve(session);
    const subject = viewer?.identity.subjectPlayerId ?? null;
    const runtime = room.runtime;
    const projected = runtime ? gameView(runtime, { subjectPlayerId: subject, readOnly: false }, now) : null;
    const known = runtime?.state ? publishedState(runtime.state, runtime.events) : null;
    const subjectCaps = projected?.capabilities ?? noGameCapabilities();
    const gameCaps = readOnly ? noGameCapabilities() : subjectCaps;
    const caps: SnapshotCapabilities = {
      ...gameCaps,
      supportsProposalEditConfirmation: true,
      allowedCommands: [...gameCaps.allowedCommands],
      commandReasons: Object.fromEntries(COMMAND_ACTIONS.map((action) => [action, gameCaps.allowedCommands.includes(action) ? null : readOnly ? 'spectator_read_only' : runtime ? 'action_unavailable' : 'game_not_started'])) as SnapshotCapabilities['commandReasons'],
      room: this.roomCapabilities(room, member),
    };
    const windows = (projected?.windows ?? []).filter((w) => w.instanceId && w.type && w.closesAt > now && (!personalWindows.has(w.id) || subjectCaps.allowedCommands.some((a) => actionWindows[a].includes(w.id)))).map((w) => ({ id: w.id, type: w.type!, instanceId: w.instanceId!, closesAt: w.closesAt }));
    const privateView = projected?.private?.self ? projected.private : null;
    const members = [...room.members.values()].sort((a, b) => a.joinedOrder - b.joinedOrder);
    const participantById = new Map([...room.participants.values()].map((p) => [p.playerId, p]));
    const chat: RoomSnapshot['chat'] = { public: [], faction: [] };
    if (runtime && known) {
      let ids = this.messageIds.get(runtime);
      if (!ids) { ids = new Map(); this.messageIds.set(runtime, ids); }
      for (const message of runtime.chat) {
        if (message.channel === 'faction' && (!subject || !canReadRoomMessage(known, subject, message.eventSeq))) continue;
        const channel = chat[message.channel];
        const messageId = message.messageId ?? ids.get(message.id) ?? randomUUID();
        ids.set(message.id, messageId);
        channel.push({ messageId, clientMessageId: message.clientMessageId ?? '', cursor: channel.length + 1, senderId: message.senderId, text: message.text, at: message.at });
      }
    }
    const gameId = room.gameId;
    // C 组：送达回执只下发给此刻持有发布权的人（其他人不含该字段，避免听众信息变成公共知识）
    const delivery = !readOnly && caps.canPublishVoice && gameId ? this.deps.voice?.deliveryFor(gameId) ?? null : null;
    const result: Omit<RoomSnapshot, 'serverTime' | 'viewVersion'> = {
      contractVersion: CONTRACT_VERSION, rulesVersion: room.ruleset.version, roomId: room.roomId, gameId: room.gameId,
      viewer: { userId: member.userId, memberId: member.memberId, kind: member.kind, subjectPlayerId: subject, readOnly, isHost: room.hostMemberId === member.memberId },
      room: { code: room.code, phase: room.phase, config: room.ruleset, requiredPlayers: room.requiredPlayers(), hostMemberId: room.hostMemberId, formalMembers: members.filter((m) => m.kind === 'formal').map((m) => this.member(room, m)), spectators: members.filter((m) => m.kind !== 'formal').map((m) => this.member(room, m)), emptyDeadline: room.emptyDeadline },
      public: known && projected ? {
        phase: known.phase, dayNumber: known.dayNumber, stage: known.stage, sheriff: known.sheriff,
        seats: known.players.map<SeatDTO>((p) => {
          const participant = participantById.get(p.playerId)!;
          const current = room.members.get(participant.userId);
          const profile = this.deps.directory.deps.accounts.profileOrNull(participant.userId);
          return { userId: participant.userId, uid: participant.uid, nickname: participant.nickname, avatarUrl: profile?.avatarUrl ?? null, profileVersion: profile?.profileVersion ?? 0, playerId: p.playerId, memberId: current?.memberId ?? null, seat: p.seat, alive: p.life !== 'dead', revealedRoleId: p.revealed ? p.roleId : null, presence: current?.presence ?? 'left', isHost: current?.memberId === room.hostMemberId };
        }).sort((a, b) => a.seat - b.seat),
        events: events(projected.public.events ?? []), day: dayView(known), result: known.win,
        night: known.phase === 'night' && projected.public.nightDeadline !== null ? { closesAt: projected.public.nightDeadline } : null,
        startedAt: room.matchStartedAt!, endedAt: room.matchEndedAt,
      } : null,
      private: privateView ? {
        self: { playerId: privateView.self.playerId, seat: privateView.self.seat, nickname: privateView.self.nickname, roleId: privateView.self.roleId, life: privateView.self.life, revealed: privateView.self.revealed, voteFrozen: privateView.self.voteFrozen, abilities: privateView.self.abilities, guardHistory: privateView.self.guardHistory },
        events: events(privateView.events), targets: privateView.targets, proposal: privateView.proposal, knowledge: privateView.knowledge,
        factionRoom: privateView.factionRoom ? { ...privateView.factionRoom, readOnly: readOnly || privateView.factionRoom.readOnly, canWrite: !readOnly && privateView.factionRoom.canWrite } : null,
        ...(delivery ? { voice: { delivery } } : {}),
      } : null,
      capabilities: caps, windows,
      tasks: gameCaps.allowedCommands.flatMap((action) => windows.filter((w) => actionWindows[action].includes(w.id)).map((w) => ({ action, windowInstanceId: w.instanceId, closesAt: w.closesAt, targets: privateView?.targets?.[action as keyof typeof privateView.targets] ?? null }))),
      submissionState: subject ? (this.deps.submissions?.(room, subject) ?? []).map((s) => ({ ...s, requestId: readOnly ? null : s.requestId })) : [],
      chat,
    };
    const key = JSON.stringify([room.roomId, member.userId]);
    const fingerprint = JSON.stringify(result);
    const old = this.versions.get(key);
    const version = old ? old.fingerprint === fingerprint ? old.version : old.version + 1 : 1;
    this.versions.set(key, { fingerprint, version });
    return { ...result, serverTime: now, viewVersion: version };
  }
  forget(roomId: string) { for (const key of this.versions.keys()) if ((JSON.parse(key) as string[])[0] === roomId) this.versions.delete(key); }
}
