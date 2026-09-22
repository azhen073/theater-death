import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, loadReviewFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.goto('/game-test.html');
  return { set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

test('正式玩家每局首次入场揭示身份，刷新和响应式切换不重播', async ({ page }) => {
  const fixture = loadGameFixture('night-door-full.json');
  fixture.identityReveal = 'enabled';
  await mount(page, fixture);
  const role = fixture.catalog.roles.find(item => item.roleId === fixture.view.private!.self.roleId)!;
  const dialog = page.getByRole('dialog', { name: role.name });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(role.name);
  await expect(dialog).toContainText(role.faction === 'human' ? '人类阵营' : '死神阵营');
  await expect(dialog).toContainText(`${fixture.view.private!.self.seat}号席位`);
  await expect(dialog).toContainText(role.description);
  await expect(dialog.getByRole('img', { name: `${role.name}身份卡` })).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await dialog.getByRole('button', { name: '进入舞台' }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('dialog', { name: role.name })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /夜幕降临|晨间公告/ })).toBeVisible();
});

test('公共观众、私人第二屏和复盘均不自动展示', async ({ page }) => {
  const publicView = loadGameFixture('night-door-full.json');
  publicView.identityReveal = 'enabled';
  publicView.view.viewer.kind = 'public_spectator';
  publicView.view.viewer.readOnly = true;
  publicView.view.viewer.subjectPlayerId = null;
  publicView.view.private = null;
  const mounted = await mount(page, publicView);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const privateScreen = loadGameFixture('private-second-screen-full.json');
  privateScreen.identityReveal = 'enabled';
  await mounted.set(privateScreen);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const review = loadReviewFixture();
  review.identityReveal = 'enabled';
  await mounted.set(review);
  await expect(page.getByRole('heading', { name: '演出落幕' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('十秒内行动优先，已显示的身份揭示也立即让位且本局不补弹', async ({ page }) => {
  const fixture = loadGameFixture('night-door-full.json');
  fixture.identityReveal = 'enabled';
  fixture.view.tasks[0]!.closesAt = fixture.view.serverTime + 10_000;
  const mounted = await mount(page, fixture);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '舞台行动' })).toBeVisible();

  const nextGame = structuredClone(fixture);
  nextGame.view.gameId = `${fixture.view.gameId}-next`;
  nextGame.identityReveal = 'enabled';
  nextGame.view.tasks[0]!.closesAt = nextGame.view.serverTime + 60_000;
  await mounted.set(nextGame);
  const reveal = page.getByRole('button', { name: '进入舞台' });
  await expect(reveal).toBeVisible();

  const urgent = structuredClone(nextGame);
  urgent.view.viewVersion += 1;
  urgent.view.tasks[0]!.closesAt = urgent.view.serverTime + 9_000;
  await mounted.set(urgent);
  await expect(reveal).toHaveCount(0);

  const safeAgain = structuredClone(urgent);
  safeAgain.view.viewVersion += 1;
  safeAgain.view.tasks[0]!.closesAt = safeAgain.view.serverTime + 60_000;
  await mounted.set(safeAgain);
  await expect(page.getByRole('button', { name: '进入舞台' })).toHaveCount(0);
});
