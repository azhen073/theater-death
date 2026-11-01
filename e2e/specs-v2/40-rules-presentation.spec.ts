import { expect, test } from '@playwright/test';
import { loadGameFixture } from '../helpers-v2/game.ts';

async function openRules(page: import('@playwright/test').Page) {
  const fixture = loadGameFixture('night-door-full.json');
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.goto('/game-test.html');
  await page.getByRole('tab', { name: '规则' }).click();
  await page.getByRole('button', { name: '打开完整规则' }).click();
  return page.getByRole('dialog', { name: '规则与玩法 · 2.0' });
}

test('深色规则首页保留清晰层次与快速入口', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const dialog = await openRules(page);
  await expect(dialog.locator('.rules-quick__hero')).toBeVisible();
  await expect(dialog.locator('.rules-quick__link')).toHaveCount(6);
  await expect(dialog.locator('.rules-view-switch')).toBeVisible();
  await page.screenshot({ path: `/results/rules-presentation-dark-${testInfo.project.name}.png`, fullPage: true });
});

test('移动端完整条款与表格不造成页面横向溢出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openRules(page);
  await dialog.getByRole('button', { name: '完整条款' }).click();
  await dialog.getByRole('combobox', { name: '规则章节' }).selectOption('chapter-05');
  await expect(dialog.locator('.rules-chapter table')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(dialog.locator('.rules-search input')).toHaveCSS('font-size', '16px');
  await page.screenshot({ path: `/results/rules-presentation-mobile-${testInfo.project.name}.png`, fullPage: true });
});
