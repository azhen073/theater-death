import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(current),
  }));
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: /夜幕降临|晨间公告|白天议程/ })).toBeVisible();
  return {
    set: async (next: GameHarnessFixture) => {
      current = next;
      await pushFixture(page, next);
    },
  };
}

function nextView(
  fixture: GameHarnessFixture,
  change: { phase?: 'night' | 'morning' | 'day'; day?: number; stage?: 1 | 2 },
): GameHarnessFixture {
  const next = structuredClone(fixture);
  next.identityReveal = 'seen';
  next.view.viewVersion += 1;
  next.view.serverTime += 1_000;
  next.view.public!.phase = change.phase ?? next.view.public!.phase as 'night' | 'morning' | 'day';
  next.view.public!.dayNumber = change.day ?? next.view.public!.dayNumber;
  next.view.public!.stage = change.stage ?? next.view.public!.stage;
  return next;
}

function withDeathEvent(
  fixture: GameHarnessFixture,
  type: 'deaths_announced' | 'elimination_announced',
  cursor: number,
): GameHarnessFixture {
  const next = structuredClone(fixture);
  next.view.public!.events = [...next.view.public!.events, {
    cursor,
    type,
    dayNumber: next.view.public!.dayNumber,
    stage: next.view.public!.stage,
    payload: type === 'deaths_announced' ? { seats: [1] } : { seat: 2 },
  }];
  return next;
}

const transition = (page: Page) => page.locator('.phase-transition');

async function setDocumentVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate(next => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('实时公开入夜、天亮和第二阶段均短暂展示，且不含私密信息', async ({ page }, testInfo) => {
  const night = loadGameFixture('night-door-full.json');
  night.identityReveal = 'seen';
  const mounted = await mount(page, night);

  const dawn = nextView(night, { phase: 'morning' });
  await mounted.set(dawn);
  await expect(transition(page)).toContainText('天光初现');
  await expect(transition(page)).toContainText(`第 ${dawn.view.public!.dayNumber} 轮 · 第 ${dawn.view.public!.stage} 阶段`);
  await expect(transition(page)).not.toContainText(dawn.view.private!.self.roleId);
  const privateRole = dawn.catalog.roles.find(role => role.roleId === dawn.view.private!.self.roleId)!;
  await expect(transition(page)).not.toContainText(privateRole.name);
  await expect(transition(page)).not.toContainText(privateRole.faction === 'human' ? '人类阵营' : '死神阵营');
  expect(await transition(page).evaluate(node => getComputedStyle(node).animationDuration)).toBe('2.2s');
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: '/results/phase-transition-1440.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/results/phase-transition-390.png' });
  }
  await expect(transition(page)).toHaveCount(0, { timeout: 2_600 });

  const stageTwo = nextView(dawn, { phase: 'day', stage: 2 });
  await mounted.set(stageTwo);
  await expect(transition(page)).toContainText('第二阶段开启');
  await expect(transition(page)).toHaveCount(0, { timeout: 2_600 });

  const nextNight = nextView(stageTwo, { phase: 'night', day: stageTwo.view.public!.dayNumber + 1 });
  await mounted.set(nextNight);
  await expect(transition(page)).toContainText('夜幕降临');
  await expect(transition(page)).toHaveCount(0, { timeout: 2_600 });
});

test('刷新、离线重连和隐藏页恢复都不补播', async ({ page }) => {
  const night = loadGameFixture('night-door-full.json');
  night.identityReveal = 'seen';
  const mounted = await mount(page, night);
  const dawn = nextView(night, { phase: 'morning' });

  await mounted.set(dawn);
  await expect(transition(page)).toBeVisible();
  await page.reload();
  await expect(transition(page)).toHaveCount(0);

  const offline = structuredClone(dawn);
  offline.online = false;
  await mounted.set(offline);
  const stageTwo = nextView(offline, { phase: 'day', stage: 2 });
  stageTwo.online = false;
  await mounted.set(stageTwo);
  await expect(transition(page)).toHaveCount(0);
  const reconnected = structuredClone(stageTwo);
  reconnected.online = true;
  await mounted.set(reconnected);
  await expect(transition(page)).toHaveCount(0);

  await setDocumentVisibility(page, 'hidden');
  const nextNight = nextView(reconnected, { phase: 'night', day: reconnected.view.public!.dayNumber + 1 });
  await mounted.set(nextNight);
  await expect(transition(page)).toHaveCount(0);
  await setDocumentVisibility(page, 'visible');
  await expect(transition(page)).toHaveCount(0);
});

