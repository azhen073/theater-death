import { expect, test } from '@playwright/test';
import { api, joinRoom } from '../helpers/api.ts';
import { createRoomViaUi } from '../helpers/ui.ts';

function errorCode(body: Record<string, unknown>): unknown {
  return (body.error as { code?: unknown } | undefined)?.code;
}

/**
 * 用例：大厅期房主解散房间（v1 语义）——房主点「解散房间」并确认后整房销毁：
 * 房主回入口页、其余成员会话失效（房间不存在）、房间码失效无法重新加入。
 */
test('大厅期房主解散房间：房主回入口页、其余成员会话失效、房间码失效', async ({ browser }) => {
  test.setTimeout(120_000);

  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  // web/src/app.tsx 用 window.confirm('确定解散房间？所有成员将回到入口页。') 二次确认
  hostPage.on('dialog', (dialog) => void dialog.accept());
  const roomCode = await createRoomViaUi(hostPage, '房主');

  // 另一名正式成员（API 会话，用于断言解散后会话失效）
  const member = await joinRoom(roomCode, '玩家2');
  await expect(hostPage.locator('.members li')).toHaveCount(2, { timeout: 15_000 });
  await expect(hostPage.getByRole('button', { name: '解散房间', exact: true })).toBeVisible();
  await hostPage.screenshot({ path: 'results/artifacts/dissolve-before.png', fullPage: true });

  await hostPage.getByRole('button', { name: '解散房间', exact: true }).click();

  // 房主回到入口页（解散成功即清会话 cookie）
  await hostPage.getByRole('button', { name: '创建房间', exact: true }).waitFor({ timeout: 20_000 });
  await hostPage.screenshot({ path: 'results/artifacts/dissolve-after.png', fullPage: true });

  // 其余成员：房间已不存在 → 会话失效
  const memberView = await api.get('/api/view', member.cookie);
  expect(memberView.status).toBe(404);
  expect(errorCode(memberView.json)).toBe('room_not_found');

  // 房间码失效：无法重新加入
  const rejoin = await api.post(`/api/rooms/${roomCode}/join`, { nickname: '新来的' });
  expect(rejoin.status).toBe(404);
  expect(errorCode(rejoin.json)).toBe('room_not_found');

  await hostContext.close();
});
