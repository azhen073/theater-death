import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { revealHudActions } from '../helpers-v2/rooms.ts';
import { loadGameFixture, pushFixture, taskFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

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
  await page.getByRole('tab', { name: '公屏' }).click();
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
    // 徽标在座位号行内（方案 B），单枚徽标 = 一个底色块；盒子必须有真实高度
    // （回归闸门：旧的 `writing-mode: vertical-rl` 在容器字体下盒高恒为 0、两个字重叠成一个）
    const strip = page.locator(`[data-player-id="${playerId}"] .seat-number > .badge-strip`);
    await expect(strip.locator('[data-badge="spirit"]')).toHaveText('魂灵');
    await expect(strip).toHaveAttribute('aria-label', '魂灵');
    expect((await strip.boundingBox())!.height).toBeGreaterThan(8);
  }
  await revealHudActions(page); await page.getByRole('button', { name: '我的身份' }).click();
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
    await expect(page.locator(`[data-player-id="${playerId}"] [data-badge="spirit"]`)).toHaveText('魂灵');
  }
  // 本人座位只有「身份」徽标（新增），不应出现「魂灵」知识徽标
  await expect(page.locator(`[data-player-id="${spiritFixture.view.private!.self.playerId}"] [data-badge="spirit"]`)).toHaveCount(0);

  const doorFixture = loadGameFixture('night-door-full.json');
  const mounted = await mount(page, doorFixture);
  // 门先生没有私有知识、也不是天理 → 除本人座位上的「身份」徽标外，不应有任何知识/职务徽标
  await expect(page.locator('[data-badge="spirit"]')).toHaveCount(0);
  await expect(page.locator('[data-badge="sheriff"]')).toHaveCount(0);
  await expect(page.locator('[data-badge="identity"]')).toHaveCount(1);
  await revealHudActions(page); await page.getByRole('button', { name: '我的身份' }).click();
  await expect(page.getByRole('dialog')).not.toContainText('已知身份');
  void mounted;
});

