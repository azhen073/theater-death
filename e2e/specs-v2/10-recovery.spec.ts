import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loadRoomAccounts, leaveRoom, loginRoomAccount } from '../helpers-v2/rooms.ts';
import { loadAccountCase, type RoomAccount } from '../helpers-v2/account.ts';
import { apiSessionFromContext, browserContextForApi, closeApiSessions, enterAndReady, loginApi, roomPost, roomView, type ApiSession, waitForView } from '../helpers-v2/recovery.ts';
import { loadGameFixture, loadReviewDocument, loadReviewFixture, pushFixture, taskFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

interface GameSetup {
  hostContext: BrowserContext; hostPage: Page; code: string; sessions: ApiSession[]; spirit: ApiSession; spiritIsHost: boolean; spiritLoggedOut: boolean; spiritContext: BrowserContext; spiritPage: Page;
}
async function createFivePlayerGame(browser: Browser, accounts: RoomAccount[]): Promise<GameSetup> {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  await loginRoomAccount(hostPage, accounts[0]!);
  const sessions: ApiSession[] = [];
  let code: string;
  await hostPage.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(hostPage.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
  await hostPage.getByRole('button', { name: '自定义角色组成' }).click();
  await hostPage.getByLabel('玩家人数').fill('5');
  for (const [label, value] of [['莱莱可人数', '0'], ['门先生人数', '1'], ['水妖人数', '0'], ['降临者人数', '0'], ['科研员人数', '1'], ['平民人数', '1'], ['死神人数', '1'], ['魂灵人数', '1'], ['丧亲者人数', '0']] as const) await hostPage.getByLabel(label).fill(value);
  await hostPage.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(hostPage.getByRole('heading', { name: '房间大厅' })).toBeVisible();
  code = (await hostPage.locator('.room-code strong').innerText()).trim();
  for (const account of accounts.slice(1, 5)) {
    const session = await loginApi(account);
    sessions.push(session);
    await enterAndReady(session, code);
  }
  await hostPage.getByRole('button', { name: '准备', exact: true }).click();
  await expect(hostPage.getByRole('button', { name: '开始游戏', exact: true })).toBeEnabled();
  await hostPage.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(hostPage.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 25_000 });

  if (!code) throw new Error('recovery room code missing');
  let spirit = (await Promise.all(sessions.map(async session => ({ session, view: await roomView(session, code) })))).find(item => item.view.private?.self?.roleId === 'spirit')?.session;
  if (!spirit) {
    const hostResponse = await hostPage.request.get(`/api/v2/rooms/${code}/view`);
    const hostView = await hostResponse.json() as any;
    if (hostView.private?.self?.roleId === 'spirit') spirit = await apiSessionFromContext(hostContext, accounts[0]!);
  }
  if (!spirit) throw new Error('experimental five-player setup did not assign a spirit');
  const spiritView = await waitForView(spirit, code, view => view.tasks?.some((task: any) => task.action === 'EDIT_PROPOSAL'));
  const factionTask = spiritView.tasks.find((task: any) => task.action === 'EDIT_PROPOSAL');
  if (!factionTask || factionTask.closesAt - spiritView.serverTime < 30_000) throw new Error('spirit faction window has insufficient remaining time');
  const spiritContext = await browserContextForApi(browser, spirit);
  const spiritPage = await spiritContext.newPage();
  await spiritPage.goto(`/#/room/${code}`);
  await expect(spiritPage.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 25_000 });
  return { hostContext, hostPage, code, sessions, spirit, spiritIsHost: spirit.account.userId === accounts[0]!.userId, spiritLoggedOut: false, spiritContext, spiritPage };
}

async function cleanupGame(game: GameSetup): Promise<void> {
  try {
  for (const session of game.sessions) {
    if (game.spiritLoggedOut && session === game.spirit) continue;
    await roomPost(session, `/api/v2/rooms/${game.code}/leave`, { requestId: `recovery-clean-${session.account.uid}-${Date.now()}` });
  }
  if (game.spiritLoggedOut) expect((await game.spirit.api.get('/api/v2/auth/me')).status()).toBe(401);
  if (!(game.spiritIsHost && game.spiritLoggedOut) && !game.hostPage.isClosed()) await leaveRoom(game.hostPage);
  } finally {
  await game.spiritContext.close().catch(() => undefined);
  await game.hostContext.close().catch(() => undefined);
  await closeApiSessions(game.sessions);
  if (!game.sessions.includes(game.spirit)) await game.spirit.api.dispose();
  }
}

function releaseGateSafely(release: (() => void) | null): void {
  if (release) release();
}

