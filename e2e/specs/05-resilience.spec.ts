import { expect, test, type Browser } from '@playwright/test';
import { createRoom, joinRoom, setReady, startGame } from '../helpers/api.ts';
import { joinLobbyViaUi, readyViaUi } from '../helpers/ui.ts';
import { FAST_BOARD } from '../helpers/board.ts';

async function setupOneBrowserGame(browser: Browser) {
  const host = await createRoom({ nickname: '房主', ruleset: FAST_BOARD });
  for (let index = 2; index <= 12; index += 1) {
    const filler = await joinRoom(host.roomCode, `脚本${index}`);
    await setReady(host.roomCode, filler);
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await joinLobbyViaUi(page, { nickname: '重连者', roomCode: host.roomCode });
  await readyViaUi(page);
  await setReady(host.roomCode, host.client);
  await startGame(host.roomCode, host.client);
  await page.locator('.window').first().waitFor({ timeout: 20_000 });
  return { host, context, page };
}

test('刷新恢复：会话保持、对局界面与服务端对账', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await setupOneBrowserGame(browser);

  // 记录刷新前的身份信息
  const identityBefore = await page.locator('section.card.identity').innerText();

  await page.reload();
  await page.locator('.window').first().waitFor({ timeout: 20_000 });
  const identityAfter = await page.locator('section.card.identity').innerText();
  expect(identityAfter).toBe(identityBefore);

  // 座次仍在（13 行）
  await expect(page.locator('.seats .seat')).toHaveCount(13);

  await context.close();
});

test('断网恢复：实时推送重新连通（倒计时继续推进）', async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await setupOneBrowserGame(browser);

  const windowsText = async (): Promise<string> =>
    page.locator('section.card:has-text("当前窗口") .windows').innerText();

  await context.setOffline(true);
  await page.waitForTimeout(5_000);
  await context.setOffline(false);
  await page.waitForTimeout(3_000);

  // 恢复后：窗口倒计时仍在变化（socket 已重连、服务端推送恢复）
  const first = await windowsText();
  await page.waitForTimeout(4_000);
  const second = await windowsText();
  expect(second).not.toBe(first);
  expect(second).toMatch(/\d{2}:\d{2}/);

  await context.close();
});
