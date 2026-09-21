import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  const chats: Array<Record<string, unknown>> = [];
  let chatMode: 'accepted' | 'unknown' = 'accepted';
  let chatAttempts = 0;
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/view', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current.view) }));
  await page.route('**/api/v2/rooms/*/chat', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    chats.push(structuredClone(body));
    chatAttempts += 1;
    if (chatMode === 'unknown' && chatAttempts === 1) { await route.fetch(); await route.abort('failed'); return; }
    const senderId = current.view.viewer.subjectPlayerId!;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ gameId: body.gameId, channel: body.channel, message: { messageId: 'server-' + chats.length, clientMessageId: body.clientMessageId, cursor: 900 + chats.length, senderId, text: body.text, at: 1000 } }) });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: /夜幕降临|晨间公告/ })).toBeVisible();
  return { chats, setMode: (mode: 'accepted' | 'unknown') => { chatMode = mode; chatAttempts = 0; }, setFixture: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

test('聊天 composer：精确 payload、纯文本、Enter/IME/ShiftEnter 与 UTF16 限制', async ({ page }) => {
  const fixture = loadGameFixture();
  fixture.view.capabilities.canPostPublic = true;
  fixture.view.capabilities.canPostFaction = true;
  fixture.view.private!.factionRoom = { roomId: 'faction-room', readOnly: false, canWrite: true, members: [] };
  const mounted = await mount(page, fixture);
  const publicInput = page.getByLabel('公屏消息');
  await publicInput.fill('<b>纯文本</b>');
  await publicInput.press('Shift+Enter');
  expect(await publicInput.inputValue()).toContain('\n');
  await publicInput.press('Enter');
  await expect.poll(() => mounted.chats.length).toBe(1);
  expect(Object.keys(mounted.chats[0]!).sort()).toEqual(['channel', 'clientMessageId', 'gameId', 'text']);
  expect(mounted.chats[0]).toMatchObject({ channel: 'public', gameId: fixture.view.gameId, text: '<b>纯文本</b>\n' });
  await expect(page.getByText('<b>纯文本</b>', { exact: false })).toBeVisible();

  await publicInput.fill('组合输入');
  await publicInput.dispatchEvent('compositionstart');
  await publicInput.press('Enter');
  expect(mounted.chats.length).toBe(1);
  await publicInput.dispatchEvent('compositionend');
  await publicInput.press('Enter');
  await expect.poll(() => mounted.chats.length).toBe(2);

  await publicInput.fill('😀'.repeat(250));
  await expect(page.getByText('500 / 500')).toBeVisible();
  await expect(page.getByRole('button', { name: '发送公屏消息' })).toBeEnabled();
  await page.getByRole('tab', { name: '情报' }).click();
  await expect(page.getByRole('textbox', { name: '阵营消息' })).toBeVisible();
  await page.getByRole('textbox', { name: '阵营消息' }).fill('阵营原文');
  await page.getByRole('button', { name: '发送阵营消息' }).click();
  await expect.poll(() => mounted.chats.length).toBe(3);
  expect(mounted.chats.at(-1)).toMatchObject({ channel: 'faction', gameId: fixture.view.gameId, text: '阵营原文' });
  mounted.setMode('unknown');
  await page.getByRole('tab', { name: '公屏' }).click();
  await publicInput.fill('保留原文');
  await publicInput.press('Enter');
  await expect(page.getByText('尚未确认送达')).toBeVisible();
  const unknownBody = structuredClone(mounted.chats.at(-1)!);
  mounted.setMode('accepted');
  await page.getByRole('button', { name: '重试原消息' }).click();
  await expect.poll(() => mounted.chats.length).toBe(5);
  expect(mounted.chats.at(-1)?.clientMessageId).toBe(unknownBody.clientMessageId);
  expect(mounted.chats.at(-1)?.text).toBe(unknownBody.text);
});

test('readonly、能力禁写与 scope 变化：草稿保持后跨局清空', async ({ page }) => {
  const fixture = loadGameFixture();
  fixture.view.capabilities.canPostPublic = true;
  const mounted = await mount(page, fixture);
  const input = page.getByLabel('公屏消息');
  await input.fill('待发送草稿');
  const noWrite = structuredClone(fixture.view);
  noWrite.capabilities.canPostPublic = false;
  await mounted.setFixture({ ...fixture, view: noWrite });
  await expect(input).toHaveValue('待发送草稿');
  await expect(input).toBeDisabled();

  const readonly = structuredClone(noWrite);
  readonly.viewer.readOnly = true;
  readonly.viewer.kind = 'public_spectator';
  readonly.private = null;
  await mounted.setFixture({ ...fixture, view: readonly });
  await expect(page.getByLabel('公屏消息')).toHaveCount(0);

  const changed = structuredClone(fixture.view);
  changed.gameId = 'new-game-information';
  changed.viewer.subjectPlayerId = changed.public!.seats[1]!.playerId;
  await mounted.setFixture({ ...fixture, view: changed });
  await expect(page.getByLabel('公屏消息')).toHaveValue('');
});

test('聊天/事件历史：分段早历史、滚动未读、cursor 独立与公开票型语义', async ({ page }) => {
  const fixture = loadGameFixture();
  fixture.view.capabilities.canPostPublic = true;
  fixture.view.capabilities.canPostFaction = true;
  fixture.view.private!.factionRoom = { roomId: 'faction-room', readOnly: false, canWrite: true, members: [] };
  fixture.view.chat.public = Array.from({ length: 160 }, (_, index) => ({ messageId: 'chat-' + index, clientMessageId: 'client-' + index, cursor: index + 1, senderId: fixture.view.viewer.subjectPlayerId!, text: '聊天记录 ' + index, at: index }));
  fixture.view.public!.events = Array.from({ length: 120 }, (_, index) => ({ cursor: index + 1, type: index === 0 ? 'game_started' : 'night_started', dayNumber: 1, stage: 1 as const, payload: index === 0 ? {} : { nightNumber: index + 1 } })) as any;
  fixture.view.chat.faction = [{ messageId: 'faction-1', clientMessageId: 'faction-client-1', cursor: 1, senderId: fixture.view.viewer.subjectPlayerId!, text: '阵营独立游标', at: 1 }];
  const mounted = await mount(page, fixture);
  const history = page.getByRole('tabpanel', { name: '公屏' }).getByLabel('公屏历史');
  await expect(page.getByRole('button', { name: /条新消息/ })).toHaveCount(0);
  await expect(history.getByText('聊天记录 159')).toBeVisible();
  await history.getByRole('button', { name: '显示更早的本局记录' }).click();
  await expect(history.getByText('聊天记录 0')).toBeVisible();
  await expect(history.getByText('聊天记录 159')).toHaveCount(1);
  await history.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  const scrollTopBeforeMessage = await history.evaluate(element => element.scrollTop);
  await page.getByLabel('公屏消息').fill('历史滚动期间的草稿');
  await page.getByRole('tab', { name: '情报' }).click();
  await page.getByRole('tab', { name: '公屏' }).click();
  await expect(page.getByLabel('公屏消息')).toHaveValue('历史滚动期间的草稿');
  expect(await history.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(scrollTopBeforeMessage + 1);
  const updated = structuredClone(fixture);
  updated.view.chat.public.push({ messageId: 'chat-new', clientMessageId: 'client-new', cursor: 161, senderId: fixture.view.viewer.subjectPlayerId!, text: '滚动时新消息', at: 161 });
  updated.view.chat.public.push(structuredClone(fixture.view.chat.public[159]!));
  await mounted.setFixture(updated);
  await expect(page.getByRole('button', { name: /条新消息/ })).toBeVisible();
  await expect(history.getByText('聊天记录 159')).toHaveCount(1);
  expect(await history.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(scrollTopBeforeMessage + 1);

  const split = structuredClone(updated);
  split.view.public!.events = [...updated.view.public!.events, { cursor: 201, type: 'election_started', dayNumber: 1, stage: 1, payload: {} }, { cursor: 202, type: 'day_ended', dayNumber: 1, stage: 1, payload: {} }] as any;
  split.view.private!.events = [...updated.view.private!.events, { cursor: 201, type: 'spirit_knowledge', dayNumber: 1, stage: 1, payload: { seats: [3] } }] as any;
  await mounted.setFixture(split);
  await page.getByRole('tab', { name: '记录' }).click();
  const publicRows = page.getByRole('tabpanel', { name: '记录' }).locator('.event-row strong');
  expect((await publicRows.allTextContents()).slice(-2)).toEqual(['天理竞选开始', '白天结束']);
  await expect(publicRows.filter({ hasText: '演出开始' })).toHaveCount(0);
  await page.getByRole('button', { name: '显示更早的事件' }).click();
  await expect(publicRows.first()).toHaveText('演出开始');
  await page.getByRole('tab', { name: '情报' }).click();
  const privateRows = page.getByRole('tabpanel', { name: '情报' }).locator('.event-row strong');
  await expect(privateRows.filter({ hasText: '获知魂灵名单' })).toHaveCount(1);
  await expect(privateRows.filter({ hasText: '白天结束' })).toHaveCount(0);

  const unknown = structuredClone(updated);
  unknown.view.public!.events = [...updated.view.public!.events, { cursor: 1000, type: 'unknown_internal_event', dayNumber: 1, stage: 1, payload: { secret: 'do-not-render-json' } }];
  await mounted.setFixture(unknown);
  await page.getByRole('tab', { name: '记录' }).click();
  await expect(page.getByText('事件记录')).toBeVisible();
  await expect(page.getByText('do-not-render-json')).toHaveCount(0);
  await expect(page.getByText('投票票型')).toHaveCount(0);
  await page.getByRole('tab', { name: '公屏' }).click();
  await page.getByRole('tab', { name: '情报' }).click();
  await expect(page.getByText('阵营独立游标')).toBeVisible();
  const voteView = structuredClone(unknown);
  voteView.view.public!.events = [...unknown.view.public!.events, { cursor: 2000, type: 'election_result', dayNumber: 1, stage: 1, payload: { votes: [{ voterSeat: 1, targetSeat: 2, units: 3 }], tally: [{ seat: 2, units: 3 }], winnerSeat: 2, tiedSeats: [] } }];
  await mounted.setFixture(voteView);
  await page.getByRole('tab', { name: '记录' }).click();
  await expect(page.getByText('1.5票')).toBeVisible();
});

test('规则入口：关键词、空结果、当前角色与当前阶段跳转', async ({ page }) => {
  const fixture = loadGameFixture();
  const mounted = await mount(page, fixture);
  await page.getByRole('tab', { name: '规则' }).click();
  await page.getByRole('button', { name: '打开完整规则' }).click();
  await expect(page.getByRole('dialog')).toContainText('完整规则 · 2.0');
  const search = page.getByRole('searchbox', { name: '搜索规则' });
  await search.fill('门先生');
  await expect(page.getByRole('region', { name: '规则搜索结果' })).toContainText('找到');
  await search.focus();
  const updated = structuredClone(fixture);
  updated.view.chat.public.push({ messageId: 'rules-message', clientMessageId: 'rules-client', cursor: 999, senderId: fixture.view.viewer.subjectPlayerId!, text: '规则弹层期间消息', at: 999 });
  await mounted.setFixture(updated);
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label'))).toBe('搜索规则');
  await search.fill('不存在的关键词');
  await expect(page.getByRole('region', { name: '规则搜索结果' })).toContainText('找到 0 个章节');
  await search.fill('');
  await expect(page.getByRole('button', { name: '当前角色规则' })).toBeVisible();
  await expect(page.getByRole('button', { name: '当前阶段规则' })).toBeVisible();
  await page.getByRole('button', { name: '当前角色规则' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: /04 神职/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '当前阶段规则' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: /03 开局与夜间流程/ }).first()).toBeVisible();
  await expectNoOverflow(page);
  await page.screenshot({ path: '/results/information-' + test.info().project.name + '.png' });
  void mounted;
});

test('死神/魂灵知识：已知魂灵在座位卡与身份弹窗中可见，其他身份不可见', async ({ page }) => {
  const deathFixture = loadGameFixture('night-death-full.json');
  const spiritSeats = deathFixture.view.private!.knowledge.spiritSeats;
  expect(spiritSeats.length).toBeGreaterThan(0);
  await mount(page, deathFixture);
  for (const seat of spiritSeats) {
    const playerId = deathFixture.view.public!.seats.find(item => item.seat === seat)!.playerId;
    await expect(page.locator(`[data-player-id="${playerId}"] .seat-known`)).toHaveText('魂灵');
  }
  await page.getByRole('button', { name: '我的身份' }).click();
  await expect(page.getByRole('dialog')).toContainText(`已知身份 · 魂灵：${spiritSeats.map(seat => `${seat}号`).join('、')}`);
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const spiritFixture = loadGameFixture('night-spirit-full.json');
  const ownSeat = spiritFixture.view.private!.self.seat;
  const spiritPeers = spiritFixture.view.private!.knowledge.spiritSeats;
  expect(spiritPeers).not.toContain(ownSeat);
  await mount(page, spiritFixture);
  for (const seat of spiritPeers) {
    const playerId = spiritFixture.view.public!.seats.find(item => item.seat === seat)!.playerId;
    await expect(page.locator(`[data-player-id="${playerId}"] .seat-known`)).toHaveText('魂灵');
  }
  await expect(page.locator(`[data-player-id="${spiritFixture.view.private!.self.playerId}"] .seat-known`)).toHaveCount(0);

  const doorFixture = loadGameFixture('night-door-full.json');
  const mounted = await mount(page, doorFixture);
  await expect(page.locator('.seat-known')).toHaveCount(0);
  await page.getByRole('button', { name: '我的身份' }).click();
  await expect(page.getByRole('dialog')).not.toContainText('已知身份');
  void mounted;
});

test('房间管理视图保持聊天非零滚动位置与草稿', async ({ page }) => {
  const fixture = loadGameFixture();
  fixture.view.capabilities.canPostPublic = true;
  fixture.view.chat.public = Array.from({ length: 120 }, (_, index) => ({ messageId: 'manage-chat-' + index, clientMessageId: 'manage-client-' + index, cursor: index + 1, senderId: fixture.view.viewer.subjectPlayerId!, text: '管理视图消息 ' + index, at: index }));
  const mounted = await mount(page, fixture);
  const history = page.getByLabel('公屏历史');
  const input = page.getByLabel('公屏消息');
  await input.fill('管理视图草稿');
  await history.evaluate(element => { element.scrollTop = 200; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  const before = await history.evaluate(element => element.scrollTop);
  expect(before).toBeGreaterThan(0);
  await page.getByRole('button', { name: '房间管理', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回舞台', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回舞台', exact: true }).click();
  await expect(input).toHaveValue('管理视图草稿');
  const after = await history.evaluate(element => element.scrollTop);
  expect(after).toBeGreaterThan(0);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  void mounted;
});

async function expectNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