test('座位徽标：天理与魂灵共用一个底色框、左半天理右半魂灵，且不改变座位卡高度', async ({ page }) => {
  const fixture = loadGameFixture('night-spirit-full.json');
  const peerSeat = fixture.view.private!.knowledge.spiritSeats[0]!;
  const peerId = fixture.view.public!.seats.find(item => item.seat === peerSeat)!.playerId;
  const plainId = fixture.view.public!.seats.find(item => item.seat !== peerSeat && item.playerId !== fixture.view.private!.self.playerId)!.playerId;
  fixture.view.public!.sheriff = { enabled: true, holderId: peerId };
  await mount(page, fixture);

  const strip = page.locator(`[data-player-id="${peerId}"] .seat-number > .badge-strip`);
  await expect(strip).toHaveClass(/badge-strip--split/);
  await expect(strip).toHaveAttribute('aria-label', '天理、魂灵');
  await expect(strip.locator('[data-badge="sheriff"]')).toHaveText('天理');
  await expect(strip.locator('[data-badge="spirit"]')).toHaveText('魂灵');
  // 双徽标：等分底色框（左半天理、右半魂灵，底色不同、宽度相等、盒子有高度）
  const halves = await strip.evaluate(node => {
    const [left, right] = Array.from(node.children) as HTMLElement[];
    const l = left!.getBoundingClientRect(), r = right!.getBoundingClientRect();
    return {
      order: [left!.textContent, right!.textContent], leftX: l.x, rightX: r.x, leftW: l.width, rightW: r.width,
      leftH: l.height, rightH: r.height,
      leftBg: getComputedStyle(left!).backgroundColor, rightBg: getComputedStyle(right!).backgroundColor,
      leftColor: getComputedStyle(left!).color,
    };
  });
  expect(halves.order).toEqual(['天理', '魂灵']);
  expect(halves.leftX).toBeLessThan(halves.rightX);
  expect(halves.leftBg).not.toBe(halves.rightBg);
  expect(halves.leftColor).toBe('rgb(255, 255, 255)');
  expect(Math.abs(halves.leftW - halves.rightW)).toBeLessThan(1);
  expect(halves.leftH).toBeGreaterThan(8);
  expect(halves.rightH).toBeGreaterThan(8);
  // 两枚 2 字徽标（天理 + 魂灵）与号码同排：卡片不加高、不换行、不裁字，且 8px 字号生效
  const cardHeight = await page.locator(`[data-player-id="${peerId}"] .seat-main`).evaluate(node => node.getBoundingClientRect().height);
  const plainHeight = await page.locator(`[data-player-id="${plainId}"] .seat-main`).evaluate(node => node.getBoundingClientRect().height);
  expect(Math.abs(cardHeight - plainHeight)).toBeLessThan(1);
  expect(await page.locator(`[data-player-id="${peerId}"] .seat-number`).evaluate(node => getComputedStyle(node).flexDirection)).toBe('row');
  await expect(strip.locator('[data-badge="sheriff"]')).toHaveCSS('font-size', '8px');
  // 行宽仍有余量（不贴边，因此不会触发 flex-wrap 兜底）
  const room = await strip.evaluate(node => {
    const card = node.closest('.seat-main') as HTMLElement;
    const style = getComputedStyle(card);
    const available = card.getBoundingClientRect().width - parseFloat(style.paddingLeft) * 2 - parseFloat(style.borderLeftWidth) * 2;
    return available - (node.parentElement as HTMLElement).getBoundingClientRect().width;
  });
  expect(room).toBeGreaterThan(8);
  const inside = await strip.evaluate(node => {
    const card = node.closest('.seat-main')!.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return box.left >= card.left - 0.5 && box.right <= card.right + 0.5;
  });
  expect(inside).toBe(true);
  // 4 倍放大存档（仅 chromium：CDP 截屏在 WebKit 不可用）：确认两半底色与两个字都真实绘制
  // （旧的竖排实现盒高为 0、两个字重叠成一个）
  const card = await page.locator(`[data-player-id="${peerId}"] .seat-main`).boundingBox();
  if (card && test.info().project.name === 'chromium') {
    const client = await page.context().newCDPSession(page);
    const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...card, scale: 4 } });
    writeFileSync(`/results/seat-badges-zoom-${test.info().project.name}.png`, Buffer.from(shot.data, 'base64'));
  }
  await page.screenshot({ path: '/results/seat-badges-' + test.info().project.name + '.png', fullPage: true });

  // 390 宽：双徽标不产生横向溢出，仍在卡内
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(`[data-player-id="${peerId}"] [data-badge="sheriff"]`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/results/seat-badges-mobile-' + test.info().project.name + '.png', fullPage: true });

  // 320 宽：≤359px 走两列网格 → 双徽标仍与号码同排、卡内有余量、卡片不加高
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.locator('.stage-seats').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2);
  expect(await page.locator(`[data-player-id="${peerId}"] .seat-number`).evaluate(node => getComputedStyle(node).flexDirection)).toBe('row');
  const narrowRoom = await strip.evaluate(node => {
    const card = node.closest('.seat-main') as HTMLElement;
    const style = getComputedStyle(card);
    const available = card.getBoundingClientRect().width - parseFloat(style.paddingLeft) * 2 - parseFloat(style.borderLeftWidth) * 2;
    return available - (node.parentElement as HTMLElement).getBoundingClientRect().width;
  });
  expect(narrowRoom).toBeGreaterThan(12);
  expect(await strip.evaluate(node => {
    const card = node.closest('.seat-main')!.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return box.left >= card.left - 0.5 && box.right <= card.right + 0.5;
  })).toBe(true);
  expect(await strip.evaluate(node => Array.from(node.children).some(child => child.scrollWidth > child.clientWidth + 1))).toBe(false);
  const narrowPlain = await page.locator(`[data-player-id="${plainId}"] .seat-main`).evaluate(node => node.getBoundingClientRect().height);
  const narrowBadge = await page.locator(`[data-player-id="${peerId}"] .seat-main`).evaluate(node => node.getBoundingClientRect().height);
  expect(Math.abs(narrowBadge - narrowPlain)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/results/seat-badges-320-' + test.info().project.name + '.png', fullPage: true });
});

