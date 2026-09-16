import type { Page } from '@playwright/test';
import { ENV } from './env.ts';

/** 入口页：昵称 + 房间码 → 加入房间。 */
export async function joinLobbyViaUi(
  page: Page,
  options: { nickname: string; roomCode: string },
): Promise<void> {
  await page.goto(ENV.baseUrl);
  await page.locator('input[placeholder*="字符"]').fill(options.nickname);
  await page.locator('input[placeholder*="房间码"]').fill(options.roomCode);
  await page.getByRole('button', { name: '加入房间' }).click();
  await page.getByRole('button', { name: '准备', exact: true }).waitFor({ timeout: 15_000 });
}

/** 大厅：准备（并以「取消准备」出现确认）。 */
export async function readyViaUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '取消准备' }).waitFor({ timeout: 15_000 });
}

/** 加入语音并等待连接就绪。 */
export async function joinVoiceViaUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: '加入语音' }).click({ timeout: 30_000 });
  await page.getByText('语音已连接').waitFor({ timeout: 30_000 });
}

/** 对局内：点击座位选择器中的目标（`.chip`，文本形如「3号 玩家3」）。 */
export async function pickSeat(page: Page, seatLabel: string): Promise<void> {
  await page.locator('.picker button.chip', { hasText: seatLabel }).first().click();
}

/** 等待宿主页面出现某文案。 */
export function waitForText(page: Page, text: string, timeoutMs = 20_000): Promise<unknown> {
  return page.getByText(text, { exact: false }).first().waitFor({ timeout: timeoutMs });
}