test('真实 spirit：导航往返保留 faction 草稿，20秒未知命令可用同 requestId/目标重试', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const game = await createFivePlayerGame(browser, loadRoomAccounts(testInfo.project.name));
  let releaseGate: (() => void) | null = null;
  const commandBodies: Array<Record<string, unknown>> = [];
  let gateTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    await game.spiritPage.route('**/api/v2/rooms/*/command', async route => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      commandBodies.push(structuredClone(body));
      if (body.action === 'EDIT_PROPOSAL' && commandBodies.filter(item => item.action === 'EDIT_PROPOSAL').length === 1) {
        await new Promise<void>(resolve => {
          releaseGate = () => { if (gateTimer) clearTimeout(gateTimer); gateTimer = null; resolve(); };
          gateTimer = setTimeout(resolve, 22_000);
        });
      }
      try { await route.continue(); } catch { /* client deadline may abort the gated route */ }
    });
    await expect(game.spiritPage.getByRole('region', { name: '舞台行动', exact: true }).locator('h2')).toHaveText('拟定攻击方案');
    const spiritView = await roomView(game.spirit, game.code);
    const task = spiritView.tasks.find((item: any) => item.action === 'EDIT_PROPOSAL');
    expect(task.closesAt - spiritView.serverTime).toBeGreaterThan(20_000);
    const target = task.targets.playerIds[0];
    await game.spiritPage.getByRole('button', { name: new RegExp(`^${spiritView.public.seats.find((seat: any) => seat.playerId === target).seat}号 .*可选目标$`) }).click();
    await expect(game.spiritPage.locator('.selection-summary')).toContainText('1 /');
    await game.spiritPage.getByRole('tab', { name: '情报' }).click();
    const factionDraft = game.spiritPage.getByLabel('阵营消息');
    await factionDraft.fill('导航保留的阵营草稿');
    await game.spiritPage.getByRole('region', { name: '舞台行动', exact: true }).getByRole('button', { name: '确认提交' }).click();
    await expect(game.spiritPage.getByRole('region', { name: '舞台行动', exact: true }).getByRole('button', { name: /正在提交/ })).toBeVisible();

    await game.spiritPage.getByRole('button', { name: '导航' }).click();
    await game.spiritPage.getByRole('dialog', { name: '剧院导航' }).getByRole('button', { name: '我的账户' }).click();
    await expect(game.spiritPage.getByRole('heading', { name: '你的账户' })).toBeVisible();
    await game.spiritPage.getByRole('button', { name: '我的房间' }).click();
    await expect(game.spiritPage.getByRole('heading', { name: '夜幕降临' })).toBeVisible();
    await expect(game.spiritPage.locator('.selection-summary')).toContainText('1 /');
    await game.spiritPage.getByRole('tab', { name: '情报' }).click();
    await expect(game.spiritPage.getByLabel('阵营消息')).toHaveValue('导航保留的阵营草稿');
    await expect(game.spiritPage.getByText('连接中断，正在确认行动结果。')).toBeVisible({ timeout: 26_000 });
    const beforeRetry = await roomView(game.spirit, game.code);
    expect(beforeRetry.submissionState.some((item: any) => item.requestId === commandBodies[0]?.requestId)).toBe(false);
    releaseGateSafely(releaseGate); releaseGate = null;
    await game.spiritPage.getByRole('button', { name: '用原目标与请求重试' }).click();
    await expect.poll(() => commandBodies.filter(item => item.action === 'EDIT_PROPOSAL').length, { timeout: 15_000 }).toBe(2);
    expect(commandBodies[1]).toMatchObject({ requestId: commandBodies[0]?.requestId, gameId: commandBodies[0]?.gameId, action: 'EDIT_PROPOSAL', windowInstanceId: commandBodies[0]?.windowInstanceId, targets: commandBodies[0]?.targets });
    await expect.poll(async () => (await roomView(game.spirit, game.code)).submissionState.some((item: any) => item.requestId === commandBodies[0]?.requestId), { timeout: 15_000 }).toBe(true);
  } finally {
    releaseGateSafely(releaseGate); if (gateTimer) clearTimeout(gateTimer);
    await cleanupGame(game);
  }
});

