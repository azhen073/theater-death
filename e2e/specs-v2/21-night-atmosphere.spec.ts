import { expect, test, type Page } from '@playwright/test';
import { fixtureRoute, loadGameFixture, pushFixture, taskFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mount(page: Page, fixture: GameHarnessFixture): Promise<void> {
  await fixtureRoute(page, fixture);
  await page.goto('/game-test.html');
  await expect(page.getByRole('region', { name: '玩家舞台' })).toBeVisible();
}

async function expectNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('夜间银蓝静态层和原素材可见，座位行动在四档宽度仍可读可点', async ({ page }, testInfo) => {
  const base = loadGameFixture('night-spirit-full.json');
  const fixture = taskFixture(base.view, 'SUBMIT_GUARD', {
    playerIds: base.view.public!.seats.filter(seat => seat.alive).slice(0, 3).map(seat => seat.playerId),
    maxTargets: 1, allowRepeated: false, canSkip: false, forbiddenPairs: [],
  });
  await mount(page, fixture);

  const stage = page.getByRole('region', { name: '玩家舞台' });
  await expect(stage).toHaveClass(/theater-stage--night/);
  await expect(stage.locator('.night-atmosphere__glow')).toBeVisible();
  await expect(stage.locator('.night-atmosphere__vignette')).toBeVisible();
  await expect(stage.locator('.night-atmosphere__motion i')).toHaveCount(24);
  const visual = await stage.evaluate(element => {
    const stageStyle = getComputedStyle(element);
    const sceneryStyle = getComputedStyle(element.querySelector('.stage-backdrop') ?? element);
    const glow = getComputedStyle(element.querySelector('.night-atmosphere__glow')!);
    const vignette = getComputedStyle(element.querySelector('.night-atmosphere__vignette')!);
    return {
      stageBackground: sceneryStyle.backgroundImage,
      border: stageStyle.borderColor,
      glowBackground: glow.backgroundImage,
      glowOpacity: Number(glow.opacity),
      vignetteBackground: vignette.backgroundImage,
      vignetteOpacity: Number(vignette.opacity),
    };
  });
  expect(visual.stageBackground).toContain('theater.png');
  expect(visual.stageBackground).toContain('linear-gradient');
  expect(visual.glowBackground).toContain('/assets/ui-night/climax.png');
  expect(visual.glowOpacity).toBeGreaterThan(0);
  expect(visual.vignetteBackground).toContain('/assets/ui-night/vignette.png');
  expect(visual.vignetteOpacity).toBeGreaterThan(0);
  expect(visual.border).not.toBe('rgba(0, 0, 0, 0)');
  expect(await page.evaluate(async () => Promise.all(['/assets/ui-night/climax.png', '/assets/ui-night/vignette.png'].map(async url => {
    const response = await fetch(url); return [response.ok, response.headers.get('content-type')];
  })))).toEqual([[true, 'image/png'], [true, 'image/png']]);

  for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 700 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(stage.locator('.seat-main').first()).toBeVisible();
    await expect(page.getByRole('region', { name: '舞台行动', exact: true })).toBeVisible();
    await expectNoOverflow(page);
  }
  const target = stage.locator('.seat-main[aria-label*="可选目标"]').first();
  await target.click();
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stage-submit')).toBeEnabled();
  await stage.screenshot({ path: `/results/night-atmosphere-${testInfo.project.name}.png` });
});

test('短雾五秒后连同24粒子卸载，同一夜刷新、重连都不重播，白天和离场清除', async ({ page }) => {
  test.setTimeout(30_000);
  const night = loadGameFixture('night-spirit-full.json');
  await mount(page, night);
  const atmosphere = page.locator('.night-atmosphere');
  await expect(atmosphere).toBeVisible();
  await expect(atmosphere.locator('.night-atmosphere__motion i')).toHaveCount(24);
  await expect(atmosphere.locator('.night-atmosphere__motion')).toHaveCount(0, { timeout: 6_500 });
  await expect(atmosphere.locator('.night-atmosphere__glow')).toBeVisible();

  await page.reload();
  await expect(atmosphere).toBeVisible();
  await expect(atmosphere.locator('.night-atmosphere__motion')).toHaveCount(0);

  await pushFixture(page, { ...night, online: false });
  await expect(atmosphere.locator('.night-atmosphere__motion')).toHaveCount(0);
  await pushFixture(page, { ...night, online: true });
  await expect(atmosphere.locator('.night-atmosphere__motion')).toHaveCount(0);

  const day = loadGameFixture('day-election-full.json');
  await pushFixture(page, day);
  await expect(page.locator('.night-atmosphere')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '玩家舞台' })).not.toHaveClass(/theater-stage--night/);
  const lobby = structuredClone(day);
  lobby.view.room.phase = 'lobby';
  lobby.view.public = null;
  await pushFixture(page, lobby);
  await expect(page.locator('.night-atmosphere')).toHaveCount(0);
});

test('页面设置切换减少动画会立即停止且只保留静态夜景；隐藏后返回不重播', async ({ page }) => {
  const reduced = loadGameFixture('night-spirit-full.json');
  await mount(page, reduced);
  await expect(page.locator('.night-atmosphere__motion i')).toHaveCount(24);
  await page.getByRole('button', { name: '导航' }).click();
  await page.getByRole('dialog', { name: '剧院导航' }).getByRole('button', { name: '显示设置' }).click();
  const settings = page.getByRole('dialog', { name: '显示设置' });
  await settings.getByLabel('动画偏好').selectOption('reduced');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('true');
  await expect(page.locator('.night-atmosphere__glow')).toBeVisible();
  await expect(page.locator('.night-atmosphere__vignette')).toBeVisible();
  await expect(page.locator('.night-atmosphere__motion')).toHaveCount(0);

  await settings.getByLabel('动画偏好').selectOption('full');
  await page.getByRole('button', { name: '关闭' }).click();
  const next = structuredClone(reduced);
  next.view.public!.dayNumber += 1;
  await pushFixture(page, next);
  await expect(page.locator('.night-atmosphere__motion i')).toHaveCount(24);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.night-atmosphere__motion')).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.night-atmosphere__motion')).toHaveCount(0);
});
