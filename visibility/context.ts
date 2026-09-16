import { ROLE_DEFINITIONS } from '../rulesets/roles.ts';
import type { FactionId, RoleId } from '../rulesets/types.ts';
import type { GameState, LifeState } from '../engine/types.ts';

export interface ViewerContext {
  readonly playerId: string;
  readonly seat: number;
  readonly roleId: RoleId;
  readonly factionId: FactionId;
  readonly life: LifeState;
}

export function viewerContext(state: GameState, playerId: string): ViewerContext | null {
  const player = state.players.find((item) => item.playerId === playerId);
  if (player === undefined) {
    return null;
  }
  return {
    playerId: player.playerId,
    seat: player.seat,
    roleId: player.roleId,
    factionId: ROLE_DEFINITIONS[player.roleId].factionId,
    life: player.life,
  };
}
