import { expect, request as apiRequest, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { loadAccountCase, staticPng, type RoomAccount } from '../helpers-v2/account.ts';
import { enterRoom, loginRoomAccount } from '../helpers-v2/rooms.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ART_ASSETS = [
  'theater.png', 'avatar-sheet.png', 'death-overlay.png',
  'cards/civilian.png', 'cards/death.png', 'cards/descender.png', 'cards/door.png',
  'cards/laike.png', 'cards/mourner.png', 'cards/researcher.png', 'cards/spirit.png', 'cards/water.png',
  'frames/death.png', 'frames/human.png',
];

function smokeBaseURL(): { value: string; origin: string } {
  const value = process.env.FRONTEND_BASE_URL;
  if (!value) throw new Error('release smoke requires FRONTEND_BASE_URL');
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || parsed.hostname !== 'theater-smoke' || parsed.port !== '3000' || parsed.pathname !== '/') throw new Error(`release smoke requires http://theater-smoke:3000, got ${value}`);
  return { value: value.replace(/\/$/, ''), origin: parsed.origin };
}

async function loginApi(baseURL: string, account: RoomAccount): Promise<APIRequestContext> {
  const api = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const response = await api.post('/api/v2/auth/login', { data: { uid: account.uid, password: account.password } });
  if (response.status() !== 200) throw new Error(`bot login failed: ${response.status()}`);
  return api;
}

async function botEnterReady(api: APIRequestContext, code: string, label: string): Promise<void> {
  const entered = await api.post(`/api/v2/rooms/${code}/enter`, { data: { requestId: `release-enter-${label}-${crypto.randomUUID()}` } });
  if (entered.status() !== 200) throw new Error(`bot enter failed: ${entered.status()}`);
  const ready = await api.post(`/api/v2/rooms/${code}/ready`, { data: { requestId: `release-ready-${label}-${crypto.randomUUID()}`, ready: true } });
  if (ready.status() !== 200) throw new Error(`bot ready failed: ${ready.status()}`);
}

async function leaveKnownRoom(page: Page, code: string): Promise<string | null> {
  if (!code) return null;
  try {
    const response = await page.request.post(`/api/v2/rooms/${code}/leave`, { data: { requestId: crypto.randomUUID() } });
    return [200, 403, 404].includes(response.status()) ? null : `page leave ${response.status()}`;
  } catch (error) { return `page leave: ${error instanceof Error ? error.message : String(error)}`; }
}

async function leaveKnownApi(api: APIRequestContext, code: string): Promise<string | null> {
  if (!code) return null;
  try {
    const response = await api.post(`/api/v2/rooms/${code}/leave`, { data: { requestId: crypto.randomUUID() } });
    return [200, 403, 404].includes(response.status()) ? null : `api leave ${response.status()}`;
  } catch (error) { return `api leave: ${error instanceof Error ? error.message : String(error)}`; }
}

async function closeContext(context: BrowserContext, errors: string[], label: string): Promise<void> {
  try { await context.close(); } catch (error) { errors.push(`${label} close: ${error instanceof Error ? error.message : String(error)}`); }
}

