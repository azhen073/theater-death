import { expect, test } from '@playwright/test';
import { getView, setReady, setupLobby, startGame } from '../helpers/api.ts';
import { waitFor } from '../helpers/cloud.ts';
import { FAST_BOARD } from '../helpers/board.ts';

interface ViewShape {
  phase: string;
  serverTime: number;
  windows: Array<{ id: string; closesAt: number }>;
  view: {
    self: { playerId: string; roleId: string };
    seats: Array<Record<string, unknown>>;
    publicEvents: unknown[];
  };
}

test('泄漏检查：窗口时长与个人身份无关、未翻牌身份不外泄、私密行动不入公开流', async () => {
  test.setTimeout(120_000);

  const lobby = await setupLobby({ ruleset: FAST_BOARD });
  for (const client of lobby.clients) {
    await setReady(lobby.roomCode, client);
  }
  await startGame(lobby.roomCode, lobby.host);

  // 进入夜间（首夜开始，尚无翻牌）
  await waitFor(
    async () => {
      const view = await getView(lobby.host);
      return view.phase === 'night' ? view : false;
    },
    { label: '进入夜间', timeoutMs: 15_000 },
  );

  const views: ViewShape[] = [];
  for (const client of lobby.clients) {
    views.push((await getView(client)) as unknown as ViewShape);
  }

  // 1) 同一窗口对所有玩家的 closesAt 完全一致（公开时间不随个人状态变化）
  const byWindow = new Map<string, Set<number>>();
  for (const view of views) {
    for (const window of view.windows) {
      const set = byWindow.get(window.id) ?? new Set<number>();
      set.add(window.closesAt);
      byWindow.set(window.id, set);
    }
  }
  for (const [id, closes] of byWindow) {
    expect(closes.size, `窗口 ${id} 的 closesAt 在不同玩家间不一致`).toBe(1);
  }

  // 2) 他人身份不外泄：未翻牌玩家的 revealedRoleId 均为 null，且座位投影无 roleId 键
  for (const view of views) {
    for (const seat of view.view.seats) {
      const seatRecord = seat as { playerId: string; revealedRoleId: string | null };
      if (seatRecord.playerId !== view.view.self.playerId) {
        expect(seatRecord.revealedRoleId, `${seatRecord.playerId} 的身份泄露`).toBeNull();
      }
      expect(Object.keys(seat), '座位投影不应携带 roleId 键').not.toContain('roleId');
    }
  }

  // 3) 公开事件流不含身份/私密行动字段（时机为首夜开始，尚未翻牌）
  for (const view of views) {
    const publicJson = JSON.stringify(view.view.publicEvents);
    expect(publicJson).not.toContain('"roleId"');
    expect(publicJson).not.toContain('"guardHistory"');
    expect(publicJson).not.toContain('"abilities"');
    expect(publicJson).not.toContain('revealedRoleId');
  }

  // 每个玩家自己能看到自己的角色（对照：授权数据在）
  for (const view of views) {
    expect(view.view.self.roleId.length).toBeGreaterThan(0);
  }
});
