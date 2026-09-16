import type { FactionId, RoleId, RulesetConfig } from '../rulesets/types.ts';

export type Stage = 1 | 2;

export type LifeState = 'alive' | 'dying' | 'dead';

export type GamePhase = 'night' | 'morning' | 'day' | 'ended';

export type AttackSourceRoleId = 'laike' | 'death' | 'spirit' | 'joint';

export type PrimaryCauseKind = 'direct_attack' | 'guard_sacrifice';

export type CheckKind = 'is_spirit' | 'in_death_faction';

export const FACTION_ROOM_ID = 'faction_room';

export interface DescenderCheckRecord {
  readonly actorId: string;
  readonly targetPlayerId: string;
  readonly kind: CheckKind;
  readonly answer: boolean;
}

export interface FactionRoomState {
  readonly roomId: string;
  readonly deathJoinDecided: boolean;
  readonly deathJoined: boolean;
  readonly deathReadOnly: boolean;
  readonly deathJoinedEventSeq: number | null;
}

export interface AbilityUsage {
  readonly laikeBladeUsed: boolean;
  readonly waterRescueUsed: boolean;
}

export interface GuardRecord {
  readonly nightNumber: number;
  readonly targetPlayerIds: readonly string[];
}

export interface PlayerState {
  readonly playerId: string;
  readonly seat: number;
  readonly nickname: string;
  readonly roleId: RoleId;
  readonly life: LifeState;
  readonly revealed: boolean;
  readonly abilities: AbilityUsage;
  readonly guardHistory: readonly GuardRecord[];
  readonly voteFrozen: boolean;
  readonly lastFatalCause: PrimaryCauseKind | null;
}

export interface SheriffState {
  readonly enabled: boolean;
  readonly holderId: string | null;
}

export interface AttackEvent {
  readonly eventId: string;
  readonly nightNumber: number;
  readonly sourceActionId: string;
  readonly sourceRoleId: AttackSourceRoleId;
  readonly targetPlayerId: string;
  readonly orderKey: string;
  readonly blocked: boolean;
}

export interface FatalRecord {
  readonly playerId: string;
  readonly nightNumber: number;
  readonly primaryFatalEventId: string | null;
  readonly primaryCauseKind: PrimaryCauseKind | null;
  readonly preventedByRescue: boolean;
  readonly committedAsDeath: boolean;
}

export interface GuardSelection {
  readonly nightNumber: number;
  readonly targetPlayerIds: readonly string[];
}

export interface RescueSelection {
  readonly targetPlayerId: string;
}

export interface NightContext {
  readonly nightNumber: number;
  readonly guardSelections: readonly GuardSelection[];
  readonly attacks: readonly AttackEvent[];
  readonly rescue: RescueSelection | null;
  readonly revive: { readonly actorId: string; readonly targetPlayerId: string } | null;
  readonly descenderCheck: DescenderCheckRecord | null;
  readonly fatalRecords: readonly FatalRecord[];
  readonly dyingSet: readonly string[];
  readonly deaths: readonly string[];
  readonly sacrificeTriggered: boolean;
}

export type DayStep =
  | 'first_night_last_words'
  | 'election'
  | 'speech_round'
  | 'vote'
  | 'elimination_last_words'
  | 'handover'
  | 'settle';

export type ElectionPhase = 'signup' | 'speech' | 'vote' | 'revote' | 'done';

export interface ElectionState {
  readonly phase: ElectionPhase;
  readonly candidates: readonly string[];
  readonly withdrawn: readonly string[];
  readonly speechOrder: readonly string[];
  readonly speechIndex: number;
  readonly round: 1 | 2;
  readonly votes: Readonly<Record<string, string | null>>;
  readonly tiedIds: readonly string[];
  readonly winnerId: string | null;
}

export interface SpeechRoundState {
  readonly order: readonly string[];
  readonly index: number;
  readonly designatedBy: string | null;
  readonly startSeat: number;
  readonly direction: 'asc' | 'desc';
}

export type BallotPhase = 'vote' | 'tie_speech' | 'revote' | 'done';

export interface BallotState {
  readonly phase: BallotPhase;
  readonly round: 1 | 2;
  readonly votes: Readonly<Record<string, string | null>>;
  readonly tiedIds: readonly string[];
  readonly tieSpeechIndex: number;
  readonly eliminatedId: string | null;
}

export interface HandoverState {
  readonly deadSheriffId: string;
  readonly resolved: boolean;
  readonly heirId: string | null;
}

export interface PacedQueue {
  readonly queue: readonly string[];
  readonly index: number;
}

export interface DayContext {
  readonly dayNumber: number;
  readonly step: DayStep;
  readonly lastWordsScope: 'first_night' | 'elimination' | null;
  readonly lastWords: PacedQueue | null;
  readonly election: ElectionState | null;
  readonly speechRound: SpeechRoundState | null;
  readonly ballot: BallotState | null;
  readonly eliminatedIds: readonly string[];
  readonly handover: HandoverState | null;
}

export interface WinResult {
  readonly winner: FactionId;
  readonly dayNumber: number;
  readonly reason: string;
}

export interface GameState {
  readonly gameId: string;
  readonly ruleset: RulesetConfig;
  readonly seed: number;
  readonly dayNumber: number;
  readonly phase: GamePhase;
  readonly stage: Stage;
  readonly nightStage: Stage;
  readonly players: readonly PlayerState[];
  readonly sheriff: SheriffState;
  readonly night: NightContext | null;
  readonly day: DayContext | null;
  readonly factionRoom: FactionRoomState;
  readonly stage1AttackDisabled: boolean;
  readonly win: WinResult | null;
  readonly eventSeq: number;
}
