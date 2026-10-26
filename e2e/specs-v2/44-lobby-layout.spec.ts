import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mount(page: Page, fixture: GameHarnessFixture) {
  await page.route('**/__game-fixture', route => route.fulfill({ json: fixture }));
  await page.goto('/game-test.html');
}

test('桌面大厅长列表独立滚动且规则侧栏留在视口，移动端恢复自然列表', async ({ page }, testInfo) => {
  const fixture = loadGameFixture('post-review-lobby-full.json');
  const original = fixture.view.room.formalMembers;
  fixture.view.room.formalMembers = Array.from({ length: 26 }, (_, index) => ({
    ...original[index % original.length]!,
    memberId: `layout-member-${index}`,
    userId: `layout-user-${index}`,
    nickname: `长列表玩家 ${String(index + 1).padStart(2, '0')} 号`,
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, fixture);
  await expect(page.getByRole('heading', { name: '房间大厅' })).toBeVisible();
  const list = page.locator('.members-list').first();
  await expect(list.locator('.member-card')).toHaveCount(26);
  await expect(list).toHaveCSS('overflow-y', 'auto');
  expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(list.locator('.member-card').last()).toBeInViewport();
  await expect(page.locator('.room-rules')).toHaveCSS('position', 'sticky');
  const rules = await page.locator('.room-rules').boundingBox();
  expect(rules!.y).toBeGreaterThanOrEqual(0);
  expect(rules!.y + rules!.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: `/results/lobby-layout-desktop-${testInfo.project.name}.png`, fullPage: true });

  await page.setViewportSize({ width: 320, height: 844 });
  await expect(list).toHaveCSS('overflow-y', 'visible');
  await expect(page.locator('.room-rules')).toHaveCSS('position', 'static');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/results/lobby-layout-mobile-${testInfo.project.name}.png`, fullPage: true });
});

test('窄屏座位详情保留头像、长昵称和完整状态且不产生横向溢出', async ({ page }, testInfo) => {
  const fixture = loadGameFixture('night-door-full.json');
  fixture.view.public!.seats[0]!.nickname = '一位昵称特别长且需要完整换行显示的剧院玩家';
  fixture.view.public!.seats[0]!.uid = '12345678901234567890';
  await page.setViewportSize({ width: 320, height: 844 });
  await mount(page, fixture);
  await page.locator('.seat-tools button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.seat-profile > .avatar')).toBeVisible();
  await expect(dialog).toContainText(fixture.view.public!.seats[0]!.nickname);
  await expect(dialog).toContainText('公开状态：存活');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/results/seat-profile-mobile-${testInfo.project.name}.png`, fullPage: true });
});
