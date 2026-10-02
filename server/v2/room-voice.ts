import type { MemberKind, RoomPhase } from '../../contracts/v2.ts';

/**
 * 房间级语音（Q-12）：大厅与复盘的自由开麦。
 *
 * 对局语音的频道名是 `gameId`（每局一个，局末关闭）；而大厅/复盘**根本还没有 playerId**
 * （seat 与 playerId 都在开局洗牌时才产生），对局频道也不存在。因此这里给出一个
 * 独立于任何一局的房间频道，以及房间频道里的语音主体 = `memberId`。
 */

/** 房间频道名：与对局频道（`g_...`）互不冲突，长度也满足声网频道名限制。 */
export const roomVoiceChannel = (roomId: string): string => `l_${roomId}`;

/** 对局外的相位（大厅 / 复盘）走房间频道；对局内走对局频道。 */
export const isRoomVoicePhase = (phase: RoomPhase): boolean => phase !== 'playing';

/** 房间频道的媒体身份（与 `RoomAccess.mediaId` 同构，主体换成 memberId）。 */
export const roomVoiceIdentity = (channel: string, member: RoomVoiceSubject): string => `v2:${channel}:${member.memberId}:${member.epoch}`;

export interface RoomVoiceSubject {
  readonly memberId: string;
  readonly epoch: string;
  readonly sessionId: string | null;
  readonly kind: MemberKind;
}

/**
 * 房间频道的身份表：正式成员可发布，观众与第二屏只订阅。
 * 离线成员不入表（其旧身份也不在表内，`sync` 会把它踢出频道）；epoch 变化即视为新身份。
 */

/** 房间频道范围所需的最小信息：房间 id + 成员表（`StableRoom` 结构上即可满足）。 */
export interface RoomVoiceSource {
  readonly roomId: string;
  readonly members: ReadonlyMap<string, RoomVoiceSubject>;
}
export function roomVoiceMembers(channel: string, members: Iterable<RoomVoiceSubject>): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const member of members) {
    if (member.sessionId === null) continue;
    result.set(roomVoiceIdentity(channel, member), member.kind === 'formal');
  }
  return result;
}
