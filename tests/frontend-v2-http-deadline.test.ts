import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, UnknownResult, request } from '../web-v2/src/transport/http.ts';

afterEach(() => { vi.useRealTimers(); });

function response(json: () => Promise<unknown>, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json } as Response;
}

describe('v2 HTTP total deadline', () => {
  it('aborts a fetch that has not produced a response after 20 seconds as UnknownResult', async () => {
    vi.useFakeTimers();
    let internalSignal: AbortSignal | null | undefined;
    const fetchPromise = new Promise<Response>(() => {});
    const requestPromise = request('/rooms/R/view', {}, async (_input, init) => {
      internalSignal = init?.signal;
      return fetchPromise;
    });
    let settled = false; let failure: unknown;
    void requestPromise.then(() => { settled = true; }, error => { settled = true; failure = error; });
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.resolve();
    expect(settled).toBe(true);
    expect(failure).toBeInstanceOf(UnknownResult);
    expect(internalSignal?.aborted).toBe(true);
  });

  it('uses the same 20 second total deadline while response.json is pending', async () => {
    vi.useFakeTimers();
    let internalSignal: AbortSignal | null | undefined;
    const jsonPromise = new Promise<unknown>(() => {});
    const requestPromise = request('/rooms/R/view', {}, async (_input, init) => {
      internalSignal = init?.signal;
      return response(async () => jsonPromise);
    });
    let settled = false; let failure: unknown;
    void requestPromise.then(() => { settled = true; }, error => { settled = true; failure = error; });
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.resolve();
    expect(settled).toBe(true);
    expect(failure).toBeInstanceOf(UnknownResult);
    expect(internalSignal?.aborted).toBe(true);
  });

  it('counts response headers and JSON body against one shared 20 second deadline', async () => {
    vi.useFakeTimers();
    let internalSignal: AbortSignal | null | undefined;
    let resolveHeaders!: (value: Response) => void;
    const jsonPromise = new Promise<unknown>(() => {});
    const headersPromise = new Promise<Response>(resolve => { resolveHeaders = resolve; });
    const requestPromise = request('/rooms/R/view', {}, async (_input, init) => {
      internalSignal = init?.signal;
      return headersPromise;
    });
    const outcome = requestPromise.then(() => null, error => error);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(12_000);
    resolveHeaders(response(async () => jsonPromise));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(7_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await outcome).toBeInstanceOf(UnknownResult);
    expect(internalSignal?.aborted).toBe(true);
  });

  it('propagates an external AbortSignal reason instead of converting it to UnknownResult', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error('caller cancelled');
    const requestPromise = request('/rooms/R/view', { signal: controller.signal }, async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(reason), { once: true });
    }));
    controller.abort(reason);
    await expect(requestPromise).rejects.toBe(reason);
    expect(controller.signal.aborted).toBe(true);
  });

  it('clears its internal deadline after success or explicit ApiFailure and preserves request options', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let internalSignal: AbortSignal | null | undefined;
    let seen: RequestInit | undefined;
    await expect(request('/rooms/R/view', { signal: controller.signal, credentials: 'omit', cache: 'force-cache' }, async (_input, init) => {
      internalSignal = init?.signal; seen = init;
      return response(async () => ({ ok: true }));
    })).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(controller.signal.aborted).toBe(false);
    expect(internalSignal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(seen).toMatchObject({ credentials: 'include', cache: 'no-store' });

    const failureController = new AbortController();
    let failureSignal: AbortSignal | null | undefined;
    await expect(request('/rooms/R/view', { signal: failureController.signal }, async (_input, init) => { failureSignal = init?.signal; return response(async () => ({ error: { code: 'room_not_found' } }), 404); })).rejects.toBeInstanceOf(ApiFailure);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(failureController.signal.aborted).toBe(false);
    expect(failureSignal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
