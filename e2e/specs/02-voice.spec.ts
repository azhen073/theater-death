import { expect, test } from '@playwright/test';
import { setReady, setupLobby, startGame } from '../helpers/api.ts';
import {
  createAdmin,
  listParticipants,
  waitFor,
  waitForAudioTrack,
  waitForCanPublish,
} from '../helpers/cloud.ts';
import { joinLobbyViaUi, joinVoiceViaUi, readyViaUi } from '../helpers/ui.ts';
import { VOICE_BOARD } from '../helpers/board.ts';

/** 摘取浏览器玩家在媒体服务上的身份（非脚本玩家）。 */
async function browserIdentity(
  admin: ReturnType<typeof createAdmin>,
  gameId: string,
  scriptIds: Set<string>,
): Promise<string> {
  const participant = await waitFor(
    async () => {
      const participants = await listParticipants(admin, gameId);
      return participants.find((item) => !scriptIds.has(item.identity)) ?? false;
    },
    { label: '浏览器玩家出现在媒体房', timeoutMs: 30_000, intervalMs: 1000 },
  );
  return participant.identity;
}

test('发言轮开麦：自动重试后音频轨发布成功，发言结束权限收回', async ({ browser }) => {
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

  const admin = createAdmin();
  const scriptIds = new Set(lobby.clients.map((client) => client.playerId));
  const identity = await browserIdentity(admin, lobby.gameId, scriptIds);

  // 竞选报名（等待报名窗口出现）
  const signup = page.getByRole('button', { name: '报名竞选天理' });
  await signup.waitFor({ timeout: 90_000 });
  await signup.click();
  // 命令受理确认（窗口可能在点击后很快关闭，「退出竞选」不一定可见）
  await page.getByText('已提交').first().waitFor({ timeout: 10_000 });

  // 竞选发言轮轮到自己（唯一候选人）
  const endSpeech = page.getByRole('button', { name: '结束发言' });
  await endSpeech.waitFor({ timeout: 60_000 });

  // 核心断言：发布权已生效 + 自动重试把音频轨发出去（修复前此处 tracks 为空）
  const participant = await waitForAudioTrack(admin, lobby.gameId, identity, { timeoutMs: 25_000 });
  expect(participant.tracks.some((track) => track.type === 0)).toBe(true);

  // 结束发言 → 权限收回
  await endSpeech.click();
  await waitForCanPublish(admin, lobby.gameId, identity, false, { timeoutMs: 30_000 });

  await page.screenshot({ path: 'results/artifacts/voice-speech.png' });
  await context.close();
});

test('夜间全体禁麦：无发布权时无法开麦（媒体侧无音轨）', async ({ browser }) => {
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

  const admin = createAdmin();
  const scriptIds = new Set(lobby.clients.map((client) => client.playerId));
  const identity = await browserIdentity(admin, lobby.gameId, scriptIds);

  // 夜间没有任何发布权
  const participant = await waitForCanPublish(admin, lobby.gameId, identity, false, {
    timeoutMs: 20_000,
  });
  expect(participant.canPublish).toBe(false);

  // 界面应提示「夜间全体静音」；等待窗口跑完仍无音轨
  await expect(page.getByText('夜间全体静音').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(8_000);
  const after = await waitFor(
    async () => {
      const participants = await listParticipants(admin, lobby.gameId);
      return participants.find((item) => item.identity === identity) ?? false;
    },
    { label: '浏览器玩家仍在媒体房', timeoutMs: 10_000 },
  );
  expect(after.tracks.some((track) => track.type === 0)).toBe(false);

  await context.close();
});
