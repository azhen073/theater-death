import { expect, test, type Page } from '@playwright/test';
import { alivePlayers, loadGameFixture, taskFixture } from '../helpers-v2/game.ts';

async function mount(page: Page) {
  const base = loadGameFixture();
  const ids = alivePlayers(base.view).slice(0, 3);
  const fixture = taskFixture(base.view, 'SUBMIT_GUARD', {
    playerIds: ids, maxTargets: 1, allowRepeated: false, canSkip: true, forbiddenPairs: [],
  });
  const commands: Array<Record<string, unknown>> = [];
  await page.route('**/__game-fixture', route => route.fulfill({ json: fixture }));
  await page.route('**/api/v2/rooms/*/view', route => route.fulfill({ json: fixture.view }));
  await page.route('**/api/v2/rooms/*/command', async route => {
    commands.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: { requestId: commands.at(-1)!.requestId, status: 'accepted', code: null, message: null } });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('region', { name: '舞台行动', exact: true })).toBeVisible();
  return { commands };
}

test('移动端选座后同一紧凑行动条保持可见并直接提交，桌面仍随舞台排列', async ({ page }, testInfo) => {
  const { commands } = await mount(page);
  for (const width of testInfo.project.name === 'chromium' ? [1440, 390, 320] : [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    const commandCount = commands.length;
    const bar = page.locator('.stage-action-card__submit');
    const submit = page.getByTestId('stage-submit');
    await expect(submit).toBeVisible();
    if (width === 1440) {
      await expect(bar).toHaveCSS('position', 'static');
      continue;
    }

    await expect(bar).toHaveCSS('position', 'fixed');
    await page.locator('.seat-main[aria-label*="可选目标"]').first().click();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    const before = await page.evaluate(() => scrollY);
    await expect(submit).toBeInViewport();
    const bounds = await bar.boundingBox();
    const tabs = await page.locator('.info-tabs').boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(tabs!.y + 1);
    await submit.click();
    await expect.poll(() => commands.length).toBe(commandCount + 1);
    expect(commands[commandCount]).toMatchObject({ action: 'SUBMIT_GUARD', targets: [expect.any(String)] });
    expect(before).toBeGreaterThan(0);
    await expect(page.locator('.stage-action-card__submit')).toHaveCount(1);
    await expect(page.getByTestId('stage-submit')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: `/results/mobile-action-bar-${testInfo.project.name}.png`, fullPage: true });
  }
});
