import { expect, test, type Page } from '@playwright/test';
import { loginRoomAccount, loadRoomAccounts, waitRoom, confirmModal } from '../helpers-v2/rooms.ts';

async function geometry(page: Page) {
  return page.evaluate(() => {
    const layout = document.querySelector('.home-layout')!;
    const main = document.querySelector('.home-main')!;
    const nav = document.querySelector('.navigation')!;
    // Root scrollWidth/clientWidth use special zoom-dependent units. Probe real
    // horizontal scrolling instead of multiplying mixed CSS/device measurements.
    const scrolling = document.scrollingElement!;
    const oldLeft = scrolling.scrollLeft;
    scrolling.scrollLeft = 1_000_000;
    const overflow = scrolling.scrollLeft;
    scrolling.scrollLeft = oldLeft;
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, layout: rect(layout), main: rect(main), nav: rect(nav),
      zoom: Number(getComputedStyle(document.documentElement).zoom), dpr: devicePixelRatio,
      display: getComputedStyle(layout).display,
      maxWidth: getComputedStyle(main).maxWidth,
      grid: rect(document.querySelector('.lobby-grid')!),
      overflow };
  });
}

async function expectFit(page: Page) {
  await expect.poll(async () => {
    const g = await geometry(page);
    const available = g.display === 'block' ? g.viewport.width : g.viewport.width - g.nav.width;
    return Math.abs(g.main.width - available);
  }).toBeLessThan(2);
  const g = await geometry(page);
  expect(g.maxWidth).toBe('none');
  expect(g.layout.height).toBeGreaterThanOrEqual(g.viewport.height - 2);
  expect(g.main.right).toBeLessThanOrEqual(g.viewport.width + 2);
  expect(g.overflow, JSON.stringify(g)).toBeLessThan(2);
}

test('大厅连续跨大小视口与DPR保持铺满；缩放补偿满高且账户/规则不被拉宽', async ({ page, context, browserName }, testInfo) => {
  test.setTimeout(120_000);
  await loginRoomAccount(page, loadRoomAccounts(testInfo.project.name)[6]!);
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await waitRoom(page);
  const roomCode = await page.locator('.room-code strong').innerText();

  for (const scale of [90, 100, 110]) {
    await page.getByRole('button', { name: '我的账户', exact: true }).click();
    await page.getByLabel('界面缩放').selectOption(String(scale));
    await expect(page.locator('.home-main')).toHaveCSS('max-width', '1280px');
    await page.getByRole('button', { name: '我的房间', exact: true }).click();
    await waitRoom(page);
    for (const [width, height] of [[1366, 900], [2560, 1600], [1920, 1080], [1800, 1000], [3840, 1600], [900, 900], [680, 844], [390, 844], [320, 720], [1366, 900]]) {
      await page.setViewportSize({ width: width!, height: height! });
      await expectFit(page);
      await expect(page.locator('.room-code strong')).toHaveText(roomCode);
      // With sparse content and a tall desktop, min-height must neither shrink nor overshoot.
      if (height === 1600) expect(Math.abs((await geometry(page)).layout.height - height)).toBeLessThan(2);
    }
  }
  await page.getByRole('button', { name: '我的账户', exact: true }).click();
  await page.getByLabel('界面缩放').selectOption('100');
  await page.getByRole('button', { name: '我的房间', exact: true }).click();
  await waitRoom(page);

  if (browserName === 'chromium') {
    const cdp = await context.newCDPSession(page);
    try {
      // Emulate mixed-scale monitor transitions while holding one window viewport constant.
      for (const dpr of [1, 1.25, 1.5, 2, 1.25, 1]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: dpr, mobile: false });
        await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(dpr);
        await expectFit(page);
      }
    } finally { await cdp.send('Emulation.clearDeviceMetricsOverride'); await cdp.detach(); }
  }
  await page.setViewportSize({ width: 2560, height: 1440 });
  await expectFit(page);
  expect((await geometry(page)).grid.width).toBeGreaterThan(2000);
  await page.screenshot({ path: `/results/lobby-wide-${testInfo.project.name}.png` });
  await page.getByRole('button', { name: '查看完整规则' }).click();
  const rules = page.getByRole('dialog');
  await expect(rules).toBeVisible();
  expect((await rules.boundingBox())!.width).toBeLessThanOrEqual(560);
  await rules.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '解散房间', exact: true }).click();
  await confirmModal(page, '解散房间？');
});
