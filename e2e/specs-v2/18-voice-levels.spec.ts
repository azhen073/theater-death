import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

/**
 * 语音条界面（A+B + 输出/输入增益）。
 * 夹具页原本不挂 app shell，故 harness 用一个可注入的会话桩渲染 `VoiceBar`：
 * 状态由夹具给出（connection/microphoneEnabled/level/remoteLevel），音量调用记到 window.__voiceCalls。
 * 真实媒体的加入/开麦仍只能在有凭据时由 16-voice 覆盖。
 */

const connectedVoice = { connection: 'connected', microphoneEnabled: true, level: 62, remoteLevel: 70, requested: false, devices: [], activeDeviceId: '' };

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.goto('/game-test.html');
  await expect(page.getByRole('region', { name: '公共语音' })).toBeVisible();
  return { setFixture: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

/** 以「白天 + 完整 day 状态」的夹具为底，覆盖发言者与语音状态。 */
function voiceFixture(voice: Record<string, unknown>, options: { speaker?: string | null } = {}): GameHarnessFixture {
  const fixture = loadGameFixture('day-election-full.json');
  const view = structuredClone(fixture.view) as any;
  const speaker = options.speaker === undefined ? view.public.seats[3].playerId : options.speaker;
  view.public.day = { ...view.public.day, step: 'speech_round', currentSpeakerId: speaker };
  // 当前发言者确实持有发布权：能力位与语音状态保持一致，避免界面出现自相矛盾的提示
  view.capabilities = { ...view.capabilities, canPublishVoice: speaker !== null };
  return { ...fixture, view, voice };
}

test('语音条：自己的电平、当前发言者、输出音量与静音、麦克风增益', async ({ page }, testInfo) => {
  const mounted = await mount(page, voiceFixture(connectedVoice));
  const bar = page.getByRole('region', { name: '公共语音' });

  // A：自己的电平（5 段，aria-valuenow 反映真实值）
  const meter = bar.getByRole('meter', { name: '麦克风音量' });
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute('aria-valuenow', '62');
  await expect(meter.locator('.level-meter__segment--on')).toHaveCount(4);

  // B：当前发言者（N号 正在发言 · X%）
  await expect(bar.locator('.voice-bar__speaker')).toContainText('4号 正在发言 · 70%');
  await expect(bar.locator('.voice-bar__speaker')).not.toContainText('已静音');

  // 输出音量：拖动后用 setOutputVolume 立即生效，松手才落库
  const output = bar.getByLabel('输出音量');
  await expect(output).toHaveValue('100');
  await output.fill('40');
  await expect.poll(() => page.evaluate(() => (window as any).__voiceCalls as string[])).toContain('output:40');
  await output.blur();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('theater-death-display-v1') ?? '{}').voiceOutput)).toBe(40);

  // 麦克风增益：只在开麦时出现，同样即时生效
  const gain = bar.getByLabel('麦克风增益');
  await expect(gain).toBeVisible();
  await gain.fill('30');
  await expect.poll(() => page.evaluate(() => (window as any).__voiceCalls as string[])).toContain('input:30');
  await gain.blur();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('theater-death-display-v1') ?? '{}').voiceInput)).toBe(30);

  await page.screenshot({ path: '/results/voice-levels-speaking-' + testInfo.project.name + '.png' });

  // 答案 4：输出静音时保留"谁在发言"，只把电平换成「已静音」
  await page.evaluate(() => localStorage.setItem('theater-death-display-v1', JSON.stringify({ voiceLevels: true, voiceOutput: 40, voiceInput: 30, voiceMuted: false })));
  await mounted.setFixture(voiceFixture({ ...connectedVoice }, {}));
  await bar.getByRole('button', { name: '静音', exact: true }).click();
  await expect(bar.locator('.voice-bar__speaker')).toContainText('4号 已静音');
  await expect(bar.locator('.voice-bar__speaker')).not.toContainText('正在发言');
  await expect(meter).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('theater-death-display-v1') ?? '{}').voiceMuted)).toBe(true);
  await page.screenshot({ path: '/results/voice-levels-muted-' + testInfo.project.name + '.png' });

  // 非发言窗口（服务端给 null）：不显示"谁在发言"，但自己的电平仍在
  await mounted.setFixture(voiceFixture(connectedVoice, { speaker: null }));
  await expect(bar.locator('.voice-bar__speaker')).toHaveCount(0);
  await expect(meter).toBeVisible();

  // 关麦后：自己的电平与增益滑杆一起消失
  await bar.getByRole('button', { name: '关闭麦克风', exact: true }).click();
  await expect(bar.getByRole('meter', { name: '麦克风音量' })).toHaveCount(0);
  await expect(bar.getByLabel('麦克风增益')).toHaveCount(0);
});

test('语音条：关闭「音量指示」只隐藏电平，保留"谁在发言"；未加入时只显示加入按钮', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('theater-death-display-v1', JSON.stringify({ voiceLevels: false })));
  const mounted = await mount(page, voiceFixture(connectedVoice));
  const bar = page.getByRole('region', { name: '公共语音' });
  // 电平全隐：自己的电平条不出现
  await expect(bar.getByRole('meter', { name: '麦克风音量' })).toHaveCount(0);
  // 但"谁在发言"保留，且不带百分比
  await expect(bar.locator('.voice-bar__speaker')).toContainText('4号 正在发言');
  await expect(bar.locator('.voice-bar__speaker')).not.toContainText('%');
  // 音量调节不受影响
  await expect(bar.getByLabel('输出音量')).toBeVisible();
  await expect(bar.getByLabel('麦克风增益')).toBeVisible();
  await page.screenshot({ path: '/results/voice-levels-no-meter-' + testInfo.project.name + '.png' });

  // 未加入：只有加入按钮与状态，没有电平/音量行
  await mounted.setFixture(voiceFixture({ connection: 'idle', microphoneEnabled: false, level: 0, remoteLevel: 0, devices: [], activeDeviceId: '' }));
  const idle = page.getByRole('region', { name: '公共语音' });
  await expect(idle.getByRole('button', { name: '加入语音', exact: true })).toBeVisible();
  await expect(idle.locator('.voice-bar__levels')).toHaveCount(0);
});
