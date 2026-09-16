import type { GameState, PlayerState } from '../engine/types.ts';

export interface RoomMembership {
  readonly roomId: string;
  readonly readOnly: boolean;
  readonly canWrite: boolean;
  /** 该成员可见的房间历史起点：只显示 seq 大于该值的消息（R-52 不含加入前内容） */
  readonly historyFromSeq: number;
}

function membershipOf(state: GameState, player: PlayerState): RoomMembership | null {
  const roomId = state.factionRoom.roomId;
  if (player.roleId === 'spirit') {
    const dead = player.life === 'dead';
    return { roomId, readOnly: dead, canWrite: !dead, historyFromSeq: 0 };
  }
  if (player.roleId === 'death' && state.factionRoom.deathJoined) {
    const readOnly = state.factionRoom.deathReadOnly || player.life === 'dead';
    return {
      roomId,
      readOnly,
      canWrite: !readOnly,
      historyFromSeq: state.factionRoom.deathJoinedEventSeq ?? 0,
    };
  }
  return null;
}

export function roomMembership(state: GameState, playerId: string): RoomMembership | null {
  const player = state.players.find((item) => item.playerId === playerId);
  return player === undefined ? null : membershipOf(state, player);
}

/** 房间消息可见性：仅成员，且消息序号在加入之后（R-52） */
export function canReadRoomMessage(
  state: GameState,
  playerId: string,
  messageSeq: number,
): boolean {
  const membership = roomMembership(state, playerId);
  if (membership === null) {
    return false;
  }
  return messageSeq > membership.historyFromSeq;
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

export function factionRoomView(state: GameState, playerId: string): FactionRoomView | null {
  const membership = roomMembership(state, playerId);
  if (membership === null) {
    return null;
  }
  const members = state.players
    .filter((player) => membershipOf(state, player) !== null)
    .sort((left, right) => left.seat - right.seat)
    .map((player) => {
      const member = membershipOf(state, player);
      return {
        playerId: player.playerId,
        seat: player.seat,
        readOnly: member?.readOnly ?? false,
      };
    });
  return {
    roomId: membership.roomId,
    readOnly: membership.readOnly,
    canWrite: membership.canWrite,
    historyFromSeq: membership.historyFromSeq,
    members,
  };
}
