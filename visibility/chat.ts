import { currentLastWordsSpeaker } from '../engine/day.ts';
import type { GameState } from '../engine/types.ts';

/** 公屏文字：白天存活玩家可发送；遗言窗口内的出局者可发送（R-35、R-45）；夜间全体禁发 */
export function canPostPublic(state: GameState, playerId: string): boolean {
  const player = state.players.find((item) => item.playerId === playerId);
  if (player === undefined) {
    return false;
  }
  if (state.phase !== 'day') {
    return false;
  }
  if (player.life !== 'dead') {
    return true;
  }
  return currentLastWordsSpeaker(state) === playerId;
}