test('真实 API 跨账号：A 的挂起命令在 logout 后释放，B 保持登录且无 A 房间私有视图', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const fullGame = loadAccountCase(testInfo.project.name).fullGame;
  if (!fullGame || fullGame.length < 6) throw new Error('missing six full-game accounts');
  const game = await createFivePlayerGame(browser, fullGame.slice(0, 6));
  const accounts = fullGame.slice(0, 6);
  let releaseGate: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let requestSettled: Promise<unknown> | null = null;
  let routeHandledResolve: (() => void) | null = null;
  const routeHandled = new Promise<void>(resolve => { routeHandledResolve = resolve; });
  try {
    await game.spiritPage.route('**/api/v2/rooms/*/command', async route => {
      if ((route.request().postDataJSON() as Record<string, unknown>).action !== 'EDIT_PROPOSAL') { await route.continue(); return; }
      await new Promise<void>(resolve => { releaseGate = () => { if (timer) clearTimeout(timer); timer = null; resolve(); }; timer = setTimeout(resolve, 22_000); });
      try { await route.continue(); } catch { /* A logout may abort the old fetch. */ } finally { routeHandledResolve?.(); routeHandledResolve = null; }
    });
    const browserRequestSettled = Promise.race([
      game.spiritPage.waitForEvent('requestfinished', { timeout: 0, predicate: request => request.url().includes('/api/v2/rooms/') && request.url().endsWith('/command') }),
      game.spiritPage.waitForEvent('requestfailed', { timeout: 0, predicate: request => request.url().includes('/api/v2/rooms/') && request.url().endsWith('/command') }),
    ]).then(() => undefined);
    requestSettled = Promise.race([browserRequestSettled, routeHandled]);
    const view = await roomView(game.spirit, game.code);
    const task = view.tasks.find((item: any) => item.action === 'EDIT_PROPOSAL');
    const target = task.targets.playerIds[0];
    const seat = view.public.seats.find((item: any) => item.playerId === target).seat;
    await game.spiritPage.getByRole('button', { name: new RegExp(`^${seat}号 .*可选目标$`) }).click();
    await game.spiritPage.getByRole('region', { name: '舞台行动', exact: true }).getByRole('button', { name: '确认提交' }).click();
    await expect(game.spiritPage.getByRole('region', { name: '舞台行动', exact: true }).getByRole('button', { name: /正在提交/ })).toBeVisible();
    await game.spiritPage.getByRole('button', { name: '导航' }).click();
    await game.spiritPage.getByRole('dialog', { name: '剧院导航' }).getByRole('button', { name: '剧院首页' }).click();
    await expect(game.spiritPage.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
    await game.spiritPage.getByRole('button', { name: '退出登录' }).click();
    await game.spiritPage.getByRole('dialog', { name: '退出当前登录？' }).getByRole('button', { name: '确认退出登录' }).click();
    game.spiritLoggedOut = true;
    await expect(game.spiritPage.getByRole('heading', { name: '欢迎入席' })).toBeVisible();
    await loginRoomAccount(game.spiritPage, accounts[5]!);
    await expect(game.spiritPage.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
    await expect(game.spiritPage.getByText('拟定攻击方案')).toHaveCount(0);
    expect(await (await game.spiritPage.request.get('/api/v2/me/rooms')).json()).toMatchObject({ currentRoomId: null });
    releaseGateSafely(releaseGate); releaseGate = null;
    await requestSettled;
    await expect(game.spiritPage.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
    await expect(game.spiritPage.getByText('拟定攻击方案')).toHaveCount(0);
    const currentAccount = await game.spiritPage.request.get('/api/v2/auth/me');
    expect(currentAccount.status()).toBe(200);
    expect(await currentAccount.json()).toMatchObject({ userId: accounts[5]!.userId });
  } finally {
    releaseGateSafely(releaseGate); if (timer) clearTimeout(timer);
    if (requestSettled) void requestSettled.catch(() => undefined);
    await cleanupGame(game);
  }
});

test('夹具复盘500未知结果保留原结束意图；约束收紧只移除非法目标不自动发送', async ({ page }) => {
  const reviewFixture = loadReviewFixture();
  let current = reviewFixture;
  let attempts = 0;
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/review', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(loadReviewDocument()) }));
  await page.route('**/api/v2/rooms/*/end-review', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>; bodies.push(structuredClone(body)); attempts += 1;
    if (attempts === 1) { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal_error' } }) }); return; }
    current = { ...loadGameFixture('post-review-lobby-full.json') };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  await page.getByRole('button', { name: '结束复盘，返回大厅' }).click();
  const dialog = page.getByRole('dialog', { name: '结束本局复盘？' });
  await dialog.getByRole('button', { name: '确认结束复盘' }).click();
  await expect(dialog.getByRole('alert')).toContainText('尚未确认结果');
  await dialog.getByRole('alert').getByRole('button', { name: '确认原结束操作' }).click();
  await expect(page.getByRole('heading', { name: '房间大厅' })).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);

  let fixture = taskFixture(loadGameFixture().view, 'SUBMIT_GUARD', { playerIds: loadGameFixture().view.public!.seats.slice(0, 2).map(seat => seat.playerId), maxTargets: 2, allowRepeated: false, canSkip: true, forbiddenPairs: [] });
  let requests = 0;
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.route('**/api/v2/rooms/*/command', async route => { requests += 1; await route.continue(); });
  await page.goto('/game-test.html');
  await page.locator('.seat-main[aria-label*="可选目标"]').nth(0).click();
  await page.locator('.seat-main[aria-label*="可选目标"]').nth(1).click();
  const narrowed = structuredClone(fixture);
  narrowed.view.tasks[0]!.targets = { ...narrowed.view.tasks[0]!.targets!, playerIds: [narrowed.view.tasks[0]!.targets!.playerIds[0]!], maxTargets: 1 };
  fixture = narrowed;
  await pushFixture(page, fixture);
  await expect(page.getByText('可选目标已更新，不再允许的选择已移除。')).toBeVisible();
  await expect(page.locator('.selection-summary')).toContainText('1 / 1');
  expect(requests).toBe(0);
});
