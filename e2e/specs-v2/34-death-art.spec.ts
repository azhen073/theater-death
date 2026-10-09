import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

interface PixelSample { before: number[]; after: number[] }
interface ArtProbe { regions: string[]; mainCenters: string[]; overlaps: PixelSample[] }
declare global { interface Window { __deathArtProbe: ArtProbe } }

test.use({ viewport: { width: 1440, height: 1000 } });

function baseline(): GameHarnessFixture {
  const fixture = loadGameFixture('night-door-full.json');
  fixture.view.public!.events = [];
  fixture.view.public!.seats.forEach(seat => { seat.alive = true; });
  return fixture;
}

function announce(base: GameHarnessFixture, seats: number[]): GameHarnessFixture {
  const next = structuredClone(base);
  next.view.viewVersion += 1;
  next.view.public!.events.push({
    cursor: 1, type: 'deaths_announced', dayNumber: next.view.public!.dayNumber,
    stage: next.view.public!.stage, payload: { seats },
  });
  next.view.public!.seats.forEach(seat => { if (seats.includes(seat.seat)) seat.alive = false; });
  return next;
}

/** Observe the real renderer without replacing its images, geometry, pixels or compositing mode. */
async function observeArt(page: Page) {
  await page.addInitScript(() => {
    const probe: ArtProbe = { regions: [], mainCenters: [], overlaps: [] };
    window.__deathArtProbe = probe;
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const source = args[0];
      const isArt = this.canvas.classList.contains('death-particles') && args.length === 9 &&
        source instanceof HTMLImageElement && new URL(source.src).pathname === '/assets/avatar-sheet.png';
      let before: number[] | null = null;
      let x = 0, y = 0;
      if (isArt) {
        const region = args.slice(1, 5).join(',');
        if (!probe.regions.includes(region)) probe.regions.push(region);
        // drawRegion places each layer's center at its current transform's origin.
        const transform = this.getTransform();
        x = Math.floor(transform.e); y = Math.floor(transform.f);
        if (region === '48,110,490,675') {
          const center = `${x},${y}`;
          if (!probe.mainCenters.includes(center)) probe.mainCenters.push(center);
        }
        if (region === '554,408,249,229' && probe.overlaps.length < 200 &&
            x >= 0 && y >= 0 && x < this.canvas.width && y < this.canvas.height) {
          before = Array.from(this.getImageData(x, y, 1, 1).data);
        }
      }
      Reflect.apply(drawImage, this, args);
      if (before) probe.overlaps.push({ before, after: Array.from(this.getImageData(x, y, 1, 1).data) });
    } as typeof drawImage;
  });
}

async function mount(page: Page, theme: 'light' | 'dark', fixture: GameHarnessFixture) {
  let current = fixture;
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' });
  await page.addInitScript(value => {
    localStorage.setItem('theater-death-display-v1', JSON.stringify({ theme: value, motion: 'full', deathEffects: true }));
  }, theme);
  await observeArt(page);
  await page.route('**/__game-fixture', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(current) }));
  await page.goto('/game-test.html');
  await expect(page.locator('.theater-stage')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  return { set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

async function preloadArt(page: Page) {
  // Playwright routing disables the HTTP cache: decoding a preload alone does not make the
  // component's next Image request immediate. Serve the real server bytes from memory for
  // every successful-image request, keeping network latency outside the 3.2-second animation.
  const response = await page.request.get(new URL('/assets/avatar-sheet.png', page.url()).href);
  expect(response.ok(), 'The application must serve its real death atlas').toBe(true);
  const png = await response.body();
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await page.route('**/assets/avatar-sheet.png', route => route.fulfill({
    status: 200, contentType: 'image/png', body: png,
  }));
  // The failure case never calls this helper, so its route.abort remains in force.
  await page.evaluate(async () => {
    const image = new Image();
    image.src = '/assets/avatar-sheet.png';
    await image.decode();
    if (image.naturalWidth !== 1774 || image.naturalHeight !== 887) throw new Error('Unexpected death atlas dimensions');
  });
}

async function frameStyle(seat: Locator) {
  return seat.evaluate(element => {
    const style = getComputedStyle(element, '::before');
    return { source: style.borderImageSource, display: style.display, pointer: style.pointerEvents };
  });
}

/** Compare visible RGB after alpha compositing onto white, rather than comparing unassociated RGBA. */
function whiteLuminance(pixel: number[]): number {
  const alpha = pixel[3]! / 255;
  return (pixel[0]! * .2126 + pixel[1]! * .7152 + pixel[2]! * .0722) * alpha + 255 * (1 - alpha);
}

async function hasPaint(page: Page): Promise<boolean> {
  return page.locator('.death-particles').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  });
}

