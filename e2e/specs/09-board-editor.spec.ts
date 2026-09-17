import { expect, test } from '@playwright/test';
import { ENV } from '../helpers/env.ts';

/**
 * 自定义板子编辑器：默认值预填、实时校验（复用服务端校验器）、
 * 用自定义板建房后大厅显示实验模式横幅与新的开局人数。
 */
test('自定义板子：编辑角色数量、实时校验、创建实验模式房间', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(ENV.baseUrl);
  await page.locator('input[placeholder*="字符"]').fill('板主');
  await page.getByRole('button', { name: '自定义板子…' }).click();

  // 默认板：13 人、无错误、可创建
  await expect(page.getByText(/共 13 人/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '用此板创建房间' })).toBeEnabled();

  // 平民 4→2、魂灵 2→1 → 共 10 人
  await page.getByRole('button', { name: '减少平民' }).click();
  await page.getByRole('button', { name: '减少平民' }).click();
  await page.getByRole('button', { name: '减少魂灵' }).click();
  await expect(page.getByText(/共 10 人/)).toBeVisible();
  await page.screenshot({ path: 'results/artifacts/board-editor.png', fullPage: true });

  // 神职清零 → 实时错误 + 创建禁用
  for (const role of ['莱莱可', '门先生', '水妖', '降临者']) {
    await page.getByRole('button', { name: `减少${role}` }).click();
  }
  await expect(page.getByText(/禁止空神职开局/)).toBeVisible();
  await expect(page.getByRole('button', { name: '用此板创建房间' })).toBeDisabled();

  // 恢复默认 → 清掉 3 个平民 → 共 10 人
  await page.getByRole('button', { name: '恢复默认' }).click();
  await expect(page.getByText(/共 13 人/)).toBeVisible();
  await page.getByRole('button', { name: '减少平民' }).click();
  await page.getByRole('button', { name: '减少平民' }).click();
  await page.getByRole('button', { name: '减少平民' }).click();
  await expect(page.getByText(/共 10 人/)).toBeVisible();

  // 用此板创建房间：大厅出现实验模式横幅与 10 人开局要求
  await page.getByRole('button', { name: '用此板创建房间' }).click();
  await page.getByText(/实验模式：本局使用非默认板子配置/).waitFor({ timeout: 15_000 });
  await expect(page.getByText(/满 10 人且全部准备后/)).toBeVisible();
  await page.screenshot({ path: 'results/artifacts/board-lobby.png', fullPage: true });
});
