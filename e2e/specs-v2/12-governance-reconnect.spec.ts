import { expect, test, type Browser, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import { advanceAcceptanceClock } from '../helpers-v2/full-game.ts';
import { browserContextForApi, enterAndReady, loginApi, roomView as apiRoomView, type ApiSession } from '../helpers-v2/recovery.ts';
import { dismissIdentityEntryReveal, enterRoom, leaveRoom, loadRoomAccounts, loginRoomAccount, roomView } from '../helpers-v2/rooms.ts';
import type { RoomAccount } from '../helpers-v2/account.ts';

const CLOCK_SOCKET = process.env.ACCEPTANCE_CLOCK_SOCKET ?? '/clock-control/clock.sock';

interface SocketGate { disconnect(): Promise<void>; allow(): void; connectionCount(): number; upstreamFrames(): string[] }

async function installSocketGate(context: BrowserContext): Promise<SocketGate> {
  let blocked = false;
  const pairs: Array<{ client: WebSocketRoute; server: WebSocketRoute }> = [];
  const upstream: string[] = [];
  const frameText = (message: string | Buffer): string => typeof message === 'string' ? message : message.toString('utf8');
  await context.routeWebSocket(/\/api\/v2\/socket\.io/, websocket => {
    if (blocked) { void websocket.close({ code: 1001, reason: 'e2e offline' }); return; }
    const server = websocket.connectToServer();
    websocket.onMessage(message => { upstream.push(frameText(message)); server.send(message); });
    server.onMessage(message => { upstream.push(frameText(message)); websocket.send(message); });
    pairs.push({ client: websocket, server });
  });
  return {
    async disconnect() {
      blocked = true;
      for (const pair of pairs) {
        // Socket.IO's default namespace DISCONNECT packet is Engine.IO message
        // type 4 plus Socket.IO packet type 1. This makes the real server
        // socket emit disconnect before transport cleanup; it does not touch
        // room/game state directly.
        pair.server.send('41');
      }
      await new Promise<void>(resolve => setTimeout(resolve, 50));
      for (const pair of pairs) {
        await pair.client.close({ code: 1001, reason: 'e2e offline' });
        await pair.server.close({ code: 1001, reason: 'e2e offline' });
      }
    },
    allow() { blocked = false; },
    connectionCount() { return pairs.length; },
    upstreamFrames() { return [...upstream]; },
  };
}

async function createExperimentalRoom(page: Page): Promise<string> {
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
  await page.getByRole('button', { name: '自定义角色组成' }).click();
  await page.getByLabel('玩家人数').fill('5');
  for (const [label, value] of [['莱莱可人数', '0'], ['门先生人数', '1'], ['水妖人数', '0'], ['降临者人数', '0'], ['科研员人数', '1'], ['平民人数', '1'], ['死神人数', '1'], ['魂灵人数', '1'], ['丧亲者人数', '0']] as const) {
    await page.getByLabel(label).fill(value);
  }
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '房间大厅' })).toBeVisible();
  return (await page.locator('.room-code strong').innerText()).trim();
}

async function openAccount(browser: Browser, account: RoomAccount, withMediaProbe = false, routeSocket = false): Promise<{ context: BrowserContext; page: Page; socketGate?: SocketGate }> {
  const context = await browser.newContext();
  const socketGate = routeSocket ? await installSocketGate(context) : undefined;
  if (withMediaProbe) {
    await context.addInitScript(() => {
      (window as any).__e2eGetUserMediaCalls = 0;
      const media = navigator.mediaDevices;
      if (!media) return;
      Object.defineProperty(media, 'getUserMedia', {
        configurable: true,
        value: async () => {
          (window as any).__e2eGetUserMediaCalls += 1;
          throw new Error('getUserMedia called while voice is disabled');
        },
      });
    });
  }
  const page = await context.newPage();
  await loginRoomAccount(page, account);
  return { context, page, socketGate };
}

async function createApiSession(account: RoomAccount): Promise<ApiSession> {
  return loginApi(account);
}

async function leaveKnownRoom(page: Page, code: string): Promise<string | null> {
  if (!code) return null;
  try {
    const response = await page.request.post(`/api/v2/rooms/${code}/leave`, { data: { requestId: crypto.randomUUID() } });
    return [200, 403, 404].includes(response.status()) ? null : `page leave ${code}: ${response.status()}`;
  } catch (error) { return `page leave ${code}: ${error instanceof Error ? error.message : String(error)}`; }
}

