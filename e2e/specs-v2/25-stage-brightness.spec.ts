import { expect, test } from '@playwright/test';
import { loadRoomAccounts, loginRoomAccount } from '../helpers-v2/rooms.ts';
import { loadGameFixture, pushFixture } from '../helpers-v2/game.ts';

test('账户亮度跨页面和房间保存，仅滤镜背景，日夜及移动端不影响操作', async ({ page, context }, testInfo) => {
  await loginRoomAccount(page, loadRoomAccounts(testInfo.project.name)[6]!);
  await page.getByRole('button', { name: '我的账户' }).click();
  const slider = page.getByRole('slider', { name: '舞台背景亮度' });
  await expect(slider).toHaveValue('100');
  await slider.focus(); await slider.press('Home');
  for (let i = 0; i < 20; i++) await slider.press('ArrowRight');
  await expect(slider).toHaveValue('70');
  await page.reload();
  await expect(slider).toHaveValue('70');
  await page.getByRole('region', { name: '显示与动画设置' }).screenshot({ path: `/results/brightness-settings-${testInfo.project.name}.png` });

  const game = await context.newPage();
  try {
    const day = loadGameFixture('day-election-full.json');
    await game.route('**/__game-fixture', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(day) }));
    await game.goto('/game-test.html');
    const backdrop = game.locator('.stage-backdrop');
    await expect(backdrop).toHaveCSS('filter', 'brightness(0.7)');
    await expect(game.getByRole('slider', { name: '舞台背景亮度' })).toHaveCount(0);
    for (const target of ['.theater-stage', '.seat-main', '.stage-action-card']) {
      await expect(game.locator(target).first()).toHaveCSS('filter', 'none');
    }
    const originalTextColor = await game.locator('.seat-main').first().evaluate(node => getComputedStyle(node).color);
    await page.getByRole('button', { name: '恢复默认亮度' }).click();
    await expect(backdrop).toHaveCSS('filter', 'brightness(1)');
    for (const width of [390, 1440]) {
      await game.setViewportSize({ width, height: 900 });
      await expect.poll(() => game.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await game.getByRole('region', { name: '玩家舞台' }).screenshot({ path: `/results/brightness-day-${width}-${testInfo.project.name}.png` });
    }
    await slider.focus(); await slider.press('Home');
    await expect(backdrop).toHaveCSS('filter', 'brightness(0.5)');
    await expect(game.locator('.seat-main').first()).toHaveCSS('color', originalTextColor);
    await slider.press('End');
    await expect(backdrop).toHaveCSS('filter', 'brightness(1.3)');

    const otherRoom = structuredClone(day); otherRoom.view.roomId += '-other'; otherRoom.view.gameId += '-other';
    await pushFixture(game, otherRoom);
    await expect(backdrop).toHaveCSS('filter', 'brightness(1.3)');
    const night = loadGameFixture('night-door-full.json');
    // Fixture files are independent captures; keep the harness clock monotonic
    // when moving from a later day capture to a newly constructed night.
    night.view.serverTime = day.view.serverTime + 10_000;
    for (const task of night.view.tasks) task.closesAt = night.view.serverTime + 60_000;
    for (const window of night.view.windows) window.closesAt = night.view.serverTime + 60_000;
    if (night.view.public?.night) night.view.public.night.closesAt = night.view.serverTime + 60_000;
    await pushFixture(game, night);
    await expect(game.locator('.theater-stage')).toHaveClass(/theater-stage--night/);
    await expect(backdrop).toHaveCSS('background-image', /theater\.png/);
    await expect(backdrop).toHaveCSS('filter', 'brightness(1.3)');
    await expect(game.locator('.stage-action-card')).toHaveCSS('filter', 'none');
    // The same test also runs in the disposable merge with the optional night PR.
    const atmosphere = game.locator('.night-atmosphere');
    if (await atmosphere.count()) {
      await expect(atmosphere).toHaveCSS('filter', 'brightness(1.3)');
      await expect(atmosphere.locator('.night-atmosphere__glow')).toBeVisible();
    }
    const target = game.locator('.seat-main[aria-label*="可选目标"]').first();
    await target.click(); await expect(target).toHaveAttribute('aria-pressed', 'true');

    await game.getByRole('button', { name: '导航', exact: true }).click();
    await game.getByRole('dialog', { name: '剧院导航' }).getByRole('button', { name: '显示设置' }).click();
    await expect(game.getByRole('dialog', { name: '显示设置' }).getByRole('slider', { name: '舞台背景亮度' })).toHaveCount(0);
    await page.getByRole('button', { name: '恢复默认亮度' }).click();
    await expect(slider).toHaveValue('100');
  } finally { await game.close(); }
});
