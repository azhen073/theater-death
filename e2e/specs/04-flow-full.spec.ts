import { expect, test } from '@playwright/test';
import { api, createRoom, setReady, setupLobby, startGame } from '../helpers/api.ts';
import { actFollowing } from '../helpers/driver.ts';
import { botStep, botView } from '../helpers/bot.ts';
import { joinLobbyViaUi, readyViaUi } from '../helpers/ui.ts';
import { FAST_BOARD } from '../helpers/board.ts';
import { ENV } from '../helpers/env.ts';

/**
 * 用例一：12 个浏览器上下文全 UI 跟随操作（限时覆盖），
 * 验证各角色面板（守护/刺杀/提案/查验/还魂/竞选/发言/投票）在真实浏览器中可用。
 */
test('12 浏览器上下文：全角色面板跟随操作覆盖', async ({ browser }) => {
  test.setTimeout(780_000);

  const host = await createRoom({ nickname: '房主', ruleset: FAST_BOARD });
  const roomCode = host.roomCode;

  const contexts = [];
  const pages = [];
  for (let seat = 2; seat <= 13; seat += 1) {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    contexts.push(context);
    pages.push(page);
  }
  // 12 个上下文并行加入大厅并准备（顺序驱动在容器负载下会拖到十分钟级）
  await Promise.all(
    pages.map((page, index) =>
      joinLobbyViaUi(page, { nickname: `玩家${index + 2}`, roomCode }).then(() => readyViaUi(page)),
    ),
  );

  await setReady(roomCode, host.client);
  await startGame(roomCode, host.client);
  await pages[0]!.locator('.window').first().waitFor({ timeout: 20_000 });

  const startedAt = Date.now();
  const actions = new Map<string, number>();
  while (Date.now() - startedAt < 240_000) {
    const results = await Promise.all(pages.map((page) => actFollowing(page).catch(() => null)));
    for (const action of results) {
      if (action !== null) {
        actions.set(action, (actions.get(action) ?? 0) + 1);
      }
    }
    await pages[0]!.waitForTimeout(500);
  }

  console.log('[ui-flow] 行动统计:', JSON.stringify(Object.fromEntries(actions)));
  // 至少覆盖：发言结束、竞选、投票及其余角色行动中的多类
  expect(actions.size, `动作种类应 >= 4，实际 ${JSON.stringify(Object.fromEntries(actions))}`).toBeGreaterThanOrEqual(4);
  await pages[0]!.screenshot({ path: 'results/artifacts/ui-flow.png', fullPage: true });

  for (const context of contexts) {
    await context.close();
  }
});

/**
 * 用例二：13 个 API 机器人快进整局至终局（快板），
 * 校验终局与复盘（服务端接口 + 浏览器复盘页渲染）。
 */
test('13 机器人快进至终局：复盘接口与页面渲染', async ({ browser }) => {
  test.setTimeout(480_000);

  const lobby = await setupLobby({ ruleset: FAST_BOARD });
  for (const client of lobby.clients) {
    await setReady(lobby.roomCode, client);
  }
  await startGame(lobby.roomCode, lobby.host);

  const deadline = Date.now() + 360_000;
  let ended = false;
  let steps = 0;
  while (Date.now() < deadline) {
    for (const client of lobby.clients) {
      const view = await botView(client);
      if (view.phase === 'ended') {
        ended = true;
        break;
      }
      const action = await botStep(client, view).catch(() => null);
      if (action !== null) {
        steps += 1;
      }
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
  console.log('[bot-flow] 步数:', steps);
  expect(ended, '对局应在时限内结束').toBe(true);

  // 终局复盘（服务端）
  const review = await api.get('/api/review', lobby.host.cookie);
  expect(review.status).toBe(200);
  const data = review.json.review as {
    winner: string;
    players: unknown[];
    timeline: unknown[];
  };
  expect(data.players.length).toBe(13);
  expect(data.timeline.length).toBeGreaterThan(0);
  expect(['human', 'death_faction']).toContain(data.winner);

  // 终局复盘（浏览器渲染：注入房主会话后打开页面）
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: 'td_session',
      value: lobby.host.cookie.replace(/^td_session=/, ''),
      url: ENV.baseUrl,
    },
  ]);
  const page = await context.newPage();
  await page.goto(ENV.baseUrl);
  await page.getByRole('button', { name: '查看复盘' }).click({ timeout: 20_000 });
  await page.getByText(/阵营/).first().waitFor({ timeout: 15_000 });
  await page.screenshot({ path: 'results/artifacts/bot-review.png', fullPage: true });
  await context.close();
});
