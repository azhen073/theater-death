import { expect, test, type Page } from '@playwright/test';
import { alivePlayers, loadGameFixture, pushFixture, resizeSeats, taskFixture, type CommandAction, type GameHarnessFixture, type RoomSnapshot, type TaskDTO } from '../helpers-v2/game.ts';

const COMMAND_ACTIONS: CommandAction[] = ['SUBMIT_GUARD', 'SUBMIT_LAIKE', 'EDIT_PROPOSAL', 'CONFIRM_PROPOSAL', 'SUBMIT_CHECK', 'SUBMIT_RESCUE', 'SUBMIT_REVIVE', 'REGISTER_CANDIDACY', 'WITHDRAW_CANDIDACY', 'START_SPEECH', 'END_ELECTION_SPEECH', 'SUBMIT_ELECTION_VOTE', 'DESIGNATE_SPEECH', 'END_SPEECH', 'SUBMIT_DAY_VOTE', 'END_TIE_SPEECH', 'END_LAST_WORDS', 'SUBMIT_HANDOVER'];

const labels: Record<CommandAction, string> = {
  SUBMIT_GUARD: '选择守护目标', SUBMIT_LAIKE: '选择刺杀目标', EDIT_PROPOSAL: '拟定攻击方案', CONFIRM_PROPOSAL: '确认团队方案',
  SUBMIT_CHECK: '选择查验目标', SUBMIT_RESCUE: '使用还魂曲', SUBMIT_REVIVE: '选择深海召回目标',
  REGISTER_CANDIDACY: '报名竞选天理', WITHDRAW_CANDIDACY: '退出竞选', START_SPEECH: '开始发言', END_ELECTION_SPEECH: '结束竞选发言',
  SUBMIT_ELECTION_VOTE: '选出天理', DESIGNATE_SPEECH: '指定发言顺序', END_SPEECH: '结束本次发言', SUBMIT_DAY_VOTE: '提交放逐投票',
  END_TIE_SPEECH: '结束平票发言', END_LAST_WORDS: '结束遗言', SUBMIT_HANDOVER: '移交天理',
};
const targetActions = new Set<CommandAction>(['SUBMIT_GUARD', 'SUBMIT_LAIKE', 'EDIT_PROPOSAL', 'SUBMIT_CHECK', 'SUBMIT_RESCUE', 'SUBMIT_REVIVE', 'SUBMIT_ELECTION_VOTE', 'DESIGNATE_SPEECH', 'SUBMIT_DAY_VOTE', 'SUBMIT_HANDOVER']);

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  const commands: Array<Record<string, any>> = [];
  let commandMode: 'accepted' | 'rejected' | 'lost' = 'accepted';
  let commandAttempts = 0;
  let lookupStatus: 'not_seen' | 'pending' | 'accepted' = 'not_seen';
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/view', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current.view) }));
  await page.route('**/api/v2/rooms/*/command', async route => {
    const body = route.request().postDataJSON() as Record<string, any>;
    commands.push(structuredClone(body));
    commandAttempts += 1;
    if (commandMode === 'lost' && commandAttempts === 1) { await route.fetch(); await route.abort('failed'); return; }
    if (commandMode === 'rejected') { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: body.requestId, status: 'rejected', code: 'action_forbidden', message: '当前无此行动权限' }) }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: body.requestId, status: 'accepted', code: null, message: null }) });
  });
  await page.route('**/api/v2/rooms/*/games/*/receipts/*', async route => {
    const body = lookupStatus === 'accepted' ? { requestId: commands.at(-1)?.requestId, status: 'accepted', code: null, message: null } : { requestId: commands.at(-1)?.requestId, status: lookupStatus };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: /夜幕降临|晨间公告/ })).toBeVisible();
  return {
    commands,
    setFixture: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); },
    setMode: (mode: 'accepted' | 'rejected' | 'lost') => { commandMode = mode; commandAttempts = 0; },
    setLookup: (status: 'not_seen' | 'pending' | 'accepted') => { lookupStatus = status; },
  };
}

function targetSelection(view: RoomSnapshot, overrides: Partial<NonNullable<TaskDTO['targets']>> = {}): NonNullable<TaskDTO['targets']> {
  const ids = alivePlayers(view).slice(0, 3);
  return { playerIds: ids, maxTargets: 2, allowRepeated: false, canSkip: true, forbiddenPairs: [], ...overrides };
}

async function confirm(page: Page): Promise<void> {
  await page.getByRole('button', { name: '确认提交', exact: true }).click();
}

