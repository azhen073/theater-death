import { describe, expect, it } from 'vitest';
import { ApiFailure, errorMessage, UnknownResult, request } from '../web-v2/src/transport/http.ts';

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('v2 frontend HTTP transport', () => {
  it('forces same-origin credentials and no-store while preserving the request path', async () => {
    let seen: { input: unknown; init?: RequestInit } | undefined;
    const result = await request<{ ok: boolean }>('/rooms/R/view', { credentials: 'omit', cache: 'force-cache' }, async (input, init) => {
      seen = { input, init };
      return response(200, { ok: true });
    });

    expect(result).toEqual({ ok: true });
    expect(seen?.input).toBe('/api/v2/rooms/R/view');
    expect(seen?.init).toMatchObject({ credentials: 'include', cache: 'no-store' });
  });

  it('passes a 200 rejected receipt through without treating it as success', async () => {
    const intent = { requestId: 'same-id', gameId: 'g1', action: 'END_SPEECH' };
    let sentBody: string | undefined;
    const rejected = { status: 'rejected', code: 'stale_window', message: 'window closed' };
    const result = await request<typeof rejected>('/rooms/R/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intent),
    }, async (_input, init) => {
      sentBody = String(init?.body);
      return response(200, rejected);
    });

    expect(result).toEqual(rejected);
    expect(sentBody).toBe(JSON.stringify(intent));
    expect(intent).toEqual({ requestId: 'same-id', gameId: 'g1', action: 'END_SPEECH' });
  });

  it('turns non-2xx structured errors into ApiFailure with status, code, and message', async () => {
    const failure = await request('/rooms/R/command', {}, async () => response(409, {
      error: { code: 'request_id_reused', message: 'request body changed' },
    })).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure).toMatchObject({ status: 409, code: 'request_id_reused', message: 'request body changed' });
  });

  it('uses unknown_error for an unstructured non-2xx payload', async () => {
    await expect(request('/rooms/R/view', {}, async () => response(500, { unexpected: 'payload' }))).rejects.toMatchObject({
      status: 500, code: 'unknown_error',
    });
  });

  it('classifies network and unreadable JSON responses as UnknownResult', async () => {
    const networkError = new Error('offline');
    await expect(request('/rooms/R/command', {}, async () => { throw networkError; })).rejects.toBeInstanceOf(UnknownResult);
    await expect(request('/rooms/R/command', {}, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('invalid json'); } } as unknown as Response))).rejects.toBeInstanceOf(UnknownResult);
  });

  it('preserves the original error for an explicitly aborted request', async () => {
    const controller = new AbortController();
    const reason = new Error('caller abort');
    controller.abort(reason);
    let called = false;

    await expect(request('/rooms/R/command', { signal: controller.signal }, async () => { called = true; throw new Error('fetch must not run'); })).rejects.toBe(reason);
    expect(called).toBe(false);
  });

  it('does not expose unknown payload text in user-facing error messages', () => {
    const secret = 'payload-injected-secret';
    expect(errorMessage(new ApiFailure(400, 'unrecognized_code', secret))).not.toContain(secret);
    expect(errorMessage(new ApiFailure(500, 'unknown_error', secret))).toBe('暂时无法完成操作，请刷新状态后重试。');
    expect(errorMessage(new UnknownResult())).not.toContain(secret);
  });
});
