import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { dismissIdentityEntryReveal, loadRoomAccounts, enterRoom, leaveRoom, loginRoomAccount, roomView, waitRoom } from '../helpers-v2/rooms.ts';
import type { RoomAccount } from '../helpers-v2/account.ts';

async function open(browser: Browser, account: RoomAccount): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginRoomAccount(page, account);
  return { context, page };
}

async function setupSix(browser: Browser, accounts: RoomAccount[]) {
  const contexts: Array<{ context: BrowserContext; page: Page }> = [];
  const host = await open(browser, accounts[0]!); contexts.push(host);
  await host.page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(host.page.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
  await host.page.getByRole('button', { name: '自定义角色组成' }).click();
  await host.page.getByLabel('玩家人数').fill('6');
  for (const [label, value] of [['莱莱可人数', '0'], ['门先生人数', '1'], ['水妖人数', '0'], ['降临者人数', '0'], ['科研员人数', '1'], ['平民人数', '1'], ['死神人数', '1'], ['魂灵人数', '2'], ['丧亲者人数', '0']] as const) await host.page.getByLabel(label).fill(value);
  const create = host.page.waitForRequest(request => request.url().endsWith('/api/v2/rooms') && request.method() === 'POST');
  await host.page.getByRole('button', { name: '创建房间', exact: true }).click();
  expect((await create).postDataJSON()).toMatchObject({ playerCount: 6 });
  await waitRoom(host.page);
  const code = (await host.page.locator('.room-code strong').innerText()).trim();
  for (const account of accounts.slice(1, 6)) { const player = await open(browser, account); contexts.push(player); await enterRoom(player.page, code); }
  const observer = await open(browser, accounts[6]!); contexts.push(observer); await enterRoom(observer.page, code);
  for (const item of contexts.slice(0, 6)) { await item.page.getByRole('button', { name: '准备', exact: true }).click(); await expect(item.page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible(); }
  await host.page.getByRole('button', { name: '开始游戏', exact: true }).click();
  for (const item of contexts) {
    await expect(item.page.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 20_000 });
    if (contexts.indexOf(item) < 6) await dismissIdentityEntryReveal(item.page);
  }
  return { contexts, code };
}

test('真实阵营交流与第二屏授权撤销：只读公开/私人视角边界', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const { contexts, code } = await setupSix(browser, accounts);
  try {
    const views = await Promise.all(contexts.map(item => roomView(item.page, code)));
    const spiritIndexes = views.map((view, index) => view.private?.self.roleId === 'spirit' ? index : -1).filter(index => index >= 0);
    const doorIndex = views.findIndex(view => view.private?.self.roleId === 'door');
    expect(spiritIndexes).toHaveLength(2); expect(doorIndex).toBeGreaterThanOrEqual(0);
    const spirit = contexts[spiritIndexes[0]!]!.page;
    const otherSpirit = contexts[spiritIndexes[1]!]!.page;
    const door = contexts[doorIndex]!.page;
    const observer = contexts[6]!.page;
    await spirit.getByRole('tab', { name: '情报' }).click();
    const factionInput = spirit.getByLabel('阵营消息');
    await expect(factionInput).toBeVisible();
    const factionRequest = spirit.waitForRequest(request => request.url().endsWith('/chat') && request.method() === 'POST');
    await factionInput.fill('夜间阵营消息');
    await spirit.getByRole('button', { name: '发送阵营消息' }).click();
    expect((await factionRequest).postDataJSON()).toMatchObject({ channel: 'faction', text: '夜间阵营消息', gameId: views[spiritIndexes[0]!]!.gameId });
    await expect.poll(async () => (await roomView(otherSpirit, code)).chat.faction.some((message: Record<string, any>) => message.text === '夜间阵营消息')).toBe(true);
    for (const index of [0, 1, 2, 3, 4, 5, 6]) if (!spiritIndexes.includes(index)) expect((await roomView(contexts[index]!.page, code)).chat.faction.some((message: Record<string, any>) => message.text === '夜间阵营消息')).toBe(false);
    await expect(door.getByLabel('公屏消息')).toBeDisabled();

    await spirit.getByRole('button', { name: '第二屏', exact: true }).click();
    await spirit.getByRole('button', { name: '生成第二屏邀请' }).click();
    const token = await spirit.getByLabel('私人邀请码').inputValue();
    expect(token.length).toBeGreaterThan(10);
    await spirit.getByRole('button', { name: '关闭' }).click();
    await spirit.screenshot({ path: `/results/real-screen-invite-${testInfo.project.name}.png` });
    await observer.getByRole('button', { name: '第二屏', exact: true }).click();
    await observer.getByLabel('输入私人邀请').fill(token);
    await observer.getByRole('button', { name: '兑换第二屏邀请' }).click();
    await expect.poll(async () => (await roomView(observer, code)).viewer.kind).toBe('private_spectator');
    const privateObserver = await roomView(observer, code);
    expect(privateObserver.viewer.readOnly).toBe(true);
    expect(privateObserver.viewer.subjectPlayerId).toBe((await roomView(spirit, code)).viewer.subjectPlayerId);
    expect(privateObserver.private?.factionRoom?.readOnly).toBe(true);
    await expect(observer.getByLabel('公屏消息')).toHaveCount(0);
    await expect(observer.getByLabel('阵营消息')).toHaveCount(0);
    await spirit.getByRole('button', { name: '第二屏', exact: true }).click();
    await spirit.getByRole('button', { name: '撤销第二屏授权' }).click();
    await spirit.getByRole('button', { name: '确认撤销' }).click();
    await expect.poll(async () => (await roomView(observer, code)).viewer.kind).toBe('public_spectator');
    expect((await roomView(observer, code)).private).toBeNull();
    await expect(observer.getByText('阵营交流记录')).toHaveCount(0);
  } finally {
    for (const item of contexts) await leaveRoom(item.page);
    for (const item of contexts) await item.context.close();
  }
});

