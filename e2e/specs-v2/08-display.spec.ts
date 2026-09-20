import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, loadReviewDocument, loadReviewFixture, pushFixture, resizeSeats, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mountPlaying(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: /夜幕降临|晨间公告/ })).toBeVisible();
  return { setFixture: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

async function mountReview(page: Page, fixture = loadReviewFixture()) {
  let current = fixture;
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/review', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(loadReviewDocument()) }));
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  return { setFixture: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '导航' }).click();
  await page.getByRole('dialog', { name: '剧院导航' }).getByRole('button', { name: '显示设置' }).click();
  return page.getByRole('dialog', { name: '显示设置' });
}

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

function deathFixture(base: GameHarnessFixture, type: 'deaths_announced' | 'elimination_announced', cursor: number): GameHarnessFixture {
  const next = structuredClone(base);
  next.view.public!.events = [...next.view.public!.events, {
    cursor, type, dayNumber: 1, stage: 1,
    payload: type === 'deaths_announced' ? { seats: [1] } : { seat: 2 },
  }];
  return next;
}

test('显示设置通过UI更新三项非敏感偏好，实际缩放/动画状态变化并在reload后保留', async ({ page }) => {
  await mountPlaying(page, loadGameFixture());
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const dialog = await openSettings(page);
  await dialog.getByLabel('动画偏好').selectOption('full');
  await dialog.getByRole('checkbox').uncheck();
  await dialog.getByLabel('界面缩放').selectOption('90');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe('0.9');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('false');
  await dialog.getByLabel('界面缩放').selectOption('110');
  await dialog.getByRole('checkbox').check();
  await dialog.getByLabel('动画偏好').selectOption('reduced');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe('1.1');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('true');
  await dialog.getByLabel('动画偏好').selectOption('system');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('theater-death-display-v1') ?? '{}') as Record<string, unknown>);
  expect(Object.keys(stored).sort()).toEqual(['deathEffects', 'motion', 'scale']);
  expect(stored).toMatchObject({ deathEffects: true, motion: 'system', scale: 110 });

  await page.getByRole('button', { name: '关闭' }).click();
  await page.reload();
  const afterReload = await openSettings(page);
  await expect(afterReload.getByLabel('动画偏好')).toHaveValue('system');
  await expect(afterReload.getByLabel('界面缩放')).toHaveValue('110');
  await expect(afterReload.getByRole('checkbox')).toBeChecked();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '关闭' }).click();
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('true');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('false');
});

test('公开新死讯才显示短提示：重复/私有/重连基线/减少动画与关闭开关都不重播', async ({ page }) => {
  const base = loadGameFixture('night-door-full.json');
  const mounted = await mountPlaying(page, base);
  await expect(page.locator('.death-notice')).toHaveCount(0);
  const firstDeath = deathFixture(base, 'deaths_announced', 3);
  await mounted.setFixture(firstDeath);
  await expect(page.locator('.death-notice')).toContainText('1号已出局');
  expect(await page.locator('.death-notice').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  const records = page.getByRole('tab', { name: '记录' });
  await records.click();
  await expect(page.getByRole('tabpanel', { name: '记录' })).toContainText('晨间死讯');
  await mounted.setFixture(structuredClone(firstDeath));
  await expect(page.locator('.death-notice')).toHaveCount(0, { timeout: 3_000 });

  const offline = structuredClone(firstDeath); offline.online = false;
  await mounted.setFixture(offline);
  const online = structuredClone(firstDeath); online.online = true;
  await mounted.setFixture(online);
  await expect(page.locator('.death-notice')).toHaveCount(0);

  const privateOnly = structuredClone(firstDeath);
  privateOnly.view.private!.self.life = 'dead';
  privateOnly.view.private!.events.push({ cursor: 4, type: 'night_deaths_confirmed', dayNumber: 1, stage: 1, payload: { deaths: [{ playerId: privateOnly.view.viewer.subjectPlayerId }] } });
  await mounted.setFixture(privateOnly);
  await expect(page.locator('.death-notice')).toHaveCount(0);

  const settings = await openSettings(page);
  await settings.getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: '关闭' }).click();
  const disabledDeath = deathFixture(privateOnly, 'elimination_announced', 5);
  await mounted.setFixture(disabledDeath);
  await expect(page.locator('.death-notice')).toHaveCount(0);
  const reducedSettings = await openSettings(page);
  await reducedSettings.getByRole('checkbox').check();
  await reducedSettings.getByLabel('动画偏好').selectOption('reduced');
  await page.getByRole('button', { name: '关闭' }).click();
  await mounted.setFixture(deathFixture(disabledDeath, 'deaths_announced', 6));
  await expect(page.locator('.death-notice')).toHaveCount(0);
});

