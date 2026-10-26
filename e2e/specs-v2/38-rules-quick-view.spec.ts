import { expect, test } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mount(page: import('@playwright/test').Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.goto('/game-test.html');
  await page.getByRole('tab', { name: '规则' }).click();
  await page.getByRole('button', { name: '打开完整规则' }).click();
  const dialog = page.getByRole('dialog', { name: '规则与玩法 · 2.0' });
  await expect(dialog).toBeVisible();
  return { dialog, set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

test('规则首页显示当前身份、胜利目标、服务端操作与快速入口', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { dialog } = await mount(page, loadGameFixture('night-door-full.json'));
  await expect(dialog.getByRole('heading', { name: '你的身份：门先生' })).toBeVisible();
  await expect(dialog).toContainText('守护');
  await expect(dialog).toContainText('丧亲者存活不影响人类获胜');
  await expect(dialog.getByRole('region', { name: '当前操作提示' })).toContainText('选择守护目标');
  await expect(dialog).not.toContainText('工程与契约');
  await page.screenshot({ path: `/results/rules-quick-view-${testInfo.project.name}.png`, fullPage: true });

  await dialog.getByRole('button', { name: '胜负条件' }).click();
  await expect(dialog.getByRole('article').getByRole('heading', { name: '01 配置与胜利' })).toBeVisible();
  await dialog.getByRole('button', { name: '现在怎么玩' }).click();
  await expect(dialog.getByRole('heading', { name: '你的身份：门先生' })).toBeVisible();
});

test('公开观战与移动端只显示公开规则信息', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = loadGameFixture('started-public-observer-full.json');
  fixture.view.private = null;
  const { dialog } = await mount(page, fixture);
  await expect(dialog.getByRole('heading', { name: '公开观战' })).toBeVisible();
  await expect(dialog).toContainText('只能查看当前视角');
  await expect(dialog).not.toContainText('胜利目标：');
  await expect(dialog).not.toContainText('工程与契约');
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: `/results/rules-quick-view-public-mobile-${testInfo.project.name}.png`, fullPage: true });
});
