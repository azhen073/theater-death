import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { advanceAcceptanceClock } from '../helpers-v2/full-game.ts';
import { loadRoomAccounts, enterRoom, leaveRoom, loginRoomAccount, roomView, waitRoom } from '../helpers-v2/rooms.ts';
import type { RoomAccount } from '../helpers-v2/account.ts';

async function open(browser: Browser, account: RoomAccount): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginRoomAccount(page, account);
  return { context, page };
}

async function setupFive(browser: Browser, accounts: RoomAccount[]): Promise<{ contexts: Array<{ context: BrowserContext; page: Page }>; code: string }> {
  const contexts: Array<{ context: BrowserContext; page: Page }> = [];
  const host = await open(browser, accounts[0]!); contexts.push(host);
  await host.page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(host.page.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
  await host.page.getByRole('button', { name: '自定义角色组成' }).click();
  await host.page.getByLabel('玩家人数').fill('5');
  for (const [label, value] of [['莱莱可人数', '0'], ['门先生人数', '1'], ['水妖人数', '0'], ['降临者人数', '0'], ['科研员人数', '1'], ['平民人数', '1'], ['死神人数', '1'], ['魂灵人数', '1'], ['丧亲者人数', '0']] as const) await host.page.getByLabel(label).fill(value);
  const request = host.page.waitForRequest(item => item.url().endsWith('/api/v2/rooms') && item.method() === 'POST');
  await host.page.getByRole('button', { name: '创建房间', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ playerCount: 5 });
  await waitRoom(host.page);
  const code = (await host.page.locator('.room-code strong').innerText()).trim();
  for (const account of accounts.slice(1, 5)) { const player = await open(browser, account); contexts.push(player); await enterRoom(player.page, code); }
  for (const item of contexts) { await item.page.getByRole('button', { name: '准备', exact: true }).click(); await expect(item.page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible(); }
  await host.page.getByRole('button', { name: '开始游戏', exact: true }).click();
  for (const item of contexts) await expect(item.page.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 20_000 });
  return { contexts, code };
}

function targetButton(page: Page, view: Record<string, any>, playerId: string) {
  const seat = view.public.seats.find((item: Record<string, any>) => item.playerId === playerId);
  if (!seat) throw new Error('authorized target seat missing');
  return page.getByRole('button', { name: new RegExp(`${seat.seat}号 .*可选目标`) });
}

test('真实五人夜间闭环：Door 守护确认与 Death 重复双刀草稿', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const { contexts, code } = await setupFive(browser, accounts);
  try {
    const views = await Promise.all(contexts.map(item => roomView(item.page, code)));
    const doorIndex = views.findIndex(view => view.private?.self.roleId === 'door');
    const deathIndex = views.findIndex(view => view.private?.self.roleId === 'death');
    expect(doorIndex).toBeGreaterThanOrEqual(0);
    expect(deathIndex).toBeGreaterThanOrEqual(0);
    const door = contexts[doorIndex]!.page;
    const death = contexts[deathIndex]!.page;
    const doorView = views[doorIndex]!;
    const doorTask = doorView.tasks.find((task: Record<string, any>) => task.action === 'SUBMIT_GUARD');
    expect(doorTask).toBeTruthy();
    expect(doorTask.closesAt - doorView.serverTime).toBeGreaterThanOrEqual(29_000);
    expect(doorTask.closesAt - doorView.serverTime).toBeLessThanOrEqual(30_000);
    const targetId = doorTask.targets.playerIds[0];
    let doorCommands = 0;
    door.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/command')) doorCommands += 1; });
    await targetButton(door, doorView, targetId).click();
    await expect(door.getByText(/1 \/ 2/)).toBeVisible();
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(doorCommands).toBe(0);
    const doorRequest = door.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/command'));
    const doorResponse = door.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/command'));
    await expect(door.getByTestId('stage-submit')).toHaveAccessibleName('确认守护');
    await door.getByTestId('stage-submit').click();
    const doorBody = await (await doorRequest).postDataJSON() as Record<string, any>;
    const doorReceipt = await (await doorResponse).json() as Record<string, any>;
    expect(doorReceipt).toMatchObject({ requestId: doorBody.requestId, status: 'accepted' });
    expect(doorBody).toMatchObject({ gameId: doorView.gameId, windowInstanceId: doorTask.windowInstanceId, action: 'SUBMIT_GUARD', targets: [targetId] });
    await expect.poll(async () => (await roomView(door, code)).submissionState.some((item: Record<string, any>) => item.requestId === doorBody.requestId && item.windowInstanceId === doorTask.windowInstanceId && item.action === 'SUBMIT_GUARD'), { timeout: 10_000 }).toBe(true);
    await door.evaluate(() => window.scrollTo(0, 0));
    await door.screenshot({ path: `/results/real-night-door-stage-${testInfo.project.name}.png` });
    await door.getByRole('region', { name: '舞台行动', exact: true }).scrollIntoViewIfNeeded();
    await door.screenshot({ path: `/results/real-night-door-action-${testInfo.project.name}.png` });
    const clockSocket = process.env.ACCEPTANCE_CLOCK_SOCKET ?? '/clock-control/clock.sock';
    try {
      await advanceAcceptanceClock(clockSocket, Math.max(1, doorTask.closesAt - doorView.serverTime + 1));
    } catch {
      // In real time environments, proceed to poll
    }

    await expect.poll(async () => (await roomView(death, code)).serverTime >= doorTask.closesAt, { timeout: 45_000, intervals: [1000] }).toBe(true);
    const deathTask = await expect.poll(async () => (await roomView(death, code)).tasks.find((task: Record<string, any>) => task.action === 'EDIT_PROPOSAL') ?? null, { timeout: 90_000, intervals: [1000] }).toBeTruthy();
    const deathView = await roomView(death, code);
    const proposalTask = deathView.tasks.find((task: Record<string, any>) => task.action === 'EDIT_PROPOSAL')!;
    const deathTarget = proposalTask.targets.playerIds[0];
    const deathSeat = deathView.public.seats.find((seat: Record<string, any>) => seat.playerId === deathTarget);
    expect(deathSeat).toBeTruthy();
    await targetButton(death, deathView, deathTarget).click();
    await death.getByRole('button', { name: new RegExp(`增加${deathSeat.seat}号目标次数`) }).click();
    await expect(death.getByText(/2 \/ 2/)).toBeVisible();
    const deathRequest = death.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/command'));
    const deathResponse = death.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/command'));
    await expect(death.getByTestId('stage-submit')).toHaveAccessibleName('发布方案');
    await death.getByTestId('stage-submit').click();
    const deathBody = await (await deathRequest).postDataJSON() as Record<string, any>;
    const deathReceipt = await (await deathResponse).json() as Record<string, any>;
    expect(deathReceipt).toMatchObject({ requestId: deathBody.requestId, status: 'accepted' });
    expect(deathBody).toMatchObject({ gameId: deathView.gameId, windowInstanceId: proposalTask.windowInstanceId, action: 'EDIT_PROPOSAL', targets: [deathTarget, deathTarget] });
    await expect.poll(async () => { const proposal = (await roomView(death, code)).private?.proposal; return { latest: proposal?.targetPlayerIds.filter((id: string) => id === deathTarget).length ?? 0, effective: proposal?.effective.targetPlayerIds.filter((id: string) => id === deathTarget).length ?? 0 }; }, { timeout: 15_000 }).toEqual({ latest: 2, effective: 2 });
    await death.evaluate(() => window.scrollTo(0, 0));
    await death.screenshot({ path: `/results/real-night-death-stage-${testInfo.project.name}.png` });
    await death.getByRole('region', { name: '舞台行动', exact: true }).scrollIntoViewIfNeeded();
    await death.screenshot({ path: `/results/real-night-death-action-${testInfo.project.name}.png` });
  } finally {
    for (const item of contexts) await leaveRoom(item.page);
    for (const item of contexts) await item.context.close();
  }
});