test('死亡分层素材：实际四区域绘制，白底碎片不会洗白已有主星芒', async ({ page }, info) => {
  const start = new Date('2026-10-10T00:00:00.000Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
  const base = baseline();
  const mounted = await mount(page, 'light', base);
  await preloadArt(page);
  await mounted.set(announce(base, [1]));
  await expect(page.locator('.death-notice')).toContainText('1号已死亡');
  // Image decoding/network events use real time, while animation age only advances one frame
  // per poll. A slow WebKit image load must not consume the short initial main-star phase.
  await expect.poll(async () => {
    await page.clock.runFor(16);
    return page.locator('.death-particles').getAttribute('data-art');
  }).toBe('true');
  await page.clock.runFor(1200);
  await expect.poll(() => page.evaluate(() => window.__deathArtProbe.regions)).toEqual(expect.arrayContaining([
    '48,110,490,675', '554,408,249,229', '501,122,347,225', '516,697,330,105',
  ]));
  await page.screenshot({ path: `/results/death-art-light-${info.project.name}.png`, fullPage: true });

  const samples = await page.evaluate(() => window.__deathArtProbe.overlaps);
  const overDarkArt = samples.filter(sample => whiteLuminance(sample.before) < 190);
  expect(overDarkArt.length, 'Must sample real dark star pixels beneath the white center of the shard image').toBeGreaterThan(0);
  const largestBrightening = Math.max(...overDarkArt.map(sample => whiteLuminance(sample.after) - whiteLuminance(sample.before)));
  // Allow small 8-bit rounding differences; source-over brightens these real pixels by tens of levels.
  expect(largestBrightening, 'A near-white shard center must not erase the star already painted beneath it').toBeLessThanOrEqual(2);
});

test('死亡素材加载失败：保留程序粒子和公开公告，并按期停止', async ({ page }, info) => {
  await page.route('**/assets/avatar-sheet.png', route => route.abort('failed'));
  const base = baseline();
  const mounted = await mount(page, 'light', base);
  await mounted.set(announce(base, [1]));
  await expect(page.locator('.death-notice')).toContainText('1号已死亡');
  await expect(page.locator('.death-particles')).toHaveCount(1);
  await expect.poll(() => hasPaint(page)).toBe(true);
  expect(await page.locator('.death-particles').getAttribute('data-art')).toBeNull();
  expect(await page.evaluate(() => window.__deathArtProbe.regions)).toEqual([]);
  await page.screenshot({ path: `/results/death-art-fallback-${info.project.name}.png`, fullPage: true });
  await expect(page.locator('.death-particles')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.death-notice')).toHaveCount(0);
});

test('暗色主题同批死亡与卡框：素材有细节，生死框正确且不遮盖选中和草稿态', async ({ page }, info) => {
  const base = baseline();
  const mounted = await mount(page, 'dark', base);
  await preloadArt(page);
  await mounted.set(announce(base, [1, 2]));
  await expect(page.locator('.death-notice')).toContainText('1号、2号已死亡');
  await expect(page.locator('[data-death-seat="1"] .seat-death-mark')).toBeVisible();
  await expect(page.locator('[data-death-seat="2"] .seat-death-mark')).toBeVisible();
  await expect(page.locator('.death-particles')).toHaveAttribute('data-art', 'true');
  await expect.poll(() => page.evaluate(() => window.__deathArtProbe.mainCenters.length)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.__deathArtProbe.regions)).toContain('501,122,347,225');
  const samples = await page.evaluate(() => window.__deathArtProbe.overlaps);
  expect(samples.some(sample => whiteLuminance(sample.after) < 150), 'The art must contain substantial dark detail, not just baked white rectangles').toBe(true);
  await page.screenshot({ path: `/results/death-art-dark-multiple-${info.project.name}.png`, fullPage: true });

  const deadSeat = page.locator(`[data-player-id="${base.view.public!.seats.find(seat => seat.seat === 1)!.playerId}"] .seat-main`);
  const livingId = base.view.public!.seats.find(seat => seat.seat === 3)!.playerId;
  const livingSeat = page.locator(`[data-player-id="${livingId}"] .seat-main`);
  expect((await frameStyle(deadSeat)).source).toContain('/assets/frames/death.png');
  expect((await frameStyle(livingSeat)).source).toContain('/assets/frames/human.png');
  expect((await frameStyle(livingSeat)).display).not.toBe('none');
  expect((await frameStyle(livingSeat)).pointer).toBe('none');
  await livingSeat.click();
  await expect(livingSeat).toHaveAttribute('aria-pressed', 'true');
  expect((await frameStyle(livingSeat)).display).toBe('none');
  await livingSeat.click();
  await expect(livingSeat).toHaveAttribute('aria-pressed', 'false');
  expect((await frameStyle(livingSeat)).display).not.toBe('none');

  // A published team proposal is distinct from the viewer's local selected targets.
  const draft = loadGameFixture('night-death-full.json');
  const targetId = draft.view.public!.seats.find(seat => seat.seat === 3)!.playerId;
  draft.view.private!.proposal = {
    ...draft.view.private!.proposal!, revision: 1, targetPlayerIds: [targetId], confirmedBy: [],
    effective: { revision: 1, targetPlayerIds: [targetId], basis: 'latest_legal' },
  };
  await mounted.set(draft);
  const draftCard = page.locator(`[data-player-id="${targetId}"]`);
  const draftSeat = draftCard.locator('.seat-main');
  await expect(draftCard).toHaveClass(/stage-seat--draft/);
  if (await draftSeat.getAttribute('aria-pressed') === 'true') await draftSeat.click();
  await expect(draftSeat).toHaveAttribute('aria-pressed', 'false');
  await expect(draftCard.locator('.seat-draft')).toHaveText('草稿');
  expect((await frameStyle(draftSeat)).display).toBe('none');
});
