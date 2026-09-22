import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

type SpeechKind = 'normal' | 'tie' | 'last-words';

function speechFixture(options: {
  preparing?: boolean;
  speakerIndex?: number;
  viewer?: 'formal' | 'public' | 'second-screen';
  kind?: SpeechKind;
  windowId?: string;
} = {}): GameHarnessFixture {
  const source = options.viewer === 'public'
    ? loadGameFixture('started-public-observer-full.json')
    : options.viewer === 'second-screen'
      ? loadGameFixture('private-second-screen-full.json')
      : loadGameFixture('day-election-full.json');
  const view = structuredClone(source.view) as any;
  const seats = view.public.seats;
  const speaker = seats[options.speakerIndex ?? 0];
  const kind = options.kind ?? 'normal';
  const action = kind === 'last-words' ? 'END_LAST_WORDS' : kind === 'tie' ? 'END_TIE_SPEECH' : options.preparing ? 'START_SPEECH' : 'END_SPEECH';
  const windowId = options.windowId ?? `speech:${kind}:${options.speakerIndex ?? 0}:${options.preparing ? 'prepare' : 'live'}`;
  view.room.phase = 'playing';
  view.public.phase = 'day';
  view.public.stage = kind === 'last-words' ? 2 : 1;
  view.public.day = {
    ...(view.public.day ?? {}), dayNumber: view.public.dayNumber ?? 1,
    step: kind === 'last-words' ? 'last_words' : kind === 'tie' ? 'tie_speech' : 'speech_round',
    currentSpeakerId: speaker.playerId, speechPreparing: !!options.preparing,
  };
  view.windows = [{ id: 'public', type: 'public', instanceId: windowId, closesAt: view.serverTime + (options.preparing ? 15_000 : 60_000) }];
  view.tasks = options.viewer ? [] : [{ action, windowInstanceId: windowId, closesAt: view.windows[0].closesAt, targets: null }];
  view.capabilities.allowedCommands = options.viewer ? [] : [action];
  if (options.viewer === 'public') {
    view.viewer.kind = 'public_spectator'; view.viewer.readOnly = true; view.viewer.subjectPlayerId = null; view.private = null;
  } else if (options.viewer === 'second-screen') {
    view.viewer.kind = 'private_spectator'; view.viewer.readOnly = true;
  } else {
    view.viewer.kind = 'formal'; view.viewer.readOnly = false; view.viewer.subjectPlayerId = seats[0].playerId;
    if (view.private) view.private.self = { ...view.private.self, playerId: seats[0].playerId, seat: seats[0].seat, nickname: seats[0].nickname };
  }
  return { ...source, view, online: true };
}

async function installAudioStub(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as any).__attentionAudioCalls = calls;
    class AudioContextStub {
      state = 'suspended'; currentTime = 0; destination = {};
      async resume() { calls.push('resume'); this.state = 'running'; }
      async suspend() { calls.push('suspend'); this.state = 'suspended'; }
      async close() { calls.push('close'); this.state = 'closed'; }
      createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() { calls.push('start'); }, stop() {}, onended: null }; }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioContextStub });
  });
}

