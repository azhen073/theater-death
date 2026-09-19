import { expect, test } from '@playwright/test';
import { loadAccountCase } from '../helpers-v2/account.ts';

test('注册校验错误与重复点击只创建一次', async ({ page }, testInfo) => {
  const account = loadAccountCase(testInfo.project.name);
  await page.goto('/'); await page.getByRole('button', { name: '直接注册' }).click();
  await page.getByLabel('昵称').fill('有数字1'); await page.getByLabel('设置密码').fill('valid888'); await page.getByLabel('确认密码').fill('valid888'); await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('昵称').fill(account.nickname); await page.getByLabel('设置密码').fill(account.password); await page.getByLabel('确认密码').fill(account.password);
  let requests = 0; await page.route('**/api/v2/auth/register', async route => { requests += 1; await route.continue(); });
  await page.getByRole('button', { name: '创建账号' }).dblclick(); await expect(page.getByRole('heading', { name: '账号创建成功' })).toBeVisible(); expect(requests).toBe(1);
});
