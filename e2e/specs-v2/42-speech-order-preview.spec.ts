import { expect, test } from '@playwright/test';
import { alivePlayers, loadGameFixture } from '../helpers-v2/game.ts';

test('发言顺序预览来自服务端而不是客户端排序', async ({ page }, testInfo) => {
  const fixture = loadGameFixture('day-election-full.json');
  const ids = alivePlayers(fixture.view).slice(0, 3);
  fixture.view.tasks = [{
    action: 'DESIGNATE_SPEECH', windowInstanceId: 'speech-preview-window', closesAt: fixture.view.serverTime + 30_000,
    targets: { playerIds: ids, maxTargets: 1, allowRepeated: false, canSkip: false, forbiddenPairs: [] },
  }];
  fixture.view.windows = [{ id: 'speech_order', type: 'speech_order', instanceId: 'speech-preview-window', closesAt: fixture.view.serverTime + 30_000 }];
  fixture.view.capabilities.allowedCommands = ['DESIGNATE_SPEECH'];
  fixture.view.public!.day!.step = 'speech_round';
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.route('**/api/v2/rooms/*/view', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.view) }));
  await page.route('**/api/v2/rooms/*/speech-order-preview', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ speechOrder: [{ playerId: ids[1], seat: 2 }, { playerId: ids[0], seat: 1 }, { playerId: ids[2], seat: 3 }] }),
  }));
  await page.goto('/game-test.html');
  await page.locator('.seat-main[aria-label*="可选目标"]').first().click();
  const preview = page.getByLabel('发言顺序预览');
  await expect(preview).toContainText('2号 → 1号 → 3号');
  await page.screenshot({ path: `/results/speech-order-preview-${testInfo.project.name}.png`, fullPage: true });
});
