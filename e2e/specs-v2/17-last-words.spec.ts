import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

/**
 * 遗言界面链路（R-45）：首夜出局者在自己的遗言窗口里能结束遗言、能发公屏；
 * 其他人（活人旁观者 / 另一名死者）既没有「结束遗言」，也不能替遗言者发言。
 *
 * 麦克风许可（canPublishVoice）在夹具里没有可断言的界面（VoiceBar 挂在 app shell，
 * 「开启麦克风」需要真实语音连接才会出现），因此该维度由 tests/capabilities.test.ts
 * 的「遗言者可发公屏和开麦，其他人不能代发」覆盖服务端权限，E2E 语音链路由 16-voice 覆盖。
 */

const LAST_WORDS_WINDOW = 'last_words';

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  const chats: Array<Record<string, unknown>> = [];
  const commands: Array<Record<string, unknown>> = [];
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/view', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current.view) }));
  await page.route('**/api/v2/rooms/*/command', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    commands.push(structuredClone(body));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: body.requestId, status: 'accepted', code: null, message: null }) });
  });
  await page.route('**/api/v2/rooms/*/chat', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    chats.push(structuredClone(body));
    const senderId = current.view.viewer.subjectPlayerId!;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ gameId: body.gameId, channel: body.channel, message: { messageId: 'server-' + chats.length, clientMessageId: body.clientMessageId, cursor: 900 + chats.length, senderId, text: body.text, at: 1000 } }) });
  });
  await page.goto('/game-test.html');
  await expect(page.getByRole('region', { name: '舞台行动', exact: true })).toBeVisible();
  return {
    chats,
    commands,
    setFixture: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); },
  };
}

type Viewer = 'speaker' | 'otherDead' | 'otherAlive';

/** 首夜遗言窗口：queue[0] 是遗言者；观察者身份由 Viewer 决定。 */
function lastWordsFixture(viewer: Viewer): { fixture: GameHarnessFixture; windowInstanceId: string; speakerId: string } {
  const base = loadGameFixture('day-election-full.json');
  const view = structuredClone(base.view);
  const selfId = view.viewer.subjectPlayerId!;
  const speakerId = viewer === 'speaker' ? selfId : view.public!.seats.map(seat => seat.playerId).find(id => id !== selfId)!;
  const selfAlive = viewer === 'otherAlive';
  const windowInstanceId = `${view.gameId}:day:1:${LAST_WORDS_WINDOW}`;
  const closesAt = view.serverTime + 60_000;

  view.room.phase = 'playing';
  view.public!.day = { ...view.public!.day!, step: 'first_night_last_words', lastWords: { queue: [speakerId], index: 0 } };
  view.public!.seats = view.public!.seats.map(seat =>
    seat.playerId === speakerId ? { ...seat, alive: false } : seat.playerId === selfId ? { ...seat, alive: selfAlive } : seat);
  view.private!.self = { ...view.private!.self, life: selfAlive ? 'alive' : 'dead' };

  view.capabilities.canPostPublic = selfAlive || viewer === 'speaker';
  view.capabilities.canPublishVoice = viewer === 'speaker';
  view.capabilities.allowedCommands = viewer === 'speaker' ? ['END_LAST_WORDS'] : [];
  view.capabilities.commandReasons = { ...view.capabilities.commandReasons, END_LAST_WORDS: viewer === 'speaker' ? null : 'action_unavailable' };
  view.tasks = viewer === 'speaker' ? [{ action: 'END_LAST_WORDS', windowInstanceId, closesAt, targets: null }] : [];
  view.windows = viewer === 'speaker' ? [{ id: LAST_WORDS_WINDOW, type: LAST_WORDS_WINDOW, instanceId: windowInstanceId, closesAt }] : [];
  return { fixture: { ...base, view }, windowInstanceId, speakerId };
}

test('首夜遗言：遗言者看到并点击「结束遗言」，同时可发公屏', async ({ page }, testInfo) => {
  const { fixture, windowInstanceId } = lastWordsFixture('speaker');
  const mounted = await mount(page, fixture);
  const region = page.getByRole('region', { name: '舞台行动', exact: true });

  await expect(region.locator('h2')).toHaveText('结束遗言');
  await expect(page.locator('.selection-summary')).toHaveCount(0);
  const submit = page.getByTestId('stage-submit');
  await expect(submit).toHaveAccessibleName('结束遗言');
  await expect(submit).toBeEnabled();

  const publicInput = page.getByLabel('公屏消息');
  await expect(publicInput).toBeVisible();
  await expect(publicInput).toBeEnabled();
  await publicInput.fill('首夜遗言：请关注 3 号');
  await expect(page.getByRole('button', { name: '发送公屏消息' })).toBeEnabled();
  await page.screenshot({ path: '/results/last-words-speaker-' + testInfo.project.name + '.png' });

  await publicInput.press('Enter');
  await expect.poll(() => mounted.chats.length).toBe(1);
  expect(mounted.chats[0]).toMatchObject({ channel: 'public', text: '首夜遗言：请关注 3 号' });

  await expect(page.getByRole('button', { name: '使用还魂曲', exact: true })).toHaveCount(0);
  const before = mounted.commands.length;
  await submit.click();
  await expect.poll(() => mounted.commands.length).toBe(before + 1);
  const sent = mounted.commands.at(-1)!;
  expect(sent).toMatchObject({ action: 'END_LAST_WORDS', windowInstanceId });
  expect(sent.targets ?? []).toEqual([]);
  expect(sent).not.toHaveProperty('confirmSelf');
  expect(sent).not.toHaveProperty('expectedRevision');
});

test('首夜遗言：其他玩家没有「结束遗言」，也不会替他发言', async ({ page }, testInfo) => {
  const mounted = await mount(page, lastWordsFixture('otherAlive').fixture);

  // 活人旁观者：白天仍可发公屏（R-35），但没有遗言类行动。
  await expect(page.getByRole('button', { name: '结束遗言', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('stage-submit')).toHaveCount(0);
  const aliveInput = page.getByLabel('公屏消息');
  await expect(aliveInput).toBeVisible();
  await expect(aliveInput).toBeEnabled();
  await aliveInput.fill('白天公屏');
  await aliveInput.press('Enter');
  await expect.poll(() => mounted.chats.length).toBe(1);

  // 另一名死者：既没有遗言行动，也没有公屏发送权（R-35 只放开发送权给当前遗言者）。
  await mounted.setFixture(lastWordsFixture('otherDead').fixture);
  await expect(page.getByRole('button', { name: '结束遗言', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('stage-submit')).toHaveCount(0);
  const deadInput = page.getByLabel('公屏消息');
  await expect(deadInput).toBeVisible();
  await expect(deadInput).toBeDisabled();
  await expect(page.getByRole('button', { name: '发送公屏消息' })).toBeDisabled();
  await expect(page.getByText('当前频道仅可阅读，发送权限以当前阶段授权为准。')).toBeVisible();
  await page.screenshot({ path: '/results/last-words-observer-' + testInfo.project.name + '.png' });

  expect(mounted.commands).toEqual([]);
  expect(mounted.chats.length).toBe(1);
});
