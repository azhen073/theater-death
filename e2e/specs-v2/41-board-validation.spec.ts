import { expect, test } from '@playwright/test';
import { loadRoomAccounts, loginRoomAccount, selectPublicChat } from '../helpers-v2/rooms.ts';

const validRoles = { laike: 1, door: 0, water: 0, descender: 0, researcher: 1, civilian: 1, death: 1, spirit: 1, mourner: 0 };

test('板子校验接口同时返回角色与人数问题', async ({ page }) => {
  const valid = await page.request.post('/api/v2/rulesets/validate', { data: { roles: validRoles, playerCount: 5 } });
  expect(valid.ok()).toBe(true);
  expect(await valid.json()).toEqual({ ok: true, issues: [] });
  const invalid = await page.request.post('/api/v2/rulesets/validate', { data: { roles: { ...validRoles, researcher: 2 }, playerCount: 4 } });
  const body = await invalid.json();
  expect(body.ok).toBe(false);
  expect(body.issues.map((issue: { code: string }) => issue.code)).toEqual(expect.arrayContaining(['duplicate_unsupported_role', 'player_count_mismatch']));
});

test('自定义编辑器使用服务端校验并在修正后允许创建', async ({ page }, testInfo) => {
  const accounts = loadRoomAccounts(testInfo.project.name);
  await loginRoomAccount(page, accounts[0]!);
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await page.getByRole('button', { name: '自定义角色组成' }).click();
  await page.getByLabel('玩家人数').fill('13');
  await page.getByLabel('科研员人数').fill('2');
  await selectPublicChat(page);
  await page.getByRole('radio', { name: '自由发言：不开启' }).click();
  await expect(page.getByText('特殊角色 "researcher" 出现 2 次')).toBeVisible();
  await expect(page.getByRole('button', { name: '创建房间', exact: true })).toBeDisabled();
  await page.screenshot({ path: `/results/board-validation-invalid-${testInfo.project.name}.png`, fullPage: true });
  await page.getByLabel('科研员人数').fill('1');
  await expect(page.getByRole('button', { name: '创建房间', exact: true })).toBeEnabled();
  await page.screenshot({ path: `/results/board-validation-valid-${testInfo.project.name}.png`, fullPage: true });
});
