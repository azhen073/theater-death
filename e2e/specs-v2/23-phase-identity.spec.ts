import { expect, test, type Page } from '@playwright/test';
import { loadGameFixture, pushFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

async function mount(page: Page, fixture: GameHarnessFixture) {
  let current = fixture;
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.goto('/game-test.html');
  await expect(page.getByRole('heading', { name: /夜幕降临|晨间公告/ })).toBeVisible();
  return { set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

const cases = [
  ['laike', 'R-15', '整局一次夜间刺杀', '两个分支不叠加'],
  ['door', 'R-16–R-19、R-49', '自身牺牲', '取消双守成功的自我牺牲'],
  ['water', 'R-20–R-23', '当夜濒死者', '白天出局及一阶段夜死不能补触发'],
  ['descender', 'R-24', '是否为魂灵', '不再获得濒死名单'],
  ['researcher', 'R-25、R-50', '触发阶段转换', '不刷新整局一次的公告'],
  ['civilian', 'R-03、R-26', '没有特殊技能', '没有新增特殊技能'],
  ['death', 'R-27–R-29、R-52', '独立每夜最多袭击两人', '已死则只读'],
  ['spirit', 'R-29、R-30、R-47', '上限等于存活魂灵人数', '联合每夜最多两个攻击名额'],
  ['mourner', 'R-31', '永不进入阵营房', '人类获胜不要求淘汰丧亲者'],
] as const;

test('九身份两阶段均显示可追溯规则摘要，并随公开阶段实时更新', async ({ page }) => {
  const fixture = loadGameFixture('night-door-full.json');
  fixture.identityReveal = 'seen';
  const mounted = await mount(page, fixture);
  await page.getByRole('button', { name: '我的身份' }).click();
  const panel = page.getByRole('region', { name: '当前阶段身份能力' });
  for (const [roleId, clauses, first, second] of cases) {
    for (const [stage, text] of [[1, first], [2, second]] as const) {
      const next = structuredClone(fixture);
      next.identityReveal = 'seen';
      next.view.viewVersion += stage;
      next.view.public!.stage = stage;
      next.view.private!.self.roleId = roleId;
      await mounted.set(next);
      await expect(panel).toContainText(`第 ${stage} 阶段 · 身份能力说明`);
      await expect(panel).toContainText(text);
      await expect(panel).toContainText(clauses);
      await expect(panel).toContainText(`第 ${stage === 1 ? 2 : 1} 阶段说明（非当前阶段）`);
    }
  }
});

test('生死与已用状态不冒充能力可用，边界以服务端舞台任务为准', async ({ page }) => {
  const fixture = loadGameFixture('night-door-full.json');
  fixture.identityReveal = 'seen';
  fixture.view.private!.self.roleId = 'laike';
  fixture.view.private!.self.life = 'dead';
  fixture.view.private!.self.abilities.laikeBladeUsed = true;
  fixture.view.tasks = [];
  await mount(page, fixture);
  await page.getByRole('button', { name: '我的身份' }).click();
  const panel = page.getByRole('region', { name: '当前阶段身份能力' });
  await expect(panel).toContainText('不代表此刻可行动');
  await expect(panel).toContainText('生死、技能次数和当前操作以服务端下发的舞台任务为准');
  await expect(page.getByRole('dialog')).toContainText('已使用过');
});

test('公开观众和错配subject没有私人能力面板，私人第二屏标明观察视角', async ({ page }) => {
  const spectator = loadGameFixture('night-door-full.json');
  spectator.identityReveal = 'seen';
  spectator.view.viewer.kind = 'public_spectator'; spectator.view.viewer.readOnly = true; spectator.view.viewer.subjectPlayerId = null;
  spectator.view.private = null;
  const mounted = await mount(page, spectator);
  await page.getByRole('tab', { name: '情报' }).click();
  await expect(page.getByText('公开观众没有私人情报或个人角色。')).toBeVisible();
  await expect(page.getByRole('region', { name: '当前阶段身份能力' })).toHaveCount(0);

  const mismatch = loadGameFixture('night-door-full.json'); mismatch.identityReveal = 'seen';
  mismatch.view.viewer.subjectPlayerId = mismatch.view.public!.seats.find(seat => seat.playerId !== mismatch.view.private!.self.playerId)!.playerId;
  await mounted.set(mismatch);
  await page.getByRole('tab', { name: '情报' }).click();
  await expect(page.getByRole('region', { name: '当前阶段身份能力' })).toHaveCount(0);

  const observed = loadGameFixture('private-second-screen-full.json'); observed.identityReveal = 'seen';
  await mounted.set(observed);
  await page.getByRole('button', { name: '当前观察身份' }).click();
  await expect(page.getByRole('region', { name: '当前阶段身份能力' })).toContainText('当前观察视角');
});

test('减少动画与390移动视口下能力说明可读且无横向溢出', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = loadGameFixture('night-door-full.json'); fixture.identityReveal = 'seen';
  await mount(page, fixture);
  await page.getByRole('button', { name: '我的身份' }).click();
  await expect(page.getByRole('region', { name: '当前阶段身份能力' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('true');
});

test('留存二阶段降临者在情报面板与我的身份中的390和1440截图', async ({ page }, testInfo) => {
  const fixture = loadGameFixture('night-door-full.json');
  fixture.identityReveal = 'seen';
  fixture.view.public!.stage = 2;
  fixture.view.private!.self.roleId = 'descender';
  await mount(page, fixture);

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.getByRole('tab', { name: '情报' }).click();
    const panel = page.getByRole('region', { name: '当前阶段身份能力' });
    await expect(panel).toContainText('第 2 阶段 · 身份能力说明');
    await expect(panel).toContainText('降临者');
    await expect(panel).toContainText('不再获得濒死名单');
    await page.screenshot({ path: `/results/phase-identity-intel-descender-stage2-${width}-${testInfo.project.name}.png`, fullPage: true });

    await page.getByRole('button', { name: '查看我的身份' }).click();
    const dialog = page.getByRole('dialog', { name: '我的身份' });
    await expect(dialog).toContainText('降临者');
    await expect(dialog.getByRole('region', { name: '当前阶段身份能力' })).toContainText('第 2 阶段 · 身份能力说明');
    await page.screenshot({ path: `/results/phase-identity-my-role-descender-stage2-${width}-${testInfo.project.name}.png`, fullPage: true });
    await dialog.getByRole('button', { name: '关闭' }).click();
  }
});
