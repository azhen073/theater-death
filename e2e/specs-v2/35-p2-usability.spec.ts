import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, resizeSeats, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mount(page: Page, fixture: GameHarnessFixture) {
  await page.route('**/__game-fixture', route => route.fulfill({ json: fixture }));
  await page.goto('/game-test.html');
  await expect(page.locator('.stage-seat')).toHaveCount(13);
}

async function expectPanelInView(page: Page, key: string) {
  await expect.poll(() => page.evaluate(key => {
    const heading = document.querySelector(`#panel-${key} h2`)!.getBoundingClientRect();
    const hud = document.querySelector('.game-hud')!.getBoundingClientRect();
    const tabs = document.querySelector('.info-tabs')!.getBoundingClientRect();
    return heading.top >= hud.bottom && heading.bottom < Math.min(tabs.top, innerHeight);
  }, key)).toBe(true);
}

test('半环保留他人公开翻牌、生死和离线状态，边界宽度与缩放下座位不相交', async ({ page }, testInfo) => {
  for (const readOnly of [false, true]) {
    const fixture = loadGameFixture(readOnly ? 'started-public-observer-full.json' : 'night-door-full.json');
    fixture.view = resizeSeats(fixture.view, 13);
    const seats = fixture.view.public!.seats;
    seats[1]!.revealedRoleId = 'laike'; seats[1]!.alive = true; seats[1]!.presence = 'offline';
    seats[2]!.alive = false;
    for (const scale of [90, 100, 110]) {
      await page.addInitScript(scale => localStorage.setItem('theater-death-display-v1', JSON.stringify({ scale, theme: 'dark', motion: 'reduced' })), scale);
      await mount(page, fixture);
      for (const width of [601, 680, 681, 844, 900]) {
        await page.setViewportSize({ width, height: 1100 });
        await expect(page.locator('.theater-stage')).toHaveClass(/theater-stage--arc/);
        const revealed = page.locator('.stage-seat').nth(1).locator('.seat-status');
        await expect(revealed).toHaveText('莱莱可 · 离线');
        await expect(revealed).toBeVisible();
        await expect(page.locator('.stage-seat').nth(2).locator('.seat-status')).toContainText('已死亡');
        await expect(page.locator('.stage-seat').nth(2).locator('.seat-status')).toBeVisible();
        await expect.poll(() => page.evaluate(() => {
          const stage = document.querySelector('.stage-seats')!.getBoundingClientRect();
          const seats = [...document.querySelectorAll('.stage-seat')].map(element => {
            const card = element.getBoundingClientRect();
            const tools = element.querySelector('.seat-tools')!.getBoundingClientRect();
            return { left: Math.min(card.left, tools.left), right: Math.max(card.right, tools.right), top: Math.min(card.top, tools.top), bottom: Math.max(card.bottom, tools.bottom) };
          });
          const outside = seats.findIndex(seat => seat.left < stage.left || seat.right > stage.right || seat.top < stage.top || seat.bottom > stage.bottom);
          if (outside >= 0) return `seat/tools outside stage: ${JSON.stringify({ index: outside, seat: seats[outside], stage, width: innerWidth, zoom: getComputedStyle(document.documentElement).zoom })}`;
          for (let a = 0; a < seats.length; a += 1) for (let b = a + 1; b < seats.length; b += 1) {
            const x = seats[a]!, y = seats[b]!;
            if (x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top) return `overlap ${a}/${b}`;
          }
          for (const seat of document.querySelectorAll('.stage-seat')) {
            const status = seat.querySelector('.seat-status')!.getBoundingClientRect();
            const tools = seat.querySelector('.seat-tools')!.getBoundingClientRect();
            if (status.bottom > tools.top && status.left < tools.right && status.right > tools.left) return 'details cover status';
          }
          return document.documentElement.scrollWidth > innerWidth ? 'horizontal overflow' : null;
        })).toBeNull();
        if (!readOnly && scale === 100 && width === 601) await page.screenshot({ path: `/results/p2-status-601-${testInfo.project.name}.png`, fullPage: true });
      }
      await page.unroute('**/__game-fixture');
    }
  }
});

test('移动页签点击、重复点击及键盘切换均将面板带到HUD下方，快照更新不抢滚动', async ({ page }, testInfo) => {
  const fixture = loadGameFixture();
  fixture.view = resizeSeats(fixture.view, 13);
  for (const motion of ['full', 'reduced']) {
    await page.addInitScript(motion => localStorage.setItem('theater-death-display-v1', JSON.stringify({ motion, scale: 110, theme: 'dark' })), motion);
    await mount(page, fixture);
    for (const width of [320, 390, 844]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [key, name] of [['intel', '情报'], ['records', '记录'], ['public', '公屏'], ['rules', '规则']] as const) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.getByRole('tab', { name, exact: true }).click();
        await expectPanelInView(page, key);
      }
      // Same tab is already selected: it must still navigate back to its off-screen panel.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.getByRole('tab', { name: '规则', exact: true }).click();
      await expectPanelInView(page, 'rules');
      await page.getByRole('tab', { name: '规则', exact: true }).press('Home');
      await expect(page.getByRole('tab', { name: '公屏', exact: true })).toBeFocused();
      await expectPanelInView(page, 'public');
      if (width === 390 && motion === 'reduced') await page.screenshot({ path: `/results/p2-tabs-390-${testInfo.project.name}.png`, fullPage: true });
      await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'instant' }));
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const before = await page.evaluate(() => scrollY);
      await pushFixture(page, structuredClone(fixture));
      await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThanOrEqual(1);
    }
    await page.unroute('**/__game-fixture');
  }
});

test('桌面页签保持页面滚动位置', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, loadGameFixture());
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});
