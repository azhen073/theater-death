import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

const VOTE_WINDOW = 'fixture:day:1:election_vote';

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/view', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current.view) }));
  await page.goto('/game-test.html');
  return { set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

/**
 * 竞选投票阶段：窗口在，但本人没有投票任务（被排除或已投票）——
 * 与真实快照一致（`server/v2/snapshots.ts` 的 tasks 只由 allowedCommands 派生）。
 */
function votingFixture(): GameHarnessFixture {
  const fixture = loadGameFixture('day-election-full.json');
  fixture.view.public!.day!.election = {
    ...fixture.view.public!.day!.election!,
    phase: 'vote', candidates: [], withdrawn: [], tiedIds: [], round: 1,
  };
  fixture.view.windows = [{ id: 'election_vote', type: 'election_vote', instanceId: VOTE_WINDOW, closesAt: fixture.view.serverTime + 60_000 }];
  fixture.view.tasks = [];
  fixture.view.capabilities.allowedCommands = [];
  fixture.view.submissionState = [];
  return fixture;
}

function selfId(fixture: GameHarnessFixture): string {
  const id = fixture.view.viewer.subjectPlayerId;
  if (!id) throw new Error('夹具缺少 subjectPlayerId');
  return id;
}

// 只读视角下行动卡的 aria-label 是「观察玩家当前行动」，与正式玩家的「舞台行动」不同。
const actionCard = (page: Page) => page.getByRole('region', { name: /舞台行动|观察玩家当前行动/ });

test('候选人本人：竞选投票阶段给出候选人说明，且没有投票入口', async ({ page }) => {
  const fixture = votingFixture();
  fixture.view.public!.day!.election!.candidates = [selfId(fixture)];
  await mount(page, fixture);
  await expect(actionCard(page).locator('h2')).toHaveText('你是候选人');
  await expect(actionCard(page)).toContainText('本轮不参与投票，等待其他玩家与结算。');
  await expect(page.getByRole('button', { name: '提交天理投票' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认弃票' })).toHaveCount(0);
  await expect(page.getByTestId('stage-submit')).toHaveCount(0);
  await expect(page.getByTestId('stage-skip')).toHaveCount(0);
});

test('重投平票者：提示平票者，优先于候选人说明', async ({ page }) => {
  const fixture = votingFixture();
  const election = fixture.view.public!.day!.election!;
  election.phase = 'revote';
  election.round = 2;
  election.candidates = [selfId(fixture)];
  election.tiedIds = [selfId(fixture)];
  await mount(page, fixture);
  await expect(actionCard(page).locator('h2')).toHaveText('你是平票者');
  await expect(actionCard(page)).toContainText('重投轮不参与投票，等待结算。');
});

test('死亡与票权冻结：分别给出对应说明', async ({ page }) => {
  const dead = votingFixture();
  dead.view.private!.self.life = 'dead';
  await mount(page, dead);
  await expect(actionCard(page).locator('h2')).toHaveText('你已死亡');

  const frozen = votingFixture();
  frozen.view.private!.self.voteFrozen = true;
  await mount(page, frozen);
  await expect(actionCard(page).locator('h2')).toHaveText('票权已冻结');
});

test('已投票与已弃票：行动卡显示回执，结算后回到通用文案', async ({ page }) => {
  const voted = votingFixture();
  const target = voted.view.public!.seats[3]!;
  voted.view.submissionState = [{
    action: 'SUBMIT_ELECTION_VOTE', windowInstanceId: VOTE_WINDOW, requestId: 'fixture-receipt',
    acceptedAt: voted.view.serverTime, targets: [target.playerId], revision: null, direction: null,
  }];
  const mounted = await mount(page, voted);
  await expect(actionCard(page).locator('h2')).toHaveText(`已投给 ${target.seat}号 ${target.nickname}`);
  await expect(actionCard(page)).toContainText('不可更改，结算后公开票型。');

  const skipped = structuredClone(voted);
  skipped.view.submissionState = [{ ...voted.view.submissionState[0]!, targets: [] }];
  await mounted.set(skipped);
  await expect(actionCard(page).locator('h2')).toHaveText('已弃票');

  const settled = structuredClone(skipped);
  settled.view.public!.day!.election!.phase = 'done';
  settled.view.windows = [];
  await mounted.set(settled);
  await expect(actionCard(page).locator('h2')).toHaveText('本阶段无需操作');
  await expect(actionCard(page)).toContainText('等待其他玩家或服务端推进阶段。');
});

test('公开观众不受影响，长昵称回执在 390 宽度无横向溢出', async ({ page }) => {
  const longName = '长昵称'.repeat(20);
  const fixture = votingFixture();
  const target = fixture.view.public!.seats[3]!;
  target.nickname = longName;
  fixture.view.submissionState = [{
    action: 'SUBMIT_ELECTION_VOTE', windowInstanceId: VOTE_WINDOW, requestId: 'fixture-receipt-long',
    acceptedAt: fixture.view.serverTime, targets: [target.playerId], revision: null, direction: null,
  }];
  const mounted = await mount(page, fixture);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(actionCard(page).locator('h2')).toHaveText(`已投给 ${target.seat}号 ${longName}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const spectator = structuredClone(fixture);
  spectator.view.viewer.kind = 'public_spectator';
  spectator.view.viewer.readOnly = true;
  spectator.view.viewer.subjectPlayerId = null;
  spectator.view.private = null;
  await mounted.set(spectator);
  await expect(actionCard(page).locator('h2')).toHaveText('你正在只读观战');
});
