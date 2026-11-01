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

test('R 编号搜索高亮具体条款并定位到对应章节', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const dialog = await openRules(page);
  await dialog.getByRole('searchbox', { name: '搜索规则' }).fill('R-43');
  const results = dialog.getByRole('region', { name: '规则搜索结果' });
  await expect(results).toContainText('找到 1 条相关规则');
  await expect(results.locator('mark').first()).toHaveText('R-43');
  await page.screenshot({ path: `/results/rules-search-r43-${testInfo.project.name}.png`, fullPage: true });
  await results.locator('.rules-search-result').click();
  await expect(dialog.getByRole('article').getByRole('heading', { name: '09 白天流程、沉睡的天理与追加裁定' })).toBeVisible();
  await expect(dialog.locator('.rule-block--focus')).toContainText('R-43');
});

test('移动端关键词搜索返回条款上下文且不包含工程内容', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openRules(page);
  await dialog.getByRole('searchbox', { name: '搜索规则' }).fill('还魂');
  const results = dialog.getByRole('region', { name: '规则搜索结果' });
  await expect(results.locator('.rules-search-result').first()).toBeVisible();
  await expect(results).not.toContainText('工程与契约');
  await page.screenshot({ path: `/results/rules-search-mobile-${testInfo.project.name}.png`, fullPage: true });
  await results.locator('.rules-search-result').filter({ hasText: 'R-20' }).first().click();
  await expect(dialog.getByRole('article').getByRole('heading', { name: '05 神职：水妖与降临者' })).toBeVisible();
  await expect(dialog.locator('.rule-block--focus')).toContainText('R-20');
});
