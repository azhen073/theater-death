import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, loadReviewDocument, pushFixture, resizeSeats, type GameHarnessFixture } from '../helpers-v2/game.ts';

function baseline(): GameHarnessFixture {
  const fixture = loadGameFixture('night-door-full.json');
  fixture.view.public!.events = [];
  fixture.view.public!.seats.forEach(seat => { seat.alive = true; });
  return fixture;
}
function announce(base: GameHarnessFixture, seats: number[], cursor: number): GameHarnessFixture {
  const next = structuredClone(base); next.view.viewVersion++;
  next.view.public!.events.push({ cursor, type: 'deaths_announced', dayNumber: 1, stage: 1, payload: { seats } });
  next.view.public!.seats.forEach(seat => { if (seats.includes(seat.seat)) seat.alive = false; });
  return next;
}
async function mount(page: Page, fixture = baseline()) {
  let current = fixture;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/__game-fixture', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(current) }));
  await page.goto('/game-test.html');
  await expect(page.locator('.theater-stage')).toBeVisible();
  return { set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}
async function preferences(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(next => {
    const key = 'theater-death-display-v1';
    const value = { ...JSON.parse(localStorage.getItem(key) ?? '{}'), ...next };
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('theater-display-changed', { detail: value }));
  }, patch);
}
const mark = (page: Page, seat: number) => page.locator(`[data-death-seat="${seat}"] .seat-death-mark`);