test('本人座位身份徽标：只出现在自己的座位上，第二屏同样显示', async ({ page }) => {
  // 门先生本人（11 号）：身份徽标＝门先生（人类阵营配色），全场只有一处
  const door = loadGameFixture('night-door-full.json');
  await mount(page, door);
  const selfId = door.view.viewer.subjectPlayerId!;
  await expect(page.locator(`[data-player-id="${selfId}"] [data-badge="identity"]`)).toHaveText('门先生');
  await expect(page.locator(`[data-player-id="${selfId}"] [data-badge="identity"]`)).toHaveAttribute('data-faction', 'human');
  await expect(page.locator(`[data-player-id="${selfId}"] [data-badge="identity"]`)).toHaveCSS('background-color', 'rgb(61, 107, 156)');
  // 本人座位不再显示「你」标记（身份徽标已表明是自己）；无障碍名保留「你的座位」
  await expect(page.locator(`[data-player-id="${selfId}"] .seat-number small`)).toHaveCount(0);
  await expect(page.locator(`[data-player-id="${selfId}"] .seat-main`)).toHaveAttribute('aria-label', /你的座位/);
  await expect(page.locator('[data-badge="identity"]')).toHaveCount(1);
  // 统一配色：身份弹窗里的阵营标签与座位徽标同色
  await revealHudActions(page); await page.getByRole('button', { name: '我的身份' }).click();
  const tagColor = await page.locator('.identity-view .faction-tag').evaluate(node => getComputedStyle(node).backgroundColor);
  const badgeColor = await page.locator(`[data-player-id="${selfId}"] [data-badge="identity"]`).evaluate(node => getComputedStyle(node).backgroundColor);
  expect(tagColor).toBe(badgeColor);
  await expect(page.locator('.identity-view .faction-tag')).toHaveText('人类阵营');
  await page.getByRole('button', { name: '关闭' }).click();
  // 不新增行：座位卡高度与其它座位一致
  const others = door.view.public!.seats.filter(item => item.playerId !== selfId);
  const selfHeight = await page.locator(`[data-player-id="${selfId}"] .seat-main`).evaluate(node => node.getBoundingClientRect().height);
  const otherHeight = await page.locator(`[data-player-id="${others[0]!.playerId}"] .seat-main`).evaluate(node => node.getBoundingClientRect().height);
  expect(Math.abs(selfHeight - otherHeight)).toBeLessThan(1);
  await page.screenshot({ path: '/results/seat-identity-' + test.info().project.name + '.png', fullPage: true });

  // 魂灵本人（4 号）：自己的「魂灵」是身份徽标（死神阵营配色），同伴的「魂灵」是私有知识徽标，两者并存但语义不同
  const spirit = loadGameFixture('night-spirit-full.json');
  await mount(page, spirit);
  const spiritSelfId = spirit.view.private!.self.playerId;
  const peerId = spirit.view.public!.seats.find(item => item.seat === spirit.view.private!.knowledge.spiritSeats[0]!)!.playerId;
  await expect(page.locator(`[data-player-id="${spiritSelfId}"] [data-badge="identity"]`)).toHaveText('魂灵');
  await expect(page.locator(`[data-player-id="${spiritSelfId}"] [data-badge="identity"]`)).toHaveAttribute('data-faction', 'death');
  await expect(page.locator(`[data-player-id="${spiritSelfId}"] [data-badge="identity"]`)).toHaveCSS('background-color', 'rgb(143, 59, 72)');
  await expect(page.locator(`[data-player-id="${spiritSelfId}"] [data-badge="spirit"]`)).toHaveCount(0);
  await expect(page.locator(`[data-player-id="${peerId}"] [data-badge="spirit"]`)).toHaveText('魂灵');
  await expect(page.locator(`[data-player-id="${peerId}"] [data-badge="identity"]`)).toHaveCount(0);
  await expect(page.locator('[data-badge="identity"]')).toHaveCount(1);

  // 第二屏：绑定玩家的座位显示身份徽标，座位号行标「视角」而不是「你」
  const second = loadGameFixture('private-second-screen-full.json');
  await mount(page, second);
  const boundId = second.view.viewer.subjectPlayerId!;
  await expect(page.locator(`[data-player-id="${boundId}"] [data-badge="identity"]`)).toHaveText('门先生');
  await expect(page.locator(`[data-player-id="${boundId}"] .seat-number small`)).toHaveText('视角');
  await expect(page.locator('[data-badge="identity"]')).toHaveCount(1);
  await page.screenshot({ path: '/results/seat-identity-second-screen-' + test.info().project.name + '.png', fullPage: true });
});

