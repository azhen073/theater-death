import { currentLastWordsSpeaker } from '../engine/day.ts';
import type { GameState } from '../engine/types.ts';
import type { PublicChatMode } from '../contracts/v2.ts';

/**
 * 公屏写权限策略：
 * - `legacy_day_only`：v1 入口的旧行为——仅白天存活玩家可写，死者仅本人遗言窗口可写（未选档位的旧房间）。
 * - `alive_only` / `everyone`：v2 房主建房时选择的档位，对局内**所有阶段**都可写；
 *   `alive_only` 下死者仍只读（本人遗言窗口除外，R-45），`everyone` 下死者同样可写。
 * 读取权限不在本函数内（R-35：公屏对全体正式玩家与观众都可读）。
 */
export type PublicChatPolicy = PublicChatMode | 'legacy_day_only';

export function canPostPublic(state: GameState, playerId: string, policy: PublicChatPolicy = 'legacy_day_only'): boolean {
  const player = state.players.find((item) => item.playerId === playerId);
  if (player === undefined) {
    return false;
  }
  if (policy === 'legacy_day_only' && state.phase !== 'day') {
    return false;
  }
  if (player.life !== 'dead') {
    return true;
  }
  if (policy === 'everyone') {
    return true;
  }
  return currentLastWordsSpeaker(state) === playerId;
}
