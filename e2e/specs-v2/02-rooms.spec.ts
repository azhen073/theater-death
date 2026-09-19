import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loadRoomAccounts, confirmModal, enterRoom, leaveRoom, loginRoomAccount, memberCard, myRooms, noHorizontalOverflow, roomView, waitRoom } from '../helpers-v2/rooms.ts';
import type { RoomAccount } from '../helpers-v2/account.ts';

async function createPage(browser: Browser, account: RoomAccount): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginRoomAccount(page, account);
  return { context, page };
}

async function kickMember(page: Page, username: string): Promise<void> {
  await memberCard(page, username).getByRole('button', { name: '移出' }).click();
  await confirmModal(page, '移出成员？');
}

async function transferHost(page: Page, username: string): Promise<void> {
  await memberCard(page, username).getByRole('button', { name: '转移房主' }).click();
  await confirmModal(page, '转移房主？');
}

async function dissolve(page: Page): Promise<void> {
  await page.getByRole('button', { name: '解散房间', exact: true }).click();
  await confirmModal(page, '解散房间？');
  await expect(page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
}

test('正式房间：默认13人板、治理、刷新与解散', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const host = await createPage(browser, accounts[0]!);
  const joiner = await createPage(browser, accounts[1]!);
  try {
    await host.page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(host.page.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
    const requestPromise = host.page.waitForRequest(request => request.url().endsWith('/api/v2/rooms') && request.method() === 'POST');
    const createRequest = requestPromise;
    await host.page.getByRole('button', { name: '创建房间', exact: true }).click();
    const createBody = createRequest ? await createRequest : null;
    const body = createBody?.postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ presetId: 'default-13' });
    expect(body).not.toHaveProperty('roles');
    await waitRoom(host.page);
    const code = (await host.page.locator('.room-code strong').innerText()).trim();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    await expect(host.page.getByText('13 人 · 正式模式')).toBeVisible();
    await expect(host.page.getByText('配置已冻结')).toBeVisible();
    await host.page.getByRole('button', { name: '查看完整规则' }).click();
    await expect(host.page.getByRole('dialog')).toContainText('完整规则 · 2.0');
    await host.page.getByRole('button', { name: '关闭' }).click();
    await host.page.screenshot({ path: `/results/rooms-formal-${testInfo.project.name}.png` });

    await enterRoom(joiner.page, code);
    const oldHostMemberId = await memberCard(host.page, accounts[0]!.username).getAttribute('data-member-id');
    await host.page.getByRole('button', { name: '准备', exact: true }).click();
    await expect(host.page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
    await host.page.getByRole('button', { name: '取消准备', exact: true }).click();
    await host.page.reload();
    await waitRoom(host.page);
    await expect(host.page.getByText('房间大厅')).toBeVisible();
    await host.page.getByRole('button', { name: '我的账户' }).click();
    await expect(host.page.getByRole('heading', { name: '你的账户' })).toBeVisible();
    await host.page.getByRole('button', { name: '我的房间' }).click();
    await waitRoom(host.page);
    await expect.poll(async () => (await roomView(joiner.page, code)).room.formalMembers.find((member: Record<string, any>) => member.userId === accounts[0]!.userId)?.presence).toBe('online');

    await transferHost(host.page, accounts[1]!.username);
    await expect(memberCard(host.page, accounts[1]!.username)).toContainText('房主');
    await kickMember(joiner.page, accounts[0]!.username);
    await expect(host.page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();

    await enterRoom(host.page, code);
    const newHostMemberId = await memberCard(host.page, accounts[0]!.username).getAttribute('data-member-id');
    expect(newHostMemberId).toBeTruthy();
    expect(newHostMemberId).not.toBe(oldHostMemberId);
    await dissolve(joiner.page);
    await expect(host.page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
    await host.page.getByRole('button', { name: '加入房间', exact: true }).click();
    await host.page.getByLabel('房间码').fill(code);
    await host.page.getByRole('button', { name: '进入房间', exact: true }).click();
    await expect(host.page.getByRole('alert')).toContainText('房间不存在或已结束');
    await noHorizontalOverflow(host.page);
  } finally {
    await host.context.close();
    await joiner.context.close();
  }
});

test('实验房间：五人冻结配置、观众晋升、离线开局与公开状态壳', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const contexts: Array<{ context: BrowserContext; page: Page }> = [];
  const open = async (index: number) => { const result = await createPage(browser, accounts[index]!); contexts.push(result); return result.page; };
  try {
    const hostPage = await open(0);
    await hostPage.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(hostPage.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
    await hostPage.getByRole('button', { name: '自定义角色组成' }).click();
    await hostPage.getByLabel('玩家人数').fill('5');
    for (const [label, value] of [['莱莱可人数', '0'], ['门先生人数', '1'], ['水妖人数', '0'], ['降临者人数', '0'], ['科研员人数', '1'], ['平民人数', '1'], ['死神人数', '1'], ['魂灵人数', '1'], ['丧亲者人数', '0']] as const) await hostPage.getByLabel(label).fill(value);
    const requestPromise = hostPage.waitForRequest(request => request.url().endsWith('/api/v2/rooms') && request.method() === 'POST');
    await hostPage.getByRole('button', { name: '创建房间', exact: true }).click();
    const body = (await requestPromise).postDataJSON() as Record<string, any>;
    expect(body.playerCount).toBe(5);
    expect(body.roles).toMatchObject({ door: 1, researcher: 1, civilian: 1, death: 1, spirit: 1 });
    await waitRoom(hostPage);
    const code = (await hostPage.locator('.room-code strong').innerText()).trim();
    await expect(hostPage.getByText('实验模式 · 本房间使用自定义角色组成，规则配置已冻结。')).toBeVisible();

    const formalPages: Page[] = [hostPage];
    for (const index of [1, 2, 3, 4]) { const page = await open(index); await enterRoom(page, code); formalPages.push(page); }
    const spectatorPage = await open(5);
    await enterRoom(spectatorPage, code);
    await expect(spectatorPage.getByRole('status').filter({ hasText: '正在观战 · 公开视角' })).toBeVisible();
    expect((await roomView(spectatorPage, code)).viewer.kind).toBe('public_spectator');
    await expect(spectatorPage.getByRole('button', { name: '准备', exact: true })).toHaveCount(0);

    for (const page of formalPages) { await page.getByRole('button', { name: '准备', exact: true }).click(); await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible(); }
    await kickMember(hostPage, accounts[1]!.username);
    await expect(contexts[1]!.page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
    await expect(spectatorPage.getByRole('button', { name: '加入对局', exact: true })).toBeEnabled();
    await spectatorPage.getByRole('button', { name: '加入对局', exact: true }).click();
    await waitRoom(spectatorPage);
    await expect(memberCard(spectatorPage, accounts[5]!.username)).toContainText('未准备');
    await enterRoom(contexts[1]!.page, code);
    await expect(contexts[1]!.page.getByText('公开观众')).toBeVisible();

    await spectatorPage.getByRole('button', { name: '准备', exact: true }).click();
    for (const page of [formalPages[0]!, formalPages[2]!, formalPages[3]!, formalPages[4]!]) await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
    await contexts[2]!.context.setOffline(true);
    await contexts[2]!.page.goto('about:blank');
    await expect.poll(async () => (await roomView(hostPage, code)).room.formalMembers.find((member: Record<string, any>) => member.userId === accounts[2]!.userId)?.presence, { timeout: 30_000, intervals: [1000] }).toBe('offline');
    await hostPage.screenshot({ path: `/results/rooms-experimental-${testInfo.project.name}.png` });
    await hostPage.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(hostPage.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 20_000 });
    const started = await roomView(hostPage, code);
    expect(started.public.phase).toBe('night');
    expect(started.gameId).toEqual(expect.any(String));
    const gameId = started.gameId;
    await hostPage.reload();
    await expect(hostPage.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 20_000 });
    expect((await roomView(hostPage, code)).gameId).toBe(gameId);
    await hostPage.getByRole('button', { name: '房间管理', exact: true }).click();
    await expect(memberCard(hostPage, accounts[2]!.username).getByRole('button', { name: '移出' })).toHaveCount(0);
    await kickMember(hostPage, accounts[1]!.username);
    await expect(contexts[1]!.page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
    await contexts[2]!.context.setOffline(false);
    await contexts[2]!.page.goto(`/#/room/${code}`);
    await expect(contexts[2]!.page.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 20_000 });
    for (const { page } of contexts) await leaveRoom(page);
    await noHorizontalOverflow(hostPage);
  } finally {
    for (const { context } of contexts) await context.close();
  }
});

test('创建请求重试与同账号接管：保留原意图、taken_over 清旧端、状态不自动抢回', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const oldHost = await createPage(browser, accounts[0]!);
  const other = await createPage(browser, accounts[1]!);
  const createBodies: string[] = [];
  try {
    await oldHost.page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(oldHost.page.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
    const beforeRooms = await myRooms(oldHost.page);
    const beforeRoomIds = new Set((beforeRooms.rooms as Array<{ roomId: string }>).map(room => room.roomId));
    let createAttempts = 0;
    await oldHost.page.route('**/api/v2/rooms', async route => {
      createAttempts += 1;
      createBodies.push(route.request().postData() ?? '');
      if (createAttempts === 1) { await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await oldHost.page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(oldHost.page.getByText('尚未确认结果')).toBeVisible();
    await oldHost.page.getByRole('button', { name: '以原请求确认创建结果' }).click();
    await waitRoom(oldHost.page);
    expect(createBodies).toHaveLength(2);
    expect(createBodies[0]).toBe(createBodies[1]);
    const createBody = JSON.parse(createBodies[0]!);
    expect(createBody).toMatchObject({ presetId: 'default-13' });
    const rooms = await myRooms(oldHost.page);
    const addedRooms = (rooms.rooms as Array<{ roomId: string }>).filter(room => !beforeRoomIds.has(room.roomId));
    expect(addedRooms).toHaveLength(1);
    expect(rooms.currentRoomId).toBe(addedRooms[0]!.roomId);
    const code = (await oldHost.page.locator('.room-code strong').innerText()).trim();

    await enterRoom(other.page, code);
    await oldHost.page.getByRole('button', { name: '准备', exact: true }).click();
    await expect(oldHost.page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
    const takeover = await createPage(browser, accounts[0]!);
    try {
      await takeover.page.getByRole('button', { name: '我的房间' }).click();
      await expect(takeover.page.getByRole('heading', { name: '加入房间' })).toBeVisible();
      await takeover.page.getByLabel('房间码').fill(code);
      await takeover.page.getByRole('button', { name: '进入房间', exact: true }).click();
      await expect(takeover.page.getByRole('dialog')).toContainText('接管当前身份？');
      await takeover.page.getByRole('dialog').getByRole('button', { name: '确认接管' }).click();
      await waitRoom(takeover.page);
      await expect(oldHost.page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
      await expect(oldHost.page.getByText('另一台设备已接管你的房间身份。')).toBeVisible();
      await expect(memberCard(takeover.page, accounts[0]!.username)).toContainText('已准备');
      await expect(oldHost.page).toHaveURL(/#\/$/);
      await takeover.page.screenshot({ path: `/results/rooms-takeover-${testInfo.project.name}.png` });
      await dissolve(takeover.page);
      await expect(other.page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
      await noHorizontalOverflow(takeover.page);
    } finally {
      await takeover.context.close();
    }
  } finally {
    await oldHost.context.close();
    await other.context.close();
  }
});

test('房主在大厅退出即解散整房：本人与其余成员都回入口页、房间码失效', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const host = await createPage(browser, accounts[0]!);
  const joiner = await createPage(browser, accounts[1]!);
  try {
    await host.page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(host.page.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
    await host.page.getByRole('button', { name: '创建房间', exact: true }).click();
    await waitRoom(host.page);
    const code = (await host.page.locator('.room-code strong').innerText()).trim();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    await enterRoom(joiner.page, code);
    await expect(memberCard(host.page, accounts[1]!.username)).toBeVisible();

    // 房主用「离开房间」（不是「解散房间」）退出：大厅阶段语义就是解散整房。
    await host.page.getByRole('button', { name: '离开房间', exact: true }).click();
    const dialog = host.page.getByRole('dialog', { name: '离开房间？' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('解散');
    await host.page.screenshot({ path: `/results/rooms-host-leave-confirm-${testInfo.project.name}.png` });
    await dialog.getByRole('button', { name: '确认操作' }).click();

    await expect(host.page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible({ timeout: 20_000 });
    await host.page.screenshot({ path: `/results/rooms-host-leave-dissolve-${testInfo.project.name}.png` });

    // 其余成员一并被解散（实时 control{dissolved}），且房间码失效。
    await expect(joiner.page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible({ timeout: 25_000 });
    await expect(joiner.page.getByText('房间已解散。')).toBeVisible();
    await joiner.page.getByRole('button', { name: '加入房间', exact: true }).click();
    await joiner.page.getByLabel('房间码').fill(code);
    await joiner.page.getByRole('button', { name: '进入房间', exact: true }).click();
    await expect(joiner.page.getByRole('alert')).toContainText('房间不存在或已结束');
    await noHorizontalOverflow(host.page);
  } finally {
    await host.context.close();
    await joiner.context.close();
  }
});
