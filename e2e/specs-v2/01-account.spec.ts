import { expect, test, type Page } from '@playwright/test';
import { loadAccountCase, newPasswordFor } from '../helpers-v2/account.ts';

async function openAuth(page: Page) { await page.goto('/'); await expect(page.getByRole('heading', { name: '欢迎入席' })).toBeVisible(); }
async function login(page: Page, uid: string, password: string) {
  await page.getByLabel('数字 UID').fill(uid); await page.getByLabel('登录密码').fill(password); await page.getByRole('button', { name: /进入剧院/ }).click();
  await expect(page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
}
async function register(page: Page, account: { nickname: string; password: string }, projectName: string) {
  await page.getByRole('button', { name: '直接注册' }).click(); await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible();
  await page.getByLabel('昵称').fill(account.nickname); await page.getByLabel('设置密码').fill(account.password); await page.getByLabel('确认密码').fill(account.password); await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.getByRole('heading', { name: '账号创建成功' })).toBeVisible(); await page.screenshot({ path: `/results/account-created-uid-${projectName}.png`, fullPage: false }); await page.getByRole('button', { name: '进入剧院' }).click();
  await expect(page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
}

test('直接注册、UID 展示、昵称编辑与改密', async ({ page, browser }, testInfo) => {
  const account = loadAccountCase(testInfo.project.name); await openAuth(page); await register(page, account, testInfo.project.name);
  await page.getByRole('button', { name: '我的账户' }).click(); const uidText=await page.getByText(/登录 UID：\d+/).innerText(); const registeredUid=uidText.replace(/\D/g,''); expect(registeredUid).toMatch(/^\d{8,20}$/); await expect(page.getByRole('button', { name: '复制 UID' })).toBeVisible(); await page.screenshot({ path: `/results/account-profile-${testInfo.project.name}.png`, fullPage: false });
  // 我的账户 → 显示与动画：三项设置按可访问名可达、默认值正确、改动即时生效（F2：复选框名字不含帮助文本）
  const display = page.getByRole('region', { name: '显示与动画设置' });
  await expect(display).toBeVisible();
  const deathEffects = display.getByRole('checkbox', { name: '死亡特效', exact: true });
  await expect(deathEffects).toBeChecked();
  await expect(display.getByLabel('动画偏好')).toHaveValue('system');
  await expect(display.getByLabel('界面缩放')).toHaveValue('100');
  // F5：三个标签字号统一，帮助文字更小，且「死亡特效」与下一项之间保持间距
  const metrics = await display.evaluate(section => {
    const fields = [...section.querySelectorAll('.select-field')];
    const row = section.querySelector('.setting-row');
    const size = (element: Element | null) => element ? getComputedStyle(element as HTMLElement).fontSize : '';
    return {
      motion: size(fields[0] ?? null),
      scale: size(fields[1] ?? null),
      deathEffects: size(row?.querySelector('span') ?? null),
      helper: size(row?.querySelector('small') ?? null),
      gap: row && fields[1] ? Math.round(fields[1].getBoundingClientRect().top - row.getBoundingClientRect().bottom) : -1,
    };
  });
  expect(new Set([metrics.motion, metrics.scale, metrics.deathEffects]).size).toBe(1);
  expect(parseFloat(metrics.helper)).toBeLessThan(parseFloat(metrics.deathEffects));
  expect(metrics.gap).toBeGreaterThanOrEqual(16);
  await display.screenshot({ path: `/results/account-display-${testInfo.project.name}.png` });
  await deathEffects.uncheck();
  await display.getByLabel('动画偏好').selectOption('reduced');
  await display.getByLabel('界面缩放').selectOption('110');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('true');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe('1.1');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('theater-death-display-v1') ?? '{}') as Record<string, unknown>)).toMatchObject({ deathEffects: false, motion: 'reduced', scale: 110 });
  await deathEffects.check();
  await display.getByLabel('动画偏好').selectOption('system');
  await display.getByLabel('界面缩放').selectOption('100');
  await page.getByRole('button', { name: '修改昵称' }).click(); await page.getByLabel('新昵称').fill('新昵称用户'); await page.getByRole('button', { name: '保存' }).click(); await expect(page.getByRole('heading', { name: '新昵称用户' })).toBeVisible();
  const changed = newPasswordFor(account.nickname); await page.getByRole('button', { name: '修改密码' }).click(); await page.getByLabel('当前密码').fill(account.password); await page.getByLabel('新密码', { exact: true }).fill(changed); await page.getByLabel('确认新密码', { exact: true }).fill(changed); await page.getByRole('button', { name: '保存新密码' }).click();
  await expect(page.getByRole('status')).toContainText('密码已更新'); await page.getByRole('button', { name: '返回登录' }).click(); await login(page, registeredUid, changed);
  const second = await browser.newContext(); const secondPage = await second.newPage(); try { await openAuth(secondPage); await login(secondPage, registeredUid, changed); } finally { await second.close(); }
});

test('注册请求响应丢失后可在原页用同一请求重试', async ({ page }, testInfo) => {
  const account = loadAccountCase(testInfo.project.name).lost; let attempts = 0;
  await page.route('**/api/v2/auth/register', async route => { attempts += 1; await route.fetch(); await route.abort('failed'); });
  await openAuth(page); await page.getByRole('button', { name: '直接注册' }).click(); await page.getByLabel('昵称').fill(account.nickname); await page.getByLabel('设置密码').fill(account.password); await page.getByLabel('确认密码').fill(account.password); await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.getByRole('status')).toContainText('注册结果尚未确认'); expect(attempts).toBe(1);
  await page.unroute('**/api/v2/auth/register'); await page.getByRole('button', { name: '创建账号' }).click(); await expect(page.getByRole('heading', { name: '账号创建成功' })).toBeVisible();
});
