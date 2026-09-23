/** Public transport vocabulary. No database rows or unfiltered engine state belong here. */
import type { RoleId, RulesetConfig } from '../rulesets/types.ts';

export const CONTRACT_VERSION = '2.2' as const;
export const COMMAND_ACTIONS = ['SUBMIT_GUARD', 'SUBMIT_LAIKE', 'EDIT_PROPOSAL', 'CONFIRM_PROPOSAL', 'SUBMIT_CHECK', 'SUBMIT_RESCUE', 'SUBMIT_REVIVE', 'REGISTER_CANDIDACY', 'WITHDRAW_CANDIDACY', 'START_SPEECH', 'END_ELECTION_SPEECH', 'SUBMIT_ELECTION_VOTE', 'DESIGNATE_SPEECH', 'END_SPEECH', 'SUBMIT_DAY_VOTE', 'END_TIE_SPEECH', 'END_LAST_WORDS', 'SUBMIT_HANDOVER'] as const;
export type CommandAction = typeof COMMAND_ACTIONS[number];
export type RoomPhase = 'lobby' | 'playing' | 'review';
export type MemberKind = 'formal' | 'public_spectator' | 'private_spectator';
export type Presence = 'online' | 'reconnecting' | 'offline';
export interface Profile { userId: string; uid: string; nickname: string; avatarUrl: string | null; profileVersion: number }
export interface AuthMe extends Profile { expiresAt: number }
export interface RoomMemberDTO extends Profile {
  memberId: string;
  kind: MemberKind;
  playerId: string | null;
  ready: boolean | null;
  presence: Presence;
  joinedAt: number;
  isHost: boolean;
}
export interface Permission { allowed: boolean; reason: string | null }
export type ControlReason = 'kicked' | 'dissolved' | 'taken_over' | 'session_expired' | 'account_disabled' | 'host_changed' | 'review_ended' | 'left' | 'screen_revoked';
export interface ControlNotice { roomId: string; gameId: string | null; reason: ControlReason }
export interface RequestIntent { requestId: string }
export interface MatchIntent extends RequestIntent { gameId: string }
export interface VoiceCredentials { appId: string; channel: string; uid: number; token: string }
export interface VoiceSyncResult { synced: true }
export interface CommandIntent extends MatchIntent { windowInstanceId: string; action: CommandAction; targets?: string[]; revision?: number; direction?: 'asc' | 'desc'; confirmSelf?: true; expectedRevision?: number }
export interface CommandReceipt {
  requestId: string;
  status: 'accepted' | 'rejected';
  code: string | null;
  message: string | null;
}
export type ReceiptLookup = CommandReceipt | { requestId: string; status: 'not_seen' | 'pending' };
export interface ChatMessageDTO { messageId: string; clientMessageId: string; cursor: number; senderId: string; text: string; at: number }
export interface ErrorEnvelope { error: { code: string; message?: string } }

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface EventDTO { cursor: number; type: string; dayNumber: number; stage: 1 | 2; payload: JsonValue }
export interface WindowDTO { id: string; type: string; instanceId: string; closesAt: number }
export interface TargetSelection { playerIds: string[]; maxTargets: number; allowRepeated: boolean; canSkip: boolean; forbiddenPairs: string[][] }
export interface SubmissionDTO { action: CommandAction; windowInstanceId: string; requestId: string | null; acceptedAt: number; targets: string[]; revision: number | null; direction: 'asc' | 'desc' | null }
export interface TaskDTO { action: CommandAction; windowInstanceId: string; closesAt: number; targets: TargetSelection | null }
export interface SeatDTO extends Profile { playerId: string; memberId: string | null; seat: number; alive: boolean; revealedRoleId: RoleId | null; presence: Presence | 'left'; isHost: boolean }
export interface SelfDTO {
  playerId: string; seat: number; nickname: string; roleId: RoleId; life: 'alive' | 'dying' | 'dead'; revealed: boolean; voteFrozen: boolean;
  abilities: { laikeBladeUsed: boolean; waterRescueUsed: boolean };
  guardHistory: readonly { nightNumber: number; targetPlayerIds: readonly string[] }[];
}
export interface DayDTO {
  step: 'morning_announcement' | 'first_night_last_words' | 'election' | 'speech_round' | 'vote' | 'elimination_last_words' | 'handover' | 'settle';
  speechPreparing: boolean;
  currentSpeakerId: string | null;
  election: { phase: 'signup' | 'speech' | 'vote' | 'revote' | 'done'; candidates: readonly string[]; withdrawn: readonly string[]; speechOrder: readonly string[]; round: 1 | 2; votedCount: number; eligibleCount: number; tiedIds: readonly string[]; winnerId: string | null } | null;
  ballot: { phase: 'vote' | 'tie_speech' | 'revote' | 'done'; round: 1 | 2; votedCount: number; eligibleCount: number; tiedIds: readonly string[]; eliminatedId: string | null } | null;
  speechRound: { order: readonly string[]; index: number; designatedBy: string | null; startSeat: number; direction: 'asc' | 'desc' } | null;
  lastWords: { queue: readonly string[]; index: number } | null;
  handover: { deadSheriffId: string; resolved: boolean; heirId: string | null } | null;
}
export interface PublicGameDTO {
  phase: 'night' | 'morning' | 'day' | 'ended'; dayNumber: number; stage: 1 | 2;
  sheriff: { enabled: boolean; holderId: string | null };
  seats: SeatDTO[]; events: EventDTO[]; day: DayDTO | null;
  night: { closesAt: number } | null;
  result: { winner: 'human' | 'death_faction'; dayNumber: number; reason: string } | null;
  startedAt: number; endedAt: number | null;
}
export interface PrivateGameDTO {
  self: SelfDTO; events: EventDTO[];
  factionRoom: { roomId: string; readOnly: boolean; canWrite: boolean; members: readonly { playerId: string; seat: number; readOnly: boolean }[] } | null;
  targets: Partial<Record<CommandAction, TargetSelection>>;
  knowledge: { spiritSeats: number[] };
  proposal: { pool: 'death' | 'spirit' | 'joint'; activeMemberIds: readonly string[]; revision: number; targetPlayerIds: readonly string[]; confirmedBy: readonly string[]; locked: boolean; effective: { revision: number | null; targetPlayerIds: readonly string[]; basis: 'unanimous' | 'latest_legal' | 'empty' } } | null;
  /** 当前发言窗口的送达回执聚合；仅对「此刻持有发布权」的人下发，其他人不含该字段（可选，向后兼容）。 */
  voice?: { delivery: VoiceDeliveryDTO } | null;
}
/** 送达回执聚合：分母是「上报过的接收端数」，不是频道人数（措辞与隐私边界见 docs/frontend-v2-voice.md）。 */
export interface VoiceDeliveryDTO {
  windowInstanceId: string; delivered: number; blocked: number; silentOutput: number; failed: number; listeners: number; updatedAt: number;
}
export type RoomAction = 'ready' | 'start' | 'promote' | 'leave' | 'transferHost' | 'dissolve' | 'endReview' | 'kickFormal' | 'kickSpectator' | 'inviteSecondScreen' | 'revokeSecondScreen';
export interface SnapshotCapabilities {
  canPostPublic: boolean; canPostFaction: boolean; canPublishVoice: boolean; canVote: boolean;
  supportsProposalEditConfirmation?: boolean;
  allowedCommands: CommandAction[];
  commandReasons: Record<CommandAction, string | null>;
  room: Record<RoomAction, Permission>;
}
export interface RoomSnapshot {
  contractVersion: typeof CONTRACT_VERSION; rulesVersion: string;
  roomId: string; gameId: string | null; serverTime: number; viewVersion: number;
  viewer: { userId: string; memberId: string; kind: MemberKind; subjectPlayerId: string | null; readOnly: boolean; isHost: boolean };
  room: { code: string; phase: RoomPhase; config: RulesetConfig; requiredPlayers: number; hostMemberId: string | null; formalMembers: RoomMemberDTO[]; spectators: RoomMemberDTO[]; emptyDeadline: number | null };
  public: PublicGameDTO | null; private: PrivateGameDTO | null;
  capabilities: SnapshotCapabilities; windows: WindowDTO[]; tasks: TaskDTO[]; submissionState: SubmissionDTO[];
  chat: { public: ChatMessageDTO[]; faction: ChatMessageDTO[] };
}
