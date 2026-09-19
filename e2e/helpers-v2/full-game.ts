import { connect } from 'node:net';
import type { APIRequestContext, Page } from '@playwright/test';
import { loadAccountCase, type FullGameAccount } from './account.ts';

export function loadFullGameAccounts(projectName: string): FullGameAccount[] {
  const accounts = loadAccountCase(projectName).fullGame;
  if (!accounts || accounts.length !== 13) throw new Error('missing thirteen full-game accounts');
  return accounts;
}

export async function loginApi(request: APIRequestContext, account: FullGameAccount): Promise<void> {
  const response = await request.post('/api/v2/auth/login', { data: { uid: account.uid, password: account.password } });
  if (response.status() !== 200) throw new Error(`full-game login failed: ${response.status()}`);
}

export async function createFormalRoomViaPage(page: Page): Promise<string> {
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await page.getByRole('heading', { name: '开启一场演出' }).waitFor();
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await page.getByRole('heading', { name: '房间大厅' }).waitFor({ timeout: 20_000 });
  return (await page.locator('.room-code strong').innerText()).trim();
}

export async function roomView(request: APIRequestContext, code: string): Promise<Record<string, any>> {
  const response = await request.get(`/api/v2/rooms/${code}/view`);
  if (response.status() !== 200) throw new Error(`full-game view failed: ${response.status()}`);
  return await response.json() as Record<string, any>;
}

export async function roomCommand(request: APIRequestContext, code: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await request.post(`/api/v2/rooms/${code}/command`, { data: body });
  const result = await response.json() as Record<string, any>;
  if (response.status() !== 200 || result.status !== 'accepted') throw new Error(`full-game command rejected: ${result.code ?? response.status()}`);
  return result;
}

export async function advanceAcceptanceClock(socketPath: string, advanceMs: number): Promise<{ now: number; pending: number }> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = '';
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('clock control timeout')); }, 10_000);
    const finish = (error?: Error, value?: { now: number; pending: number }) => { clearTimeout(timeout); socket.destroy(); if (error) reject(error); else if (value) resolve(value); };
    socket.on('connect', () => { if (!Number.isFinite(advanceMs) || advanceMs < 0 || advanceMs > 300_000) { finish(new Error('invalid clock advance')); return; } socket.write(JSON.stringify({ advanceMs }) + '\n'); });
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try { const result = JSON.parse(buffer.slice(0, newline)) as { now?: number; pending?: number; error?: string }; if (result.error || typeof result.now !== 'number' || typeof result.pending !== 'number') finish(new Error(result.error ?? 'invalid clock response')); else finish(undefined, { now: result.now, pending: result.pending }); } catch { finish(new Error('invalid clock response')); }
    });
    socket.on('error', error => finish(error));
  });
}
