import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, loadObservedActionsFixture, loadReviewDocument, loadReviewFixture, pushFixture, type GameHarnessFixture, type ReviewEnvelope } from '../helpers-v2/game.ts';

type ReviewMode = 'ok' | 'slow' | 'fail-once' | 'wrong-once';

async function mount(page: Page, fixture: GameHarnessFixture, options: { reviewMode?: ReviewMode; review?: ReviewEnvelope } = {}) {
  let current = fixture;
  let reviewMode = options.reviewMode ?? 'ok';
  let review = options.review ?? loadReviewDocument();
  let reviewRequests = 0;
  let releaseSlow: (() => void) | null = null;
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/review', async route => {
    reviewRequests += 1;
    if (reviewMode === 'slow') await new Promise<void>(resolve => { releaseSlow = resolve; });
    if (reviewMode === 'fail-once') {
      reviewMode = 'ok';
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'temporarily_unavailable' } }) });
      return;
    }
    if (reviewMode === 'wrong-once') {
      reviewMode = 'ok';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(review) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(review) });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  return {
    setFixture: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); },
    setReview: (next: ReviewEnvelope) => { review = next; },
    setReviewMode: (next: ReviewMode) => { reviewMode = next; },
    releaseSlow: () => { releaseSlow?.(); releaseSlow = null; },
    reviewRequests: () => reviewRequests,
  };
}

test('独立复盘慢响应保留概览，并展示13身份、最终生命、服务器顺序与全部交流', async ({ page }) => {
  const document = loadReviewDocument();
  const seatOneNickname = document.review.players.find(player => player.seat === 1)!.nickname;
  document.review.chat.faction = [{ id: 2, messageId: 'faction-message-2', senderId: document.review.players[9]!.playerId, senderSeat: 10, text: '<阵营>纯文本', at: 92_000 }];
  document.review.timeline.push(
    { dayNumber: 1, stage: 1, type: 'attack_events', payload: { attacks: [{ sourceRoleId: 'death', targetPlayerId: document.review.players[0]!.playerId, blocked: false }] } },
    { dayNumber: 1, stage: 1, type: 'guard_sacrifice', payload: { doorId: document.review.players[2]!.playerId, targets: [document.review.players[0]!.playerId] } },
    { dayNumber: 1, stage: 1, type: 'revive_selected', payload: { targetPlayerId: document.review.players[1]!.playerId } },
    { dayNumber: 1, stage: 1, type: 'night_deaths_confirmed', payload: { deaths: [{ playerId: document.review.players[0]!.playerId }] } },
    { dayNumber: 1, stage: 1, type: 'unknown_server_only', payload: { secret: 'do-not-render-json' } },
  );
  const mounted = await mount(page, loadReviewFixture(), { reviewMode: 'slow', review: document });
  await expect(page.getByText('人类阵营获胜')).toBeVisible();
  await expect(page.getByText('结局概览已保留')).toBeVisible();
  mounted.releaseSlow();

  const cards = page.locator('.member-card');
  await expect(cards).toHaveCount(13);
  const catalogNames: Record<string, string> = { researcher: '科研员', civilian: '平民', door: '门先生', mourner: '丧亲者', death: '死神', water: '水妖', descender: '降临者', spirit: '魂灵', laike: '莱莱可' };
  for (const player of document.review.players) {
    await expect(cards.filter({ hasText: `${player.seat}号 ${player.nickname}` })).toContainText(`${catalogNames[player.roleId]} · ${player.life === 'alive' ? '最终存活' : '最终死亡'}`);
  }

  await page.getByRole('tab', { name: '完整时间线' }).click();
  const titles = page.locator('.event-row strong');
  await expect(titles.first()).toHaveText('演出开始');
  await expect(titles.nth(1)).toHaveText('身份分配');
  await expect(titles.nth(13)).toHaveText('身份分配');
  await expect(titles.nth(14)).toHaveText('获知魂灵名单');
  await expect(titles.nth(15)).toHaveText('阵营房已建立');
  await expect(titles.nth(16)).toHaveText('夜幕降临');
  await expect(titles.nth(17)).toHaveText('本夜攻击与抵挡');
  await expect(titles.nth(18)).toHaveText('濒死情报');
  await expect(titles.nth(19)).toHaveText('未使用还魂曲');
  await expect(titles.nth(20)).toHaveText('夜末死亡确认');
  await expect(titles.nth(22)).toHaveText('本夜攻击与抵挡');
  await expect(titles.nth(23)).toHaveText('门先生双守牺牲');
  await expect(titles.nth(24)).toHaveText('深海召回目标');
  await expect(titles.nth(25)).toHaveText('夜末死亡确认');
  await expect(page.getByText('do-not-render-json')).toHaveCount(0);
  await expect(page.getByText(`死神 → 1号 ${seatOneNickname}：未抵挡`)).toBeVisible();

  await page.getByRole('tab', { name: '全部公屏' }).click();
  await expect(page.getByText('contract message')).toBeVisible();
  await expect(page.locator('.chat-message').filter({ hasText: 'contract message' })).toHaveCount(1);
  await page.getByRole('tab', { name: '全部阵营交流' }).click();
  await expect(page.getByText('<阵营>纯文本')).toBeVisible();
  await expect(page.locator('.chat-message').filter({ hasText: '<阵营>纯文本' })).toHaveCount(1);
});