test('紧急行动跳过转场，并立即取消已经进行中的转场', async ({ page }) => {
  const night = loadGameFixture('night-door-full.json');
  night.identityReveal = 'seen';
  const mounted = await mount(page, night);

  const urgentDawn = nextView(night, { phase: 'morning' });
  urgentDawn.view.tasks[0]!.closesAt = urgentDawn.view.serverTime + 9_000;
  await mounted.set(urgentDawn);
  await expect(transition(page)).toHaveCount(0);

  const safeAgain = structuredClone(urgentDawn);
  safeAgain.view.viewVersion += 1;
  safeAgain.view.tasks[0]!.closesAt = safeAgain.view.serverTime + 60_000;
  await mounted.set(safeAgain);
  await expect(transition(page)).toHaveCount(0);

  const stageTwo = nextView(safeAgain, { phase: 'day', stage: 2 });
  stageTwo.view.tasks[0]!.closesAt = stageTwo.view.serverTime + 60_000;
  await mounted.set(stageTwo);
  await expect(transition(page)).toContainText('第二阶段开启');
  const becomesUrgent = structuredClone(stageTwo);
  becomesUrgent.view.viewVersion += 1;
  becomesUrgent.view.tasks[0]!.closesAt = becomesUrgent.view.serverTime + 9_000;
  await mounted.set(becomesUrgent);
  await expect(transition(page)).toHaveCount(0);
});

test('公开死讯优先，同批天亮与阶段二在优先窗口后正常展示', async ({ page }) => {
  const night = loadGameFixture('night-door-full.json');
  night.identityReveal = 'seen';
  const mounted = await mount(page, night);

  const dawn = withDeathEvent(nextView(night, { phase: 'morning' }), 'deaths_announced', 30);
  await mounted.set(dawn);
  await expect(page.locator('.death-notice')).toContainText('1号已出局');
  await expect(transition(page)).toHaveCount(0);
  await expect(page.locator('.death-notice')).toHaveCount(0, { timeout: 2_200 });
  await expect(transition(page)).toContainText('天光初现', { timeout: 1_800 });
  await expect(transition(page)).toHaveCount(0, { timeout: 2_600 });

  const stageTwo = withDeathEvent(nextView(dawn, { phase: 'day', stage: 2 }), 'deaths_announced', 31);
  await mounted.set(stageTwo);
  await expect(page.locator('.death-notice')).toContainText('1号已出局');
  await expect(transition(page)).toHaveCount(0);
  await expect(transition(page)).toContainText('第二阶段开启', { timeout: 3_600 });

  const eliminated = withDeathEvent(stageTwo, 'elimination_announced', 32);
  eliminated.view.viewVersion += 1;
  await mounted.set(eliminated);
  await expect(page.locator('.death-notice')).toContainText('2号已出局');
  await expect(transition(page)).toHaveCount(0);
  await expect(page.locator('.death-notice')).toHaveCount(0, { timeout: 2_200 });
  await page.waitForTimeout(1_500);
  await expect(transition(page)).toHaveCount(0);
});

test('死讯后待展示转场遇到紧急行动立即取消且不补播', async ({ page }) => {
  const night = loadGameFixture('night-door-full.json'); night.identityReveal = 'seen';
  const mounted = await mount(page, night);
  const dawn = withDeathEvent(nextView(night, { phase: 'morning' }), 'deaths_announced', 40);
  dawn.view.tasks[0]!.closesAt = dawn.view.serverTime + 60_000;
  await mounted.set(dawn);
  await expect(page.locator('.death-notice')).toBeVisible();
  const urgent = structuredClone(dawn);
  urgent.view.viewVersion += 1;
  urgent.view.tasks[0]!.closesAt = urgent.view.serverTime + 9_000;
  await mounted.set(urgent);
  await page.waitForTimeout(3_500);
  await expect(transition(page)).toHaveCount(0);
  const safe = structuredClone(urgent);
  safe.view.viewVersion += 1;
  safe.view.tasks[0]!.closesAt = safe.view.serverTime + 60_000;
  await mounted.set(safe);
  await expect(transition(page)).toHaveCount(0);
});

