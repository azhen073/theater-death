import { expect, test, type Page } from '@playwright/test';
import { revealHudActions } from '../helpers-v2/rooms.ts';
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
const submitLabels: Record<CommandAction, string> = {
  SUBMIT_GUARD: '确认守护', SUBMIT_LAIKE: '确认刺杀', EDIT_PROPOSAL: '发布方案', CONFIRM_PROPOSAL: '同意方案 v3',
  SUBMIT_CHECK: '提交查验', SUBMIT_RESCUE: '确认还魂曲', SUBMIT_REVIVE: '确认回归对象', REGISTER_CANDIDACY: '报名竞选',
  WITHDRAW_CANDIDACY: '退出竞选', START_SPEECH: '提前开始发言', END_ELECTION_SPEECH: '结束竞选发言', SUBMIT_ELECTION_VOTE: '提交天理投票',
  DESIGNATE_SPEECH: '确认发言顺序', END_SPEECH: '结束发言', SUBMIT_DAY_VOTE: '提交放逐投票', END_TIE_SPEECH: '结束平票发言',
  END_LAST_WORDS: '结束遗言', SUBMIT_HANDOVER: '确认移交天理',
};

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

async function confirm(page: Page, action: CommandAction): Promise<void> {
  const button = page.getByTestId('stage-submit');
  await expect(button).toHaveAccessibleName(submitLabels[action]);
  await button.click();
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
    await confirm(page, action);
    await expect.poll(() => mounted.commands.length).toBe(before + 1);
    const sent = mounted.commands.at(-1)!;
    expect(sent).toMatchObject({ action, gameId: next.view.gameId, windowInstanceId: next.view.tasks[0]!.windowInstanceId });
    expect(sent).not.toHaveProperty('playerId');
    if (targetActions.has(action)) expect(sent.targets).toHaveLength(1); else expect(sent).not.toHaveProperty('targets');
    if (action === 'CONFIRM_PROPOSAL') expect(sent.revision).toBe(3); else expect(sent).not.toHaveProperty('revision');
    if (action === 'DESIGNATE_SPEECH') expect(sent.direction).toBe('asc'); else expect(sent).not.toHaveProperty('direction');
    await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('已提交');
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
  const beforeEmpty = mounted.commands.length;
  await expect(page.getByTestId('stage-skip')).toHaveAccessibleName('确认空守');
  await page.getByTestId('stage-skip').click();
  await expect.poll(() => mounted.commands.length).toBe(beforeEmpty + 1);
  expect(mounted.commands.at(-1)).toMatchObject({ action: 'SUBMIT_GUARD', targets: [] });
  await expect(page.locator('.selection-summary')).toContainText('尚未选择目标');

  const clearFixture = taskFixture(base.view, 'SUBMIT_GUARD', targetSelection(base.view), 'clear-selection-window');
  await mounted.setFixture(clearFixture);
  await page.locator('.seat-main[aria-label*="可选目标"]').nth(0).click();
  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认空守', exact: true })).toBeVisible();
  await page.locator('.seat-main[aria-label*="可选目标"]').nth(0).click();
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('确认守护');
  await expect(page.getByTestId('stage-submit')).toBeEnabled();

  const repeated = taskFixture(base.view, 'SUBMIT_LAIKE', targetSelection(base.view, { maxTargets: 3, allowRepeated: true }));
  await mounted.setFixture(repeated);
  await page.locator('.seat-main[aria-label*="可选目标"]').nth(0).click();
  await page.locator('.seat-main[aria-label*="可选目标"]').nth(1).click();
  await expect(page.locator('.selection-summary')).toContainText('2 / 3');
  // 夜间与白天同一套色：selected-only 也必须是浅蓝实线（2026-09-27 按用户裁定整体调浅，此前夜间被覆盖成淡蓝 #9bbfff，与图例不符）
  const nightSelected = page.locator('.stage-seat--selected:not(.stage-seat--draft) .seat-main').first();
  await expect(nightSelected).toHaveCSS('border-top-style', 'solid');
  await expect(nightSelected).toHaveCSS('border-top-color', 'rgb(125, 144, 171)');
  await expect(nightSelected).toHaveCSS('background-color', 'rgb(243, 247, 252)');
  // 选择提示改为加粗正文（各目标类行动共用），文案说明"点击＝选中/取消"
  const hint = page.locator('.stage-action-card .action-hint');
  await expect(hint).toHaveText(/点击舞台上的可选玩家进行选中 \/ 取消选中/);
  await expect(hint).toHaveCSS('font-weight', '700');
  // 重复目标已废止：不再有加减按钮，再点同一座位即取消选中
  await expect(page.getByRole('button', { name: /增加.*目标次数/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /减少.*目标次数/ })).toHaveCount(0);
  await page.locator('.seat-main[aria-label*="可选目标"]').nth(1).click();
  await expect(page.locator('.selection-summary')).toContainText('1 / 3');

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
  await revealHudActions(page); await expect(page.getByRole('button', { name: '当前观察身份' })).toBeVisible();
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
  await confirm(page, 'SUBMIT_GUARD');
  await expect(page.getByRole('alert')).toContainText('当前不能执行此行动');
  await expect(page.locator('.selection-summary')).toContainText('1 / 2');

  mounted.setMode('lost');
  await mounted.setFixture(guard);
  await confirm(page, 'SUBMIT_GUARD');
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
  await confirm(page, 'SUBMIT_GUARD');
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

test('团队方案支持一次发布并本人确认，同时保留队友逐版确认', async ({ page }) => {
  const base = loadGameFixture('night-spirit-full.json');
  const view = structuredClone(base.view);
  const windowInstanceId = 'fixture:combined-proposal';
  const selection = targetSelection(view, { maxTargets: 2, allowRepeated: true });
  const edit = { action: 'EDIT_PROPOSAL' as const, windowInstanceId, closesAt: view.serverTime + 60_000, targets: selection };
  const confirmTask = { action: 'CONFIRM_PROPOSAL' as const, windowInstanceId, closesAt: edit.closesAt, targets: null };
  const guardTask = { action: 'SUBMIT_GUARD' as const, windowInstanceId: 'fixture:combined-guard', closesAt: edit.closesAt, targets: selection };
  const firstTarget = selection.playerIds[0]!;
  view.tasks = [edit, confirmTask, guardTask];
  view.windows = [{ id: 'faction', type: 'faction', instanceId: windowInstanceId, closesAt: edit.closesAt },
    { id: 'guard', type: 'guard', instanceId: guardTask.windowInstanceId, closesAt: guardTask.closesAt }];
  view.capabilities.allowedCommands = ['EDIT_PROPOSAL', 'CONFIRM_PROPOSAL', 'SUBMIT_GUARD'];
  view.capabilities.supportsProposalEditConfirmation = true;
  view.private!.proposal = {
    pool: 'spirit', activeMemberIds: [view.private!.self.playerId, 'fixture-teammate'], revision: 2,
    targetPlayerIds: [firstTarget], confirmedBy: [], locked: false,
    effective: { revision: 2, targetPlayerIds: [firstTarget], basis: 'latest_legal' },
  };
  const mounted = await mount(page, { ...base, view });
  const region = page.getByRole('region', { name: '舞台行动', exact: true });
  await expect(region.locator('h2')).toHaveText('团队攻击');
  await expect(region.getByRole('group', { name: '可用任务' }).getByRole('button', { name: '团队攻击', exact: true })).toHaveCount(1);
  await expect(region.getByRole('button', { name: '确认团队方案', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('同意方案 v2');
  await expect(page.getByTestId('stage-skip')).toHaveCount(0); // 单按钮：空刀不再与方案并列
  // 草稿目标（队友/已发布版本）用青色虚线 +「草稿」角标区分于「我的选择」，并在方案面板给出图例
  const draftSeat = page.locator(`.stage-seat[data-player-id="${firstTarget}"]`);
  await expect(draftSeat).toHaveClass(/stage-seat--draft/);
  await expect(draftSeat).toHaveClass(/stage-seat--selected/);
  await expect(draftSeat.locator('.seat-draft')).toHaveText('草稿');
  await expect(draftSeat.locator('.seat-main')).toHaveAttribute('aria-label', /在队伍草稿中/);
  await expect(region.getByRole('region', { name: '团队方案' })).toContainText('当前草稿目标');
  // 重合座位：保持我的浅蓝实线，外圈补青色环（草稿身份由角标与环体现）
  await expect(draftSeat.locator('.seat-main')).toHaveCSS('border-top-style', 'solid');
  await expect(draftSeat.locator('.seat-main')).toHaveCSS('border-top-color', 'rgb(125, 144, 171)');
  await expect(draftSeat.locator('.seat-main')).toHaveCSS('box-shadow', /106, 172, 184/);
  await page.getByTestId('stage-submit').click();
  await expect.poll(() => mounted.commands.length).toBe(1);
  expect(mounted.commands[0]).toMatchObject({ action: 'CONFIRM_PROPOSAL', revision: 2 });
  expect(mounted.commands[0]).not.toHaveProperty('confirmSelf');

  const confirmed = structuredClone(view);
  confirmed.viewVersion += 1;
  confirmed.private!.proposal!.confirmedBy = [confirmed.private!.self.playerId];
  confirmed.submissionState = [{ action: 'CONFIRM_PROPOSAL', windowInstanceId, requestId: mounted.commands[0]!.requestId,
    acceptedAt: confirmed.serverTime, targets: [], revision: 2, direction: null }];
  await mounted.setFixture({ ...base, view: confirmed });
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('已同意 v2');
  await expect(page.getByTestId('stage-submit')).toBeDisabled();

  await page.locator('.seat-main[aria-label*="可选目标"]').nth(1).click();
  // 新选中的座位是我的选择（不是草稿目标）；草稿目标仍只有一个，重合座位同时具备两种类
  await expect(page.locator('.stage-seat--selected')).toHaveCount(2);
  await expect(page.locator('.stage-seat--draft')).toHaveCount(1);
  await expect(page.locator('.stage-seat--selected.stage-seat--draft')).toHaveCount(1);
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('发布并确认方案');
  await page.getByTestId('stage-submit').click();
  await expect.poll(() => mounted.commands.length).toBe(2);
  expect(mounted.commands[1]).toMatchObject({ action: 'EDIT_PROPOSAL', confirmSelf: true, expectedRevision: 2 });
  expect(mounted.commands[1]!.targets.length).toBeGreaterThan(0);
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('方案已提交，正在同步');
  await expect(page.getByTestId('stage-submit')).toBeDisabled();

  const legacy = structuredClone(view);
  legacy.viewVersion += 10;
  legacy.capabilities.supportsProposalEditConfirmation = false;
  legacy.tasks = legacy.tasks.map(item => ({ ...item, windowInstanceId: 'fixture:legacy-proposal' }));
  legacy.windows = [{ id: 'faction', type: 'faction', instanceId: 'fixture:legacy-proposal', closesAt: edit.closesAt }];
  legacy.submissionState = [];
  await mounted.setFixture({ ...base, view: legacy });
  await expect(page.getByRole('group', { name: '可用任务' })).toBeVisible();
  await expect(page.getByRole('button', { name: '拟定攻击方案', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认团队方案', exact: true })).toBeVisible();
});

test('团队方案生效文案：全票 / 最后合法草稿 / 空刀草稿 / 无草稿四种状态各自说清', async ({ page }) => {
  const base = loadGameFixture('night-spirit-full.json');
  const view = structuredClone(base.view);
  const windowInstanceId = 'fixture:effective-copy';
  const selection = targetSelection(view, { maxTargets: 2, allowRepeated: true });
  view.tasks = [
    { action: 'EDIT_PROPOSAL', windowInstanceId, closesAt: view.serverTime + 60_000, targets: selection },
    { action: 'CONFIRM_PROPOSAL', windowInstanceId, closesAt: view.serverTime + 60_000, targets: null },
  ];
  view.windows = [{ id: 'faction', type: 'faction', instanceId: windowInstanceId, closesAt: view.serverTime + 60_000 }];
  view.capabilities.allowedCommands = ['EDIT_PROPOSAL', 'CONFIRM_PROPOSAL'];
  view.capabilities.supportsProposalEditConfirmation = true;
  view.private!.proposal = {
    pool: 'spirit', activeMemberIds: [view.private!.self.playerId, 'fixture-teammate'], revision: 3,
    targetPlayerIds: [selection.playerIds[1]!], confirmedBy: [], locked: true,
    effective: { revision: 2, targetPlayerIds: [selection.playerIds[0]!], basis: 'unanimous' },
  };
  const mounted = await mount(page, { ...base, view });
  const effective = page.locator('.effective-proposal');
  // ① 全票版本优先于之后更新的未确认草稿：标题不再写"此刻…会执行"，依据说清是"全队已确认"
  await expect(effective).toContainText('窗口截止将采用');
  await expect(effective).toContainText('v2 ·');
  await expect(effective).toContainText('全队已确认这一版');
  await expect(effective).toHaveAttribute('title', /以服务端结算为准/);

  // ② 没有全票版本 → 采用最后一份由在场成员提交的草稿
  const latest = structuredClone(view);
  latest.viewVersion += 1;
  latest.private!.proposal = {
    ...view.private!.proposal, revision: 3, targetPlayerIds: [selection.playerIds[1]!], confirmedBy: [], locked: false,
    effective: { revision: 3, targetPlayerIds: [selection.playerIds[1]!], basis: 'latest_legal' },
  };
  await mounted.setFixture({ ...base, view: latest });
  await expect(effective).toContainText('v3 ·');
  await expect(effective).toContainText('没有全票版本，采用最后一份由在场成员提交的草稿');

  // ③ 最后合法草稿本身是空刀 → 必须说"空刀"，不能显示成"空选择"（引擎允许空目标草稿）
  const emptyDraft = structuredClone(view);
  emptyDraft.viewVersion += 3;
  emptyDraft.private!.proposal = {
    ...view.private!.proposal, revision: 3, targetPlayerIds: [], confirmedBy: [], locked: false,
    effective: { revision: 3, targetPlayerIds: [], basis: 'latest_legal' },
  };
  await mounted.setFixture({ ...base, view: emptyDraft });
  await expect(effective).toContainText('v3 · 空刀（今晚不出刀）');
  await expect(effective).not.toContainText('空选择');
  // 草稿行同口径：最新草稿 v3：空刀（不是"空选择"，也不是"尚无草稿"）
  const draftLine = page.getByRole('region', { name: '团队方案' }).locator('p').first();
  await expect(draftLine).toHaveText('最新草稿 v3：空刀');

  // ④ 没有任何可采用的草稿 → 空刀
  const empty = structuredClone(view);
  empty.viewVersion += 5;
  empty.private!.proposal = {
    ...view.private!.proposal, revision: 0, targetPlayerIds: [], confirmedBy: [], locked: false,
    effective: { revision: null, targetPlayerIds: [], basis: 'empty' },
  };
  await mounted.setFixture({ ...base, view: empty });
  await expect(effective).toContainText('当前无草稿（空刀）');
  await expect(effective).toContainText('没有可采用的草稿，按空刀处理（今晚不出刀）');
  // v0 是"尚无草稿"，与"空刀草稿"仍是两件事
  await expect(draftLine).toHaveText('最新草稿 v0：尚无草稿');
});

test('团队方案非空时改为先清空选择、再由同一个按钮发布空刀（单按钮，不误确认当前目标）', async ({ page }) => {
  const base = loadGameFixture('night-spirit-full.json');
  const view = structuredClone(base.view);
  const windowInstanceId = 'fixture:combined-empty';
  const selection = targetSelection(view, { maxTargets: 2, allowRepeated: true });
  view.tasks = [
    { action: 'EDIT_PROPOSAL', windowInstanceId, closesAt: view.serverTime + 60_000, targets: selection },
    { action: 'CONFIRM_PROPOSAL', windowInstanceId, closesAt: view.serverTime + 60_000, targets: null },
  ];
  view.windows = [{ id: 'faction', type: 'faction', instanceId: windowInstanceId, closesAt: view.serverTime + 60_000 }];
  view.capabilities.allowedCommands = ['EDIT_PROPOSAL', 'CONFIRM_PROPOSAL'];
  view.capabilities.supportsProposalEditConfirmation = true;
  view.private!.proposal = { pool: 'spirit', activeMemberIds: [view.private!.self.playerId, 'fixture-teammate'],
    revision: 4, targetPlayerIds: [selection.playerIds[0]!], confirmedBy: [], locked: false,
    effective: { revision: 4, targetPlayerIds: [selection.playerIds[0]!], basis: 'latest_legal' } };
  const mounted = await mount(page, { ...base, view });

  // 草稿未改：只剩一个「同意方案 v4」，空刀不再是并列按钮
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('同意方案 v4');
  await expect(page.getByTestId('stage-skip')).toHaveCount(0);

  // 清空本地选择后，同一个按钮改为发布空刀（而不是误确认队友的方案）
  await page.getByRole('button', { name: '清空选择' }).click();
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('发布并确认空刀');
  await expect(page.locator('.stage-seat--selected')).toHaveCount(0);
  // 只剩草稿目标时用青色虚线区分
  await expect(page.locator('.stage-seat--draft .seat-main')).toHaveCSS('border-top-style', 'dashed');
  await expect(page.locator('.stage-seat--draft .seat-main')).toHaveCSS('border-top-color', 'rgb(106, 172, 184)');
  await page.getByTestId('stage-submit').click();
  await expect.poll(() => mounted.commands.length).toBe(1);
  expect(mounted.commands[0]).toMatchObject({ action: 'EDIT_PROPOSAL', targets: [], confirmSelf: true, expectedRevision: 4 });
  expect(mounted.commands[0]).not.toHaveProperty('revision');

  // v0 无草稿：单按钮即空刀（原先两个按钮载荷相同）
  const freshWindow = 'fixture:combined-empty-fresh';
  const fresh = structuredClone(view);
  fresh.viewVersion += 5;
  fresh.tasks = [
    { action: 'EDIT_PROPOSAL', windowInstanceId: freshWindow, closesAt: view.serverTime + 60_000, targets: selection },
    { action: 'CONFIRM_PROPOSAL', windowInstanceId: freshWindow, closesAt: view.serverTime + 60_000, targets: null },
  ];
  fresh.windows = [{ id: 'faction', type: 'faction', instanceId: freshWindow, closesAt: view.serverTime + 60_000 }];
  fresh.submissionState = [];
  fresh.private!.proposal = { ...view.private!.proposal, revision: 0, targetPlayerIds: [], confirmedBy: [], effective: { revision: null, targetPlayerIds: [], basis: 'empty' } };
  await mounted.setFixture({ ...base, view: fresh });
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('发布并确认空刀');
  await expect(page.getByTestId('stage-skip')).toHaveCount(0);
});

test('旧快照A与accepted B只采用一份提交依据，A可显式重提且更高版本C覆盖旧B回执', async ({ page }) => {
  const base = loadGameFixture();
  const ids = alivePlayers(base.view).slice(0, 3);
  const single = targetSelection(base.view, { playerIds: ids, maxTargets: 1, canSkip: false });
  const initial = taskFixture(base.view, 'SUBMIT_GUARD', single, 'submission-evidence-window');
  initial.view.viewVersion = 10;
  initial.view.submissionState = [{
    action: 'SUBMIT_GUARD', windowInstanceId: initial.view.tasks[0]!.windowInstanceId,
    targets: [ids[0]!], revision: null, direction: null, requestId: 'snapshot-A', acceptedAt: 1,
  }];
  const mounted = await mount(page, initial);
  const seat = (id: string) => page.locator(`.stage-seat[data-player-id="${id}"] .seat-main`);

  await seat(ids[1]!).click();
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('更新守护');
  await page.getByTestId('stage-submit').click();
  await expect.poll(() => mounted.commands.length).toBe(1);
  const acceptedB = mounted.commands[0]!;
  expect(acceptedB.targets).toEqual([ids[1]]);

  await seat(ids[0]!).click();
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('更新守护');
  await expect(page.getByTestId('stage-submit')).toBeEnabled();
  await page.getByTestId('stage-submit').click();
  await expect.poll(() => mounted.commands.length).toBe(2);
  expect(mounted.commands[1]!.targets).toEqual([ids[0]]);

  const nextWindow = taskFixture(base.view, 'SUBMIT_GUARD', single, 'submission-evidence-window-2');
  nextWindow.view.viewVersion = 20;
  nextWindow.view.submissionState = [{
    action: 'SUBMIT_GUARD', windowInstanceId: nextWindow.view.tasks[0]!.windowInstanceId,
    targets: [ids[0]!], revision: null, direction: null, requestId: 'snapshot-A2', acceptedAt: 2,
  }];
  await mounted.setFixture(nextWindow);
  await seat(ids[1]!).click();
  await page.getByTestId('stage-submit').click();
  await expect.poll(() => mounted.commands.length).toBe(3);
  const secondB = mounted.commands[2]!;

  const alignedB = structuredClone(nextWindow);
  alignedB.view.viewVersion = 21;
  alignedB.view.submissionState = [{
    action: 'SUBMIT_GUARD', windowInstanceId: alignedB.view.tasks[0]!.windowInstanceId,
    targets: [ids[1]!], revision: null, direction: null, requestId: String(secondB.requestId), acceptedAt: 3,
  }];
  await mounted.setFixture(alignedB);
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('已提交');
  await expect(page.getByTestId('stage-submit')).toBeDisabled();

  const newerC = structuredClone(alignedB);
  newerC.view.viewVersion = 22;
  newerC.view.submissionState = [{
    action: 'SUBMIT_GUARD', windowInstanceId: newerC.view.tasks[0]!.windowInstanceId,
    targets: [ids[2]!], revision: null, direction: null, requestId: 'snapshot-C', acceptedAt: 4,
  }];
  await mounted.setFixture(newerC);
  await expect(page.getByTestId('stage-submit')).toHaveAccessibleName('更新守护');
  await expect(page.getByTestId('stage-submit')).toBeEnabled();
});

test('unknown请求截止及任务消失后仍可查询原结果且不能重试', async ({ page }) => {
  const base = loadGameFixture();
  const guard = taskFixture(base.view, 'SUBMIT_GUARD', targetSelection(base.view, { maxTargets: 1 }), 'expiry-recovery-window');
  const mounted = await mount(page, guard);
  mounted.setMode('lost');
  await page.locator('.seat-main[aria-label*="可选目标"]').first().click();
  await confirm(page, 'SUBMIT_GUARD');
  await expect(page.getByRole('button', { name: '查询结果' })).toBeVisible();

  const expired = structuredClone(guard);
  expired.view.tasks[0]!.closesAt = expired.view.serverTime - 1;
  expired.view.windows[0]!.closesAt = expired.view.serverTime - 1;
  await mounted.setFixture(expired);
  await expect(page.getByText('时间已到')).toBeVisible();
  await expect(page.getByRole('button', { name: '查询结果' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '用原目标与请求重试' })).toHaveCount(0);

  const removed = structuredClone(expired);
  removed.view.tasks = [];
  removed.view.windows = [];
  await mounted.setFixture(removed);
  await expect(page.getByText('上一窗口的')).toBeVisible();
  await expect(page.getByRole('button', { name: '查询原结果' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '用原目标与请求重试' })).toHaveCount(0);
});

async function expectNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
