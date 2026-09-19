import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { advanceAcceptanceClock, loadFullGameAccounts, roomCommand, roomView } from './full-game.ts';
import { enterRoom, loginRoomAccount } from './rooms.ts';
import type { FullGameAccount } from './account.ts';

export const specialRoleBoard = {
  laike: 1, door: 1, water: 1, descender: 0, researcher: 1,
  civilian: 1, death: 1, spirit: 1, mourner: 0,
} as const;
export type SpecialRole = keyof typeof specialRoleBoard;

export function loadSpecialAccounts(projectName: string): FullGameAccount[] {
  const accounts = loadFullGameAccounts(projectName).slice(0, 7);
  if (accounts.length !== 7) throw new Error('special acceptance requires seven disposable accounts');
  return accounts;
}

export async function createSpecialRoomViaPage(page: Page): Promise<string> {
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开启一场演出' })).toBeVisible();
  const custom = page.getByRole('button', { name: '自定义角色组成' });
  await expect(custom).toBeVisible();
  await custom.click();
  await page.getByLabel('玩家人数').fill('7');
  const values: Record<string, string> = {
    莱莱可: '1', 门先生: '1', 水妖: '1', 降临者: '0', 科研员: '1',
    平民: '1', 死神: '1', 魂灵: '1', 丧亲者: '0',
  };
  for (const [role, count] of Object.entries(values)) await page.getByLabel(`${role}人数`).fill(count);
  const requestPromise = page.waitForRequest(request => request.url().endsWith('/api/v2/rooms') && request.method() === 'POST');
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  const body = await requestPromise;
  const payload = body.postDataJSON() as Record<string, unknown>;
  expect(payload.playerCount).toBe(7);
  expect(payload.roles).toEqual(expect.objectContaining(specialRoleBoard));
  await expect(page.getByRole('heading', { name: '房间大厅' })).toBeVisible({ timeout: 20_000 });
  return (await page.locator('.room-code strong').innerText()).trim();
}

export async function loginAndEnterSpecial(page: Page, account: FullGameAccount, code: string): Promise<void> {
  await loginRoomAccount(page, account);
  await enterRoom(page, code);
}

export function roleUsers(views: Array<Record<string, any>>): Map<SpecialRole, { index: number; userId: string; playerId: string }> {
  const result = new Map<SpecialRole, { index: number; userId: string; playerId: string }>();
  views.forEach((view, index) => {
    const role = view.private?.self?.roleId as SpecialRole | undefined;
    if (role && role in specialRoleBoard && specialRoleBoard[role] === 1) {
      result.set(role, { index, userId: view.viewer.userId, playerId: view.private.self.playerId });
    }
  });
  return result;
}

export function playerIdForRole(users: Map<SpecialRole, { index: number; userId: string; playerId: string }>, role: SpecialRole): string {
  const player = users.get(role);
  if (!player) throw new Error(`special role ${role} was not assigned`);
  return player.playerId;
}

export async function authorizedViews(requests: APIRequestContext[], code: string): Promise<Array<Record<string, any>>> {
  return Promise.all(requests.map(request => roomView(request, code)));
}

export async function submitAuthorized(
  request: APIRequestContext,
  code: string,
  view: Record<string, any>,
  task: Record<string, any>,
  targets: string[] = [],
  extras: Record<string, unknown> = {},
): Promise<{ body: Record<string, unknown>; receipt: Record<string, any> }> {
  const body: Record<string, unknown> = {
    requestId: crypto.randomUUID(), gameId: view.gameId, windowInstanceId: task.windowInstanceId,
    action: task.action, ...(task.targets ? { targets } : {}), ...extras,
  };
  const receipt = await roomCommand(request, code, body);
  return { body, receipt };
}

export async function submitTargetInBrowser(page: Page, view: Record<string, any>, targetPlayerId: string, action: string): Promise<Record<string, any>> {
  const seat = view.public?.seats?.find((item: Record<string, any>) => item.playerId === targetPlayerId);
  if (!seat) throw new Error(`${action}: target seat is not public`);
  const target = page.getByRole('button', { name: new RegExp(`^${seat.seat}号 .*可选目标`) });
  await expect(target).toBeVisible({ timeout: 20_000 });
  const requestPromise = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith(`/api/v2/rooms/${view.room.code}/command`));
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/v2/rooms/${view.room.code}/command`));
  await target.click();
  await page.getByRole('button', { name: '确认提交', exact: true }).click();
  const sent = await requestPromise;
  const receipt = await (await responsePromise).json() as Record<string, any>;
  const body = sent.postDataJSON() as Record<string, any>;
  expect(body.action).toBe(action);
  expect(receipt.status).toBe('accepted');
  expect(receipt.requestId).toBe(body.requestId);
  return { ...receipt, sentBody: body };
}

export async function advanceToNextWindow(requests: APIRequestContext[], code: string, clockSocket: string): Promise<void> {
  let views = await authorizedViews(requests, code);
  let now = Math.max(...views.map(view => Number(view.serverTime)));
  let deadlines = views.flatMap(view => (view.windows ?? []).map((window: Record<string, any>) => window.closesAt))
    .filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > now);
  if (!deadlines.length) {
    const summary = views.map(view => ({ phase: view.public?.phase, step: view.public?.day?.step, gameId: view.gameId, serverTime: view.serverTime, windows: view.windows?.map((window: Record<string, any>) => ({ id: window.id, closesAt: window.closesAt })), tasks: view.tasks?.map((task: Record<string, any>) => task.action) }));
    throw new Error(`special actions found no future authorized deadline: ${JSON.stringify(summary)}`);
  }
  await advanceAcceptanceClock(clockSocket, Math.min(...deadlines) - now + 1);
}

export function taskFor(view: Record<string, any>, action: string): Record<string, any> | undefined {
  return (view.tasks ?? []).find((task: Record<string, any>) => task.action === action && view.capabilities?.allowedCommands?.includes(action));
}

export function targetFor(view: Record<string, any>, task: Record<string, any>, playerId: string): string {
  if (!task.targets?.playerIds?.includes(playerId)) throw new Error(`${task.action}: target is not legal in the current view`);
  return playerId;
}
