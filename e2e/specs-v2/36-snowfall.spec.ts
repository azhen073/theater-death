import { expect, test, type Page } from '@playwright/test';
import { revealHudActions } from '../helpers-v2/rooms.ts';
import { fixtureRoute, loadGameFixture, loadReviewDocument, loadReviewFixture, pushFixture, taskFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mount(page: Page, fixture: GameHarnessFixture): Promise<void> {
  await fixtureRoute(page, fixture);
  await page.route('**/api/v2/rooms/*/review', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(loadReviewDocument()),
  }));
  await page.goto('/game-test.html');
  await expect(page.getByRole('region', { name: '玩家舞台' })).toBeVisible();
}

/** 只改公开的轮次/阶段/昼夜，不碰私有视图与任务。 */
function publicStage(
  fixture: GameHarnessFixture,
  change: { stage?: 1 | 2; phase?: 'night' | 'morning' | 'day'; day?: number },
): GameHarnessFixture {
  const next = structuredClone(fixture);
  next.identityReveal = 'seen';
  next.view.viewVersion += 1;
  next.view.serverTime += 1_000;
  next.view.public!.stage = change.stage ?? next.view.public!.stage;
  next.view.public!.phase = change.phase ?? next.view.public!.phase as 'night' | 'morning' | 'day';
  next.view.public!.dayNumber = change.day ?? next.view.public!.dayNumber;
  return next;
}

async function setDocumentVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate(next => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** 图层可见且至少有一粒雪花落在视口内（雪粒位置随机，不能假定第一粒一定在屏幕上）。 */
async function expectSnowOnScreen(page: Page): Promise<void> {
  await expect(page.locator('.snowfall')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const layer = document.querySelector('.snowfall');
    if (!layer) return 0;
    return Array.from(layer.querySelectorAll('i')).filter(flake => {
      const rect = flake.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    }).length;
  })).toBeGreaterThan(0);
}

/** 雪花层必须完全不吃指针事件：图层中心与屏幕上可见雪粒的命中测试都不能落在 .snowfall 内。 */
async function expectSnowDoesNotIntercept(page: Page): Promise<void> {
  const hits = await page.evaluate(() => {
    const layer = document.querySelector('.snowfall') as HTMLElement;
    const box = layer.getBoundingClientRect();
    const classify = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y);
      if (!element) return 'none';
      return element.closest('.snowfall') ? 'snow' : 'other';
    };
    const flakes = Array.from(layer.querySelectorAll('i')).map(flake => {
      const rect = flake.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }).filter(point => point.x > 0 && point.y > 0 && point.x < window.innerWidth && point.y < window.innerHeight);
    return {
      layer: classify(box.left + box.width / 2, box.top + box.height / 2),
      flakes: flakes.slice(0, 12).map(point => classify(point.x, point.y)),
      pointerEvents: getComputedStyle(layer).pointerEvents,
    };
  });
  expect(hits.pointerEvents).toBe('none');
  expect(hits.layer).toBe('other');
  expect(hits.flakes.length).toBeGreaterThan(0);
  expect(hits.flakes.every(hit => hit === 'other')).toBe(true);
}

