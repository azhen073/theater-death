import { expect, request as apiRequest, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { loginRoomAccount } from '../helpers-v2/rooms.ts';
import { advanceAcceptanceClock, createFormalRoomViaPage, loadFullGameAccounts, loginApi, roomCommand, roomView } from '../helpers-v2/full-game.ts';

async function driveAuthorizedWindows(requests: APIRequestContext[], hostPage: any, code: string, clockSocket: string, accepted: Array<Record<string, unknown>>, roleByUser: Map<string, string>): Promise<{ view: Record<string, any>; chatDone: boolean; hostVoteDone: boolean }> {
  const submitted = new Set<string>();
  let hostVoteDone = false;
  let chatDone = false;
  const humanCandidate = [...roleByUser.entries()].find(([, role]) => role === 'researcher')?.[0];
  const deathTargets = new Set([...roleByUser.entries()].filter(([, role]) => role === 'death' || role === 'spirit').map(([userId]) => userId));
  for (let step = 0; step < 320; step += 1) {
    const views = await Promise.all(requests.map(request => roomView(request, code)));
    const review = views.find(view => view.room?.phase === 'review');
    if (review) return { view: review, chatDone, hostVoteDone };
    let sent = false;
    for (let index = 0; index < views.length; index += 1) {
      const view = views[index]!;
      for (const task of view.tasks ?? []) {
        if (!view.capabilities?.allowedCommands?.includes(task.action)) continue;
        const revisionKey = task.action === 'CONFIRM_PROPOSAL' ? `/${view.private?.proposal?.revision ?? 0}` : '';
        const key = `${view.viewer.userId}/${task.windowInstanceId}/${task.action}${revisionKey}`;
        if (submitted.has(key)) continue;
        if (task.action === 'WITHDRAW_CANDIDACY' || task.action === 'REGISTER_CANDIDACY' && view.viewer.userId !== humanCandidate) { submitted.add(key); continue; }
        if (task.action === 'CONFIRM_PROPOSAL' && (!Number.isSafeInteger(view.private?.proposal?.revision) || (view.private?.proposal?.revision ?? 0) <= 0)) continue;
        let targets: string[] = [];
        if (task.action === 'EDIT_PROPOSAL' || task.action === 'SUBMIT_LAIKE' || task.action === 'SUBMIT_RESCUE') targets = [];
        else if (task.action === 'SUBMIT_ELECTION_VOTE') {
          const candidate = view.public?.seats.find((seat: any) => seat.userId === humanCandidate && seat.alive)?.playerId;
          if (!candidate || !task.targets?.playerIds.includes(candidate)) throw new Error('human candidate is not a legal election target');
          targets = [candidate];
        } else if (task.action === 'SUBMIT_DAY_VOTE') {
          const target = task.targets?.playerIds.find((id: string) => view.public?.seats.some((seat: any) => seat.playerId === id && seat.alive && deathTargets.has(seat.userId)));
          if (!target) throw new Error('no legal alive death/spirit day-vote target');
          targets = [target];
        } else if (task.targets) {
          const target = task.targets.playerIds.find((id: string) => view.public?.seats.some((seat: any) => seat.playerId === id && seat.alive));
          if (!target && !task.targets.canSkip) throw new Error(`no legal target for ${task.action}`);
          if (target) targets = [target];
        }
        const body: Record<string, unknown> = { requestId: crypto.randomUUID(), gameId: view.gameId, windowInstanceId: task.windowInstanceId, action: task.action };
        if (task.targets) body.targets = targets;
        if (task.action === 'DESIGNATE_SPEECH') body.direction = 'asc';
        if (task.action === 'CONFIRM_PROPOSAL') body.revision = view.private?.proposal?.revision;
        let receipt: Record<string, any>;
        if (index === 0 && task.action === 'SUBMIT_DAY_VOTE' && !hostVoteDone) {
          const seat = view.public.seats.find((item: any) => item.playerId === targets[0]);
          const request = hostPage.waitForRequest((item: any) => item.method() === 'POST' && item.url().endsWith('/command'));
          const response = hostPage.waitForResponse((item: any) => item.request().method() === 'POST' && item.url().endsWith('/command'));
          await hostPage.getByRole('button', { name: new RegExp(`^${seat.seat}号 .*可选目标`) }).click();
          await hostPage.getByRole('button', { name: '确认提交', exact: true }).click();
          const sentBody = await (await request).postDataJSON();
          receipt = await (await response).json();
          expect(sentBody).toMatchObject({ gameId: body.gameId, windowInstanceId: body.windowInstanceId, action: body.action, targets: body.targets });
          expect(sentBody.requestId).toEqual(receipt.requestId); hostVoteDone = true;
          accepted.push({ action: sentBody.action, gameId: sentBody.gameId, windowInstanceId: sentBody.windowInstanceId, requestId: receipt.requestId, targets: sentBody.targets, viaBrowser: true });
        } else receipt = await roomCommand(requests[index]!, code, body);
        expect(receipt.status).toBe('accepted');
        if (index !== 0 || task.action !== 'SUBMIT_DAY_VOTE') accepted.push({ action: body.action, gameId: body.gameId, windowInstanceId: body.windowInstanceId, requestId: receipt.requestId, targets: body.targets, viaBrowser: false });
        submitted.add(key); sent = true; break;
      }
      if (sent) break;
    }
    if (sent) continue;
    if (!chatDone) {
      const writer = views.findIndex(view => view.capabilities?.canPostPublic);
      if (writer >= 0) { const chat = await requests[writer]!.post(`/api/v2/rooms/${code}/chat`, { data: { gameId: views[writer]!.gameId, clientMessageId: crypto.randomUUID(), channel: 'public', text: '首局白天真实公屏消息' } }); expect(chat.status()).toBe(201); chatDone = true; continue; }
    }
    const allDeadlines = views.flatMap(view => (view.windows ?? []).map((window: Record<string, any>) => window.closesAt)).filter((value: unknown): value is number => typeof value === 'number' && value > Math.max(...views.map(view => view.serverTime)));
    const now = Math.max(...views.map(view => view.serverTime));
    if (allDeadlines.length) await advanceAcceptanceClock(clockSocket, Math.max(1, Math.min(...allDeadlines) - now + 1));
    else if (!sent) throw new Error('full-game stalled without authorized task or window');
  }
  throw new Error('full-game did not reach review within bounded authorized-window driver');
}

test('正式13人第一局真实复盘与第二局启动（acceptance profile only）', async ({ browser }, testInfo) => {
  test.setTimeout(900_000);
  const clockSocket = process.env.ACCEPTANCE_CLOCK_SOCKET ?? '/clock-control/clock.sock';
  // Fail fast before creating accounts/rooms if this is accidentally run on dev.
  await advanceAcceptanceClock(clockSocket, 0);
  const accounts = loadFullGameAccounts(testInfo.project.name);
  const hostContext = await browser.newContext({ extraHTTPHeaders: { Origin: 'http://localhost:5173' } });
  const hostPage = await hostContext.newPage();
  const apiContexts: APIRequestContext[] = [];
  const accepted: Array<Record<string, unknown>> = [];
  let code = '';
  try {
    await loginRoomAccount(hostPage, accounts[0]!);
    code = await createFormalRoomViaPage(hostPage);
    for (const account of accounts.slice(1)) {
      const api = await apiRequest.newContext({ baseURL: 'http://localhost:5173', extraHTTPHeaders: { Origin: 'http://localhost:5173' } });
      apiContexts.push(api); await loginApi(api, account);
      const entered = await api.post(`/api/v2/rooms/${code}/enter`, { data: { requestId: crypto.randomUUID() } });
      expect(entered.status()).toBe(200);
      const ready = await api.post(`/api/v2/rooms/${code}/ready`, { data: { requestId: crypto.randomUUID(), ready: true } });
      expect(ready.status()).toBe(200);
    }
    await hostPage.getByRole('button', { name: '准备', exact: true }).click();
    await hostPage.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(hostPage.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 30_000 });
    const requests = [hostPage.request, ...apiContexts];
    const initialViews = await Promise.all(requests.map(requestContext => roomView(requestContext, code)));
    const roleByUser = new Map(initialViews.map(view => [view.viewer.userId, view.private?.self.roleId] as [string, string]));
    const driven = await driveAuthorizedWindows(requests, hostPage, code, clockSocket, accepted, roleByUser);
    const reviewView = driven.view;
    expect(driven.chatDone).toBe(true);
    expect(driven.hostVoteDone).toBe(true);
    expect(reviewView.room.code).toBe(code);
    expect(reviewView.room.config).toBeTruthy();
    expect(reviewView.gameId).toBeTruthy();
    const review = await hostPage.request.get(`/api/v2/rooms/${code}/review`);
    expect(review.status()).toBe(200);
    const reviewBody = await review.json() as { review?: { gameId?: string; players?: unknown[]; timeline?: unknown[]; chat?: unknown } };
    expect(reviewBody.review?.gameId).toBe(reviewView.gameId);
    expect(reviewBody.review?.players?.length).toBe(13);
    expect(Array.isArray(reviewBody.review?.timeline)).toBe(true);
    expect(reviewBody.review?.chat).toBeTruthy();
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.some(item => item.action === 'SUBMIT_GUARD' && Array.isArray(item.targets) && item.targets.length > 0)).toBe(true);
    expect(accepted.some(item => item.action === 'SUBMIT_CHECK' && Array.isArray(item.targets) && item.targets.length > 0)).toBe(true);
    expect(accepted.some(item => item.action === 'SUBMIT_DAY_VOTE')).toBe(true);
    expect(accepted.some(item => item.action === 'SUBMIT_DAY_VOTE' && item.viaBrowser === true)).toBe(true);
    expect((reviewBody.review as any)?.winner).toBe('human');
    expect((reviewBody.review?.timeline ?? []).filter((event: any) => event.type === 'night_started').length).toBeGreaterThanOrEqual(2);
    expect((reviewBody.review?.timeline ?? []).some((event: any) => event.type === 'vote_result')).toBe(true);
    const firstGameId = reviewView.gameId;
    await hostPage.screenshot({ path: '/results/full-game-review.png' });
    await hostPage.getByRole('button', { name: '结束复盘，返回大厅' }).click();
    await hostPage.getByRole('dialog').getByRole('button', { name: '确认结束复盘' }).click();
    await expect(hostPage.getByRole('heading', { name: '房间大厅' })).toBeVisible({ timeout: 20_000 });
    const afterReview = await roomView(hostPage.request, code);
    expect(afterReview.roomId).toBe(reviewView.roomId); expect(afterReview.room.code).toBe(code); expect(afterReview.gameId).toBeNull();
    expect(afterReview.room.config).toEqual(reviewView.room.config);
    expect(afterReview.room.formalMembers.every((member: Record<string, any>) => member.ready === false)).toBe(true);
    for (let index = 1; index < apiContexts.length + 1; index += 1) {
      const ready = await apiContexts[index - 1]!.post(`/api/v2/rooms/${code}/ready`, { data: { requestId: crypto.randomUUID(), ready: true } });
      expect(ready.status()).toBe(200);
    }
    await hostPage.getByRole('button', { name: '准备', exact: true }).click();
    await hostPage.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(hostPage.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 30_000 });
    await hostPage.screenshot({ path: '/results/full-game-second-game.png' });
    const second = await roomView(hostPage.request, code);
    expect(second.gameId).toBeTruthy(); expect(second.gameId).not.toBe(firstGameId);
    expect(second.chat.public).toEqual([]); expect(second.chat.faction).toEqual([]); expect(second.submissionState).toEqual([]);
    const oldWindowIds = new Set(accepted.map(item => item.windowInstanceId));
    const secondViews = await Promise.all(requests.map(requestContext => roomView(requestContext, code)));
    for (const view of secondViews) { expect(view.chat.public).toEqual([]); expect(view.chat.faction).toEqual([]); expect(view.submissionState).toEqual([]); expect(view.private?.self.guardHistory).toEqual([]); }
    for (const view of secondViews) { expect((view.private?.events ?? []).some((event: any) => ['dying_list', 'descender_check_result'].includes(event.type))).toBe(false); }
    const actorIndex = secondViews.findIndex(view => view.capabilities?.allowedCommands?.includes('SUBMIT_GUARD') && view.tasks?.some((task: any) => task.action === 'SUBMIT_GUARD'));
    expect(actorIndex).toBeGreaterThanOrEqual(0);
    const actorView = secondViews[actorIndex]!; const actorTask = actorView.tasks.find((task: any) => actorView.capabilities.allowedCommands.includes(task.action));
    expect(actorTask.action).toBe('SUBMIT_GUARD');
    expect(oldWindowIds.has(actorTask.windowInstanceId)).toBe(false);
    const actorTarget = actorTask?.targets?.playerIds?.[0];
    const actorBody: Record<string, unknown> = { requestId: crypto.randomUUID(), gameId: actorView.gameId, windowInstanceId: actorTask.windowInstanceId, action: actorTask.action };
    if (actorTask.targets) actorBody.targets = actorTarget ? [actorTarget] : [];
    const secondReceipt = await roomCommand(requests[actorIndex]!, code, actorBody);
    expect(secondReceipt.status).toBe('accepted');
  } finally {
    const leaveErrors: unknown[] = [];
    for (const api of apiContexts) { try { if (code) { const response = await api.post(`/api/v2/rooms/${code}/leave`, { data: { requestId: crypto.randomUUID() } }); if (![200, 404, 403].includes(response.status())) throw new Error(`leave status ${response.status()}`); } } catch (error) { leaveErrors.push(error); } }
    try { if (code) { const response = await hostPage.request.post(`/api/v2/rooms/${code}/leave`, { data: { requestId: crypto.randomUUID() } }); if (![200, 404, 403].includes(response.status())) throw new Error(`host leave status ${response.status()}`); } } catch (error) { leaveErrors.push(error); }
    if (leaveErrors.length) console.warn('full-game cleanup failed', leaveErrors.length);
    for (const api of apiContexts) await api.dispose();
    await hostContext.close();
  }
});
