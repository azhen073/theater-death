import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

/**
 * 进入对局前 / 复盘的自由开麦（Q-12）：大厅与复盘走房间频道，正式玩家可开麦、观众只听。
 * 语音会话用夹具页的界面桩（`window.__emitVoiceLevels` 驱动远端电平）；
 * 真实媒体验收仍只在有凭据时由 `16-voice` 覆盖。
 */

const connectedVoice = { connection: 'connected', microphoneEnabled: false, level: 0, remoteLevel: 0, requested: false, devices: [], activeDeviceId: '', audioBlocked: false, error: '', microphoneError: '', notice: '' };

async function mount(page: Page, fixture: GameHarnessFixture, ready = '.voice-bar') {
  let current = fixture;
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/view', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current.view) }));
  // 复盘页会额外拉一次复盘数据；这里给一份空壳，避免用例被无关的读取失败干扰
  await page.route('**/api/v2/rooms/*/review', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ review: { gameId: current.view.gameId, winner: 'human', reason: '验收夹具', endedAtDay: 2, durationMs: 60_000, players: [] } }),
  }));
  await page.goto('/game-test.html');
  await expect(page.locator(ready)).toBeVisible();
  return { set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

/** 大厅 / 复盘夹具：正式玩家可开麦（服务端在 Q-12 下就是 true），可给出一份 uid → memberId 映射。 */
function roomPhaseFixture(phase: 'lobby' | 'review', options: { readOnly?: boolean; uids?: Record<string, string> } = {}): GameHarnessFixture {
  const base = loadGameFixture('lobby-formal-full.json');
  const view = structuredClone(base.view);
  view.room.phase = phase;
  if (options.readOnly) view.viewer = { ...view.viewer, kind: 'public_spectator', readOnly: true, subjectPlayerId: null };
  view.capabilities = { ...view.capabilities, canPublishVoice: !options.readOnly };
  view.voice = { channel: `l_${view.roomId}`, uids: options.uids ?? {} };
  return { ...base, view, voice: connectedVoice };
}

test('大厅语音：正式玩家看到房间频道的自由开麦提示、可开麦；观众只加入旁听', async ({ page }, testInfo) => {
  const fixture = roomPhaseFixture('lobby');
  const { set } = await mount(page, fixture, '.lobby-grid');
  const bar = page.locator('.voice-bar');
  await expect(bar.locator('.voice-bar__speaker')).toHaveText('进入对局前 · 正式玩家可自由开麦');
  await expect(bar).toContainText('已连接 · 只听');
  const mic = bar.getByRole('button', { name: '开启麦克风' });
  await expect(mic).toBeEnabled();
  await mic.click();
  await expect.poll(() => page.evaluate(() => (window as any).__voiceCalls as string[])).toContain('mic');
  await expect(bar).toContainText('正在发言');

  // 远端电平只归属到服务端给出的 uid → memberId 映射：亮起的就是那张成员卡
  const speaker = fixture.view.room.formalMembers[1]!;
  const silent = fixture.view.room.formalMembers[2]!;
  const speakerCard = page.locator(`.member-card[data-member-id="${speaker.memberId}"]`);
  const silentCard = page.locator(`.member-card[data-member-id="${silent.memberId}"]`);
  await set(roomPhaseFixture('lobby', { uids: { '21': speaker.memberId, '22': silent.memberId } }));
  await page.evaluate(() => (window as any).__emitVoiceLevels({ 21: 42, 22: 0 }));
  await expect(speakerCard).toHaveAttribute('data-speaking', 'true');
  await expect(speakerCard).toHaveClass(/member-card--speaking/);
  await expect(speakerCard.locator('.badge--speaking')).toHaveText('正在说话');
  await expect(silentCard).not.toHaveClass(/member-card--speaking/);
  await page.screenshot({ path: '/results/lobby-voice-' + testInfo.project.name + '.png', fullPage: true });

  // 保持期后光环自动消失（采样停止时不能永远亮着）
  await expect(speakerCard).not.toHaveClass(/member-card--speaking/, { timeout: 4000 });

  // 观众（含第二屏）：只读 → 只能旁听，没有开麦按钮，也不会显示「等待发言权限」
  await set(roomPhaseFixture('lobby', { readOnly: true }));
  await expect(bar).toContainText('旁听中');
  await expect(bar.getByRole('button', { name: '开启麦克风' })).toHaveCount(0);
  await expect(bar).not.toContainText('等待发言权限');
  await page.screenshot({ path: '/results/lobby-voice-observer-' + testInfo.project.name + '.png', fullPage: true });
});

test('复盘语音：房间频道同样自由开麦，且不再显示大厅的提示', async ({ page }, testInfo) => {
  await mount(page, roomPhaseFixture('review'), '.voice-bar');
  const bar = page.locator('.voice-bar');
  await expect(bar.locator('.voice-bar__speaker')).toHaveText('复盘讨论 · 正式玩家可自由开麦');
  await expect(bar.getByRole('button', { name: '开启麦克风' })).toBeEnabled();
  await page.screenshot({ path: '/results/review-voice-' + testInfo.project.name + '.png', fullPage: true });
});
