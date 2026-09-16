import type { GameEvent } from '../engine/events.ts';
import type {
  AbilityUsage,
  GamePhase,
  GameState,
  GuardRecord,
  LifeState,
  Stage,
} from '../engine/types.ts';
import type { RoleId } from '../rulesets/types.ts';
import { viewerContext, type ViewerContext } from './context.ts';
import { filterVisible } from './deliver.ts';
import { factionRoomView, type FactionRoomView } from './rooms.ts';

/**
 * 对外事件：使用每条流自己的连续游标，不暴露全局事件序号与隐藏事件计数（需求 §07 侧信道）。
 */
export interface ClientEvent {
  readonly cursor: number;
  readonly type: string;
  readonly dayNumber: number;
  readonly stage: Stage;
  readonly payload: unknown;
}

export interface SeatPublicView {
  readonly playerId: string;
  readonly seat: number;
  readonly nickname: string;
  /** 濒死对外视为存活：公开界面不得提前展示"某人已濒死" */
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

export interface PlayerView {
  readonly gameId: string;
  readonly dayNumber: number;
  readonly phase: GamePhase;
  readonly stage: Stage;
  readonly self: SelfView;
  readonly seats: readonly SeatPublicView[];
  /** 仅阵营房成员可见；非成员为 null（不透露房间存在细节） */
  readonly room: FactionRoomView | null;
  readonly publicEvents: readonly ClientEvent[];
  readonly personalEvents: readonly ClientEvent[];
}

function toClientEvents(events: readonly GameEvent[]): ClientEvent[] {
  return events.map((event, index) => ({
    cursor: index + 1,
    type: event.type,
    dayNumber: event.dayNumber,
    stage: event.stage,
    payload: event.payload,
  }));
}

/** 公共事件流：全员一致，独立游标从 1 起 */
export function publicEventLog(events: readonly GameEvent[]): ClientEvent[] {
  return toClientEvents(events.filter((event) => event.visibility.kind === 'public'));
}

/** 个人事件流：本人可见的定向事件，独立游标从 1 起（刷新按此恢复历史） */
export function personalEventLog(
  events: readonly GameEvent[],
  viewer: ViewerContext,
): ClientEvent[] {
  return toClientEvents(
    filterVisible(events, viewer).filter((event) => event.visibility.kind !== 'public'),
  );
}

export function buildPlayerView(input: {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly playerId: string;
}): PlayerView {
  const { state, events, playerId } = input;
  const viewer = viewerContext(state, playerId);
  if (viewer === null) {
    throw new Error(`未知玩家 ${playerId}`);
  }
  const me = state.players.find((player) => player.playerId === playerId);
  if (me === undefined) {
    throw new Error(`未知玩家 ${playerId}`);
  }

  return {
    gameId: state.gameId,
    dayNumber: state.dayNumber,
    phase: state.phase,
    stage: state.stage,
    self: {
      playerId: me.playerId,
      seat: me.seat,
      nickname: me.nickname,
      roleId: me.roleId,
      life: me.life,
      revealed: me.revealed,
      abilities: me.abilities,
      guardHistory: me.guardHistory,
      voteFrozen: me.voteFrozen,
    },
    seats: state.players
      .slice()
      .sort((left, right) => left.seat - right.seat)
      .map((player) => ({
        playerId: player.playerId,
        seat: player.seat,
        nickname: player.nickname,
        alive: player.life !== 'dead',
        revealedRoleId: player.revealed ? player.roleId : null,
      })),
    room: factionRoomView(state, playerId),
    publicEvents: publicEventLog(events),
    personalEvents: personalEventLog(events, viewer),
  };
}
