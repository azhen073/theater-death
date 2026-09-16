import { ROLE_DEFINITIONS } from '../rulesets/roles.ts';
import type { GameState, WinResult } from './types.ts';

export function checkVictory(state: GameState): WinResult | null {
  const players = state.players;

  const researcher = players.find((player) => player.roleId === 'researcher');
  const researcherDead = researcher !== undefined && researcher.life === 'dead';

  const deities = players.filter((player) => ROLE_DEFINITIONS[player.roleId].eliminationGroup === 'deity');
  const civilians = players.filter(
    (player) => ROLE_DEFINITIONS[player.roleId].eliminationGroup === 'civilian',
  );
  const allDeitiesDead = deities.length > 0 && deities.every((player) => player.life === 'dead');
  const allCiviliansDead = civilians.length > 0 && civilians.every((player) => player.life === 'dead');

  const humanWinTargets = players.filter((player) => ROLE_DEFINITIONS[player.roleId].countsForHumanWin);
  const humanWins = humanWinTargets.length > 0 && humanWinTargets.every((player) => player.life === 'dead');

  const deathWins = researcherDead && (allDeitiesDead || allCiviliansDead);

  if (deathWins) {
    const wiped = allDeitiesDead ? '神职' : '平民';
    return {
      winner: 'death_faction',
      dayNumber: state.dayNumber,
      reason: `科研员当前死亡，且所有${wiped}已全部出局`,
    };
  }
  if (humanWins) {
    return {
      winner: 'human',
      dayNumber: state.dayNumber,
      reason: '死神与魂灵已全部出局',
    };
  }
  return null;
}