test('夹具 UI 为全部18个 action 发送准确 envelope，目标单击不提前发送', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const base = loadGameFixture();
  const mounted = await mount(page, base);
  await expect(page.locator('.game-hud .eyebrow')).toContainText('第 1 阶段');
  for (const action of COMMAND_ACTIONS) {
    const next = taskFixture(base.view, action, targetActions.has(action) ? targetSelection(base.view) : null);
    if (action === 'CONFIRM_PROPOSAL') next.view.private!.proposal = { pool: 'death', activeMemberIds: [], revision: 3, targetPlayerIds: [], confirmedBy: [], locked: false, effective: { revision: 1, targetPlayerIds: [], basis: 'latest_legal' } };
    await mounted.setFixture(next);
    await expect(page.getByRole('region', { name: '舞台行动', exact: true }).locator('h2')).toHaveText(labels[action]);
    const before = mounted.commands.length;
    if (targetActions.has(action)) {
      await page.locator('.seat-main[aria-label*="可选目标"]').first().click();
      expect(mounted.commands.length).toBe(before);
    }
    await confirm(page);
    await expect.poll(() => mounted.commands.length).toBe(before + 1);
    const sent = mounted.commands.at(-1)!;
    expect(sent).toMatchObject({ action, gameId: next.view.gameId, windowInstanceId: next.view.tasks[0]!.windowInstanceId });
    expect(sent).not.toHaveProperty('playerId');
    if (targetActions.has(action)) expect(sent.targets).toHaveLength(1); else expect(sent).not.toHaveProperty('targets');
    if (action === 'CONFIRM_PROPOSAL') expect(sent.revision).toBe(3); else expect(sent).not.toHaveProperty('revision');
    if (action === 'DESIGNATE_SPEECH') expect(sent.direction).toBe('asc'); else expect(sent).not.toHaveProperty('direction');
  }
  await page.screenshot({ path: '/results/actions-' + testInfo.project.name + '.png' });
  await expectNoOverflow(page);
});

test('夹具 UI 保持选择/任务/草稿边界并覆盖席位布局与公开私有视角', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const base = loadGameFixture();
  const mounted = await mount(page, base);
  const constrained = taskFixture(base.view, 'SUBMIT_GUARD', targetSelection(base.view, { maxTargets: 2, forbiddenPairs: [targetSelection(base.view).playerIds.slice(0, 2)] }));
  await mounted.setFixture(constrained);
  await page.locator('.seat-main[aria-label*="可选目标"]').nth(0).click();
  await page.locator('.seat-main[aria-label*="可选目标"]').nth(1).click();
  await expect(page.getByRole('region', { name: '舞台行动', exact: true }).locator('button.button--primary')).toBeDisabled();
  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认空守', exact: true })).toBeVisible();
  await page.locator('.seat-main[aria-label*="可选目标"]').nth(0).click();
  await expect(page.getByRole('button', { name: '确认提交', exact: true })).toBeEnabled();

  const repeated = taskFixture(base.view, 'SUBMIT_LAIKE', targetSelection(base.view, { maxTargets: 3, allowRepeated: true }));
  await mounted.setFixture(repeated);
  await page.locator('.seat-main[aria-label*="可选目标"]').first().click();
  await page.getByRole('button', { name: /增加.*目标次数/ }).first().click();
  await expect(page.locator('.selection-summary')).toContainText('2 / 3');

  const multi = structuredClone(base.view);
  multi.room.phase = 'playing';
  const first = { action: 'SUBMIT_GUARD' as const, windowInstanceId: 'w1', closesAt: multi.serverTime + 30_000, targets: targetSelection(multi) };
  const second = { action: 'SUBMIT_LAIKE' as const, windowInstanceId: 'w2', closesAt: multi.serverTime + 30_000, targets: targetSelection(multi) };
  multi.tasks = [first, second]; multi.windows = [{ id: 'w1', type: 'guard', instanceId: 'w1', closesAt: first.closesAt }, { id: 'w2', type: 'laike', instanceId: 'w2', closesAt: second.closesAt }]; multi.capabilities.allowedCommands = ['SUBMIT_GUARD', 'SUBMIT_LAIKE'];
  await mounted.setFixture({ ...repeated, view: multi });
  await expect(page.getByRole('group', { name: '可用任务' })).toBeVisible();
  await page.getByRole('button', { name: '选择刺杀目标', exact: true }).click();
  await expect(page.getByRole('region', { name: '舞台行动', exact: true }).locator('h2')).toHaveText('选择刺杀目标');

  const proposal = taskFixture(base.view, 'CONFIRM_PROPOSAL');
  proposal.view.private!.proposal = { pool: 'death', activeMemberIds: [], revision: 2, targetPlayerIds: [], confirmedBy: [], locked: false, effective: { revision: 1, targetPlayerIds: alivePlayers(base.view).slice(0, 1), basis: 'latest_legal' } };
  await mounted.setFixture(proposal);
  await expect(page.getByRole('region', { name: '舞台行动', exact: true }).locator('[aria-label="团队方案"]')).toContainText('最新草稿 v2');
  await expect(page.getByRole('region', { name: '舞台行动', exact: true }).locator('[aria-label="团队方案"]')).toContainText('v1');

  for (const count of [5, 13, 26, 64]) {
    const resized = resizeSeats(base.view, count);
    await mounted.setFixture(taskFixture(resized, 'REGISTER_CANDIDACY'));
    await expect(page.locator('.stage-seat')).toHaveCount(count);
    await expect(page.getByRole('button', { name: /查看\d+号玩家信息/ }).first()).toBeVisible();
    const stage = await page.locator('.theater-stage').boundingBox();
    expect(stage).not.toBeNull();
    const seats = await page.locator('.stage-seat').evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; }));
    for (const seat of seats) { expect(seat.left).toBeGreaterThanOrEqual(stage!.x - 1); expect(seat.top).toBeGreaterThanOrEqual(stage!.y - 1); expect(seat.right).toBeLessThanOrEqual(stage!.x + stage!.width + 1); expect(seat.bottom).toBeLessThanOrEqual(stage!.y + stage!.height + 1); }
  }
  const publicFixture = loadGameFixture('started-public-observer-full.json');
  const publicView = structuredClone(publicFixture.view); publicView.viewer.kind = 'public_spectator'; publicView.viewer.readOnly = true; publicView.private = null;
  await mounted.setFixture({ ...publicFixture, view: publicView });
  await expect(page.getByRole('region', { name: '观察玩家当前行动', exact: true }).locator('h2')).toHaveText('你正在只读观战');
  await expect(page.getByRole('button', { name: '确认提交', exact: true })).toHaveCount(0);
  const privateFixture = loadGameFixture('private-second-screen-full.json');
  const privateView = structuredClone(privateFixture.view); privateView.viewer.kind = 'private_spectator'; privateView.viewer.readOnly = true;
  await mounted.setFixture({ ...privateFixture, view: privateView });
  await expect(page.getByText(/正在观战 · 私人第二屏/)).toBeVisible();
  await expect(page.getByRole('button', { name: '当前观察身份' })).toBeVisible();
  await page.screenshot({ path: '/results/actions-layout-' + testInfo.project.name + '.png' });
  await expectNoOverflow(page);
});

