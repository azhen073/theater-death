/**
 * 客户端消费的 API 契约（服务端 visibility/、server/app.ts 的投影结果）。
 * 手写副本：前端不 import 服务端源码，避免把 Node 环境拖进打包。
 */

export type RoleId =
  | 'laike'
  | 'door'
  | 'water'
  | 'descender'
  | 'researcher'
  | 'civilian'
  | 'death'
  | 'spirit'
  | 'mourner';

export type Stage = 1 | 2;
export type LifeState = 'alive' | 'dying' | 'dead';
export type GamePhase = 'night' | 'morning' | 'day' | 'ended';

export interface AbilityUsage {
  readonly laikeBladeUsed: boolean;
  readonly waterRescueUsed: boolean;
}

export interface GuardRecord {
  readonly nightNumber: number;
  readonly targetPlayerIds: readonly string[];
}

/** 一条推送给客户端的对局事件（流内没有全局序号，按到达顺序追加） */
export interface PushEvent {
  readonly flow: 'public' | 'personal';
  readonly type: string;
  readonly dayNumber: number;
  readonly stage: Stage;
  readonly payload: unknown;
}

/** UI 侧展示用的事件（公共流/个人流/复盘时间线通用） */
export interface DisplayEvent {
  readonly type: string;
  readonly dayNumber: number;
  readonly stage: Stage;
  readonly payload: unknown;
}

export interface ClientEvent {
  readonly cursor: number;
  readonly type: string;
  readonly dayNumber: number;
  readonly stage: Stage;
  readonly payload: unknown;
}

export interface LiveWindow {
  readonly id: string;
  readonly closesAt: number;
}

export interface ProposalView {
  readonly pool: 'death' | 'spirit' | 'joint';
  readonly activeMemberIds: readonly string[];
  readonly revision: number;
  readonly targetPlayerIds: readonly string[];
  readonly confirmedBy: readonly string[];
  readonly locked: boolean;
}

export interface SeatPublicView {
  readonly playerId: string;
  readonly seat: number;
  readonly nickname: string;
  readonly alive: boolean;
  readonly revealedRoleId: RoleId | null;
}

export interface SelfView {
  readonly playerId: string;
  readonly seat: number;
  readonly nickname: string;
  readonly roleId: RoleId;
  readonly life: LifeState;
  readonly revealed: boolean;
  readonly abilities: AbilityUsage;
  readonly guardHistory: readonly GuardRecord[];
  readonly voteFrozen: boolean;
}

export interface RoomMemberView {
  readonly playerId: string;
  readonly seat: number;
  readonly readOnly: boolean;
}

export interface FactionRoomView {
  readonly roomId: string;
  readonly readOnly: boolean;
  readonly canWrite: boolean;
  readonly historyFromSeq: number;
  readonly members: readonly RoomMemberView[];
}

export interface PlayerView {
  readonly gameId: string;
  readonly dayNumber: number;
  readonly phase: GamePhase;
  readonly stage: Stage;
  readonly self: SelfView;
  readonly seats: readonly SeatPublicView[];
  readonly room: FactionRoomView | null;
  readonly publicEvents: readonly ClientEvent[];
  readonly personalEvents: readonly ClientEvent[];
}

export interface GameHints {
  readonly sheriffSeat: number | null;
  readonly speakerSeat: number | null;
  readonly candidateSeats: readonly number[];
}

export type VoicePermissionReason =
  | 'speaker'
  | 'dead_listener'
  | 'night_silence'
  | 'vote_silence'
  | 'not_your_turn'
  | 'game_not_started'
  | 'game_ended';

export interface VoicePermission {
  readonly canPublish: boolean;
  readonly reason: VoicePermissionReason;
}

export interface VoiceView {
  readonly enabled: boolean;
  readonly permission: VoicePermission;
}

export interface VoiceTokenResponse {
  readonly url: string;
  readonly token: string;
  readonly roomName: string;
  readonly permission: VoicePermission;
}

export interface GameViewResponse {
  readonly phase: GamePhase;
  readonly rulesetMode: RulesetMode;
  readonly voice: VoiceView;
  readonly view: PlayerView;
  readonly proposal: ProposalView | null;
  readonly hints: GameHints;
  readonly windows: readonly LiveWindow[];
  readonly serverTime: number;
}

export interface LobbyMember {
  readonly playerId: string;
  readonly nickname: string;
  readonly ready: boolean;
  readonly isHost: boolean;
}

export type RulesetMode = 'formal' | 'experimental';

export interface LobbyView {
  readonly phase: 'lobby';
  readonly rulesetMode: RulesetMode;
  readonly requiredPlayers: number;
  readonly voice: { readonly enabled: boolean };
  readonly roomCode: string;
  readonly gameId: string;
  readonly you: {
    readonly playerId: string;
    readonly nickname: string;
    readonly ready: boolean;
    readonly isHost: boolean;
  };
  readonly members: readonly LobbyMember[];
}

export type ViewResponse = LobbyView | GameViewResponse;

export interface ChatMessage {
  readonly id: number;
  readonly channel: 'public' | 'faction';
  readonly senderId: string;
  readonly text: string;
  readonly at: number;
  readonly eventSeq: number;
}

export interface CommandReceipt {
  readonly requestId: string;
  readonly status: 'accepted' | 'rejected';
  readonly code: string | null;
  readonly message: string | null;
}

export interface ReviewPlayer {
  readonly playerId: string;
  readonly seat: number;
  readonly nickname: string;
  readonly roleId: RoleId;
  readonly life: 'alive' | 'dead';
  readonly revealed: boolean;
}

export interface ReviewTimelineEntry {
  readonly dayNumber: number;
  readonly stage: Stage;
  readonly type: string;
  readonly payload: unknown;
}

export interface ReviewChatEntry {
  readonly id: number;
  readonly senderId: string;
  readonly senderSeat: number | null;
  readonly text: string;
  readonly at: number;
}

export interface ReviewView {
  readonly gameId: string;
  readonly winner: 'human' | 'death_faction';
  readonly reason: string;
  readonly endedAtDay: number;
  readonly players: readonly ReviewPlayer[];
  readonly timeline: readonly ReviewTimelineEntry[];
  readonly chat: {
    readonly public: readonly ReviewChatEntry[];
    readonly faction: readonly ReviewChatEntry[];
  };
}
