import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';
import { confirmModal, loadRoomAccounts, loginRoomAccount, selectPublicChat, waitRoom } from '../helpers-v2/rooms.ts';

/** 把夹具改成「白天自由发言阶段」：公开窗口 + 全员发布权 + 频道 uid 映射。 */
function freeSpeechFixture(): GameHarnessFixture {
  const base = loadGameFixture('night-spirit-full.json');
  const view = structuredClone(base.view);
  const self = view.private!.self.playerId;
  const seats = view.public!.seats;
  const other = seats.find(seat => seat.playerId !== self)!;
  const third = seats.find(seat => seat.playerId !== self && seat.playerId !== other.playerId)!;
  view.public!.phase = 'day';
  view.public!.day = {
    ...view.public!.day!,
    step: 'free_speech',
    speechPreparing: false,
    currentSpeakerId: null,
    election: null,
    ballot: null,
    speechRound: null,
    lastWords: null,
    handover: null,
  };
  view.windows = [{ id: 'free_speech', type: 'free_speech', instanceId: 'free-1', closesAt: view.serverTime + 120_000 }];
  view.tasks = [];
  view.capabilities.allowedCommands = [];
  view.capabilities.canPostPublic = true;
  view.capabilities.canPublishVoice = true;
  view.capabilities.canVote = false;
  view.public!.voice = { uids: { '11': self, '12': other.playerId, '13': third.playerId } };
  view.private!.voice = { delivery: { windowInstanceId: 'free-1', delivered: 1, blocked: 0, silentOutput: 0, failed: 0, listeners: 1, updatedAt: view.serverTime } };
  return { ...base, view, voice: { connection: 'connected', devices: [], activeDeviceId: '' } };
}

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/view', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current.view) }));
  await page.goto('/game-test.html');
  await expect(page.locator('.theater-stage')).toBeVisible();
  return { set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

test('自由发言阶段：阶段文案、全员可开麦、送达回执与「谁在说话」座位光环', async ({ page }, testInfo) => {
  const fixture = freeSpeechFixture();
  await mount(page, fixture);
  const self = fixture.view.private!.self.playerId;
  const speaking = fixture.view.public!.voice!.uids['12']!;

  // 阶段文案与倒计时
  await expect(page.locator('.game-hud h1')).toHaveText('自由发言');
  await expect(page.getByLabel('发言与提醒')).toContainText('自由发言进行中 · 全体存活可同时开麦');
  await expect(page.getByRole('timer', { name: '自由发言剩余时间' })).toBeVisible();
  // 语音条：该阶段不是「轮到我」，不自动开麦，但可以手动开麦；开麦后显示送达回执
  await expect(page.locator('.voice-bar')).toContainText('自由发言进行中 · 全体存活可开麦');
  expect(await page.evaluate(() => (window as unknown as { __voiceCalls?: string[] }).__voiceCalls ?? [])).not.toContain('mic');
  await page.getByRole('button', { name: '开启麦克风' }).click();
  await expect(page.getByRole('button', { name: '关闭麦克风' })).toBeVisible();
  await expect(page.locator('.voice-bar__delivery')).toHaveText('已送达 1/1');

  // 「谁在说话」：按远端电平给对应座位亮光环，带保持期
  const seatSpeaking = page.locator(`[data-player-id="${speaking}"]`);
  const seatQuiet = page.locator(`[data-player-id="${self}"]`);
  await expect(seatSpeaking.locator('.seat-speaking')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __emitVoiceLevels?: (levels: Record<number, number>) => void }).__emitVoiceLevels?.({ 12: 42 }));
  await expect(seatSpeaking.locator('.seat-speaking')).toHaveText('正在发言');
  expect(await seatSpeaking.evaluate(node => node.classList.contains('stage-seat--speaking'))).toBe(true);
  await expect(seatQuiet.locator('.seat-speaking')).toHaveCount(0);
  await page.screenshot({ path: `/results/free-speech-speaking-${testInfo.project.name}.png`, fullPage: true });
  // 电平归零后保持期内仍显示，之后消失
  await page.evaluate(() => (window as unknown as { __emitVoiceLevels?: (levels: Record<number, number>) => void }).__emitVoiceLevels?.({}));
  await expect(seatSpeaking.locator('.seat-speaking')).toHaveText('正在发言');
  await expect(seatSpeaking.locator('.seat-speaking')).toHaveCount(0, { timeout: 4_000 });
});

test('建房必须显式选择自由发言开关，并在大厅按选择显示', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginRoomAccount(page, accounts[0]!);
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(page.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
    // 未选择时不能提交；两个开关都未选中
    await expect(page.getByRole('button', { name: '创建房间', exact: true })).toBeDisabled();
    await expect(page.getByRole('radio', { name: '自由发言：开启' })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('radio', { name: '自由发言：不开启' })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('请先选择是否开启白天自由发言')).toBeVisible();
    const create = page.waitForRequest(request => request.url().endsWith('/api/v2/rooms') && request.method() === 'POST');
    await selectPublicChat(page, 'alive_only', true);
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    expect((await create).postDataJSON()).toMatchObject({ publicChat: 'alive_only', freeSpeech: true });
    await waitRoom(page);
    await expect(page.getByText('白天自由发言：开启（发言轮后 2 分钟 · 全体存活可开麦）')).toBeVisible();
    await page.screenshot({ path: `/results/free-speech-lobby-${testInfo.project.name}.png`, fullPage: true });
    await page.getByRole('button', { name: '解散房间' }).click();
    await confirmModal(page, '解散房间？');
  } finally {
    await context.close();
  }
});