test('死讯后待展示转场在刷新或离线后取消，恢复连接不补播', async ({ page }) => {
  const night = loadGameFixture('night-door-full.json'); night.identityReveal = 'seen';
  const mounted = await mount(page, night);
  const dawn = withDeathEvent(nextView(night, { phase: 'morning' }), 'deaths_announced', 50);
  await mounted.set(dawn);
  await expect(page.locator('.death-notice')).toBeVisible();
  await page.reload();
  await page.waitForTimeout(3_500);
  await expect(transition(page)).toHaveCount(0);

  const nextGame = structuredClone(night);
  nextGame.view.gameId = `${night.view.gameId}-offline-pending`;
  nextGame.view.viewVersion += 10;
  await mounted.set(nextGame);
  await page.reload();
  const nextDawn = withDeathEvent(nextView(nextGame, { phase: 'morning' }), 'deaths_announced', 150);
  await mounted.set(nextDawn);
  await expect(page.getByRole('heading', { name: /晨间公告|白天议程/ })).toBeVisible();
  await expect(transition(page)).toHaveCount(0);
  const offline = structuredClone(nextDawn); offline.online = false; offline.view.viewVersion += 1;
  await mounted.set(offline);
  await page.waitForTimeout(3_500);
  const online = structuredClone(offline); online.online = true; online.view.viewVersion += 1;
  await mounted.set(online);
  await expect(transition(page)).toHaveCount(0);
});

test('减少动画时消费但不补播，用户明确标准动画可覆盖系统reduce', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const night = loadGameFixture('night-door-full.json');
  night.identityReveal = 'seen';
  const mounted = await mount(page, night);
  const dawn = nextView(night, { phase: 'morning' });
  await mounted.set(dawn);
  await expect(transition(page)).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(transition(page)).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('theater-death-display-v1', JSON.stringify({ motion: 'full' })));
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('false');
  const stageTwo = nextView(dawn, { phase: 'day', stage: 2 });
  await mounted.set(stageTwo);
  await expect(transition(page)).toContainText('第二阶段开启');
});

test('身份入场卡与阶段转场互斥，公共观众只收到公开转场', async ({ page }) => {
  const identity = loadGameFixture('night-door-full.json');
  identity.identityReveal = 'enabled';
  const mounted = await mount(page, identity);
  await expect(page.getByRole('button', { name: '进入舞台' })).toBeVisible();
  const dawn = nextView(identity, { phase: 'morning' });
  dawn.identityReveal = 'enabled';
  await mounted.set(dawn);
  await expect(transition(page)).toHaveCount(0);
  await page.getByRole('button', { name: '进入舞台' }).click();
  await expect(transition(page)).toHaveCount(0);

  const spectator = structuredClone(dawn);
  spectator.identityReveal = 'seen';
  spectator.view.viewer.kind = 'public_spectator';
  spectator.view.viewer.readOnly = true;
  spectator.view.viewer.subjectPlayerId = null;
  spectator.view.private = null;
  spectator.view.tasks = [];
  spectator.view.capabilities.allowedCommands = [];
  await mounted.set(spectator);
  // Establish the spectator scope as the initial snapshot before testing its next live phase.
  await page.reload();
  await expect(page.getByRole('heading', { name: /晨间公告|白天议程/ })).toBeVisible();
  const spectatorNight = nextView(spectator, { phase: 'night', day: spectator.view.public!.dayNumber + 1 });
  await mounted.set(spectatorNight);
  await expect(transition(page)).toContainText('夜幕降临');
  await expect(transition(page)).toHaveText(new RegExp(`第 ${spectatorNight.view.public!.dayNumber} 轮 · 第 ${spectatorNight.view.public!.stage} 阶段\\s*夜幕降临`));
});
