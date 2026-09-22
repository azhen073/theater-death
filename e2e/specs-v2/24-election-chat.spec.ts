import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, loadReviewFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/view', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current.view) }));
  await page.goto('/game-test.html');
  return { set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

function electionFixture(): GameHarnessFixture {
  const fixture = loadGameFixture('day-election-full.json');
  const seats = fixture.view.public!.seats;
  fixture.view.public!.day!.election = {
    phase: 'signup', candidates: [seats[1]!.playerId, seats[3]!.playerId, seats[5]!.playerId],
    withdrawn: [seats[3]!.playerId], speechOrder: [], round: 1, votedCount: 0,
    eligibleCount: 11, tiedIds: [], winnerId: null,
  };
  return fixture;
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('公开上警名单覆盖报名、退选、重投和结束，跨四页签与公开观众一致且不泄露私密', async ({ page }) => {
  const fixture = electionFixture();
  const mounted = await mount(page, fixture);
  const roster = page.getByRole('region', { name: '公开上警名单' });
  await expect(roster).toContainText('2 人参选');
  await expect(roster).toContainText('2号');
  await expect(roster).toContainText('4号');
  await expect(roster).toContainText('已退选');
  await expect(roster).toContainText('6号');
  for (const tab of ['公屏', '情报', '记录', '规则']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(roster).toBeVisible();
  }

  const revote = structuredClone(fixture);
  revote.view.public!.day!.election!.phase = 'revote';
  revote.view.public!.day!.election!.tiedIds = [revote.view.public!.seats[1]!.playerId, revote.view.public!.seats[5]!.playerId];
  await mounted.set(revote);
  await expect(roster.getByText('重投候选')).toHaveCount(2);
  await expect(roster).toContainText('已退选');

  const done = structuredClone(revote);
  done.view.public!.day!.election!.phase = 'done';
  done.view.public!.day!.election!.winnerId = done.view.public!.seats[5]!.playerId;
  await mounted.set(done);
  await expect(roster).toContainText('竞选结果');
  await expect(roster).toContainText('6号当选');
  await expect(roster).toContainText('已当选');

  const observer = structuredClone(done);
  observer.view.viewer.kind = 'public_spectator'; observer.view.viewer.readOnly = true;
  observer.view.viewer.subjectPlayerId = null; observer.view.private = null;
  await mounted.set(observer);
  await expect(roster).toContainText('6号当选');
  await page.getByRole('tab', { name: '情报', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: '情报' })).toContainText('公开观众没有私人情报');
  await expect(page.getByRole('button', { name: /身份/ })).toHaveCount(0);

  await mounted.set(loadGameFixture('night-door-full.json'));
  await expect(page.getByRole('region', { name: '公开上警名单' })).toHaveCount(0);
  await mounted.set(loadReviewFixture());
  await expect(page.getByRole('region', { name: '公开上警名单' })).toHaveCount(0);
});

test('公屏底部跟随、阅读历史未读回最新、分页锚点和跨页签草稿均保持', async ({ page }) => {
  const fixture = electionFixture();
  fixture.view.capabilities.canPostPublic = true;
  const sender = fixture.view.public!.seats[1]!;
  sender.nickname = '<b>' + '很长的公开昵称'.repeat(6) + '</b>';
  fixture.view.chat.public = Array.from({ length: 160 }, (_, index) => ({
    messageId: 'public-' + index, clientMessageId: 'client-' + index, cursor: index + 1,
    senderId: sender.playerId, text: index === 159 ? '<img src=x onerror=alert(1)>' + '长文本'.repeat(100) : '公开记录 ' + index, at: index,
  }));
  const mounted = await mount(page, fixture);
  const history = page.getByLabel('公屏历史');
  await expect(history.getByText('公开记录 80')).toBeVisible();
  await expect(history.getByText('<img src=x onerror=alert(1)>', { exact: false })).toBeVisible();
  await expect(history.locator('img')).toHaveCount(0);
  await expect(history.locator('strong').last()).toContainText(`2号 · ${sender.nickname}`);
  await expect(history.locator('strong b')).toHaveCount(0);
  await expect.poll(() => history.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(24);

  const anchor = history.locator('[data-message-id="public-80"]');
  const older = history.getByRole('button', { name: '显示更早的本局记录' });
  await older.scrollIntoViewIfNeeded();
  const beforeTop = await anchor.evaluate(el => el.getBoundingClientRect().top);
  await older.click();
  await expect(history.getByText('公开记录 0')).toBeVisible();
  await expect.poll(() => anchor.evaluate((el, top) => Math.abs(el.getBoundingClientRect().top - top), beforeTop)).toBeLessThan(3);

  await history.evaluate(element => { element.scrollTop = 100; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  const held = await history.evaluate(element => element.scrollTop);
  await page.getByLabel('公屏消息').fill('切换页签仍保留的草稿');
  await page.getByRole('tab', { name: '规则', exact: true }).click();
  const update = structuredClone(fixture);
  update.view.chat.public.push({ messageId: 'public-160', clientMessageId: 'client-160', cursor: 161, senderId: sender.playerId, text: '阅读历史时到达的新消息', at: 161 });
  await mounted.set(update);
  await page.getByRole('tab', { name: '公屏', exact: true }).click();
  await expect(page.getByLabel('公屏消息')).toHaveValue('切换页签仍保留的草稿');
  expect(await history.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(held + 2);
  const latest = page.getByRole('button', { name: /条新消息 · 回到最新/ });
  await expect(latest).toBeVisible();
  await latest.click();
  await expect.poll(() => history.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(24);

  const atBottom = structuredClone(update);
  atBottom.view.chat.public.push({ messageId: 'public-161', clientMessageId: 'client-161', cursor: 162, senderId: sender.playerId, text: '底部自动跟随消息', at: 162 });
  await mounted.set(atBottom);
  await expect(history.getByText('底部自动跟随消息')).toBeVisible();
  await expect(page.getByRole('button', { name: /条新消息 · 回到最新/ })).toHaveCount(0);
  await expect.poll(() => history.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(24);
});

test('选举名单和长公屏内容在320至1440宽度均无横向溢出', async ({ page }, testInfo) => {
  const fixture = electionFixture();
  const sender = fixture.view.public!.seats[1]!;
  sender.nickname = '长昵称'.repeat(20);
  fixture.view.chat.public = [{ messageId: 'long', clientMessageId: 'long-client', cursor: 1, senderId: sender.playerId, text: '不含空格的超长消息'.repeat(80), at: 1 }];
  await mount(page, fixture);
  for (const size of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 700 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await expect(page.getByRole('region', { name: '公开上警名单' })).toBeVisible();
    await expect(page.getByLabel('公屏历史')).toBeVisible();
    await expectNoOverflow(page);
  }
  await page.screenshot({ path: `/results/election-chat-${testInfo.project.name}.png`, fullPage: false });
});
