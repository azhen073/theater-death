import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { alivePlayers, loadGameFixture, pushFixture, taskFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';
import { revealHudActions } from '../helpers-v2/rooms.ts';

const storageKey = 'theater-death-display-v1';

async function mount(page: Page, fixture = loadGameFixture()) {
  let current = fixture;
  await page.route('**/__game-fixture', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
  await page.route('**/api/v2/rooms/*/view', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current.view) }));
  await page.goto('/game-test.html');
  await expect(page.locator('.theater-stage')).toBeVisible();
  return { set: async (next: GameHarnessFixture) => { current = next; await pushFixture(page, next); } };
}

async function openSettings(page: Page) {
  await revealHudActions(page);
  await page.getByRole('button', { name: '导航', exact: true }).click();
  await page.getByRole('dialog', { name: '剧院导航' }).getByRole('button', { name: '显示设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '显示设置', exact: true });
  await expect(dialog.getByLabel('界面主题', { exact: true })).toBeVisible();
  return dialog;
}

async function expectTheme(page: Page, theme: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  // 属性更新与样式重算不是同一时刻；必须等到真实配色生效，再采集后续比较值。
  await expect(page.locator('html')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(20, 17, 24)' : 'rgb(237, 240, 243)');
}

test('界面主题通过设置切换：跟随系统实时变化，手动浅色与深色覆盖系统', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await mount(page);
  const dialog = await openSettings(page);
  const theme = dialog.getByLabel('界面主题', { exact: true });
  await expect(theme).toHaveValue('system');
  await expectTheme(page, 'light');
  const lightBackground = await page.locator('html').evaluate(node => getComputedStyle(node).backgroundColor);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark');
  await expect(theme).toHaveValue('system');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  const darkBackground = await page.locator('html').evaluate(node => getComputedStyle(node).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);

  await theme.selectOption('light');
  await expectTheme(page, 'light');
  await expect(page.locator('html')).toHaveCSS('background-color', lightBackground);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'light');
  await expect(theme).toHaveValue('light');
  await page.screenshot({ path: `/results/theme-settings-light-${testInfo.project.name}.png`, fullPage: true });

  await theme.selectOption('dark');
  await expectTheme(page, 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'dark');
  await expect(theme).toHaveValue('dark');
  await expect(page.locator('html')).toHaveCSS('background-color', darkBackground);
  await page.screenshot({ path: `/results/theme-settings-dark-${testInfo.project.name}.png`, fullPage: true });

  await theme.selectOption('system');
  await expectTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light');
});

test('旧显示偏好迁移保留原设置，刷新及玩家与管理员登录页沿用主题', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const fixture = loadGameFixture();
  await mount(page, fixture);
  const oldPreferences = { motion: 'reduced', deathEffects: false, scale: 110, stageBrightness: 86, voiceOutput: 42 };
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: oldPreferences });
  await page.reload();
  const dialog = await openSettings(page);
  await expect(dialog.getByLabel('界面主题', { exact: true })).toHaveValue('system');
  await expectTheme(page, 'dark');
  await expect(dialog.getByLabel('动画偏好', { exact: true })).toHaveValue('reduced');
  await expect(dialog.getByLabel('界面缩放', { exact: true })).toHaveValue('110');
  await expect(dialog.getByRole('checkbox', { name: '死亡特效', exact: true })).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--stage-brightness'))).toBe('0.86');

  await dialog.getByLabel('界面主题', { exact: true }).selectOption('light');
  await expectTheme(page, 'light');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), storageKey)).toMatchObject({ ...oldPreferences, theme: 'light' });
  await page.reload();
  const afterReload = await openSettings(page);
  await expect(afterReload.getByLabel('界面主题', { exact: true })).toHaveValue('light');
  await expectTheme(page, 'light');
  await afterReload.getByLabel('界面主题', { exact: true }).selectOption('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'dark');
  const darkBackground = await page.locator('html').evaluate(node => getComputedStyle(node).backgroundColor);

  // 实际玩家入口与登录组件，使用公开启动夹具与匿名响应，不需要创建或修改账号。
  await page.route('**/api/v2/bootstrap', route => route.fulfill({ status: 200, contentType: 'application/json', body: readFileSync('/contract-fixtures/bootstrap-full.json', 'utf8') }));
  await page.route('**/api/v2/catalog', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.catalog) }));
  await page.route('**/api/v2/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unauthorized' } }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '欢迎入席', exact: true })).toBeVisible();
  await expectTheme(page, 'dark');
  await expect(page.locator('html')).toHaveCSS('background-color', darkBackground);
  await page.reload();
  await expect(page.getByRole('heading', { name: '欢迎入席', exact: true })).toBeVisible();
  await expectTheme(page, 'dark');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), storageKey)).toMatchObject({ ...oldPreferences, theme: 'dark' });
  await page.screenshot({ path: `/results/theme-login-dark-${testInfo.project.name}.png`, fullPage: true });

  // 管理员入口独立挂载 AdminApp；匿名响应保证覆盖登录界面，而不接触管理员账号。
  await page.route('**/api/v2/admin/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unauthorized' } }) }));
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '剧院管理', exact: true })).toBeVisible();
  await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '进入管理台', exact: true })).toBeVisible();
  await expectTheme(page, 'dark');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await page.screenshot({ path: `/results/theme-admin-login-dark-${testInfo.project.name}.png`, fullPage: true });
});