test('真实转日公屏：授权后两玩家交换一次消息并验证 Socket 去重/原文', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const { contexts, code } = await setupSix(browser, accounts);
  try {
    const views = await Promise.all(contexts.slice(0, 6).map(item => roomView(item.page, code)));
    await expect.poll(async () => (await roomView(contexts[0]!.page, code)).public.phase, { timeout: 150_000, intervals: [1000] }).toBe('day');
    const current = await Promise.all(contexts.slice(0, 6).map(item => roomView(item.page, code)));
    const writers = current.map((view, index) => view.capabilities.canPostPublic ? index : -1).filter(index => index >= 0);
    expect(writers.length).toBeGreaterThanOrEqual(2);
    const sender = contexts[writers[0]!]!.page;
    const receiver = contexts[writers[1]!]!.page;
    const text = '<strong>真实公屏原文</strong>';
    let aborted = false;
    const senderBodies: string[] = [];
    await sender.route('**/api/v2/rooms/*/chat', async route => {
      const body = route.request().postData() ?? '';
      if (body.includes(text)) {
        senderBodies.push(body);
        if (!aborted) { aborted = true; await route.fetch(); await route.abort('failed'); return; }
      }
      await route.continue();
    });
    await sender.getByLabel('公屏消息').fill(text);
    await sender.getByRole('button', { name: '发送公屏消息' }).click();
    await expect.poll(() => senderBodies.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(senderBodies[0]!) as Record<string, any>;
    expect(body).toMatchObject({ gameId: current[writers[0]!]!.gameId, channel: 'public', text });
    const retry = sender.getByRole('button', { name: '重试原消息' });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await expect.poll(async () => (await roomView(receiver, code)).chat.public.filter((message: Record<string, any>) => message.text === text).length).toBe(1);
    await expect(receiver.getByText(text, { exact: true })).toBeVisible();
    expect((await roomView(receiver, code)).chat.public.filter((message: Record<string, any>) => message.text === text)).toHaveLength(1);
    const reply = '真实公屏回复';
    await receiver.getByLabel('公屏消息').fill(reply);
    await receiver.getByRole('button', { name: '发送公屏消息' }).click();
    await expect.poll(async () => (await roomView(sender, code)).chat.public.filter((message: Record<string, any>) => message.text === reply).length).toBe(1);
    await expect(sender.getByText(reply, { exact: true })).toBeVisible();
    await sender.evaluate(() => window.scrollTo(0, 0));
    await sender.screenshot({ path: `/results/real-chat-day-${testInfo.project.name}.png` });
    void views;
  } finally {
    for (const item of contexts) await leaveRoom(item.page);
    for (const item of contexts) await item.context.close();
  }
});
