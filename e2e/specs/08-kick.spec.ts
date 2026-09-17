import { expect, test } from '@playwright/test';
import { api, joinRoom, watchRoom } from '../helpers/api.ts';
import { createRoomViaUi, joinLobbyViaUi } from '../helpers/ui.ts';

function errorCode(body: Record<string, unknown>): unknown {
  return (body.error as { code?: unknown } | undefined)?.code;
}

/**
 * 用例一：大厅期房主移出成员——界面按钮、被移出者自动回入口页、可重新加入（踢人 = 清位）。
 */
test('大厅期房主移出成员：对方回入口页、可重新加入', async ({ browser }) => {
  test.setTimeout(120_000);
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  hostPage.on('dialog', (dialog) => void dialog.accept());
  const roomCode = await createRoomViaUi(hostPage, '房主');

  // 玩家2 走界面加入（用于验证被移出后的界面表现）
  const p2Context = await browser.newContext();
  const p2Page = await p2Context.newPage();
  await joinLobbyViaUi(p2Page, { nickname: '玩家2', roomCode });

  await expect(hostPage.locator('.members li')).toHaveCount(2, { timeout: 15_000 });
  await expect(hostPage.getByRole('button', { name: '移出' })).toHaveCount(1);

  await hostPage
    .locator('.members li', { hasText: '玩家2' })
    .getByRole('button', { name: '移出' })
    .click();

  // 房主侧：成员消失，自己那行始终没有移出按钮
  await expect(hostPage.locator('.members li')).toHaveCount(1, { timeout: 15_000 });
  await expect(hostPage.getByRole('button', { name: '移出' })).toHaveCount(0);
  await hostPage.screenshot({ path: 'results/artifacts/kick-lobby.png', fullPage: true });

  // 被移出侧：轮询内回到入口页并显示提示
  await p2Page.getByRole('button', { name: '创建房间' }).waitFor({ timeout: 20_000 });
  await expect(p2Page.getByText('你已不在该房间中')).toBeVisible();

  // 可重新加入
  await joinLobbyViaUi(p2Page, { nickname: '玩家2', roomCode });
  await hostPage.locator('.members li', { hasText: '玩家2' }).waitFor({ timeout: 15_000 });

  await hostContext.close();
  await p2Context.close();
});

/**
 * 用例二：大厅期房主移出观战者——观战行消失、观众会话失效。
 */
test('大厅期房主移出观战者：观众会话失效、成员行观战标记消失', async ({ browser }) => {
  test.setTimeout(120_000);
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  hostPage.on('dialog', (dialog) => void dialog.accept());
  const roomCode = await createRoomViaUi(hostPage, '房主');

  const p2 = await joinRoom(roomCode, '玩家2');
  const spectator = await watchRoom(roomCode, '观众', p2.playerId);

  // 房主界面：玩家2 行下方出现观战行
  const spectatorRow = hostPage.locator('.members li.spectator-row', { hasText: '观众' });
  await spectatorRow.waitFor({ timeout: 15_000 });
  await expect(spectatorRow).toContainText('观战：观众');
  await hostPage.screenshot({ path: 'results/artifacts/kick-spectator.png', fullPage: true });

  await spectatorRow.getByRole('button', { name: '移出' }).click();

  await expect(hostPage.locator('.members li.spectator-row')).toHaveCount(0, { timeout: 15_000 });
  const spectatorView = await api.get('/api/view', spectator.cookie);
  expect(spectatorView.status).toBe(403);
  expect(errorCode(spectatorView.json)).toBe('not_member');

  // 被绑定玩家仍在房间里
  await expect(hostPage.locator('.members li', { hasText: '玩家2' })).toBeVisible();

  await hostContext.close();
});
