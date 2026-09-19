import { expect, request, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { RoomAccount } from './account.ts';

export interface ApiSession { api: APIRequestContext; account: RoomAccount }

export async function loginApi(account: RoomAccount): Promise<ApiSession> {
  const api = await request.newContext({ baseURL: 'http://localhost:5173', extraHTTPHeaders: { Origin: 'http://localhost:5173' } });
  const response = await api.post('/api/v2/auth/login', { data: { uid: account.uid, password: account.password } });
  expect(response.status()).toBe(200);
  return { api, account };
}

export async function roomPost(session: ApiSession, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await session.api.post(path, { data: body });
  const json = await response.json() as Record<string, unknown>;
  expect(response.status(), `${path}: ${JSON.stringify(json)}`).toBeLessThan(300);
  return json;
}

export async function roomView(session: ApiSession, code: string): Promise<any> {
  const response = await session.api.get(`/api/v2/rooms/${code}/view`);
  expect(response.status()).toBe(200);
  return await response.json();
}

export async function enterAndReady(session: ApiSession, code: string): Promise<void> {
  await roomPost(session, `/api/v2/rooms/${code}/enter`, { requestId: `recovery-enter-${session.account.uid}-${Date.now()}` });
  await roomPost(session, `/api/v2/rooms/${code}/ready`, { requestId: `recovery-ready-${session.account.uid}-${Date.now()}`, ready: true });
}

export async function browserContextForApi(browser: Browser, session: ApiSession): Promise<BrowserContext> {
  return browser.newContext({ storageState: await session.api.storageState() });
}

export async function apiSessionFromContext(context: BrowserContext, account: RoomAccount): Promise<ApiSession> {
  const api = await request.newContext({ baseURL: 'http://localhost:5173', storageState: await context.storageState(), extraHTTPHeaders: { Origin: 'http://localhost:5173' } });
  return { api, account };
}

export async function waitForView(session: ApiSession, code: string, predicate: (view: any) => boolean, timeout = 20_000): Promise<any> {
  await expect.poll(async () => predicate(await roomView(session, code)), { timeout, intervals: [250] }).toBe(true);
  return roomView(session, code);
}

export async function closeApiSessions(sessions: ApiSession[]): Promise<void> {
  await Promise.all(sessions.map(async session => { await session.api.dispose(); }));
}

export async function closePageContext(context: BrowserContext | null): Promise<void> {
  if (context) await context.close();
}

export function pageRoomUrl(page: Page, code: string): string {
  return `${new URL(page.url()).origin}/#/room/${code}`;
}