test('夹具 UI 处理 rejected、丢响应查询/retry、旧窗口、新 game 清理与离线锁定', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const base = loadGameFixture();
  const mounted = await mount(page, base);
  const guard = taskFixture(base.view, 'SUBMIT_GUARD', targetSelection(base.view));
  mounted.setMode('rejected');
  await mounted.setFixture(guard);
  await page.locator('.seat-main[aria-label*="可选目标"]').first().click();
  await confirm(page);
  await expect(page.getByRole('alert')).toContainText('当前不能执行此行动');
  await expect(page.locator('.selection-summary')).toContainText('1 / 2');

  mounted.setMode('lost');
  await mounted.setFixture(guard);
  await confirm(page);
  const beforeLost = 1;
  expect(mounted.commands.length).toBe(beforeLost + 1);
  await expect(page.getByRole('button', { name: '查询结果' })).toBeVisible();
  mounted.setLookup('not_seen');
  const beforeLookup = mounted.commands.length;
  await page.getByRole('button', { name: '查询结果' }).click();
  await expect(page.getByText('暂未查询到记录')).toBeVisible();
  expect(mounted.commands.length).toBe(beforeLookup);
  await page.getByRole('button', { name: '用原目标与请求重试' }).click();
  await expect.poll(() => mounted.commands.length).toBeGreaterThan(1);

  const oldWindow = taskFixture(base.view, 'SUBMIT_GUARD', targetSelection(base.view), 'old-window');
  mounted.setMode('lost');
  await mounted.setFixture(oldWindow);
  await page.locator('.seat-main[aria-label*="可选目标"]').first().click();
  await expect(page.locator('.selection-summary')).toContainText('1 / 2');
  await confirm(page);
  await expect(page.getByText('连接中断')).toBeVisible();
  mounted.setMode('accepted');
  const newWindow = taskFixture(base.view, 'SUBMIT_GUARD', targetSelection(base.view), 'new-window');
  await mounted.setFixture(newWindow);
  await expect(page.getByText('上一窗口的')).toBeVisible();
  await expect(page.getByRole('button', { name: '查询原结果' })).toBeVisible();
  const newGame = structuredClone(newWindow.view); newGame.gameId = 'new-game-id'; newGame.private = null;
  await mounted.setFixture({ ...newWindow, view: newGame });
  await expect(page.locator('.selection-summary')).toContainText('尚未选择目标');

  const offline = { ...taskFixture(base.view, 'SUBMIT_GUARD', targetSelection(base.view)), online: false };
  await mounted.setFixture(offline);
  await expect(page.getByText('连接尚未恢复')).toBeVisible();
  await expect(page.getByRole('region', { name: '舞台行动', exact: true }).locator('button.button--primary')).toBeDisabled();
  await page.screenshot({ path: '/results/actions-outcomes-' + testInfo.project.name + '.png' });
  await expectNoOverflow(page);
});

async function expectNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