async function leaveApiKnownRoom(session: ApiSession, code: string): Promise<string | null> {
  if (!code) return null;
  try {
    const response = await session.api.post(`/api/v2/rooms/${code}/leave`, { data: { requestId: crypto.randomUUID() } });
    return [200, 403, 404].includes(response.status()) ? null : `api leave ${code}: ${response.status()}`;
  } catch (error) { return `api leave ${code}: ${error instanceof Error ? error.message : String(error)}`; }
}

async function closeContext(context: BrowserContext, errors: string[], label: string): Promise<void> {
  try { await context.close(); } catch (error) { errors.push(`${label} close: ${error instanceof Error ? error.message : String(error)}`); }
}

function addCleanupResult(errors: string[], result: string | null): void { if (result) errors.push(result); }

async function startFivePlayerGame(hostPage: Page, code: string, apiSessions: ApiSession[], additionalPages: Page[] = []): Promise<void> {
  for (const session of apiSessions) await enterAndReady(session, code);
  for (const page of additionalPages) {
    await page.getByRole('button', { name: '准备', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
  }
  await hostPage.getByRole('button', { name: '准备', exact: true }).click();
  await expect(hostPage.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
  await hostPage.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(hostPage.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 25_000 });
  await dismissIdentityEntryReveal(hostPage);
}

async function advanceUntilPublicWriter(requests: Array<{ view: (code: string) => Promise<any> }>, code: string): Promise<{ index: number; view: any }> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const views = await Promise.all(requests.map(item => item.view(code)));
    const index = views.findIndex(view => view.capabilities?.canPostPublic === true && view.tasks?.some((task: any) => task.action === 'REGISTER_CANDIDACY'));
    if (index >= 0) return { index, view: views[index] };
    const deadlines = views.flatMap(view => (view.windows ?? []).map((window: any) => window.closesAt)).filter((value: unknown): value is number => typeof value === 'number' && value > 0);
    if (!deadlines.length) {
      if (!views.some(view => view.room?.phase === 'playing' && view.gameId && view.public?.phase !== 'ended')) throw new Error('game reached a terminal state without a public writer');
      // Private check/rescue segments are intentionally absent from every
      // authorized snapshot when this viewer has no task. Advance natural
      // fake time in small steps until the next public window becomes visible.
      await advanceAcceptanceClock(CLOCK_SOCKET, 1_000);
      continue;
    }
    const now = Math.max(...views.map(view => view.serverTime));
    await advanceAcceptanceClock(CLOCK_SOCKET, Math.max(1, Math.min(...deadlines) - now + 1));
  }
  throw new Error('public chat writer did not become available');
}

