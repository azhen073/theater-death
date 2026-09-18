import { expect, test } from '@playwright/test';
import { api, setReady, setupLobby, startGame } from '../helpers/api.ts';
import { botStep, botView } from '../helpers/bot.ts';
import { FAST_BOARD } from '../helpers/board.ts';
import { ENV } from '../helpers/env.ts';

function errorCode(body: Record<string, unknown>): unknown {
  return (body.error as { code?: unknown } | undefined)?.code;
}

/**
 * 用例一：对局进行中不能退出（服务端拒绝，席位与对局不受影响）。
 */
test('对局进行中退出被拒：409 game_started', async () => {
  test.setTimeout(120_000);

  const lobby = await setupLobby({ ruleset: FAST_BOARD });
  for (const client of lobby.clients) {
    await setReady(lobby.roomCode, client);
  }
  await startGame(lobby.roomCode, lobby.host);

  const leave = await api.post(`/api/rooms/${lobby.roomCode}/leave`, {}, lobby.clients[1].cookie);
  expect(leave.status).toBe(409);
  expect(errorCode(leave.json)).toBe('game_started');

  // 房间与席位未受影响
  const still = await api.get('/api/view', lobby.clients[1].cookie);
  expect(still.status).toBe(200);
});

/**
 * 用例二：终局后退出房间——本人回入口页；房间保留，其他成员仍能查看复盘
 * （终局退出只释放自己的席位，房主退出也不解散）。
 */
test('终局后退出房间：本人回入口页、其他人复盘保留', async ({ browser }) => {
  test.setTimeout(480_000);

  const lobby = await setupLobby({ ruleset: FAST_BOARD });
  for (const client of lobby.clients) {
    await setReady(lobby.roomCode, client);
  }
  await startGame(lobby.roomCode, lobby.host);

  // 13 机器人快进至终局
  const deadline = Date.now() + 360_000;
  let ended = false;
  while (Date.now() < deadline) {
    for (const client of lobby.clients) {
      const view = await botView(client);
      if (view.phase === 'ended') {
        ended = true;
        break;
      }
      await botStep(client, view).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    if (ended) {
      break;
    }
    const hostView = await botView(lobby.host);
    if (hostView.phase === 'ended') {
      ended = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  expect(ended, '对局应在时限内结束').toBe(true);

  // 非房主玩家在真实浏览器里打开（注入其会话 cookie）
  const leaver = lobby.clients[12];
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: 'td_session',
      value: leaver.cookie.replace(/^td_session=/, ''),
      url: ENV.baseUrl,
    },
  ]);
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(ENV.baseUrl);

  // 终局卡片出现：查看复盘 + 退出房间
  await expect(page.getByRole('button', { name: '查看复盘' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '退出房间' })).toBeVisible();
  await page.screenshot({ path: 'results/artifacts/end-exit-before.png', fullPage: true });

  await page.getByRole('button', { name: '退出房间' }).click();

  // 回到入口页
  await page.getByRole('button', { name: '创建房间' }).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: 'results/artifacts/end-exit-after.png', fullPage: true });

  // 退出者会话失效
  const leftView = await api.get('/api/view', leaver.cookie);
  expect(leftView.status).toBe(403);

  // 房间与他人复盘保留（房主自己也还在）
  const hostView = await api.get('/api/view', lobby.host.cookie);
  expect(hostView.status).toBe(200);
  const review = await api.get('/api/review', lobby.host.cookie);
  expect(review.status).toBe(200);

  await context.close();
});
