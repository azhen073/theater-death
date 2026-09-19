import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CommandIntent, CommandReceipt, ReceiptLookup, RoomSnapshot } from '../contracts/v2.ts';
import { ApiFailure } from '../web-v2/src/transport/http.ts';
import { CommandTracker } from '../web-v2/src/features/actions/commands.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/contract-2.1/night-door-full.json', import.meta.url), 'utf8')) as RoomSnapshot;

function viewCopy(): RoomSnapshot {
  const view = structuredClone(fixture);
  view.room.phase = 'playing';
  view.viewer.readOnly = false;
  view.tasks = [{ action: 'SUBMIT_GUARD', windowInstanceId: 'guard:1', closesAt: view.serverTime + 30_000, targets: { playerIds: ['p_a', 'p_b'], maxTargets: 2, allowRepeated: false, canSkip: true, forbiddenPairs: [] } }];
  view.windows = [{ id: 'guard', type: 'guard', instanceId: 'guard:1', closesAt: view.serverTime + 30_000 }];
  view.capabilities.allowedCommands = ['SUBMIT_GUARD'];
  return view;
}

function intent(view: RoomSnapshot, requestId = 'request-1'): CommandIntent {
  return { requestId, gameId: view.gameId!, windowInstanceId: 'guard:1', action: 'SUBMIT_GUARD', targets: ['p_a'] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function accepted(requestId: string): CommandReceipt {
  return { requestId, status: 'accepted', code: null, message: null };
}

function rejected(requestId: string): CommandReceipt {
  return { requestId, status: 'rejected', code: 'action_forbidden', message: 'forbidden' };
}

function trackerHarness() {
  const view = viewCopy();
  let current: RoomSnapshot | null = view;
  const changed = vi.fn<(records: unknown[]) => void>();
  const failed = vi.fn<(error: unknown) => void>();
  const sends: CommandIntent[] = [];
  const lookups: CommandIntent[] = [];
  const transport = {
    send: vi.fn(async (value: CommandIntent) => { sends.push(structuredClone(value)); return accepted(value.requestId); }),
    lookup: vi.fn(async (value: CommandIntent): Promise<ReceiptLookup> => { lookups.push(structuredClone(value)); return { requestId: value.requestId, status: 'not_seen' }; }),
  };
  const tracker = new CommandTracker(view, () => current, transport, changed, failed);
  return { view, setView: (next: RoomSnapshot | null) => { current = next; }, tracker, transport, sends, lookups, changed, failed };
}

describe('v2 command tracker', () => {
  it('sends repeated clicks or the same action slot only once while unresolved', async () => {
    const h = trackerHarness();
    const pending = deferred<CommandReceipt>();
    h.transport.send.mockImplementationOnce(async value => { h.sends.push(structuredClone(value)); return pending.promise; });
    const first = h.tracker.submit(intent(h.view));
    await Promise.resolve();
    await h.tracker.submit(intent(h.view, 'request-2'));
    expect(h.transport.send).toHaveBeenCalledTimes(1);
    pending.resolve(accepted('request-1'));
    await first;
    expect(h.tracker.list()[0]?.status).toBe('accepted');
  });

  it('keeps an HTTP 200 rejected receipt rejected, and classifies bad receipts as unknown', async () => {
    const h = trackerHarness();
    h.transport.send.mockResolvedValueOnce(rejected('request-1'));
    await h.tracker.submit(intent(h.view));
    expect(h.tracker.list()[0]).toMatchObject({ status: 'rejected', code: 'action_forbidden' });

    const bad = trackerHarness();
    bad.transport.send.mockResolvedValueOnce({ requestId: 'other', status: 'accepted', code: null, message: null });
    await bad.tracker.submit(intent(bad.view));
    expect(bad.tracker.list()[0]?.status).toBe('unknown');
  });

  it('marks network and 429/503 failures unknown, retries only with the original intent, and reports failures', async () => {
    const h = trackerHarness();
    const original = intent(h.view);
    h.transport.send.mockRejectedValueOnce(new Error('offline'));
    await h.tracker.submit(original);
    expect(h.tracker.list()[0]?.status).toBe('unknown');
    expect(h.failed).toHaveBeenCalledOnce();
    await h.tracker.retry(original.requestId);
    expect(h.transport.send).toHaveBeenCalledTimes(2);
    expect(h.transport.send.mock.calls[0]?.[0]).toEqual(original);
    expect(h.transport.send.mock.calls[1]?.[0]).toEqual(original);

    for (const status of [408, 429, 500, 502, 503, 504]) {
      const retryable = trackerHarness();
      retryable.transport.send.mockRejectedValueOnce(new ApiFailure(status, 'rate_limited'));
      await retryable.tracker.submit(intent(retryable.view));
      expect(retryable.tracker.list()[0]?.status).toBe('unknown');
      await retryable.tracker.retry('request-1');
      expect(retryable.transport.send).toHaveBeenCalledTimes(2);
      expect(retryable.transport.send.mock.calls[1]?.[0]).toEqual(retryable.transport.send.mock.calls[0]?.[0]);
    }
  });

  it('queries receipts with GET semantics only, treats not_seen as a status, and never resends pending', async () => {
    const h = trackerHarness();
    h.transport.send.mockRejectedValueOnce(new ApiFailure(503, 'rate_limited'));
    await h.tracker.submit(intent(h.view));
    const failureCount = h.failed.mock.calls.length;
    await h.tracker.query('request-1');
    expect(h.transport.lookup).toHaveBeenCalledTimes(1);
    expect(h.transport.send).toHaveBeenCalledTimes(1);
    expect(h.tracker.list()[0]?.status).toBe('not_seen');

    h.transport.lookup.mockResolvedValueOnce({ requestId: 'request-1', status: 'pending' });
    await h.tracker.query('request-1');
    expect(h.tracker.list()[0]?.status).toBe('pending');
    await h.tracker.retry('request-1');
    expect(h.transport.send).toHaveBeenCalledTimes(1);
    expect(h.failed.mock.calls.length).toBe(failureCount);
  });

  it('does not resend after a window change but can still query the same game record', async () => {
    const h = trackerHarness();
    h.transport.send.mockRejectedValueOnce(new ApiFailure(503, 'rate_limited'));
    await h.tracker.submit(intent(h.view));
    const changedView = viewCopy();
    changedView.tasks[0]!.windowInstanceId = 'guard:2';
    changedView.windows[0]!.instanceId = 'guard:2';
    h.setView(changedView);
    await h.tracker.retry('request-1');
    expect(h.transport.send).toHaveBeenCalledTimes(1);
    await h.tracker.query('request-1');
    expect(h.transport.lookup).toHaveBeenCalledTimes(1);
  });

  it('suppresses late responses after account/game/perspective authorization changes and after dispose', async () => {
    for (const change of [
      (view: RoomSnapshot) => { view.viewer.userId = 'other-user'; },
      (view: RoomSnapshot) => { view.gameId = 'other-game'; },
      (view: RoomSnapshot) => { view.viewer.memberId = 'other-member'; },
      (view: RoomSnapshot) => { view.viewer.readOnly = true; },
    ]) {
      const h = trackerHarness();
      const pending = deferred<CommandReceipt>();
      h.transport.send.mockImplementationOnce(async () => pending.promise);
      const submission = h.tracker.submit(intent(h.view));
      await Promise.resolve();
      const emissions = h.changed.mock.calls.length;
      const next = viewCopy(); change(next); h.setView(next);
      pending.resolve(accepted('request-1'));
      await submission;
      expect(h.changed.mock.calls.length).toBe(emissions);
    }

    const disposed = trackerHarness();
    const pending = deferred<CommandReceipt>();
    disposed.transport.send.mockImplementationOnce(async () => pending.promise);
    const submission = disposed.tracker.submit(intent(disposed.view));
    await Promise.resolve();
    const emissions = disposed.changed.mock.calls.length;
    disposed.tracker.dispose();
    pending.resolve(accepted('request-1'));
    await submission;
    expect(disposed.tracker.list()).toEqual([]);
    expect(disposed.changed.mock.calls.length).toBe(emissions);
  });

  it('returns deep-cloned records and does not expose private mutable state', async () => {
    const h = trackerHarness();
    await h.tracker.submit(intent(h.view));
    const first = h.tracker.list();
    first[0]!.intent.targets![0] = 'tampered';
    first[0]!.intent.requestId = 'tampered';
    const second = h.tracker.list();
    expect(second[0]!.intent.requestId).toBe('request-1');
    expect(second[0]!.intent.targets).toEqual(['p_a']);
  });

  it('reconciles only a matching authorized submissionState and never downgrades accepted', async () => {
    const h = trackerHarness();
    h.transport.send.mockRejectedValueOnce(new Error('late network loss'));
    await h.tracker.submit(intent(h.view));
    expect(h.tracker.list()[0]?.status).toBe('unknown');
    h.view.submissionState = [{ action: 'SUBMIT_GUARD', windowInstanceId: 'guard:1', requestId: 'request-1', acceptedAt: 123, targets: ['p_a'], revision: null, direction: null }];
    h.tracker.reconcile();
    expect(h.tracker.list()[0]?.status).toBe('accepted');
    await h.tracker.query('request-1');
    expect(h.transport.lookup).not.toHaveBeenCalled();
    expect(h.tracker.list()[0]?.status).toBe('accepted');

    const wrong = trackerHarness();
    wrong.transport.send.mockRejectedValueOnce(new Error('unknown'));
    await wrong.tracker.submit(intent(wrong.view));
    wrong.view.submissionState = [{ action: 'SUBMIT_GUARD', windowInstanceId: 'other-window', requestId: 'request-1', acceptedAt: 123, targets: ['p_a'], revision: null, direction: null }];
    wrong.tracker.reconcile();
    expect(wrong.tracker.list()[0]?.status).toBe('unknown');
    wrong.view.submissionState = [{ action: 'SUBMIT_GUARD', windowInstanceId: 'guard:1', requestId: 'other-request', acceptedAt: 123, targets: ['p_a'], revision: null, direction: null }];
    wrong.tracker.reconcile();
    expect(wrong.tracker.list()[0]?.status).toBe('unknown');
    wrong.view.submissionState = [{ action: 'SUBMIT_LAIKE', windowInstanceId: 'guard:1', requestId: 'request-1', acceptedAt: 123, targets: ['p_a'], revision: null, direction: null }];
    wrong.tracker.reconcile();
    expect(wrong.tracker.list()[0]?.status).toBe('unknown');

    for (const change of [
      (view: RoomSnapshot) => { view.viewer.readOnly = true; },
      (view: RoomSnapshot) => { view.viewer.userId = 'other-user'; },
      (view: RoomSnapshot) => { view.gameId = 'other-game'; },
      (view: RoomSnapshot) => { view.viewer.subjectPlayerId = 'other-player'; },
    ]) {
      const unauthorized = trackerHarness();
      unauthorized.transport.send.mockRejectedValueOnce(new Error('unknown'));
      await unauthorized.tracker.submit(intent(unauthorized.view));
      unauthorized.view.submissionState = [{ action: 'SUBMIT_GUARD', windowInstanceId: 'guard:1', requestId: 'request-1', acceptedAt: 123, targets: ['p_a'], revision: null, direction: null }];
      change(unauthorized.view);
      unauthorized.tracker.reconcile();
      expect(unauthorized.tracker.list()[0]?.status).toBe('unknown');
    }
  });

  it('wins races between reconcile and a late send rejection or lookup result', async () => {
    const sending = trackerHarness();
    const send = deferred<CommandReceipt>();
    sending.transport.send.mockImplementationOnce(async () => send.promise);
    const submission = sending.tracker.submit(intent(sending.view));
    await Promise.resolve();
    sending.view.submissionState = [{ action: 'SUBMIT_GUARD', windowInstanceId: 'guard:1', requestId: 'request-1', acceptedAt: 123, targets: ['p_a'], revision: null, direction: null }];
    sending.tracker.reconcile();
    send.reject(new Error('late network failure'));
    await submission;
    expect(sending.tracker.list()[0]?.status).toBe('accepted');
    expect(sending.failed).not.toHaveBeenCalled();

    const querying = trackerHarness();
    querying.transport.send.mockRejectedValueOnce(new Error('unknown'));
    await querying.tracker.submit(intent(querying.view));
    const lookup = deferred<ReceiptLookup>();
    querying.transport.lookup.mockImplementationOnce(async () => lookup.promise);
    const query = querying.tracker.query('request-1');
    await Promise.resolve();
    querying.view.submissionState = [{ action: 'SUBMIT_GUARD', windowInstanceId: 'guard:1', requestId: 'request-1', acceptedAt: 123, targets: ['p_a'], revision: null, direction: null }];
    querying.tracker.reconcile();
    lookup.resolve({ requestId: 'request-1', status: 'not_seen' });
    await query;
    expect(querying.tracker.list()[0]?.status).toBe('accepted');
  });
});