async function mount(page: Page, initial: GameHarnessFixture) {
  let current = initial;
  const commands: any[] = [];
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/view', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current.view) }));
  await page.route('**/api/v2/rooms/*/command', async route => {
    commands.push(await route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true }) });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('region', { name: '发言与提醒' })).toBeVisible();
  return { commands, set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

const audioStarts = (page: Page) => page.evaluate(() => ((window as any).__attentionAudioCalls as string[]).filter(call => call === 'start').length);

test('准备、正式发言、切人、遗言和平票均聚焦发言者，准备可提前开始且无需二次确认', async ({ page }) => {
  const mounted = await mount(page, speechFixture({ preparing: true }));
  const attention = page.getByRole('region', { name: '发言与提醒' });
  await expect(attention).toContainText('轮到你了 · 即将发言：1号');
  await expect(attention.getByRole('timer', { name: '发言准备剩余时间' })).toBeVisible();
  await expect(attention).toContainText('最多准备 15 秒');
  await expect(page.locator('.stage-seat--speaking')).toHaveAttribute('data-player-id', speechFixture().view.public!.seats[0]!.playerId);
  await expect(page.locator('.stage-seat--speaking .seat-speaking')).toHaveText('准备发言');

  await page.getByRole('button', { name: '提前开始发言', exact: true }).click();
  await expect.poll(() => mounted.commands.length).toBe(1);
  expect(mounted.commands[0].action).toBe('START_SPEECH');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await mounted.set(speechFixture({ preparing: false, windowId: 'speech:live' }));
  await expect(attention).toContainText('轮到你了 · 正在发言：1号');
  await expect(page.locator('.stage-seat--speaking .seat-speaking')).toHaveText('正在发言');
  await mounted.set(speechFixture({ speakerIndex: 1, windowId: 'speech:next' }));
  await expect(attention).toContainText('正在发言：2号');
  await expect(attention).not.toContainText('轮到你了');
  await expect(page.locator('.stage-seat--speaking')).toHaveAttribute('data-player-id', speechFixture({ speakerIndex: 1 }).view.public!.seats[1]!.playerId);

  await mounted.set(speechFixture({ kind: 'last-words', windowId: 'speech:last' }));
  await expect(attention).toContainText('正在发言：1号');
  await expect(page.getByRole('button', { name: '结束遗言', exact: true })).toBeVisible();
  await mounted.set(speechFixture({ kind: 'tie', windowId: 'speech:tie' }));
  await expect(attention).toContainText('正在发言：1号');
  await expect(page.getByRole('button', { name: '结束平票发言', exact: true })).toBeVisible();
});

test('提示音默认关闭，仅点击后解锁；阶段/本人发言各响一次，重复、重连和隐藏恢复不补响，刷新复位', async ({ page }) => {
  await installAudioStub(page);
  const mounted = await mount(page, speechFixture({ speakerIndex: 1, windowId: 'speech:other' }));
  const toggle = page.getByRole('button', { name: '阶段与本人发言提示音' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await audioStarts(page)).toBe(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (window as any).__attentionAudioCalls)).toContain('resume');
  expect(await audioStarts(page)).toBe(0);

  const night = speechFixture({ speakerIndex: 1, windowId: 'night-transition' });
  night.view.public!.phase = 'night'; night.view.public!.stage = 1; night.view.public!.day = null; night.view.windows = [];
  await mounted.set(night);
  await expect.poll(() => audioStarts(page)).toBe(2);
  await mounted.set(structuredClone(night));
  await expect.poll(() => audioStarts(page)).toBe(2);
  const stage2 = structuredClone(night); stage2.view.public!.stage = 2;
  await mounted.set(stage2);
  await expect.poll(() => audioStarts(page)).toBe(4);

  const ownPrepare = speechFixture({ preparing: true, windowId: 'own-prepare' });
  await mounted.set(ownPrepare);
  await expect.poll(() => audioStarts(page)).toBe(6);
  const duplicate = structuredClone(ownPrepare); duplicate.online = false;
  await mounted.set(duplicate); duplicate.online = true; await mounted.set(duplicate);
  await expect.poll(() => audioStarts(page)).toBe(6);

  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await mounted.set(speechFixture({ preparing: false, windowId: 'hidden-live' }));
  await expect.poll(() => audioStarts(page)).toBe(6);
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => audioStarts(page)).toBe(6);

  await page.reload();
  await expect(page.getByRole('button', { name: '阶段与本人发言提示音' })).toHaveAttribute('aria-pressed', 'false');
  expect(await audioStarts(page)).toBe(0);
});

test('音频解锁失败降级为文字提醒；公开观众和第二屏不显示“轮到你”，各断点无横向溢出且光环无遮挡', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    class BlockedAudioContext { state = 'suspended'; async resume() { throw new Error('blocked'); } async close() {} }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: BlockedAudioContext });
  });
  const initial = speechFixture({ preparing: true });
  initial.view.public!.seats[0]!.avatarUrl = '/assets/avatar-sheet.png';
  const mounted = await mount(page, initial);
  await page.getByRole('button', { name: '阶段与本人发言提示音' }).click();
  await expect(page.getByRole('region', { name: '发言与提醒' }).getByRole('status')).toContainText('文字提醒仍然可用');
  await expect(page.getByRole('button', { name: '阶段与本人发言提示音' })).toHaveAttribute('aria-pressed', 'false');

  for (const viewer of ['public', 'second-screen'] as const) {
    await mounted.set(speechFixture({ preparing: true, viewer }));
    await expect(page.getByRole('region', { name: '发言与提醒' })).not.toContainText('轮到你了');
  }
  const withUploadedAvatar = speechFixture({ preparing: true });
  withUploadedAvatar.view.public!.seats[0]!.avatarUrl = '/assets/avatar-sheet.png';
  await mounted.set(withUploadedAvatar);
  for (const width of [320, 390, 844, 1440]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const seat = page.locator('.stage-seat--speaking .seat-main');
    const avatar = page.locator('.stage-seat--speaking .avatar');
    const [seatBox, avatarBox] = await Promise.all([seat.boundingBox(), avatar.boundingBox()]);
    expect(seatBox).not.toBeNull(); expect(avatarBox).not.toBeNull();
    expect(avatarBox!.x).toBeGreaterThanOrEqual(seatBox!.x - 14);
    expect(avatarBox!.x + avatarBox!.width).toBeLessThanOrEqual(seatBox!.x + seatBox!.width + 14);
    await page.screenshot({ path: `/results/speech-attention-${width}-${testInfo.project.name}.png`, fullPage: true });
  }
  // 上传头像的位图必须继续由圆形头像容器裁切；装饰光环不能以取消裁切为代价。
  await expect(page.locator('.stage-seat--speaking .avatar')).toHaveCSS('overflow', 'hidden');
});
