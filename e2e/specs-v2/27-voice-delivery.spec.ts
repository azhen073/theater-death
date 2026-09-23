import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

/**
 * C 组：发言者看到的「送达」提示。
 * 产品要求是**不显眼**：小字灰色文本、无徽标/无告警色、细节只在 title 里；
 * 因此本用例既断言"能看到"，也断言"它确实很轻"（span、≤11px、带透明度、不占错误样式）。
 */

const connectedVoice = { connection: 'connected', microphoneEnabled: true, level: 62, remoteLevel: 70, requested: false, devices: [], activeDeviceId: '' };
const idleVoice = { connection: 'connected', microphoneEnabled: false, level: 0, remoteLevel: 70, requested: false, devices: [], activeDeviceId: '' };

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.goto('/game-test.html');
  await expect(page.getByRole('region', { name: '公共语音' })).toBeVisible();
  return { setFixture: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

function voiceFixture(voice: Record<string, unknown>, delivery: Record<string, unknown> | null): GameHarnessFixture {
  const fixture = loadGameFixture('day-election-full.json');
  const view = structuredClone(fixture.view) as any;
  view.public.day = { ...view.public.day, step: 'speech_round', currentSpeakerId: view.public.seats[3].playerId };
  view.capabilities = { ...view.capabilities, canPublishVoice: true };
  if (delivery !== null) view.private = { ...view.private, voice: { delivery } };
  return { ...fixture, view, voice };
}

const sample = (overrides: Record<string, unknown> = {}) => ({ windowInstanceId: 'win-1', delivered: 11, blocked: 0, silentOutput: 0, failed: 0, listeners: 12, updatedAt: 1, ...overrides });

test('送达提示以低调用方式呈现：小字灰色 span、细节在 title、不占用错误样式', async ({ page }) => {
  await mount(page, voiceFixture(connectedVoice, sample({ blocked: 1, silentOutput: 2 })));
  const bar = page.getByRole('region', { name: '公共语音' });
  const delivery = bar.locator('.voice-bar__delivery');

  await expect(delivery).toBeVisible();
  await expect(delivery).toHaveText('已送达 11/12');
  await expect(delivery).toHaveAttribute('title', /已确认收到：11/);
  await expect(delivery).toHaveAttribute('title', /1 人未播放/);
  await expect(delivery).toHaveAttribute('title', /2 人已静音/);

  const style = await delivery.evaluate((element) => {
    const computed = getComputedStyle(element as HTMLElement);
    return { tag: element.tagName, role: element.getAttribute('role'), fontSize: Number.parseFloat(computed.fontSize), opacity: Number.parseFloat(computed.opacity) };
  });
  expect(style.tag).toBe('SPAN');
  expect(style.role).toBeNull();
  expect(style.fontSize).toBeLessThanOrEqual(11);
  expect(style.opacity).toBeLessThan(1);
  await expect(bar.locator('.voice-bar__error')).toHaveCount(0);
});

test('没有任何接收端上报时不渲染（避免"0 人确认"的假警报）；未开麦时也不渲染', async ({ page }) => {
  const mounted = await mount(page, voiceFixture(connectedVoice, sample({ delivered: 0, listeners: 0 })));
  await expect(page.locator('.voice-bar__delivery')).toHaveCount(0);

  const { setFixture } = mounted;
  await setFixture(voiceFixture(connectedVoice, sample({ delivered: 0, listeners: 5 })));
  await expect(page.locator('.voice-bar__delivery')).toHaveText('等待接收确认');

  await setFixture(voiceFixture(idleVoice, sample()));
  await expect(page.locator('.voice-bar__delivery')).toHaveCount(0);
});

test('送达提示只出现在语音条内，公共区域不出现任何送达字样', async ({ page }) => {
  await mount(page, voiceFixture(connectedVoice, sample()));
  const bar = page.getByRole('region', { name: '公共语音' });
  await expect(bar.locator('.voice-bar__delivery')).toHaveCount(1);
  // 公共面板（座位、公屏）不应出现送达信息：它只属于发言者的私有视图
  await expect(page.locator('#panel-public').getByText('已送达')).toHaveCount(0);
});