test('公开死讯绘制座位粒子，常驻星芒覆盖头像；不挡点击、不重播', async ({ page }, info) => {
  const base = baseline(), mounted = await mount(page, base);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const first = announce(base, [1], 1); await mounted.set(first);
  await expect(page.locator('.death-notice')).toContainText('1号已死亡');
  await expect(mark(page, 1)).toBeVisible();
  await expect(page.locator('.death-particles')).toHaveCount(1);
  await expect.poll(() => page.locator('.death-particles').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);
  const geometry = await page.locator('.death-particles').evaluate(element => {
    const canvas = element as HTMLCanvasElement, rect = element.getBoundingClientRect();
    const avatar = document.querySelector('[data-death-seat="1"]')!.getBoundingClientRect();
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, x = 0, y = 0;
    for (let i = 3; i < pixels.length; i += 4) { const a = pixels[i]; const index = (i - 3) / 4; sum += a; x += (index % canvas.width) * a; y += Math.floor(index / canvas.width) * a; }
    return { painted: sum > 0, dx: Math.abs(rect.left + x / sum * rect.width / canvas.width - (avatar.left + avatar.width / 2)), dy: Math.abs(rect.top + y / sum * rect.height / canvas.height - (avatar.top + avatar.height / 2)), pointer: getComputedStyle(element).pointerEvents };
  });
  expect(geometry.painted).toBe(true); expect(geometry.dx).toBeLessThan(150); expect(geometry.dy).toBeLessThan(150); expect(geometry.pointer).toBe('none');
  // Capture the dispersal phase rather than the initially transparent frame.
  await page.waitForTimeout(650);
  await page.screenshot({ path: `/results/death-fx/burst-${info.project.name}.png`, fullPage: true });
  await page.getByRole('tab', { name: /^记录/ }).click();
  await expect(page.getByRole('tabpanel', { name: '记录' })).toContainText('晨间死讯');
  await page.getByRole('button', { name: '查看1号玩家信息', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('公开状态：已死亡');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.death-notice')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.death-particles')).toHaveCount(0);
  await expect(mark(page, 1)).toBeVisible();
  await mounted.set(structuredClone(first));
  await expect(page.locator('.death-particles')).toHaveCount(0);
  await page.reload();
  await expect(mark(page, 1)).toBeVisible();
  await expect(page.locator('.death-notice')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('私有死亡不泄漏；同批多人、连续批次、回归与再次死亡', async ({ page }) => {
  const base = baseline(), mounted = await mount(page, base);
  const hidden = structuredClone(base); hidden.view.viewVersion++;
  hidden.view.private!.self.life = 'dead';
  hidden.view.private!.events.push({ cursor: 99, type: 'night_deaths_confirmed', dayNumber: 1, stage: 1, payload: { seats: [1] } });
  await mounted.set(hidden);
  await expect(page.locator('.seat-death-mark')).toHaveCount(0);
  await expect(page.locator('.death-notice')).toHaveCount(0);
  const first = announce(hidden, [1, 2], 1); await mounted.set(first);
  await expect(page.locator('.death-notice')).toContainText('1号、2号已死亡');
  const second = announce(first, [3], 2); await mounted.set(second);
  await expect(page.locator('.death-notice')).toContainText('1号、2号、3号已死亡');
  const returned = structuredClone(second); returned.view.viewVersion++;
  returned.view.public!.seats.find(seat => seat.seat === 1)!.alive = true;
  await mounted.set(returned); await expect(mark(page, 1)).toHaveCount(0);
  await expect(page.locator('.death-notice')).toContainText('2号、3号已死亡');
  const again = announce(returned, [1], 3); await mounted.set(again);
  await expect(mark(page, 1)).toBeVisible();
  const immediateReturn = announce(again, [4], 4);
  immediateReturn.view.public!.seats.find(seat => seat.seat === 4)!.alive = true;
  await mounted.set(immediateReturn); await expect(mark(page, 4)).toHaveCount(0);
  await expect(page.locator('.death-notice')).not.toContainText('4号');
});

test('重连/隐藏页面/换局只恢复静态状态，观众也只看公开死讯', async ({ page }) => {
  const base = baseline(), mounted = await mount(page, base);
  const offline = announce(base, [1], 1); offline.online = false; await mounted.set(offline);
  const online = structuredClone(offline); online.online = true; await mounted.set(online);
  await expect(mark(page, 1)).toBeVisible(); await expect(page.locator('.death-particles')).toHaveCount(0);
  const away = announce(online, [2], 2); away.active = false; await mounted.set(away);
  await expect(page.locator('.death-notice')).toHaveCount(0);
  const back = structuredClone(away); back.active = true; await mounted.set(back);
  await expect(mark(page, 2)).toBeVisible(); await expect(page.locator('.death-particles')).toHaveCount(0);
  const next = announce(back, [3], 3); await mounted.set(next); await expect(page.locator('.death-particles')).toHaveCount(1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('.death-particles')).toHaveCount(0); await expect(page.locator('.death-notice')).toHaveCount(0);
  const hiddenUpdate = announce(next, [4], 4); await mounted.set(hiddenUpdate);
  await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(mark(page, 4)).toBeVisible(); await expect(page.locator('.death-particles')).toHaveCount(0);
  const changed = structuredClone(next); changed.view.gameId += '-new'; await mounted.set(changed);
  await expect(page.locator('.death-notice')).toHaveCount(0);
  for (const kind of ['public_spectator', 'private_spectator'] as const) {
    const observer = baseline(); observer.view.viewer.kind = kind; observer.view.viewer.readOnly = true;
    if (kind === 'public_spectator') { observer.view.private = null; observer.view.viewer.subjectPlayerId = null; }
    await mounted.set(observer); await expect(page.locator('.seat-death-mark')).toHaveCount(0);
    await mounted.set(announce(observer, [1], 1)); await expect(mark(page, 1)).toBeVisible();
    await expect(page.locator('.death-notice')).toContainText('1号已死亡');
  }
});

test('减少动画和关闭装饰仍有文字公告；重新打开不补播旧粒子', async ({ page }) => {
  const base = baseline(), mounted = await mount(page, base);
  await preferences(page, { motion: 'reduced' });
  const first = announce(base, [1], 1); await mounted.set(first);
  await expect(page.locator('.death-notice')).toContainText('1号已死亡'); await expect(mark(page, 1)).toBeVisible();
  await expect(page.locator('.death-particles')).toHaveCount(0);
  await preferences(page, { motion: 'full' }); await expect(page.locator('.death-particles')).toHaveCount(0);
  await preferences(page, { deathEffects: false }); await expect(mark(page, 1)).toHaveCount(0);
  const second = announce(first, [2], 2); await mounted.set(second);
  await expect(page.locator('.death-notice')).toContainText('2号'); await expect(page.locator('.death-particles')).toHaveCount(0);
  await preferences(page, { deathEffects: true }); await expect(mark(page, 2)).toBeVisible();
  await expect(page.locator('.death-particles')).toHaveCount(0);
  await mounted.set(announce(second, [3], 3)); await expect(page.locator('.death-particles')).toHaveCount(1);
  await preferences(page, { motion: 'system' }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.death-particles')).toHaveCount(0); await expect(mark(page, 3)).toBeVisible();
});

test('最后一次公开死讯跨复盘切换保留，初次打开复盘不重播', async ({ page }) => {
  const base = baseline(), mounted = await mount(page, base);
  const end = announce(base, [1], 1); end.view.room.phase = 'review'; end.view.public!.phase = 'ended';
  end.view.public!.result = { winner: 'human', dayNumber: 1, reason: '验收终局' };
  const review = loadReviewDocument(); review.review.gameId = end.view.gameId!;
  await page.route('**/api/v2/rooms/*/review', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(review) }));
  await mounted.set(end);
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  await expect(page.locator('.death-notice')).toContainText('1号已死亡');
  await expect(page.locator('.death-particles')).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  await expect(page.locator('.death-notice')).toHaveCount(0);
});

test('320/390/844/1440、缩放、大人数场景的覆盖层无溢出且粒子预算有界', async ({ page }, info) => {
  const base = baseline(), mounted = await mount(page, base);
  for (const [width, height, count, scale] of [[320, 740, 5, 90], [390, 844, 13, 110], [844, 390, 26, 100], [1440, 900, 64, 100]]) {
    await page.setViewportSize({ width, height }); await preferences(page, { scale });
    const fixture = { ...base, view: resizeSeats(base.view, count) }; fixture.view.gameId += `-${count}`;
    await mounted.set(fixture); await expect(page.locator('.stage-seat')).toHaveCount(count);
    await mounted.set(announce(fixture, [1, 2, 3], 1));
    await expect(mark(page, 1)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect.poll(async () => Number(await page.locator('.death-particles').getAttribute('data-particle-count'))).toBeGreaterThan(0);
    const budget = await page.locator('.death-particles').evaluate(element => ({ count: Number((element as HTMLElement).dataset.particleCount), width: element.clientWidth }));
    expect(budget.count).toBeLessThanOrEqual(budget.width < 600 ? 100 : 220);
    if (count === 13) await page.screenshot({ path: `/results/death-fx/mobile-${info.project.name}.png`, fullPage: true });
  }
});