test('多个徽标同时存在：身份+天理 一个底色框等分，且不与草稿/已选角标重叠', async ({ page }) => {
  const fixture = loadGameFixture('night-spirit-full.json');
  const selfId = fixture.view.private!.self.playerId;
  const selfSeat = fixture.view.private!.self.seat;
  const peerSeat = fixture.view.private!.knowledge.spiritSeats[0]!;
  const peerId = fixture.view.public!.seats.find(item => item.seat === peerSeat)!.playerId;
  const picks = fixture.view.public!.seats.filter(seat => seat.alive).slice(0, 4).map(seat => seat.playerId);
  const task = taskFixture(fixture.view, 'EDIT_PROPOSAL', { playerIds: picks, maxTargets: 2, allowRepeated: true, canSkip: true, forbiddenPairs: [] });
  // 本人既是天理、又是方案草稿目标（点击后再加上「已选」）；同伴保留「魂灵」知识徽标
  task.view.public!.sheriff = { enabled: true, holderId: selfId };
  task.view.private!.proposal = { ...task.view.private!.proposal!, revision: 1, targetPlayerIds: [selfId] };
  await mount(page, task);

  const strip = page.locator(`[data-player-id="${selfId}"] .seat-number > .badge-strip`);
  await expect(strip).toHaveClass(/badge-strip--split/);
  await expect(strip).toHaveAttribute('aria-label', '魂灵、天理');
  await expect(strip.locator('[data-badge="identity"]')).toHaveText('魂灵');
  await expect(strip.locator('[data-badge="sheriff"]')).toHaveText('天理');
  await page.locator(`[data-player-id="${selfId}"] .seat-main`).click();
  await expect(page.locator(`[data-player-id="${selfId}"] .seat-count`)).toHaveText('已选');
  await expect(page.locator(`[data-player-id="${selfId}"] .seat-draft`)).toHaveText('草稿');
  await expect(page.locator(`[data-player-id="${peerId}"] [data-badge="spirit"]`)).toHaveText('魂灵');

  // 两半等分、底色不同（身份＝死神阵营红、天理＝金）、顺序＝身份在前
  const layout = await strip.evaluate(node => {
    const [left, right] = Array.from(node.children) as HTMLElement[];
    const l = left!.getBoundingClientRect(), r = right!.getBoundingClientRect();
    const card = node.closest('.seat-main')!.getBoundingClientRect();
    const chips = [...node.closest('.stage-seat')!.querySelectorAll('.seat-count, .seat-draft')].map(chip => chip.getBoundingClientRect());
    const overlap = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    return {
      order: [left!.textContent, right!.textContent], leftW: l.width, rightW: r.width, leftH: l.height,
      leftBg: getComputedStyle(left!).backgroundColor, rightBg: getComputedStyle(right!).backgroundColor,
      stripBox: { left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right },
      inside: node.getBoundingClientRect().left >= card.left - 0.5 && node.getBoundingClientRect().right <= card.right + 0.5,
      chipOverlap: chips.some(chip => overlap(node.getBoundingClientRect(), chip)),
      diag: JSON.stringify({ strip: node.getBoundingClientRect().toJSON(), card: card.toJSON(), chips: chips.map(chip => chip.toJSON()) }),
      whitespace: getComputedStyle(left!).whiteSpace,
    };
  });
  expect(layout.order).toEqual(['魂灵', '天理']);
  expect(layout.leftBg).toBe('rgb(143, 59, 72)');
  expect(layout.rightBg).toBe('rgb(129, 112, 76)');
  expect(Math.abs(layout.leftW - layout.rightW)).toBeLessThan(1);
  expect(layout.leftH).toBeGreaterThan(8);
  expect(layout.inside).toBe(true);
  expect(layout.chipOverlap, layout.diag).toBe(false);
  expect(layout.whitespace).toBe('nowrap');
  // 文字不被裁切（每半块内容宽度不超过盒子）
  const clipped = await strip.evaluate(node => Array.from(node.children).some(child => child.scrollWidth > child.clientWidth + 1));
  expect(clipped).toBe(false);
  // 两枚 2 字徽标（魂灵 + 天理）与号码同排：卡片不加高、两引擎一致，且行内仍有余量
  expect(await page.locator(`[data-player-id="${selfId}"] .seat-number`).evaluate(node => getComputedStyle(node).flexDirection)).toBe('row');
  const h = (id: string) => page.locator(`[data-player-id="${id}"] .seat-main`).evaluate(node => node.getBoundingClientRect().height);
  const plainId = fixture.view.public!.seats.find(seat => seat.playerId !== selfId && seat.playerId !== peerId)!.playerId;
  expect(Math.abs((await h(selfId)) - (await h(plainId)))).toBeLessThan(1);
  // 单徽标座位仍是「号码 + 徽标」同一行：徽标与号码有纵向重叠
  const oneLine = await page.locator(`[data-player-id="${peerId}"]`).evaluate(seat => {
    const number = seat.querySelector('.seat-number')!.getBoundingClientRect();
    const strip = seat.querySelector('.badge-strip')!.getBoundingClientRect();
    return strip.top < number.bottom && strip.bottom > number.top;
  });
  expect(oneLine).toBe(true);
  await page.screenshot({ path: '/results/seat-badges-multi-' + test.info().project.name + '.png', fullPage: true });

  // 390 宽：双徽标 + 两个角标同处一卡也不横向溢出、不出卡
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(strip.locator('[data-badge="identity"]')).toBeVisible();
  await expect(strip.locator('[data-badge="sheriff"]')).toBeVisible();
  expect(await strip.evaluate(node => {
    const card = node.closest('.seat-main')!.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return box.left >= card.left - 0.5 && box.right <= card.right + 0.5;
  })).toBe(true);
  await page.screenshot({ path: '/results/seat-badges-multi-390-' + test.info().project.name + '.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // 3 字身份（门先生）+ 天理：8px 徽标下也能与号码同排（不换行、卡片不加高、行内仍有 ≥12px 余量）
  const longRole = loadGameFixture('night-spirit-full.json');
  longRole.view.private!.self.roleId = 'door';
  const longSelfId = longRole.view.private!.self.playerId;
  const longPicks = longRole.view.public!.seats.filter(seat => seat.alive).slice(0, 4).map(seat => seat.playerId);
  const longTask = taskFixture(longRole.view, 'EDIT_PROPOSAL', { playerIds: longPicks, maxTargets: 2, allowRepeated: true, canSkip: true, forbiddenPairs: [] });
  longTask.view.public!.sheriff = { enabled: true, holderId: longSelfId };
  const longPlainId = longRole.view.public!.seats.find(seat => !longPicks.includes(seat.playerId))!.playerId;
  await mount(page, longTask);
  const longStrip = page.locator(`[data-player-id="${longSelfId}"] .seat-number > .badge-strip`);
  await expect(longStrip).toHaveAttribute('aria-label', '门先生、天理');
  expect(await page.locator(`[data-player-id="${longSelfId}"] .seat-number`).evaluate(node => getComputedStyle(node).flexDirection)).toBe('row');
  const longRoom = await longStrip.evaluate(node => {
    const card = node.closest('.seat-main') as HTMLElement;
    const style = getComputedStyle(card);
    const available = card.getBoundingClientRect().width - parseFloat(style.paddingLeft) * 2 - parseFloat(style.borderLeftWidth) * 2;
    return available - (node.parentElement as HTMLElement).getBoundingClientRect().width;
  });
  expect(longRoom).toBeGreaterThan(12);
  // 徽标条完整落在卡片内、文字不被裁切、卡片与无徽标座位同高
  expect(await longStrip.evaluate(node => {
    const card = node.closest('.seat-main')!.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return box.left >= card.left - 0.5 && box.right <= card.right + 0.5;
  })).toBe(true);
  expect(await longStrip.evaluate(node => Array.from(node.children).some(child => child.scrollWidth > child.clientWidth + 1))).toBe(false);
  const longDelta = await page.locator(`[data-player-id="${longSelfId}"] .seat-main`).evaluate((node, plain) => {
    return node.getBoundingClientRect().height - (document.querySelector(`[data-player-id="${plain}"] .seat-main`) as HTMLElement).getBoundingClientRect().height;
  }, longPlainId);
  expect(Math.abs(longDelta)).toBeLessThan(1);
  await page.screenshot({ path: '/results/seat-badges-long-identity-' + test.info().project.name + '.png', fullPage: true });

  // 320 宽：3 字身份（门先生）+ 天理在两列网格下也能保持单排、装进卡片
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.locator('.stage-seats').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2);
  expect(await page.locator(`[data-player-id="${longSelfId}"] .seat-number`).evaluate(node => getComputedStyle(node).flexDirection)).toBe('row');
  const longNarrowRoom = await longStrip.evaluate(node => {
    const card = node.closest('.seat-main') as HTMLElement;
    const style = getComputedStyle(card);
    const available = card.getBoundingClientRect().width - parseFloat(style.paddingLeft) * 2 - parseFloat(style.borderLeftWidth) * 2;
    return available - (node.parentElement as HTMLElement).getBoundingClientRect().width;
  });
  expect(longNarrowRoom).toBeGreaterThan(12);
  expect(await longStrip.evaluate(node => {
    const card = node.closest('.seat-main')!.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return box.left >= card.left - 0.5 && box.right <= card.right + 0.5;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/results/seat-badges-long-identity-320-' + test.info().project.name + '.png', fullPage: true });
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
  await revealHudActions(page); await page.getByRole('button', { name: '房间管理', exact: true }).click();
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