test('release smoke：candidate同源静态产物、注册头像与真实五人Socket开局', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const { value: baseURL, origin } = smokeBaseURL();
  const accountCase = loadAccountCase(testInfo.project.name);
  const requestedUrls: string[] = [];
  const viewUpdatedFrames: string[] = [];
  const websocketUrls: string[] = [];
  let code = '';
  const botApis: APIRequestContext[] = [];
  let joinContext: BrowserContext | null = null;
  let joinPage: Page | null = null;
  try {
    page.on('request', request => requestedUrls.push(request.url()));
    page.on('websocket', socket => {
      websocketUrls.push(socket.url());
      if (!socket.url().includes('/api/v2/socket.io')) return;
      socket.on('framereceived', frame => {
        const payload = frame.payload;
        const text = typeof payload === 'string' ? payload : payload.toString();
        if (text.includes('view_updated')) viewUpdatedFrames.push(text);
      });
    });

    const documentResponse = await page.goto('/');
    expect(documentResponse?.status()).toBe(200);
    expect(new URL(page.url()).origin).toBe(origin);
    const contextSecurity = await page.evaluate(() => ({ secure: window.isSecureContext, randomUUID: typeof globalThis.crypto?.randomUUID }));
    expect(contextSecurity.secure).toBe(false);
    expect(contextSecurity.randomUUID).toBe('undefined');

    const staticUrls = await page.locator('script[src], link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => element.tagName === 'SCRIPT' ? (element as HTMLScriptElement).src : (element as HTMLLinkElement).href));
    expect(staticUrls.length).toBeGreaterThanOrEqual(2);
    for (const url of staticUrls) {
      expect(new URL(url).origin).toBe(origin);
      const response = await page.request.get(url);
      expect(response.status(), url).toBe(200);
    }
    for (const asset of ART_ASSETS) {
      const response = await page.request.get(`/assets/${asset}`);
      expect(response.status(), asset).toBe(200);
      expect(new URL(response.url()).origin).toBe(origin);
    }
    for (const blockedPath of ['/game-test.html', '/@vite/client', '/@fs/app/web-v2/src/main.tsx', '/src/main.tsx', '/.env']) {
      const response = await page.request.get(blockedPath);
      expect(response.status(), blockedPath).toBe(404);
    }

    await page.getByRole('button', { name: '直接注册' }).click();
    await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible();
    await page.getByLabel('昵称').fill(accountCase.nickname);
    await page.getByLabel('设置密码').fill(accountCase.password);
    await page.getByLabel('确认密码').fill(accountCase.password);
    await page.getByRole('button', { name: '创建账号' }).click();
    await expect(page.getByRole('heading', { name: '账号创建成功' })).toBeVisible();
    const registeredUid = await page.getByLabel('登录 UID').inputValue();
    await page.getByRole('button', { name: '进入剧院' }).click();
    await expect(page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '欢迎入席' })).toBeVisible();
    await page.getByLabel('数字 UID').fill(registeredUid);
    await page.getByLabel('登录密码').fill(accountCase.password);
    await page.getByRole('button', { name: /进入剧院/ }).click();
    await expect(page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();

    await page.getByRole('button', { name: '我的账户' }).click();
    await expect(page.getByRole('heading', { name: '你的账户' })).toBeVisible();
    await page.getByRole('button', { name: '更换头像' }).click();
    await page.getByLabel('选择头像图片').setInputFiles({ name: 'release-smoke.png', mimeType: 'image/png', buffer: staticPng() });
    await expect(page.getByRole('img', { name: '裁剪后的头像预览' })).toBeVisible();
    const avatarResponse = page.waitForResponse(response => response.url().endsWith('/api/v2/me/avatar') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: '保存头像' }).click();
    const uploaded = await avatarResponse;
    expect(uploaded.status()).toBe(200);
    const avatarBody = await uploaded.json() as { avatarUrl: string; userId: string };
    expect(new URL(avatarBody.avatarUrl, origin).origin).toBe(origin);
    const avatarAsset = await page.request.get(avatarBody.avatarUrl);
    expect(avatarAsset.status()).toBe(200);
    expect(new URL(avatarAsset.url()).origin).toBe(origin);
    expect(avatarAsset.headers()['content-type']).toContain('image/webp');

    await page.getByRole('button', { name: '剧院首页' }).click();
    await expect(page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(page.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
    await page.getByRole('button', { name: '自定义角色组成' }).click();
    await page.getByLabel('玩家人数').fill('5');
    for (const [label, value] of [['莱莱可人数', '0'], ['门先生人数', '1'], ['水妖人数', '0'], ['降临者人数', '0'], ['科研员人数', '1'], ['平民人数', '1'], ['死神人数', '1'], ['魂灵人数', '1'], ['丧亲者人数', '0']] as const) await page.getByLabel(label).fill(value);
    const createRequest = page.waitForRequest(request => request.url().endsWith('/api/v2/rooms') && request.method() === 'POST');
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    const createBody = (await createRequest).postDataJSON() as Record<string, any>;
    expect(createBody.requestId).toMatch(UUID_V4);
    await expect(page.getByRole('heading', { name: '房间大厅' })).toBeVisible();
    code = (await page.locator('.room-code strong').innerText()).trim();

    joinContext = await browser.newContext();
    joinPage = await joinContext.newPage();
    await loginRoomAccount(joinPage, loadAccountCase(testInfo.project.name).rooms![0]!);
    await enterRoom(joinPage, code);
    const framesBeforeBots = viewUpdatedFrames.length;
    for (const account of loadAccountCase(testInfo.project.name).rooms!.slice(1, 4)) {
      const api = await loginApi(baseURL, account);
      botApis.push(api);
      await botEnterReady(api, code, account.uid);
    }
    await expect.poll(() => viewUpdatedFrames.length, { timeout: 15_000, intervals: [100, 250] }).toBeGreaterThan(framesBeforeBots);
    await expect.poll(() => page.locator('.member-card').count(), { timeout: 15_000, intervals: [250] }).toBe(5);
    await joinPage.getByRole('button', { name: '准备', exact: true }).click();
    await expect(joinPage.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '准备', exact: true }).click();
    await expect.poll(() => page.getByText(/已准备 5 \/ 5/).count(), { timeout: 15_000, intervals: [250] }).toBeGreaterThan(0);
    expect(viewUpdatedFrames.length).toBeGreaterThan(framesBeforeBots);
    expect(websocketUrls.some(url => url.startsWith('ws://') && url.includes('/api/v2/socket.io'))).toBe(true);
    const startRequest = page.waitForRequest(request => request.url().endsWith(`/api/v2/rooms/${code}/start`) && request.method() === 'POST');
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
    expect((await startRequest).postDataJSON().requestId).toMatch(UUID_V4);
    await expect(page.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `/results/release-stage-${testInfo.project.name}.png` });

    const forbidden = requestedUrls.filter(url => /\/(?:@vite|@fs)\/|\/(?:src|source)\/|game-test|\.tsx(?:\?|$)|\.ts(?:\?|$)/i.test(new URL(url).pathname));
    expect(forbidden).toEqual([]);
  } finally {
    const cleanupErrors: string[] = [];
    if (code) {
      const pageLeave = await leaveKnownRoom(page, code); if (pageLeave) cleanupErrors.push(pageLeave);
      if (joinPage) { const joinLeave = await leaveKnownRoom(joinPage, code); if (joinLeave) cleanupErrors.push(joinLeave); }
      for (const api of botApis) { const botLeave = await leaveKnownApi(api, code); if (botLeave) cleanupErrors.push(botLeave); }
    }
    for (const api of botApis) { try { await api.dispose(); } catch (error) { cleanupErrors.push(`api close: ${error instanceof Error ? error.message : String(error)}`); } }
    if (joinContext) await closeContext(joinContext, cleanupErrors, 'join');
    if (cleanupErrors.length) throw new Error(`release smoke cleanup failed for ${code}: ${cleanupErrors.join('; ')}`);
  }
});
