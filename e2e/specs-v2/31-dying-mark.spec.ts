import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

/** 座位左下角「濒死」标记（R-20/R-24）：只对有名单视野的人可见，服务端已按授权裁剪。 */

function fixtureWithDying(seats: number[] | null, role?: string): GameHarnessFixture {
  const base = loadGameFixture('night-spirit-full.json');
  const view = structuredClone(base.view);
  if (role) view.private!.self.roleId = role as typeof view.private.self.roleId;
  if (seats === null) delete (view.private!.knowledge as { dyingSeats?: number[] }).dyingSeats;
  else view.private!.knowledge.dyingSeats = seats;
  return { ...base, view };
}

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/view', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current.view) }));
  await page.goto('/game-test.html');
  await expect(page.locator('.theater-stage')).toBeVisible();
  return { set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

test('濒死标记：名单内座位左下角显示，名单外/无字段/公开观众都不显示', async ({ page }, testInfo) => {
  const fixture = fixtureWithDying([6, 7], 'descender');
  const seatId = (seatNumber: number) => fixture.view.public!.seats.find(seat => seat.seat === seatNumber)!.playerId;
  await mount(page, fixture);

  // 名单内：文案 + 白底红字描边 + 无障碍名带「濒死」
  const marked = page.locator(`[data-player-id="${seatId(6)}"] .seat-dying`);
  await expect(marked).toHaveText('濒死');
  await expect(marked).toHaveCSS('color', 'rgb(148, 75, 86)');
  await expect(marked).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(marked).toHaveCSS('border-top-color', 'rgb(148, 75, 86)');
  await expect(page.locator(`[data-player-id="${seatId(6)}"] .seat-main`)).toHaveAttribute('aria-label', /，濒死/);
  await expect(page.locator('.seat-dying')).toHaveCount(2);
  // 名单外：没有标记，也没有「濒死」无障碍名
  await expect(page.locator(`[data-player-id="${seatId(1)}"] .seat-dying`)).toHaveCount(0);
  await expect(page.locator(`[data-player-id="${seatId(1)}"] .seat-main`)).not.toHaveAttribute('aria-label', /濒死/);
  // 濒死不改变公开存活状态
  await expect(page.locator(`[data-player-id="${seatId(6)}"] .seat-status`)).toContainText('存活');
  // 位置：左下角（在卡片左半、下沿附近），且不与可见的「详情」按钮或状态行重叠
  const geometry = await marked.evaluate(node => {
    const card = node.closest('.seat-main')!.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const button = (node.closest('.stage-seat')!.querySelector('.seat-tools button') as HTMLElement).getBoundingClientRect();
    const status = (node.closest('.seat-main')!.querySelector('.seat-status') as HTMLElement).getBoundingClientRect();
    const overlap = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    return {
      leftOfCenter: box.left < card.left + card.width / 2,
      belowCenter: box.top > card.top + card.height / 2,
      buttonOverlap: overlap(box, button),
      statusOverlap: overlap(box, status),
    };
  });
  expect(geometry.leftOfCenter).toBe(true);
  expect(geometry.belowCenter).toBe(true);
  expect(geometry.buttonOverlap, JSON.stringify(geometry)).toBe(false);
  expect(geometry.statusOverlap, JSON.stringify(geometry)).toBe(false);
  await page.screenshot({ path: '/results/seat-dying-' + testInfo.project.name + '.png', fullPage: true });

  // 4 倍放大存档（仅 chromium：CDP 截屏 WebKit 不可用）；clip 外扩以便完整包含卡片外的左下角标记
  if (testInfo.project.name === 'chromium') {
    const card = await page.locator(`[data-player-id="${seatId(6)}"] .seat-main`).boundingBox();
    if (card) {
      const client = await page.context().newCDPSession(page);
      const shot = await client.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
        clip: { x: card.x - 14, y: card.y - 8, width: card.width + 28, height: card.height + 34, scale: 4 },
      });
      writeFileSync('/results/seat-dying-zoom-chromium.png', Buffer.from(shot.data, 'base64'));
    }
  }

  // 没有该字段（其他身份 / 二阶段 / 白天 / 水妖已用还魂曲）：全场无标记
  const { set } = await mount(page, fixtureWithDying(null, 'civilian'));
  await expect(page.locator('.seat-dying')).toHaveCount(0);
  // 水妖用过还魂曲由服务端省略字段 → 同样无标记（这里直接模拟"字段缺失"）
  await set(fixtureWithDying(null, 'water'));
  await expect(page.locator('.seat-dying')).toHaveCount(0);

  // 公开观众：无私有视图 → 无标记
  const spectator = fixtureWithDying([6], 'descender');
  spectator.view.private = null;
  spectator.view.viewer = { ...spectator.view.viewer, kind: 'public_spectator', readOnly: true, subjectPlayerId: null };
  await set(spectator);
  await expect(page.locator('.seat-dying')).toHaveCount(0);

  // 第二屏：沿用被绑定玩家的名单
  const second = fixtureWithDying([6], 'descender');
  second.view.viewer = { ...second.view.viewer, kind: 'private_spectator', readOnly: true };
  await set(second);
  await expect(page.locator('.seat-dying')).toHaveCount(1);
  await expect(page.locator(`[data-player-id="${seatId(6)}"] .seat-dying`)).toHaveText('濒死');

  // 390 宽：标记不溢出卡片、不与「详情」按钮重叠
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator(`[data-player-id="${seatId(6)}"] .seat-dying`).evaluate(node => {
    const card = node.closest('.seat-main')!.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const button = (node.closest('.stage-seat')!.querySelector('.seat-tools button') as HTMLElement).getBoundingClientRect();
    const overlap = Math.min(box.right, button.right) - Math.max(box.left, button.left) > 0.5 && Math.min(box.bottom, button.bottom) - Math.max(box.top, button.top) > 0.5;
    return box.left >= card.left - 30 && box.right <= card.right + 30 && !overlap;
  })).toBe(true);
  await page.screenshot({ path: '/results/seat-dying-390-' + testInfo.project.name + '.png', fullPage: true });

  // 320 宽（最窄支持档）：角标已收窄到 26px，仍不与「详情」按钮重叠
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.locator(`[data-player-id="${seatId(6)}"] .seat-dying`).evaluate(node => {
    const button = (node.closest('.stage-seat')!.querySelector('.seat-tools button') as HTMLElement).getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return !(Math.min(box.right, button.right) - Math.max(box.left, button.left) > 0.5 && Math.min(box.bottom, button.bottom) - Math.max(box.top, button.top) > 0.5);
  })).toBe(true);
  await page.screenshot({ path: '/results/seat-dying-320-' + testInfo.project.name + '.png', fullPage: true });
});
