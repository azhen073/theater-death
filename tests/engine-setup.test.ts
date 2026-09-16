import { describe, expect, it } from 'vitest';
import { createGame } from '../engine/setup.ts';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import { ROLE_IDS, type RoleId } from '../rulesets/types.ts';

const testPlayers = Array.from({ length: 13 }, (_, index) => ({
  playerId: `p_${index + 1}`,
  nickname: `玩家${index + 1}`,
}));

function createTestGame(seed = 7) {
  return createGame({ gameId: 'g_test', ruleset: THEATER_DEATH_13, players: testPlayers, seed });
}

describe('开局分配', () => {
  it('T-01：13 个唯一席位，9 种身份人数逐项一致', () => {
    const { state } = createTestGame();
    expect(state.players).toHaveLength(13);
    expect(new Set(state.players.map((player) => player.seat)).size).toBe(13);

    const counts: Partial<Record<RoleId, number>> = {};
    for (const player of state.players) {
      counts[player.roleId] = (counts[player.roleId] ?? 0) + 1;
    }
    expect(counts).toEqual({ ...THEATER_DEATH_13.roles });
  });

  it('相同种子分配结果完全一致，可用于复现', () => {
    const first = createTestGame(99);
    const second = createTestGame(99);
    expect(first.state.players).toEqual(second.state.players);
  });

  it('初始状态：全员存活、未翻牌、无天理、无胜负、第一夜', () => {
    const { state } = createTestGame();
    expect(state.players.every((player) => player.life === 'alive')).toBe(true);
    expect(state.players.every((player) => !player.revealed)).toBe(true);
    expect(state.sheriff.holderId).toBeNull();
    expect(state.win).toBeNull();
    expect(state.phase).toBe('night');
    expect(state.dayNumber).toBe(1);
    expect(state.stage).toBe(1);
  });

  it('身份事件只发给本人；公共事件不含任何角色信息', () => {
    const { events } = createTestGame();

    const roleEvents = events.filter((event) => event.type === 'role_assigned');
    expect(roleEvents).toHaveLength(13);
    for (const event of roleEvents) {
      expect(event.visibility.kind).toBe('players');
      const payload = event.payload as { playerId: string };
      if (event.visibility.kind === 'players') {
        expect(event.visibility.playerIds).toEqual([payload.playerId]);
      }
    }

    const started = events.find((event) => event.type === 'game_started');
    expect(started).toBeDefined();
    expect(started?.visibility).toEqual({ kind: 'public' });
    const serialized = JSON.stringify(started?.payload);
    for (const roleId of ROLE_IDS) {
      expect(serialized).not.toContain(roleId);
    }
  });

  it('玩家数与角色总数不一致时拒绝开局', () => {
    expect(() =>
      createGame({
        gameId: 'g_bad',
        ruleset: THEATER_DEATH_13,
        players: testPlayers.slice(0, 12),
        seed: 1,
      }),
    ).toThrow();
  });

  it('重复 playerId 被拒绝', () => {
    const duplicated = [...testPlayers.slice(0, 12), { playerId: 'p_1', nickname: '重复' }];
    expect(() =>
      createGame({ gameId: 'g_bad2', ruleset: THEATER_DEATH_13, players: duplicated, seed: 1 }),
    ).toThrow();
  });
});
