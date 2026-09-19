import type { GameEvent } from '../engine/events.ts';
import type { GameState, Stage } from '../engine/types.ts';
import type { FactionId, RoleId } from '../rulesets/types.ts';

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
  readonly messageId?: string;
  readonly senderId: string;
  readonly senderSeat: number | null;
  readonly text: string;
  readonly at: number;
}

export interface ReviewView {
  readonly gameId: string;
  readonly winner: FactionId;
  readonly reason: string;
  readonly endedAtDay: number;
  readonly players: readonly ReviewPlayer[];
  readonly timeline: readonly ReviewTimelineEntry[];
  readonly chat: {
    readonly public: readonly ReviewChatEntry[];
    readonly faction: readonly ReviewChatEntry[];
  };
}

/**
 * 终局复盘（R-53）：公开全部交流（公屏全文、阵营房全文，含死神加入前历史）、
 * 行动日志（时间线保留引擎事件）、全部身份与最终生命状态、胜负原因与每日时间线。
 * 仅对局终局后可用；不包含会话密钥、凭证或调试数据。
 */
export function buildReviewView(input: {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly messages: readonly {
    readonly id: number;
    readonly messageId?: string;
    readonly channel: string;
    readonly senderId: string;
    readonly text: string;
    readonly at: number;
  }[];
}): ReviewView | null {
  const win = input.state.win;
  if (win === null) {
    return null;
  }

  const players: readonly ReviewPlayer[] = input.state.players.map((player) => ({
    playerId: player.playerId,
    seat: player.seat,
    nickname: player.nickname,
    roleId: player.roleId,
    life: player.life === 'dead' ? 'dead' : 'alive',
    revealed: player.revealed,
  }));
  const seatById = new Map(players.map((player) => [player.playerId, player.seat]));

  const timeline: readonly ReviewTimelineEntry[] = input.events.map((event) => ({
    dayNumber: event.dayNumber,
    stage: event.stage,
    type: event.type,
    payload: event.payload,
  }));

  const publicChat: ReviewChatEntry[] = [];
  const factionChat: ReviewChatEntry[] = [];
  for (const message of input.messages) {
    const entry: ReviewChatEntry = {
      id: message.id,
      ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
      senderId: message.senderId,
      senderSeat: seatById.get(message.senderId) ?? null,
      text: message.text,
      at: message.at,
    };
    if (message.channel === 'faction') {
      factionChat.push(entry);
    } else {
      publicChat.push(entry);
    }
  }

  return {
    gameId: input.state.gameId,
    winner: win.winner,
    reason: win.reason,
    endedAtDay: win.dayNumber,
    players,
    timeline,
    chat: { public: publicChat, faction: factionChat },
  };
}
