import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture } from '../helpers-v2/game.ts';

async function mount(page: Page) {
  const fixture = loadGameFixture('night-spirit-full.json');
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.goto('/game-test.html');
  await expect(page.locator('.theater-stage')).toBeVisible();
}

/**
 * 窄屏（≤680px）滚动后 HUD 收成细条，四个操作收进「更多」菜单——避免吸附的头条盖住座位；
 * 桌面宽度不收缩，行为与以前一致。
 */
test('窄屏滚动后 HUD 收成细条并把操作收进「更多」，桌面不收缩', async ({ page }, testInfo) => {
  await mount(page);
  const hud = page.locator('.game-hud');
  const more = page.getByRole('button', { name: '更多', exact: true });
  const narrow = testInfo.project.name === 'webkit';

  if (!narrow) {
    // 桌面：滚到底也不收缩，操作按钮始终直接在 HUD 上
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(200);
    await expect(more).toHaveCount(0);
    await expect(page.getByRole('button', { name: '导航', exact: true })).toBeVisible();
    const desktopHud = await hud.boundingBox();
    expect(desktopHud!.height).toBeGreaterThan(80);
    return;
  }

  const expanded = await hud.boundingBox();
  expect(expanded!.height).toBeGreaterThan(100);
  // 滚下 600px：细条 + 「更多」出现，工具行按钮不再直接可见
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(more).toBeVisible();
  const compact = await hud.boundingBox();
  expect(compact!.height).toBeLessThanOrEqual(56);
  expect(compact!.height).toBeLessThan(expanded!.height / 2);
  await expect(page.getByRole('button', { name: '导航', exact: true })).toHaveCount(0);
  // 细条仍显示阶段与倒计时
  await expect(hud).toContainText('第 1 轮 · 夜晚 · 第 1 阶段');
  await expect(hud.locator('.hud-meta strong')).toBeVisible();
  await page.screenshot({ path: `/results/hud-compact-${testInfo.project.name}-scrolled.png`, fullPage: false });
  // 「更多」展开同一组操作，点击后打开对应弹窗
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByLabel('对局操作');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: '我的身份', exact: true })).toBeVisible();
  await page.screenshot({ path: `/results/hud-compact-${testInfo.project.name}-menu.png`, fullPage: false });
  await menu.getByRole('button', { name: '导航', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '剧院导航' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click();
  // 回到顶部后恢复完整 HUD
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(more).toHaveCount(0);
  const restored = await hud.boundingBox();
  expect(restored!.height).toBeGreaterThan(100);
  await expect(page.getByRole('button', { name: '房间管理', exact: true })).toBeVisible();
});