function parsePageCountdown(text: string | null): number {
  const match = /^(\d+):(\d{2})$/.exec((text ?? '').trim());
  if (!match) throw new Error(`invalid page countdown: ${text ?? '<empty>'}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

test('AC07 房主断线超过宽限后自动继任，旧房主管理菜单清空且旧操作被拒绝', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  await advanceAcceptanceClock(CLOCK_SOCKET, 0);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const host = await openAccount(browser, accounts[0]!, false, true);
  const onlinePlayer = await openAccount(browser, accounts[1]!);
  const apiSessions: ApiSession[] = [];
  let code = '';
  try {
    code = await createExperimentalRoom(host.page);
    await enterRoom(onlinePlayer.page, code);
    for (const account of accounts.slice(2, 5)) apiSessions.push(await createApiSession(account));
    await startFivePlayerGame(host.page, code, apiSessions, [onlinePlayer.page]);

    await host.page.getByRole('button', { name: '房间管理', exact: true }).click();
    await expect(host.page.getByRole('button', { name: '转移房主' }).first()).toBeVisible();
    await host.page.getByRole('button', { name: '转移房主' }).first().click();
    await expect(host.page.getByRole('dialog', { name: '转移房主？' })).toBeVisible();
    expect(host.socketGate!.connectionCount()).toBeGreaterThan(0);
    const hostFrames = host.socketGate!.upstreamFrames();
    expect(hostFrames.length).toBeGreaterThan(5);
    await host.socketGate!.disconnect();
    await host.context.setOffline(true);
    await expect.poll(async () => (await roomView(onlinePlayer.page, code)).room.formalMembers.find((member: any) => member.userId === accounts[0]!.userId)?.presence, { timeout: 25_000, intervals: [250] }).toBe('reconnecting');

    const beforeGrace = await roomView(onlinePlayer.page, code);
    const oldHostMember = beforeGrace.room.formalMembers.find((member: any) => member.userId === accounts[0]!.userId);
    const onlineMember = beforeGrace.room.formalMembers.find((member: any) => member.userId === accounts[1]!.userId);
    expect(oldHostMember?.presence).toBe('reconnecting');
    expect(beforeGrace.room.hostMemberId).toBe(oldHostMember?.memberId);
    await advanceAcceptanceClock(CLOCK_SOCKET, 14_999);
    expect((await roomView(onlinePlayer.page, code)).room.hostMemberId).toBe(oldHostMember?.memberId);

    await advanceAcceptanceClock(CLOCK_SOCKET, 1);
    await expect.poll(async () => (await roomView(onlinePlayer.page, code)).room.hostMemberId, { timeout: 15_000, intervals: [250] }).toBe(onlineMember?.memberId);
    const transferred = await roomView(onlinePlayer.page, code);
    expect(transferred.room.formalMembers.find((member: any) => member.userId === accounts[0]!.userId)?.presence).toBe('offline');
    expect(transferred.viewer.isHost).toBe(true);

    await host.context.setOffline(false);
    host.socketGate!.allow();
    await expect(host.page.getByRole('heading', { name: /夜幕降临|晨间公告|白昼/ })).toBeVisible({ timeout: 25_000 });
    await expect.poll(async () => (await roomView(host.page, code)).viewer.isHost, { timeout: 30_000, intervals: [500] }).toBe(false);
    await expect(host.page.getByRole('button', { name: '转移房主' })).toHaveCount(0);
    await expect(host.page.getByRole('button', { name: '移出' })).toHaveCount(0);
    await expect(host.page.getByRole('dialog')).toHaveCount(0);
    const staleTransfer = await host.page.request.post(`/api/v2/rooms/${code}/transfer-host`, { data: { requestId: crypto.randomUUID(), memberId: onlineMember?.memberId } });
    expect(staleTransfer.status()).toBe(403);
    expect((await staleTransfer.json()).error.code).toBe('not_host');
  } finally {
    const cleanupErrors: string[] = [];
    await host.context.setOffline(false).catch(() => {});
    addCleanupResult(cleanupErrors, await leaveKnownRoom(host.page, code));
    addCleanupResult(cleanupErrors, await leaveKnownRoom(onlinePlayer.page, code));
    for (const session of apiSessions) addCleanupResult(cleanupErrors, await leaveApiKnownRoom(session, code));
    for (const session of apiSessions) { try { await session.api.dispose(); } catch (error) { cleanupErrors.push(`api close: ${error instanceof Error ? error.message : String(error)}`); } }
    await closeContext(host.context, cleanupErrors, 'host'); await closeContext(onlinePlayer.context, cleanupErrors, 'online player');
    if (cleanupErrors.length) throw new Error(`cleanup failed for ${code}: ${cleanupErrors.join('; ')}`);
  }
});

test('AC09 正式成员离开后仅剩观众，5分钟回收；正式成员离线仍保留房间', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  await advanceAcceptanceClock(CLOCK_SOCKET, 0);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const firstPlayer = await openAccount(browser, accounts[0]!, false, true);
  const players = [firstPlayer, ...(await Promise.all(accounts.slice(1, 5).map(account => openAccount(browser, account))))];
  const spectator = await openAccount(browser, accounts[5]!);
  const secondSpectator = await openAccount(browser, accounts[6]!);
  let code = '';
  try {
    code = await createExperimentalRoom(players[0]!.page);
    for (const player of players.slice(1)) await enterRoom(player.page, code);
    await enterRoom(spectator.page, code);
    await enterRoom(secondSpectator.page, code);
    expect((await roomView(spectator.page, code)).viewer.kind).toBe('public_spectator');
    expect((await roomView(secondSpectator.page, code)).viewer.kind).toBe('public_spectator');

    expect(players[0]!.socketGate!.connectionCount()).toBeGreaterThan(0);
    await players[0]!.socketGate!.disconnect();
    await players[0]!.context.setOffline(true);
    await expect.poll(async () => (await roomView(players[1]!.page, code)).room.formalMembers.find((member: any) => member.userId === accounts[0]!.userId)?.presence, { timeout: 25_000, intervals: [250] }).toBe('reconnecting');
    await advanceAcceptanceClock(CLOCK_SOCKET, 15_000);
    await expect.poll(async () => (await roomView(players[1]!.page, code)).room.formalMembers.find((member: any) => member.userId === accounts[0]!.userId)?.presence, { timeout: 15_000, intervals: [250] }).toBe('offline');
    await advanceAcceptanceClock(CLOCK_SOCKET, 285_000);
    const offlineStillFormal = await roomView(spectator.page, code);
    expect(offlineStillFormal.room.formalMembers).toHaveLength(5);
    expect(offlineStillFormal.room.formalMembers.find((member: any) => member.userId === accounts[0]!.userId)?.presence).toBe('offline');
    expect(offlineStillFormal.room.emptyDeadline).toBeNull();
    await players[0]!.context.setOffline(false);
    players[0]!.socketGate!.allow();
    await expect(players[0]!.page.getByRole('heading', { name: '房间大厅' })).toBeVisible({ timeout: 25_000 });
    await expect.poll(async () => (await roomView(players[0]!.page, code)).room.formalMembers.find((member: any) => member.userId === accounts[0]!.userId)?.presence, { timeout: 30_000, intervals: [500] }).toBe('online');

    for (const player of players) await leaveRoom(player.page);
    const empty = await roomView(spectator.page, code);
    expect(empty.room.formalMembers).toHaveLength(0);
    expect(empty.room.spectators).toHaveLength(2);
    expect(empty.room.hostMemberId).toBeNull();
    expect(empty.room.emptyDeadline).toEqual(expect.any(Number));
    await expect(spectator.page.getByText('当前暂无房主。')).toBeVisible();
    await expect(spectator.page.getByText(/当前无正式玩家，房间将自动解散。剩余/)).toBeVisible();
    await expect(spectator.page.getByRole('button', { name: '加入对局', exact: true })).toBeEnabled();
    await spectator.page.getByRole('button', { name: '加入对局', exact: true }).click();
    await expect.poll(async () => (await roomView(spectator.page, code)).room.formalMembers.length, { timeout: 15_000, intervals: [250] }).toBe(1);
    const promoted = await roomView(spectator.page, code);
    expect(promoted.room.formalMembers[0]?.userId).toBe(accounts[5]!.userId);
    expect(promoted.room.formalMembers[0]?.ready).toBe(false);
    expect(promoted.room.emptyDeadline).toBeNull();
    await leaveRoom(spectator.page);
    const emptyAgain = await roomView(secondSpectator.page, code);
    expect(emptyAgain.room.formalMembers).toHaveLength(0);
    expect(emptyAgain.room.spectators).toHaveLength(1);
    expect(emptyAgain.room.hostMemberId).toBeNull();
    expect(emptyAgain.room.emptyDeadline).toEqual(expect.any(Number));
    await expect(secondSpectator.page.getByText('当前暂无房主。')).toBeVisible();
    await expect(secondSpectator.page.getByText(/当前无正式玩家，房间将自动解散。剩余/)).toBeVisible();
    const deadline = emptyAgain.room.emptyDeadline as number;
    await advanceAcceptanceClock(CLOCK_SOCKET, 299_999);
    const beforeExpiry = await roomView(secondSpectator.page, code);
    expect(beforeExpiry.room.emptyDeadline).toBe(deadline);
    await advanceAcceptanceClock(CLOCK_SOCKET, 1);
    await expect(secondSpectator.page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible({ timeout: 20_000 });
    const expired = await secondSpectator.page.request.get(`/api/v2/rooms/${code}/view`);
    expect(expired.status()).toBe(404);
  } finally {
    const cleanupErrors: string[] = [];
    for (const player of players) await player.context.setOffline(false).catch(() => {});
    for (const player of players) addCleanupResult(cleanupErrors, await leaveKnownRoom(player.page, code));
    addCleanupResult(cleanupErrors, await leaveKnownRoom(spectator.page, code));
    addCleanupResult(cleanupErrors, await leaveKnownRoom(secondSpectator.page, code));
    for (const player of players) await closeContext(player.context, cleanupErrors, 'player');
    await closeContext(spectator.context, cleanupErrors, 'spectator');
    await closeContext(secondSpectator.context, cleanupErrors, 'second spectator');
    if (cleanupErrors.length) throw new Error(`cleanup failed for ${code}: ${cleanupErrors.join('; ')}`);
  }
});

test('AC19 真实Socket断线重连保持玩家与窗口，禁止自动重发；voice=false时不请求麦克风且公屏可用', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  await advanceAcceptanceClock(CLOCK_SOCKET, 0);
  const accounts = loadRoomAccounts(testInfo.project.name);
  const host = await openAccount(browser, accounts[0]!, true, true);
  const apiSessions: ApiSession[] = [];
  let chatContext: BrowserContext | null = null;
  let chatPage: Page | null = null;
  let chatSocketGate: SocketGate | null = null;
  let code = '';
  const voiceRequests: string[] = [];
  try {
    host.page.on('request', request => {
      if (request.url().includes('/voice/')) voiceRequests.push(request.url());
    });
    const bootstrap = await host.page.request.get('/api/v2/bootstrap');
    expect(bootstrap.status()).toBe(200);
    const bootstrapBody = await bootstrap.json() as any;
    expect(bootstrapBody.features.voice).toBe(false);
    code = await createExperimentalRoom(host.page);
    for (const account of accounts.slice(1, 5)) apiSessions.push(await createApiSession(account));
    await startFivePlayerGame(host.page, code, apiSessions);

    const gameViews = [{ view: (room: string) => roomView(host.page, room) }, ...apiSessions.map(session => ({ view: (room: string) => apiRoomView(session, room) }))];
    const dayWriter = await advanceUntilPublicWriter(gameViews, code);
    if (dayWriter.index === 0) {
      chatPage = host.page;
    } else {
      chatContext = await browserContextForApi(browser, apiSessions[dayWriter.index - 1]!);
      chatSocketGate = await installSocketGate(chatContext);
      await chatContext.addInitScript(() => {
        (window as any).__e2eGetUserMediaCalls = 0;
        const media = navigator.mediaDevices;
        if (media) Object.defineProperty(media, 'getUserMedia', { configurable: true, value: async () => { (window as any).__e2eGetUserMediaCalls += 1; throw new Error('getUserMedia called while voice is disabled'); } });
      });
      chatPage = await chatContext.newPage();
      await chatPage.goto(`/#/room/${code}`);
      await expect(chatPage.locator('.game-hud h1')).toBeVisible({ timeout: 25_000 });
    }
    const reconnectPage = chatPage!;
    const reconnectContext = chatContext ?? host.context;
    const reconnectGate = chatSocketGate ?? host.socketGate!;
    const writerApiIndex = dayWriter.index - 1;
    const reconnectObserver = apiSessions.find((_, index) => index !== writerApiIndex) ?? apiSessions[0]!;
    const reconnectVoiceRequests: string[] = [];
    const reconnectCommandRequests: string[] = [];
    const reconnectChatRequests: string[] = [];
    reconnectPage.on('request', request => {
      if (request.url().includes('/voice/')) reconnectVoiceRequests.push(request.url());
      if (request.url().endsWith('/command')) reconnectCommandRequests.push(request.url());
      if (request.url().endsWith('/chat')) reconnectChatRequests.push(request.url());
    });
    await expect(reconnectPage.getByLabel('公屏消息')).toBeVisible();
    const firstText = `断线前文字-${testInfo.project.name}`;
    await reconnectPage.getByLabel('公屏消息').fill(firstText);
    await reconnectPage.getByRole('button', { name: '发送公屏消息' }).click();
    await expect.poll(async () => (await apiRoomView(reconnectObserver, code)).chat.public.filter((message: any) => message.text === firstText).length, { timeout: 20_000, intervals: [250] }).toBe(1);
    expect(reconnectChatRequests).toHaveLength(1);

    const actionView = await roomView(reconnectPage, code);
    const legalTask = actionView.tasks?.find((task: any) => task.action === 'REGISTER_CANDIDACY');
    if (!legalTask) throw new Error('public writer has no REGISTER_CANDIDACY task before reconnect');
    const actionRegion = reconnectPage.getByRole('region', { name: '舞台行动', exact: true });
    await expect(actionRegion.getByTestId('stage-submit')).toHaveAccessibleName('报名竞选');
    const commandRequest = reconnectPage.waitForRequest(request => request.url().endsWith('/command') && request.method() === 'POST');
    const commandResponse = reconnectPage.waitForResponse(response => response.url().endsWith('/command') && response.request().method() === 'POST');
    await actionRegion.getByTestId('stage-submit').click();
    const sentCommand = await commandRequest;
    const commandReceipt = await (await commandResponse).json() as Record<string, any>;
    const sentBody = sentCommand.postDataJSON() as Record<string, any>;
    expect(sentBody).toMatchObject({ gameId: actionView.gameId, windowInstanceId: legalTask.windowInstanceId, action: 'REGISTER_CANDIDACY' });
    expect(commandReceipt).toMatchObject({ requestId: sentBody.requestId, status: 'accepted' });
    expect(reconnectCommandRequests).toHaveLength(1);
    const beforeReconnect = await roomView(reconnectPage, code);
    const beforeWindow = beforeReconnect.windows[0]?.closesAt;
    expect(beforeWindow).toEqual(expect.any(Number));
    const pageCountdown = reconnectPage.locator('.hud-meta strong');
    await expect(pageCountdown).toHaveText(/^\d+:\d{2}$/);
    const beforePageSeconds = parsePageCountdown(await pageCountdown.textContent());
    expect(beforePageSeconds).toBeGreaterThan(1);
    const beforeGameId = beforeReconnect.gameId;
    const beforeMemberCount = beforeReconnect.room.formalMembers.length;
    const reconnectUserId = beforeReconnect.viewer.userId;
    const reconnectFrames = reconnectGate.upstreamFrames();
    expect(reconnectFrames.length).toBeGreaterThan(5);
    await reconnectGate.disconnect();
    await reconnectContext.setOffline(true);
    await expect.poll(async () => (await apiRoomView(reconnectObserver, code)).room.formalMembers.find((member: any) => member.userId === reconnectUserId)?.presence, { timeout: 25_000, intervals: [250] }).toBe('reconnecting');
    await advanceAcceptanceClock(CLOCK_SOCKET, 1_000);
    await reconnectContext.setOffline(false);
    reconnectGate.allow();
    await expect(reconnectPage.locator('.game-hud h1')).toBeVisible({ timeout: 25_000 });
    await expect.poll(async () => (await roomView(reconnectPage, code)).room.formalMembers.find((member: any) => member.userId === reconnectUserId)?.presence, { timeout: 30_000, intervals: [500] }).toBe('online');
    await expect(reconnectPage.getByText(/连接已中断，信息可能不是最新/)).toHaveCount(0);
    await expect.poll(async () => parsePageCountdown(await pageCountdown.textContent()), { timeout: 5_000, intervals: [100, 250] }).toBeLessThan(beforePageSeconds);
    const afterReconnect = await roomView(reconnectPage, code);
    expect(afterReconnect.windows[0]?.closesAt).toBe(beforeWindow);
    expect(afterReconnect.gameId).toBe(beforeGameId);
    expect(afterReconnect.room.formalMembers).toHaveLength(beforeMemberCount);
    expect(new Set(afterReconnect.room.formalMembers.map((member: any) => member.userId)).size).toBe(beforeMemberCount);
    expect(new Set(afterReconnect.public.seats.map((seat: any) => seat.playerId)).size).toBe(afterReconnect.public.seats.length);
    expect(reconnectChatRequests).toHaveLength(1);
    expect(reconnectCommandRequests).toHaveLength(1);
    expect(await host.page.evaluate(() => (window as any).__e2eGetUserMediaCalls)).toBe(0);
    expect(await reconnectPage.evaluate(() => (window as any).__e2eGetUserMediaCalls)).toBe(0);
    expect(voiceRequests).toHaveLength(0);
    expect(reconnectVoiceRequests).toHaveLength(0);

    const secondText = `重连后仍可发送文字-${testInfo.project.name}`;
    await reconnectPage.getByLabel('公屏消息').fill(secondText);
    await reconnectPage.getByRole('button', { name: '发送公屏消息' }).click();
    await expect.poll(async () => (await apiRoomView(reconnectObserver, code)).chat.public.filter((message: any) => message.text === secondText).length, { timeout: 20_000, intervals: [250] }).toBe(1);
    expect(reconnectChatRequests).toHaveLength(2);
    const finalBootstrap = await reconnectPage.request.get('/api/v2/bootstrap');
    expect((await finalBootstrap.json()).features.voice).toBe(false);
  } finally {
    const cleanupErrors: string[] = [];
    await host.context.setOffline(false).catch(() => {});
    addCleanupResult(cleanupErrors, await leaveKnownRoom(host.page, code));
    for (const session of apiSessions) addCleanupResult(cleanupErrors, await leaveApiKnownRoom(session, code));
    for (const session of apiSessions) { try { await session.api.dispose(); } catch (error) { cleanupErrors.push(`api close: ${error instanceof Error ? error.message : String(error)}`); } }
    if (chatContext && chatContext !== host.context) await closeContext(chatContext, cleanupErrors, 'chat');
    await closeContext(host.context, cleanupErrors, 'host');
    if (cleanupErrors.length) throw new Error(`cleanup failed for ${code}: ${cleanupErrors.join('; ')}`);
  }
});
