import { expect, test } from '@playwright/test';
import { adminCredentials, ensureAdmin, openAdmin } from '../helpers-v2/admin.ts';
import { loadRoomAccounts } from '../helpers-v2/rooms.ts';

test.describe.configure({ mode: 'serial' });

test('未配置管理员时显示说明', async ({ page }) => {
  await page.route('**/api/v2/admin/me', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'admin_not_configured' } }) }));
  await openAdmin(page); await expect(page.getByText('管理员功能尚未配置')).toBeVisible(); await page.unroute('**/api/v2/admin/me');
});

test('管理员控制注册开关并直接治理账户', async ({ page }, testInfo) => {
  await ensureAdmin(page, adminCredentials()); await page.getByRole('button', { name: '注册设置' }).click();
  const toggle = page.getByRole('button', { name: /停止注册|开放注册/ }); await toggle.click(); await expect(page.getByRole('button', { name: /停止注册|开放注册/ })).toBeVisible();
  const account = loadRoomAccounts(testInfo.project.name)[0]!; await page.getByRole('button', { name: '账户' }).click(); await page.getByLabel('搜索').fill(account.nickname); await page.getByRole('button', { name: '搜索' }).click();
  let card = page.locator('.admin-account').filter({ hasText: account.nickname }).first(); await expect(card).toBeVisible(); await page.screenshot({ path: `/results/admin-account-governance-${testInfo.project.name}.png`, fullPage: false });
  await card.getByRole('button', { name: '改昵称' }).click(); await page.getByLabel('新昵称').fill('管理员改名'); await page.getByRole('dialog').getByRole('button', { name: '确认操作' }).click(); card=page.locator('.admin-account').filter({ hasText: '管理员改名' }).first(); await expect(card).toBeVisible();
  await card.getByRole('button', { name: '设置新密码' }).click(); await page.getByLabel('新密码', { exact: true }).fill('adminnew8'); await page.getByLabel('确认新密码', { exact: true }).fill('adminnew8'); await page.getByRole('dialog').getByRole('button', { name: '确认操作' }).click();
  await card.getByRole('button', { name: '停用' }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认操作' }).click(); await expect(card).toContainText('已停用');
});
