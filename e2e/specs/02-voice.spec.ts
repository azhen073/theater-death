import { expect, test } from '@playwright/test';
import { setReady, setupLobby, startGame } from '../helpers/api.ts';
import { fetchUserStatus, waitForChannelUser } from '../helpers/cloud.ts';
import { joinLobbyViaUi, joinVoiceViaUi, readyViaUi } from '../helpers/ui.ts';
import { VOICE_BOARD } from '../helpers/board.ts';

/**
 * 声网模式下没有"媒体侧发流状态/发布权限"的查询接口（权限编码在 token 中，仅能由 SDK 行为体现），
 * 因此语音用例的断言来自：① 频道在线状态（声网 REST）；② 界面许可文案与错误提示。
 */
test('发言轮开麦：授权后进入可发言状态且无麦克风错误，发言结束权限收回', async ({ browser }) => {
  test.setTimeout(300_000);

  const lobby = await setupLobby({ ruleset: VOICE_BOARD, prefix: '脚本', size: 12 });
  for (const client of lobby.clients) {
    await setReady(lobby.roomCode, client);
  }

  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  await joinLobbyViaUi(page, { nickname: '浏览器', roomCode: lobby.roomCode });
  await readyViaUi(page);
  await startGame(lobby.roomCode, lobby.host);
  await page.locator('.window').first().waitFor({ timeout: 20_000 });
  await joinVoiceViaUi(page);

  const uid = await waitForChannelUser(lobby.gameId);

  // 竞选报名（等待报名窗口出现）
  const signup = page.getByRole('button', { name: '报名竞选天理' });
  await signup.waitFor({ timeout: 90_000 });
  await signup.click();
  // 命令受理确认（窗口可能在点击后很快关闭，「退出竞选」不一定可见）
  await page.getByText('已提交').first().waitFor({ timeout: 10_000 });

  // 竞选发言轮轮到自己（唯一候选人）
  const endSpeech = page.getByRole('button', { name: '结束发言' });
  await endSpeech.waitFor({ timeout: 60_000 });

  // 核心断言：发布授权生效后界面进入可发言状态，且未卡在"正在启用麦克风"或错误
  await expect(page.getByText(/轮到你发言/).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('正在启用麦克风…')).toBeHidden({ timeout: 25_000 });
  await expect(page.getByText(/麦克风启用失败/)).toHaveCount(0);
  const online = await fetchUserStatus(lobby.gameId, uid);
  expect(online.inChannel).toBe(true);

  // 结束发言 → 权限收回（界面回到禁麦提示）
  await endSpeech.click();
  await expect(page.getByText('当前不是你的发言时间').first()).toBeVisible({ timeout: 30_000 });

  await page.screenshot({ path: 'results/artifacts/voice-speech.png' });
  await context.close();
});

test('夜间全体禁麦：界面提示静音、无麦克风错误且保持频道连接', async ({ browser }) => {
  test.setTimeout(240_000);

  const lobby = await setupLobby({ ruleset: VOICE_BOARD, prefix: '脚本', size: 12 });
  for (const client of lobby.clients) {
    await setReady(lobby.roomCode, client);
  }

  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  await joinLobbyViaUi(page, { nickname: '浏览器', roomCode: lobby.roomCode });
  await readyViaUi(page);
  await startGame(lobby.roomCode, lobby.host);
  await page.locator('.window').first().waitFor({ timeout: 20_000 });
  await joinVoiceViaUi(page);

  const uid = await waitForChannelUser(lobby.gameId);

  // 夜间没有任何发布权：界面应提示「夜间全体静音」，且没有麦克风错误
  await expect(page.getByText('夜间全体静音').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/麦克风启用失败/)).toHaveCount(0);
  await page.waitForTimeout(5_000);
  const status = await fetchUserStatus(lobby.gameId, uid);
  expect(status.inChannel).toBe(true);

  await context.close();
});
