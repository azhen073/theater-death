import { expect, request as playwrightRequest, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { advanceAcceptanceClock, createFormalRoomViaPage, loadFullGameAccounts } from '../helpers-v2/full-game.ts';
import { enterRoom, loginRoomAccount, roomView } from '../helpers-v2/rooms.ts';

const CLOCK_SOCKET = process.env.ACCEPTANCE_CLOCK_SOCKET ?? '/clock-control/clock.sock';

async function loginAndEnter(api: APIRequestContext, code: string, uid: string, password: string, label: string) {
  expect((await api.post('/api/v2/auth/login', { data: { uid, password } })).status()).toBe(200);
  expect((await api.post(`/api/v2/rooms/${code}/enter`, { data: { requestId: `voice-enter-${label}` } })).status()).toBe(200);
}

test('v2 voice：双浏览器手动开麦、接收远端音频，发言结束后撤销音轨', async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', '声网 voice acceptance uses Chromium fake microphone');
  test.setTimeout(240_000);
  await advanceAcceptanceClock(CLOCK_SOCKET, 0);
  const accounts = loadFullGameAccounts(testInfo.project.name);
  const hostContext = await browser.newContext({ permissions: ['microphone'] });
  const speakerContext = await browser.newContext({ permissions: ['microphone'] });
  const host = await hostContext.newPage();
  const speaker = await speakerContext.newPage();
  const apis: APIRequestContext[] = [];
  const extraContexts: BrowserContext[] = [];
  let code = '';
  try {
    await loginRoomAccount(host, accounts[0]!);
    await loginRoomAccount(speaker, accounts[1]!);
    code = await createFormalRoomViaPage(host);
    await enterRoom(speaker, code);
    for (let index = 2; index < accounts.length; index += 1) {
      const api = await playwrightRequest.newContext({ baseURL: process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173' });
      apis.push(api);
      await loginAndEnter(api, code, accounts[index]!.uid, accounts[index]!.password, String(index));
      expect((await api.post(`/api/v2/rooms/${code}/ready`, { data: { requestId: `voice-ready-${index}`, ready: true } })).status()).toBe(200);
    }
    await host.getByRole('button', { name: '准备', exact: true }).click();
    await speaker.getByRole('button', { name: '准备', exact: true }).click();
    await expect(host.getByText('已准备 13 / 13')).toBeVisible();
    await host.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(host.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 30_000 });

    let writer: Page | null = null;
    for (let attempt = 0; attempt < 180 && !writer; attempt += 1) {
      const views = await Promise.all([roomView(host, code), roomView(speaker, code)]);
      const index = views.findIndex(view => view.tasks?.some((task: any) => task.action === 'REGISTER_CANDIDACY'));
      if (index >= 0) writer = index === 0 ? host : speaker;
      else {
        const deadlines = views.flatMap(view => (view.windows ?? []).map((window: any) => window.closesAt)).filter((value: unknown): value is number => typeof value === 'number');
        if (!deadlines.length) { await advanceAcceptanceClock(CLOCK_SOCKET, 1_000); continue; }
        await advanceAcceptanceClock(CLOCK_SOCKET, Math.max(1, Math.min(...deadlines) - Math.max(...views.map(view => view.serverTime)) + 1));
      }
    }
    if (!writer) throw new Error('candidate signup window did not become available');
    const signupView = await roomView(writer, code);
    const signup = signupView.tasks.find((task: any) => task.action === 'REGISTER_CANDIDACY');
    expect(signup).toBeTruthy();
    const registered = await writer.request.post(`/api/v2/rooms/${code}/command`, { data: { requestId: crypto.randomUUID(), gameId: signupView.gameId, windowInstanceId: signup.windowInstanceId, action: 'REGISTER_CANDIDACY' } });
    expect(registered.status()).toBe(200); expect((await registered.json()).status).toBe('accepted');
    const signupDeadline = Math.min(...signupView.windows.map((window: any) => window.closesAt));
    await advanceAcceptanceClock(CLOCK_SOCKET, Math.max(1, signupDeadline - signupView.serverTime + 1));
    let speechView: Record<string, any> | null = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const current = await roomView(writer, code);
      const start = current.tasks?.find((task: any) => task.action === 'START_SPEECH');
      if (start) {
        const response = await writer.request.post(`/api/v2/rooms/${code}/command`, { data: { requestId: crypto.randomUUID(), gameId: current.gameId, windowInstanceId: start.windowInstanceId, action: 'START_SPEECH' } });
        expect(response.status()).toBe(200); expect((await response.json()).status).toBe('accepted');
        continue;
      }
      if (current.capabilities?.canPublishVoice && current.tasks?.some((task: any) => task.action === 'END_ELECTION_SPEECH')) { speechView = current; break; }
      const deadlines = (current.windows ?? []).map((window: any) => window.closesAt).filter((value: unknown): value is number => typeof value === 'number' && value > current.serverTime);
      if (deadlines.length) await advanceAcceptanceClock(CLOCK_SOCKET, Math.max(1, Math.min(...deadlines) - current.serverTime + 1));
      else await advanceAcceptanceClock(CLOCK_SOCKET, 1_000);
    }
    if (!speechView) throw new Error('candidate did not reach an authorized speech window');

    const extraPages = await Promise.all(accounts.slice(2).map(async account => {
      const context = await browser.newContext(); extraContexts.push(context);
      const page = await context.newPage(); await loginRoomAccount(page, account);
      const takeover = await page.request.post(`/api/v2/rooms/${code}/takeover`, { data: { requestId: crypto.randomUUID(), gameId: speechView!.gameId } });
      expect(takeover.status()).toBe(200);
      await page.goto('/#/');
      await page.getByRole('button', { name: '继续对局', exact: true }).click();
      const enter = page.getByRole('button', { name: '进入房间', exact: true });
      if (await enter.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)) await enter.click();
      await expect(page.getByRole('heading', { name: '天理竞选 · 发言' })).toBeVisible({ timeout: 20_000 });
      return page;
    }));

    const voicePages = [host, speaker, ...extraPages];
    await Promise.all(voicePages.map(async page => {
      // 只认状态行里的文案：`.voice-bar__speaker`（v2.0.3-alpha 起显示「N号 正在发言 · X%」）也含「正在发言」，
      // 用裸 getByText 会 strict mode 命中两个元素（本条自该功能合并后一直坏，2026-09-21 首次真机跑到时暴露）。
      const connected = page.locator('.voice-bar__status span').filter({ hasText: /已连接 · 只听|旁听中|正在发言|重连中，麦克风已关闭/ });
      const joinButton = page.getByRole('button', { name: '加入语音', exact: true });
      await expect.poll(async () => await connected.isVisible() || await joinButton.isVisible(), { timeout: 20_000 }).toBe(true);
      if (await joinButton.isVisible()) await joinButton.click();
      await expect(connected).toBeVisible({ timeout: 20_000 });
    }));
    expect(voicePages).toHaveLength(13);
    await receiverPage(host, speaker, writer).screenshot({ path: '/results/voice-joined-listener.png', fullPage: true });
    const openMic = writer.getByRole('button', { name: '开启麦克风', exact: true });
    const closeMic = writer.getByRole('button', { name: '关闭麦克风', exact: true });
    await expect.poll(async () => await openMic.isVisible() || await closeMic.isVisible(), { timeout: 30_000 }).toBe(true);
    if (await openMic.isVisible()) await openMic.click();
    await expect(closeMic).toBeVisible({ timeout: 30_000 });
    const receiver = writer === host ? speaker : host;
    // 远端音频"是否真收到"不能用 <audio> 元素判定：Agora Web SDK v4 用 WebAudio 播放，页面里不产生 audio 元素
    // （2026-09-21 实测两页 audioCount 均为 0）。这里改用 SDK 自己的 volume-indicator 信号：
    // 接收方语音条显示当前发言者的**远端电平 > 0**，即证明真的收到了对方的音频流。
    const remoteLevel = async () => {
      const text = (await receiver.locator('.voice-bar__speaker').textContent()) ?? '';
      const match = /(\d+)%/.exec(text);
      return match ? Number(match[1]) : 0;
    };
    await expect.poll(remoteLevel, { timeout: 30_000 }).toBeGreaterThan(0);
    // 浏览器没有拦住播放（被拦时会显示「点击启用声音」按钮：有电平但用户其实听不到）
    await expect(receiver.getByRole('button', { name: '点击启用声音' })).toHaveCount(0);
    await writer.screenshot({ path: '/results/voice-speaking.png', fullPage: true });
    const latestSpeechView = await roomView(writer, code);
    const endSpeech = latestSpeechView.tasks.find((task: any) => task.action === 'END_ELECTION_SPEECH');
    expect(endSpeech).toBeTruthy();
    expect((await writer.request.post(`/api/v2/rooms/${code}/command`, { data: { requestId: crypto.randomUUID(), gameId: latestSpeechView.gameId, windowInstanceId: endSpeech.windowInstanceId, action: 'END_ELECTION_SPEECH' } })).status()).toBe(200);
    await expect(writer.getByRole('button', { name: '等待发言权限', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(writer.getByRole('button', { name: '关闭麦克风', exact: true })).toHaveCount(0);
    await writer.screenshot({ path: '/results/voice-permission-revoked.png', fullPage: true });
  } finally {
    for (const api of apis) await api.dispose();
    for (const context of extraContexts) await context.close();
    await hostContext.close();
    await speakerContext.close();
  }
});

function receiverPage(host: Page, speaker: Page, writer: Page): Page { return writer === host ? speaker : host; }
