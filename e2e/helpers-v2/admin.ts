import { expect, type Page } from '@playwright/test';

export interface AdminCredentials { password: string }

export const adminApi = '/api/v2/admin';

export function adminCredentials(): AdminCredentials {
  const password = process.env.ADMIN_TEST_PASSWORD;
  if (!password) throw new Error('ADMIN_TEST_PASSWORD is required for configured admin tests');
  return { password };
}

export async function openAdmin(page: Page): Promise<void> {
  await page.goto('/admin');
}

export async function loginAdmin(page: Page, credentials: AdminCredentials): Promise<void> {
  await expect(page.getByRole('heading', { name: '剧院管理' })).toBeVisible();
  await page.getByLabel('管理员密码').fill(credentials.password);
  await page.getByRole('button', { name: '进入管理台' }).click();
  await expect(page.getByRole('heading', { name: '资源概览' })).toBeVisible();
}

export async function ensureAdmin(page: Page, credentials: AdminCredentials): Promise<void> {
  await openAdmin(page);
  await loginAdmin(page, credentials);
}

export async function adminJson(page: Page, path: string, options: { method?: string; data?: unknown } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await page.request.fetch(`${adminApi}${path}`, {
    method: options.method ?? 'GET', data: options.data,
    headers: { Origin: new URL(page.url()).origin },
  });
  let body: Record<string, unknown> = {};
  try { body = await response.json() as Record<string, unknown>; } catch { /* status-only response */ }
  return { status: response.status(), body };
}