test('浅暗主题与昼夜布景均保留选中、草稿及重合态的语义底色和描边', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const base = loadGameFixture('night-spirit-full.json');
  const targets = alivePlayers(base.view).slice(0, 4);
  const [selectedId, draftId, combinedId, plainId] = targets;
  if (!selectedId || !draftId || !combinedId || !plainId) throw new Error('four alive seats are required for the theme fixture');
  const fixture = taskFixture(base.view, 'EDIT_PROPOSAL', { playerIds: targets, maxTargets: 3, allowRepeated: false, canSkip: true, forbiddenPairs: [] });
  fixture.view.private!.proposal = {
    pool: 'spirit', activeMemberIds: [fixture.view.private!.self.playerId], revision: 1,
    targetPlayerIds: [draftId, combinedId], confirmedBy: [], locked: false,
    effective: { revision: 1, targetPlayerIds: [draftId, combinedId], basis: 'latest_legal' },
  };
  const mounted = await mount(page, fixture);
  const seat = (id: string) => page.locator(`[data-player-id="${id}"]`);
  await seat(selectedId).locator('.seat-main').click();
  await seat(combinedId).locator('.seat-main').click();
  await expect(seat(selectedId)).toHaveClass(/stage-seat--selected/);
  await expect(seat(selectedId)).not.toHaveClass(/stage-seat--draft/);
  await expect(seat(draftId)).toHaveClass(/stage-seat--draft/);
  await expect(seat(draftId)).not.toHaveClass(/stage-seat--selected/);
  await expect(seat(combinedId)).toHaveClass(/stage-seat--selected/);
  await expect(seat(combinedId)).toHaveClass(/stage-seat--draft/);

  for (const theme of ['light', 'dark'] as const) {
    const dialog = await openSettings(page);
    await dialog.getByLabel('界面主题', { exact: true }).selectOption(theme);
    await expectTheme(page, theme);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    for (const phase of ['day', 'night'] as const) {
      // 只改变公开昼夜布景；保持同一展示任务/选择，验证样式不会覆盖其语义状态。
      const next = structuredClone(fixture);
      next.view.public!.phase = phase;
      await mounted.set(next);
      await expect(page.locator('.game-scene')).toHaveClass(phase === 'night' ? /game-scene--night/ : /^game-scene\s*$/);
      const tokens = await page.evaluate(() => {
        const probe = document.createElement('span');
        document.documentElement.append(probe);
        try {
          const color = (token: string) => {
            if (!getComputedStyle(document.documentElement).getPropertyValue(token).trim()) throw new Error(`missing theme token ${token}`);
            probe.style.color = `var(${token})`;
            return getComputedStyle(probe).color;
          };
          return { selectedBg: color('--seat-selected-bg'), selectedLine: color('--seat-selected-line'), draftBg: color('--seat-draft-bg'), draftLine: color('--seat-draft-line') };
        } finally { probe.remove(); }
      });
      const plainBackground = await seat(plainId).locator('.seat-main').evaluate(node => getComputedStyle(node).backgroundColor);
      for (const [id, state, background, border, style] of [
        [selectedId, 'selected', tokens.selectedBg, tokens.selectedLine, 'solid'],
        [draftId, 'draft', tokens.draftBg, tokens.draftLine, 'dashed'],
        [combinedId, 'selected-and-draft', tokens.selectedBg, tokens.selectedLine, 'solid'],
      ] as const) {
        const actual = await seat(id).locator('.seat-main').evaluate(node => {
          const css = getComputedStyle(node);
          return { background: css.backgroundColor, border: css.borderTopColor, style: css.borderTopStyle, width: css.borderTopWidth, frame: css.borderImageSource };
        });
        // Soft assertions retain all four screenshots when one palette has a CSS priority regression.
        expect.soft(actual.background, `${theme}/${phase}/${state} background token`).toBe(background);
        expect.soft(actual.background, `${theme}/${phase}/${state} differs from a normal seat`).not.toBe(plainBackground);
        expect.soft(actual.border, `${theme}/${phase}/${state} border token`).toBe(border);
        expect.soft(actual.style, `${theme}/${phase}/${state} border style`).toBe(style);
        expect.soft(actual.width, `${theme}/${phase}/${state} border width`).toBe('2px');
        expect.soft(actual.frame, `${theme}/${phase}/${state} removes the decorative frame`).toBe('none');
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/results/theme-seats-${theme}-${phase}-${testInfo.project.name}.png`, fullPage: true });
    }
  }
});

test('暗色标记编辑器保持文字可读，任务切换与标记选中态仍有高亮', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const base = loadGameFixture('night-spirit-full.json');
  const fixture = taskFixture(base.view, 'EDIT_PROPOSAL', { playerIds: alivePlayers(base.view).slice(0, 3), maxTargets: 2, allowRepeated: false, canSkip: true, forbiddenPairs: [] });
  // 合同支持独立的编辑/确认任务；关闭合并能力以展示真实任务切换控件，不发任何命令。
  fixture.view.capabilities.supportsProposalEditConfirmation = false;
  fixture.view.tasks.push({ ...fixture.view.tasks[0]!, action: 'CONFIRM_PROPOSAL', targets: null });
  fixture.view.capabilities.allowedCommands = ['EDIT_PROPOSAL', 'CONFIRM_PROPOSAL'];
  await mount(page, fixture);
  await expectTheme(page, 'dark');
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.documentElement.append(probe);
    try { return getComputedStyle(probe).color; } finally { probe.remove(); }
  });
  const tasks = page.getByRole('group', { name: '可用任务', exact: true }).getByRole('button');
  await expect(tasks).toHaveCount(2);
  await expect(tasks.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(tasks.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect.soft(tasks.nth(0), 'the current task uses the accent background').toHaveCSS('background-color', accent);
  await expect.soft(tasks.nth(0), 'the current task uses the accent border').toHaveCSS('border-top-color', accent);
  await tasks.nth(1).click();
  await expect(tasks.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(tasks.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect.soft(tasks.nth(1), 'highlight follows the newly selected task').toHaveCSS('background-color', accent);
  await expect.soft(tasks.nth(1), 'selected task border follows its background').toHaveCSS('border-top-color', accent);
  const taskColors = await tasks.evaluateAll(buttons => buttons.map(button => getComputedStyle(button).backgroundColor));
  expect.soft(taskColors[0], 'selected and unselected tasks stay visually distinct').not.toBe(taskColors[1]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `/results/theme-task-switch-dark-${testInfo.project.name}.png`, fullPage: true });

  const detailsButton = page.getByRole('button', { name: '查看1号玩家信息', exact: true });
  await expect(detailsButton).toHaveCount(1);
  // 用真实键盘激活明确的详情按钮，避免窄屏滚动引发的 HUD 布局变化影响指针落点。
  await detailsButton.focus();
  await expect(detailsButton).toBeFocused();
  await detailsButton.press('Enter');
  const details = page.getByRole('dialog', { name: '1号玩家', exact: true });
  await expect(details).toBeVisible();
  const editor = details.getByRole('region', { name: '我的玩家标记', exact: true });
  const note = editor.getByRole('textbox');
  await note.fill('暗色备注保持可读');
  const labels = editor.getByRole('group', { name: '预设标签', exact: true });
  const selectedLabel = labels.getByRole('button', { name: '可疑', exact: true });
  await selectedLabel.click();
  await expect(selectedLabel).toHaveAttribute('aria-pressed', 'true');
  await expect(note).toHaveValue('暗色备注保持可读');
  await expect.soft(selectedLabel, 'selected player label retains its accent background').toHaveCSS('background-color', accent);
  const readability = await editor.locator('.player-marks__note input, .player-marks__labels button').evaluateAll(controls => controls.map(control => {
    const css = getComputedStyle(control);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`unsupported computed color: ${color}`);
      const linear = channels.map(value => value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    const background = luminance(css.backgroundColor), foreground = luminance(css.color);
    return { name: control.tagName === 'INPUT' ? '备注' : control.textContent, background, contrast: (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05), colors: `${css.color} on ${css.backgroundColor}` };
  }));
  expect(readability).toHaveLength(6);
  for (const control of readability) {
    expect.soft(control.background, `${control.name} uses a dark surface: ${control.colors}`).toBeLessThan(0.25);
    expect.soft(control.contrast, `${control.name} text remains readable: ${control.colors}`).toBeGreaterThanOrEqual(4.5);
  }
  await page.screenshot({ path: `/results/theme-player-marks-dark-${testInfo.project.name}.png`, fullPage: true });
});
