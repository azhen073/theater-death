import { expect, type Page } from '@playwright/test';
import { loadAccountCase, type RoomAccount } from './account.ts';

export function loadRoomAccounts(projectName: string): RoomAccount[] {
  const rooms = loadAccountCase(projectName).rooms;
  if (!rooms || rooms.length !== 7) throw new Error('missing seven disposable room accounts');
  return rooms;
}

export async function loginRoomAccount(page: Page, account: RoomAccount): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '欢迎入席' })).toBeVisible();
  await page.getByLabel('UID').fill(account.uid);
  await page.getByLabel('登录密码').fill(account.password);
  await page.getByRole('button', { name: /进入剧院/ }).click();
  await expect(page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
}

/**
 * 建房表单要求房主显式选择公屏写权限与「白天自由发言」开关（都没有默认值，未选时「创建房间」不可提交）。
 * 用法：在点击「创建房间」之前调用。首页入口的同名按钮（跳转到建房表单）之前调用时，
 * 页面上还没有单选框，本函数会跳过，因此可以无条件地插在每个「创建房间」点击之前。
 */
export async function selectPublicChat(page: Page, mode: 'alive_only' | 'everyone' = 'alive_only', freeSpeech = false): Promise<void> {
  const radio = page.getByRole('radio', { name: mode === 'alive_only' ? '公屏权限：仅存活正式玩家' : '公屏权限：存活与死者全体' });
  if (await radio.count() === 0) return;
  await radio.click();
  const freeSpeechRadio = page.getByRole('radio', { name: freeSpeech ? '自由发言：开启' : '自由发言：不开启' });
  if (await freeSpeechRadio.count() > 0) await freeSpeechRadio.click();
}

export async function openJoin(page: Page, code?: string): Promise<void> {
  if (code) {
    await page.getByRole('button', { name: '我的房间' }).click();
    await expect(page.getByRole('heading', { name: '加入房间' })).toBeVisible();
  } else {
    await page.getByRole('button', { name: '加入房间' }).click();
    await expect(page.getByRole('heading', { name: '加入房间' })).toBeVisible();
  }
  if (code) await page.getByLabel('房间码').fill(code);
}

export async function enterRoom(page: Page, code: string): Promise<void> {
  await openJoin(page);
  await page.getByLabel('房间码').fill(code);
  await page.getByRole('button', { name: '进入房间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '房间大厅' })).toBeVisible();
}

export async function waitRoom(page: Page, title = '房间大厅'): Promise<void> {
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 20_000 });
}

/** Dismiss the one-time formal-player entry reveal when a real-flow test is not testing it. */
export async function dismissIdentityEntryReveal(page: Page): Promise<void> {
  const reveal = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '进入舞台', exact: true }) });
  await reveal.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined);
  if (await reveal.isVisible().catch(() => false)) {
    await reveal.getByRole('button', { name: '进入舞台', exact: true }).click();
    await expect(reveal).toHaveCount(0);
  }
}

export async function confirmModal(page: Page, title: string): Promise<void> {
  await expect(page.getByRole('dialog')).toContainText(title);
  await page.getByRole('dialog').getByRole('button', { name: '确认操作' }).click();
}

/**
 * 窄屏（≤680px）滚动后 HUD 会收成细条，工具行收进「更多」菜单。
 * 需要点击 HUD 操作（我的身份 / 导航 / 第二屏 / 房间管理）之前先调用本函数：
 * 展开态下它是空操作，收起态下它点开「更多」。
 */
export async function revealHudActions(page: Page): Promise<void> {
  const more = page.getByRole('button', { name: '更多', exact: true });
  if (await more.isVisible().catch(() => false)) await more.click();
}

export async function leaveRoom(page: Page): Promise<void> {
  await dismissIdentityEntryReveal(page);
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    const close = dialog.getByRole('button', { name: '关闭' });
    if (await close.isVisible().catch(() => false)) await close.click();
  }
  let leave = page.getByRole('button', { name: /^(离开房间|暂离对局)$/, exact: true });
  if (!(await leave.isVisible().catch(() => false))) {
    await revealHudActions(page);
    const manage = page.getByRole('button', { name: '房间管理', exact: true });
    if (await manage.isVisible().catch(() => false)) {
      await manage.click();
      await expect(page.getByRole('button', { name: /^(离开房间|暂离对局)$/, exact: true })).toBeVisible();
      leave = page.getByRole('button', { name: /^(离开房间|暂离对局)$/, exact: true });
    } else {
      const rooms = await myRooms(page);
      expect(rooms.currentRoomId).toBeNull();
      return;
    }
  }
  await leave.click();
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText(/^(离开房间|暂离对局)？$/);
  await page.getByRole('dialog').getByRole('button', { name: '确认操作' }).click();
  await expect(page.getByRole('heading', { name: '下一场，等你入席。' })).toBeVisible();
}

export async function roomView(page: Page, code: string): Promise<Record<string, any>> {
  const response = await page.request.get(`/api/v2/rooms/${code}/view`);
  if (response.status() !== 200) throw new Error(`room view status ${response.status()}`);
  return await response.json() as Record<string, any>;
}

export async function myRooms(page: Page): Promise<Record<string, any>> {
  const response = await page.request.get('/api/v2/me/rooms');
  if (response.status() !== 200) throw new Error(`my rooms status ${response.status()}`);
  return await response.json() as Record<string, any>;
}

export function memberCard(page: Page, username: string) {
  return page.locator('.member-card').filter({ hasText: username }).first();
}

export async function noHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
