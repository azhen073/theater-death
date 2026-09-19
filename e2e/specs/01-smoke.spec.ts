import { expect, test } from '@playwright/test';
import { setReady, setupLobby, startGame } from '../helpers/api.ts';
import { waitForChannelUser } from '../helpers/cloud.ts';
import { joinLobbyViaUi, joinVoiceViaUi, readyViaUi } from '../helpers/ui.ts';

test('容器冒烟：假麦克风可用 + 13 人开局 + 浏览器加入语音（媒体参与建立）', async ({ browser }) => {
  test.setTimeout(240_000);

  const lobby = await setupLobby({ prefix: '脚本', size: 12 });
  for (const client of lobby.clients) {
    await setReady(lobby.roomCode, client);
  }

  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  await joinLobbyViaUi(page, { nickname: '浏览器', roomCode: lobby.roomCode });

  // 先确认容器内浏览器具备安全上下文与虚拟麦克风（修复用：--unsafely-treat-insecure-origin-as-secure）
  const trackCount = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const count = stream.getAudioTracks().length;
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return count;
  });
  expect(trackCount).toBe(1);

  await readyViaUi(page);
  await startGame(lobby.roomCode, lobby.host);
  // 开局后进入夜间：页面出现「当前窗口」面板（夜间必有窗口进行中）
  await page.locator('.window').first().waitFor({ timeout: 20_000 });

  await joinVoiceViaUi(page);
  // 脚本玩家不加入语音：经声网 REST 查到的频道内用户即浏览器玩家
  const uid = await waitForChannelUser(lobby.gameId, { timeoutMs: 45_000 });
  expect(typeof uid).toBe('number');

  await page.screenshot({ path: 'results/artifacts/smoke-voice.png' });
  await context.close();
});
