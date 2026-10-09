import { randomBytes } from 'node:crypto';
import type { MemberKind, Presence, PublicChatMode, RoomPhase, SubmissionDTO } from '../../contracts/v2.ts';
import type { RulesetConfig } from '../../rulesets/types.ts';
import { ROLE_IDS } from '../../rulesets/types.ts';
import type { Clock } from '../clock.ts';
import type { LogStore } from '../log-store.ts';
import type { Room, RoomRegistry } from '../rooms.ts';
import { ReceiptStore } from '../receipts.ts';
import type { AccountStore } from './account-store.ts';
import { RoomAccess } from './access.ts';
import { roomVoiceChannel } from './room-voice.ts';
import { ApiError } from './errors.ts';
import { ChatReceipts } from './chat-receipts.ts';

export const newId = (prefix: string) => `${prefix}_${randomBytes(16).toString('hex')}`;
export interface ActiveMember {
  memberId: string;
  userId: string;
  uid: string;
  nickname: string;
  kind: MemberKind;
  joinedAt: number;
  joinedOrder: number;
  ready: boolean;
  sessionId: string | null;
  epoch: string;
  presence: Presence;
  connections: Set<string>;
  disconnectAt: number | null;
}
export interface Participant { userId: string; uid: string; memberId: string; playerId: string; nickname: string }
export interface StableRoomDeps {
  clock: Clock;
  accounts: AccountStore;
  logStore: LogStore;
  registry: RoomRegistry;
  revokeMedia: (channel: string, identity: string) => void;
  /** 关闭某个语音频道（开局时用于关掉大厅/复盘的房间频道，Q-12）。 */
  closeRoomVoice?: (channel: string) => void;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Room lifetime is independent of its current match. Call mutation methods inside enqueue. */
export class StableRoom {
  readonly roomId = newId('r');
  readonly code: string;
  readonly createdAt: number;
  readonly ruleset: RulesetConfig;
  /** 建房时房主显式选择的公屏写权限档位；房间生命周期内不可改（与角色组成同规则）。 */
  readonly publicChat: PublicChatMode;
  readonly members = new Map<string, ActiveMember>(); // account -> current membership
  readonly participants = new Map<string, Participant>(); // account -> frozen current-match seat
  hostMemberId: string | null = null;
  runtime: Room | null = null;
  matchStartedAt: number | null = null;
  matchEndedAt: number | null = null;
  access: RoomAccess | null = null;
  receipts = new ReceiptStore();
  chatReceipts = new ChatReceipts();
  readonly submissions = new Map<string, Map<string, SubmissionDTO>>();
  emptyDeadline: number | null = null;
  /** 全员离线起点（有正式成员但无人在线时记录）；任一人回到在线即清空。 */
  allOfflineSince: number | null = null;
  dissolved = false;
  nextJoinOrder = 1;
  readonly deps: StableRoomDeps;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(code: string, ruleset: RulesetConfig, publicChat: PublicChatMode, deps: StableRoomDeps) {
    this.code = code; this.ruleset = freeze(structuredClone(ruleset)); this.publicChat = publicChat; this.deps = deps;
    this.createdAt = deps.clock.now();
    deps.logStore.recordPersistentRoom({ roomId: this.roomId, code, createdAt: this.createdAt, ruleset: this.ruleset });
  }
  enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.then(() => undefined, () => undefined);
    return next;
  }
  get gameId(): string | null { return this.runtime?.gameId ?? null; }
  get phase(): RoomPhase { return this.runtime === null ? 'lobby' : this.runtime.state?.win ? 'review' : 'playing'; }
  formalMembers(): ActiveMember[] { return [...this.members.values()].filter((m) => m.kind === 'formal').sort((a, b) => a.joinedOrder - b.joinedOrder); }
  requiredPlayers(): number { return ROLE_IDS.reduce((n, role) => n + this.ruleset.roles[role], 0); }
  startMatch(): Room {
    if (this.runtime) throw new ApiError(409, 'game_started');
    const members = this.formalMembers();
    if (members.length !== this.requiredPlayers()) throw new ApiError(409, 'room_not_full');
    if (members.some((m) => !m.ready)) throw new ApiError(409, 'not_ready');
    const runtime = this.deps.registry.createMatch(this.code, members.map((m) => ({ nickname: m.nickname })), this.ruleset, this);
    // 开局即关掉房间频道（大厅/复盘语音）：避免带着大厅发布凭证进入对局频道之外。
    this.deps.closeRoomVoice?.(roomVoiceChannel(this.roomId));
    this.runtime = runtime;
    this.matchStartedAt = this.deps.clock.now(); this.matchEndedAt = null;
    this.receipts = new ReceiptStore();
    this.chatReceipts = new ChatReceipts();
    this.submissions.clear();
    this.participants.clear();
    const access = new RoomAccess(runtime, this.deps.accounts, () => this.deps.clock.now(), (identity) => this.deps.revokeMedia(runtime.gameId, identity));
    this.access = access;
    for (let i = 0; i < members.length; i++) {
      const member = members[i]!; const playerId = runtime.members[i]!.playerId;
      this.participants.set(member.userId, { userId: member.userId, uid: member.uid, memberId: member.memberId, playerId, nickname: member.nickname });
      access.seats.set(playerId, { userId: member.userId, sessionId: member.sessionId, epoch: member.epoch });
    }
    for (const member of this.members.values()) if (member.kind !== 'formal' && member.sessionId && this.deps.accounts.sessionActive(member.sessionId)) {
      access.watch({ id: member.sessionId, userId: member.userId, expiresAt: Number.MAX_SAFE_INTEGER });
    }
    this.deps.logStore.recordMatch({ roomId: this.roomId, gameId: runtime.gameId, startedAt: this.matchStartedAt });
    this.deps.registry.startGame(runtime);
    return runtime;
  }
  recordCompletion(): void {
    if (this.runtime?.state?.win) {
      this.matchEndedAt ??= this.deps.clock.now();
      this.deps.logStore.finishMatch(this.runtime.gameId, 'completed', this.matchEndedAt);
    }
  }
  rememberSubmission(playerId: string, submission: SubmissionDTO): void {
    const entries = this.submissions.get(playerId) ?? new Map<string, SubmissionDTO>();
    const open = new Set(this.runtime?.driver?.windows().map((w) => w.instanceId) ?? []);
    for (const [key, value] of entries) if (!open.has(value.windowInstanceId)) entries.delete(key);
    if (open.has(submission.windowInstanceId)) entries.set(JSON.stringify([submission.windowInstanceId, submission.action]), structuredClone(submission));
    this.submissions.set(playerId, entries);
  }
  activeSubmissions(playerId: string): SubmissionDTO[] {
    const open = new Set(this.runtime?.driver?.windows().map((w) => w.instanceId) ?? []);
    return [...(this.submissions.get(playerId)?.values() ?? [])].filter((s) => open.has(s.windowInstanceId));
  }
}