test('一阶段不飘雪，二阶段整页飘雪且为极简小颗粒、低密度、不挡点击', async ({ page }) => {
  const day = loadGameFixture('day-election-full.json');
  const fixture = taskFixture(day.view, 'SUBMIT_GUARD', {
    playerIds: day.view.public!.seats.filter(seat => seat.alive).slice(0, 3).map(seat => seat.playerId),
    maxTargets: 1, allowRepeated: false, canSkip: false, forbiddenPairs: [],
  });
  await mount(page, fixture);
  await expect(page.locator('.snowfall')).toHaveCount(0);

  await pushFixture(page, publicStage(fixture, { stage: 2 }));
  const snow = page.locator('.snowfall');
  await expect(snow).toBeVisible();
  await expect(snow).toHaveClass(/snowfall--day/);
  const flakes = await snow.locator('i').count();
  expect(flakes).toBeGreaterThanOrEqual(45);
  expect(flakes).toBeLessThanOrEqual(150);

  const shape = await snow.locator('i').first().evaluate(element => {
    const style = getComputedStyle(element);
    return { animation: style.animationName, duration: parseFloat(style.animationDuration), size: parseFloat(style.width), opacity: Number(style.opacity) };
  });
  expect(shape.animation).toBe('snow-fall');
  expect(shape.duration).toBeGreaterThanOrEqual(11);
  expect(shape.size).toBeGreaterThanOrEqual(3);
  expect(shape.size).toBeLessThanOrEqual(6);
  expect(shape.opacity).toBeGreaterThan(0);
  expect(shape.opacity).toBeLessThanOrEqual(0.34);

  await expectSnowDoesNotIntercept(page);
  const stage = page.getByRole('region', { name: '玩家舞台' });
  const target = stage.locator('.seat-main[aria-label*="可选目标"]').first();
  await target.click();
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stage-submit')).toBeEnabled();
});

test('选择减少动画会立即卸载整层，恢复标准动画后重新出现', async ({ page }) => {
  await mount(page, publicStage(loadGameFixture('day-election-full.json'), { stage: 2 }));
  await expect(page.locator('.snowfall')).toBeVisible();

  await revealHudActions(page);
  await page.getByRole('button', { name: '导航' }).click();
  await page.getByRole('dialog', { name: '剧院导航' }).getByRole('button', { name: '显示设置' }).click();
  const settings = page.getByRole('dialog', { name: '显示设置' });
  await settings.getByLabel('动画偏好').selectOption('reduced');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('true');
  await expect(page.locator('.snowfall')).toHaveCount(0);

  await settings.getByLabel('动画偏好').selectOption('full');
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('.snowfall')).toBeVisible();
});

test('页面隐藏即卸载，返回后回来；离场与复盘都不出现；二阶段夜间与夜景氛围共存', async ({ page }, testInfo) => {
  const night = publicStage(loadGameFixture('night-spirit-full.json'), { stage: 2 });
  // 清掉私有任务，让舞台保持环形全貌，截图能同时看到夜景氛围与飘雪。
  night.view.tasks = [];
  night.view.capabilities.allowedCommands = [];
  await mount(page, night);
  await expect(page.locator('.snowfall')).toHaveClass(/snowfall--night/);
  await expect(page.locator('.night-atmosphere')).toBeVisible();
  // AGENTS.md「测试策略」：汇报用截图必须是整页（fullPage），不要只截视口或元素局部。
  await page.screenshot({ path: `/results/snowfall-night-${testInfo.project.name}.png`, fullPage: true });

  await setDocumentVisibility(page, 'hidden');
  await expect(page.locator('.snowfall')).toHaveCount(0);
  await setDocumentVisibility(page, 'visible');
  await expect(page.locator('.snowfall')).toBeVisible();

  const lobby = structuredClone(night);
  lobby.view.room.phase = 'lobby';
  lobby.view.public = null;
  await pushFixture(page, lobby);
  await expect(page.locator('.snowfall')).toHaveCount(0);

  const review = { ...loadReviewFixture(), identityReveal: 'seen' as const };
  await pushFixture(page, review);
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  await expect(page.locator('.snowfall')).toHaveCount(0);
});

test('二阶段飘雪在四档宽度不产生横向溢出，座位与行动卡保持可见', async ({ page }, testInfo) => {
  await mount(page, publicStage(loadGameFixture('day-election-full.json'), { stage: 2 }));
  const stage = page.getByRole('region', { name: '玩家舞台' });
  for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 700 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expectSnowOnScreen(page);
    await expect(stage.locator('.seat-main').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: `/results/snowfall-${testInfo.project.name}.png`, fullPage: true });
});