test('复盘GET失败可重试且拒绝错误gameId；迟到旧响应不会回填新大厅或新对局', async ({ page }) => {
  const fixture = loadReviewFixture();
  const wrong = loadReviewDocument();
  const seatOneNickname = wrong.review.players.find(player => player.seat === 1)!.nickname;
  wrong.review.gameId = 'wrong-game-id';
  const mounted = await mount(page, fixture, { reviewMode: 'fail-once', review: wrong });
  await expect(page.getByText('暂时无法完成操作，请刷新状态后重试。')).toBeVisible();
  await expect(page.getByText('人类阵营获胜')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新读取复盘' })).toBeVisible();
  mounted.setReview(loadReviewDocument());
  await page.getByRole('button', { name: '重新读取复盘' }).click();
  await expect(page.getByRole('tab', { name: '全部身份' })).toBeVisible();
  await expect(page.getByText(`1号 ${seatOneNickname}`)).toBeVisible();

  const wrongView = loadReviewFixture();
  wrongView.view.gameId = 'new-game-view';
  const wrongResponse = loadReviewDocument();
  wrongResponse.review.gameId = 'old-game-response';
  mounted.setReview(wrongResponse);
  mounted.setReviewMode('wrong-once');
  await mounted.setFixture(wrongView);
  await expect(page.getByText('对局已变化，请同步当前房间。')).toBeVisible();
  await expect(page.getByRole('tab', { name: '全部身份' })).toHaveCount(0);
  wrongResponse.review.gameId = wrongView.view.gameId;
  mounted.setReview(wrongResponse);
  await page.getByRole('button', { name: '重新读取复盘' }).click();
  await expect(page.getByRole('tab', { name: '全部身份' })).toBeVisible();

  const slow = loadReviewFixture();
  mounted.setReviewMode('slow');
  const beforeSlow = mounted.reviewRequests();
  await mounted.setFixture(slow);
  await expect.poll(() => mounted.reviewRequests()).toBe(beforeSlow + 1);
  const lobby = loadGameFixture('post-review-lobby-full.json');
  await mounted.setFixture(lobby);
  mounted.releaseSlow();
  await expect(page.getByRole('heading', { name: '房间大厅' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '演出落幕' })).toHaveCount(0);

  const playing = loadGameFixture('night-door-full.json');
  playing.view.gameId = 'new-game-after-review';
  playing.view.viewer.subjectPlayerId = playing.view.public!.seats[2]!.playerId;
  await mounted.setFixture(playing);
  await expect(page.getByRole('heading', { name: /夜幕降临|晨间公告/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '演出落幕' })).toHaveCount(0);
  expect(mounted.reviewRequests()).toBe(beforeSlow + 1);
});

test('房主结束复盘发送同一gameId/requestId并保留未知结果；非房主没有结束操作', async ({ page }) => {
  const hostFixture = loadReviewFixture();
  let current = hostFixture;
  let attempts = 0;
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/review', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(loadReviewDocument()) }));
  await page.route('**/api/v2/rooms/*/end-review', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    attempts += 1;
    if (attempts === 1) { await route.abort('failed'); return; }
    current = loadGameFixture('post-review-lobby-full.json');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  await page.getByRole('button', { name: '结束复盘，返回大厅' }).click();
  const confirmDialog = page.getByRole('dialog', { name: '结束本局复盘？' });
  await confirmDialog.getByRole('button', { name: '确认结束复盘' }).click();
  await expect(confirmDialog.getByRole('alert')).toContainText('连接中断，尚未确认结果。请先同步状态，避免重复操作。');
  await confirmDialog.getByRole('alert').getByRole('button', { name: '确认原结束操作' }).click();
  await expect(page.getByRole('heading', { name: '房间大厅' })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toMatchObject({ gameId: hostFixture.view.gameId });
  expect(bodies[1]).toEqual(bodies[0]);
  expect(typeof bodies[0]?.requestId).toBe('string');

  const nonHost = loadReviewFixture({ host: false });
  const noHost = await mount(page, nonHost);
  await expect(page.getByRole('button', { name: '结束复盘，返回大厅' })).toHaveCount(0);
  void noHost;
});

test('复盘管理转移房主未知结果返回复盘后再入管理，沿用同一 requestId 和原操作 body', async ({ page }) => {
  const fixture = loadReviewFixture();
  fixture.view.room.formalMembers[1]!.presence = 'online';
  fixture.view.capabilities.room.transferHost = { allowed: true, reason: null };
  let current = fixture;
  let attempts = 0;
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/review', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(loadReviewDocument()) }));
  await page.route('**/api/v2/rooms/*/transfer-host', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(structuredClone(body)); attempts += 1;
    if (attempts === 1) { await route.abort('failed'); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hostMemberId: fixture.view.room.formalMembers[1]!.memberId }) });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  await page.getByRole('button', { name: '房间管理' }).click();
  const target = page.locator('.member-card').filter({ hasText: fixture.view.room.formalMembers[1]!.nickname }).first();
  await target.getByRole('button', { name: '转移房主' }).click();
  await page.getByRole('dialog', { name: '转移房主？' }).getByRole('button', { name: '确认操作' }).click();
  await expect(page.getByRole('alert')).toContainText('尚未确认结果');
  await page.getByRole('button', { name: '返回复盘' }).click();
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  await page.getByRole('button', { name: '房间管理' }).click();
  await expect(page.getByRole('alert')).toContainText('尚未确认结果');
  await page.getByRole('alert').getByRole('button', { name: '确认原操作结果' }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(typeof bodies[0]?.requestId).toBe('string');
});

test('复盘页可直接发起离开房间；取消不发送请求并保留复盘', async ({ page }, testInfo) => {
  const fixture = loadReviewFixture();
  const leaveBodies: Array<Record<string, unknown>> = [];
  const forbidden: string[] = [];
  page.on('request', request => {
    if (/\/(?:end-review|logout)(?:$|\?)/.test(new URL(request.url()).pathname)) forbidden.push(new URL(request.url()).pathname);
  });
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.route('**/api/v2/rooms/*/review', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(loadReviewDocument()) }));
  await page.route('**/api/v2/rooms/*/leave', async route => {
    leaveBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ left: true, seatRetained: false }) });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  const directExit = page.getByRole('button', { name: '离开房间', exact: true });
  await expect(directExit).toBeVisible();
  await directExit.click();
  const dialog = page.getByRole('dialog', { name: '离开房间？' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: '/results/review-exit-confirmation.png', fullPage: false });
  await page.screenshot({ path: `/results/review-exit-confirmation-${testInfo.project.name}.png`, fullPage: false });
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  expect(leaveBodies).toHaveLength(0);
  expect(forbidden).toEqual([]);
});