test('320/390/844/1440视口与5/13/26/64席位无横向溢出，长账号可读且草稿跨resize保留', async ({ page }, testInfo) => {
  const base = loadGameFixture('night-door-full.json');
  const mounted = await mountPlaying(page, base);
  await page.setViewportSize({ width: 1440, height: 900 });
  const stageActions = page.getByRole('region', { name: '舞台行动', exact: true });
  await expect(stageActions).toBeVisible();
  await expect(stageActions).toContainText('选择守护目标');
  await expect(stageActions).toContainText(/00:\d{2}/);
  await expect(stageActions.getByRole('button', { name: /确认空守|确认提交/ })).toBeVisible();
  await expect(page.locator('.mobile-action-bar')).toHaveCount(0);

  const firstSeat = base.view.public!.seats.find(s => s.seat === 1)!;
  const firstTarget = page.getByRole('button', { name: `1号 ${firstSeat.nickname}，可选目标` });
  await firstTarget.click();
  const selectedSummary = page.locator('.selection-summary');
  await expect(selectedSummary).toContainText(`1号 ${firstSeat.nickname}`);
  const settings = await openSettings(page);
  await settings.getByLabel('界面缩放').selectOption('110');
  await page.getByRole('button', { name: '关闭' }).click();

  // Sequential viewport resizing across key breakpoints
  const sizes = [
    { width: 1440, height: 900, cols: 0 },
    { width: 1181, height: 900, cols: 0 },
    { width: 1180, height: 800, cols: 4 },
    { width: 681, height: 800, cols: 4 },
    { width: 680, height: 750, cols: 3 },
    { width: 390, height: 844, cols: 3 },
    { width: 320, height: 740, cols: 3 },
    { width: 844, height: 390, cols: 4 },
    { width: 1440, height: 900, cols: 0 },
  ];

  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await expectNoOverflow(page);
    await expect(page.getByRole('heading', { name: /夜幕降临|晨间公告/ })).toBeVisible();
    await expect(selectedSummary).toContainText(`1号 ${firstSeat.nickname}`);
    await expect(page.getByRole('region', { name: '舞台行动', exact: true })).toHaveCount(1);
    if (size.cols > 0) {
      const colCount = await page.locator('.stage-seats').evaluate(el => window.getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(colCount).toBe(size.cols);
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `/results/display-desktop-${testInfo.project.name}.png`, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `/results/display-mobile-${testInfo.project.name}.png`, fullPage: false });

  for (const count of [5, 13, 26, 64]) {
    const resized = resizeSeats(base.view, count);
    for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      await mounted.setFixture({ ...base, view: resized });
      await expect(page.locator('.stage-seat')).toHaveCount(count);
      await expectNoOverflow(page);
    }
  }

  const longAccount = structuredClone(base);
  longAccount.view.public!.seats[0]!.nickname = 'A'.repeat(32);
  await mounted.setFixture(longAccount);
  const detail = page.getByRole('button', { name: '查看1号玩家信息' });
  await detail.click();
  await expect(page.getByRole('dialog')).toContainText('A'.repeat(32));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label'))).toBe('查看1号玩家信息');
});

test('模拟软键盘缩小视口时聊天输入可见且焦点不被抢走，舞台行动不遮挡聊天', async ({ page }) => {
  const fixture = loadGameFixture('night-door-full.json');
  fixture.view.capabilities.canPostPublic = true;
  const mounted = await mountPlaying(page, fixture);
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.getByLabel('公屏消息');
  await input.focus();
  await page.setViewportSize({ width: 390, height: 500 });
  await expect(input).toBeFocused();
  await expect(page.locator('.mobile-action-bar')).toHaveCount(0);
  const bounds = await input.boundingBox();
  const sendBounds = await page.getByRole('button', { name: '发送公屏消息' }).boundingBox();
  expect(bounds).not.toBeNull();
  expect(sendBounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(sendBounds!.y).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.dataset.keyboardOpen)).toBe('true');
  await expect(page.getByRole('region', { name: '舞台行动', exact: true })).toBeVisible();
  void mounted;
});

test('游戏与复盘tab支持Arrow/Home/End，Escape关闭弹层，规则章节单标题并可返回', async ({ page }) => {
  await mountPlaying(page, loadGameFixture('night-door-full.json'));
  const infoTabs = page.getByRole('tablist', { name: '对局信息' }).getByRole('tab');
  await infoTabs.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(infoTabs.nth(1)).toBeFocused();
  await expect(infoTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(infoTabs.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(infoTabs.nth(3)).toBeFocused();
  await expect(infoTabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '打开完整规则' }).click();
  const rules = page.getByRole('dialog', { name: /完整规则/ });
  const initialTitle = await rules.locator('article h2').textContent();
  await expect(rules.locator('article h2')).toHaveCount(1);
  await rules.getByLabel('规则章节').selectOption({ index: 1 });
  await expect(rules.getByRole('button', { name: '返回上一章节' })).toBeVisible();
  await rules.getByRole('button', { name: '返回上一章节' }).click();
  await expect(rules.locator('article h2')).toHaveText(initialTitle ?? '');
  await expect(rules.locator('.modal-game-context')).toHaveCSS('position', 'sticky');
  await rules.evaluate(dialog => { dialog.scrollTop = 400; dialog.dispatchEvent(new Event('scroll', { bubbles: true })); });
  const contextTop = await rules.locator('.modal-game-context').evaluate(element => element.getBoundingClientRect().top);
  const dialogTop = await rules.evaluate(element => element.getBoundingClientRect().top);
  expect(contextTop).toBeGreaterThanOrEqual(dialogTop - 2);
  await page.keyboard.press('Escape');
  await expect(rules).toHaveCount(0);

  await mountReview(page);
  const reviewTabs = page.getByRole('tablist', { name: '复盘内容' }).getByRole('tab');
  await reviewTabs.nth(0).focus();
  await page.keyboard.press('End');
  await expect(reviewTabs.nth(3)).toBeFocused();
  await expect(reviewTabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(reviewTabs.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(reviewTabs.nth(1)).toBeFocused();
});