test('复盘页离开丢失响应保留确认框，重试复用同一 requestId/body并进入测试终态', async ({ page }) => {
  const fixture = loadReviewFixture();
  const leaveBodies: Array<Record<string, unknown>> = [];
  const forbidden: string[] = [];
  page.on('request', request => {
    if (/\/(?:end-review|logout)(?:$|\?)/.test(new URL(request.url()).pathname)) forbidden.push(new URL(request.url()).pathname);
  });
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.route('**/api/v2/rooms/*/review', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(loadReviewDocument()) }));
  let attempt = 0;
  await page.route('**/api/v2/rooms/*/leave', async route => {
    leaveBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    attempt += 1;
    if (attempt === 1) { await route.abort('failed'); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ left: true, seatRetained: false }) });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  await page.getByRole('button', { name: '离开房间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '离开房间？' });
  await dialog.getByRole('button', { name: '确认操作' }).click();
  await expect(dialog.getByRole('alert')).toContainText('连接中断，尚未确认结果');
  await expect(dialog.getByRole('button', { name: '确认原退出操作' })).toBeVisible();
  await dialog.getByRole('button', { name: '确认原退出操作' }).click();
  await expect(page.getByRole('status')).toContainText('测试终态：你已离开房间');
  expect(leaveBodies).toHaveLength(2);
  expect(leaveBodies[1]).toEqual(leaveBodies[0]);
  expect(typeof leaveBodies[0]?.requestId).toBe('string');
  expect(forbidden).toEqual([]);
});

test('私人第二屏只读显示当前授权窗口与当前提交，不显示动作按钮/requestId；公开观众没有角色', async ({ page }) => {
  const privateFixture = loadObservedActionsFixture();
  const seatOneNickname = privateFixture.view.public!.seats.find(seat => seat.seat === 1)!.nickname;
  const mounted = await mountPlaying(page, privateFixture);
  await expect(page.getByRole('heading', { name: '观察玩家的行动状态 · 只读' })).toBeVisible();
  await expect(page.getByText('守护 · 剩余')).toBeVisible();
  await expect(page.getByText('选择守护目标 · 已提交')).toBeVisible();
  await expect(page.getByText(`1号 ${seatOneNickname}`)).toBeVisible();
  await expect(page.getByText('request-private-hidden')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认提交' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /放弃|提交空刀草稿|确认空守/ })).toHaveCount(0);

  const publicObserver = loadGameFixture('started-public-observer-full.json');
  await mounted.setFixture(publicObserver);
  await page.getByRole('tab', { name: '情报' }).click();
  await expect(page.getByText('公开观众没有私人情报或个人角色')).toBeVisible();
  await expect(page.getByRole('heading', { name: '观察玩家的行动状态 · 只读' })).toHaveCount(0);
});

async function mountPlaying(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: /夜幕降临|晨间公告/ })).toBeVisible();
  return { setFixture: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}
