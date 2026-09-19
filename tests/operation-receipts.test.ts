import { describe, expect, it } from 'vitest';
import { OperationReceipts } from '../server/v2/operation-receipts.ts';

describe('operation receipt tickets', () => {
  it('shares one pending owner promise and replays the finished response', async () => {
    const receipts = new OperationReceipts();
    const owner = receipts.reserve('account-a', 'create', 'same-id', { operation: 'create', body: { requestId: 'same-id' } });
    const waiter = receipts.reserve('account-a', 'create', 'same-id', { operation: 'create', body: { requestId: 'same-id' } });
    expect(owner.owner).toBe(true);
    expect(waiter.owner).toBe(false);
    expect(waiter.promise).toBe(owner.promise);
    owner.finish({ status: 201, body: { roomId: 'room-1', memberId: 'member-1' } });
    await expect(waiter.promise).resolves.toEqual({ status: 201, body: { roomId: 'room-1', memberId: 'member-1' } });
    const replay = receipts.reserve('account-a', 'create', 'same-id', { operation: 'create', body: { requestId: 'same-id' } });
    expect(replay.owner).toBe(false);
    await expect(replay.promise).resolves.toEqual({ status: 201, body: { roomId: 'room-1', memberId: 'member-1' } });
  });

  it('rejects changed body or operation while preserving the original intent', () => {
    const receipts = new OperationReceipts();
    const owner = receipts.reserve('account-a', 'room:ABC234', 'intent-1', { operation: 'ready', body: { requestId: 'intent-1', ready: true } });
    owner.finish({ status: 200, body: { ready: true } });
    expect(() => receipts.reserve('account-a', 'room:ABC234', 'intent-1', { operation: 'ready', body: { requestId: 'intent-1', ready: false } })).toThrowError(expect.objectContaining({ code: 'request_id_reused' }));
    expect(() => receipts.reserve('account-a', 'room:ABC234', 'intent-1', { operation: 'start', body: { requestId: 'intent-1', ready: true } })).toThrowError(expect.objectContaining({ code: 'request_id_reused' }));
  });

  it('keeps deterministic rejection receipts but releases admission failures for retry', async () => {
    const receipts = new OperationReceipts();
    const rejected = receipts.reserve('account-a', 'room:ABC234', 'reject-1', { operation: 'ready', body: { requestId: 'reject-1' } });
    rejected.finish({ status: 500, body: { error: { code: 'internal_error' } } });
    const rejectedReplay = receipts.reserve('account-a', 'room:ABC234', 'reject-1', { operation: 'ready', body: { requestId: 'reject-1' } });
    await expect(rejectedReplay.promise).resolves.toEqual({ status: 500, body: { error: { code: 'internal_error' } } });

    const retryable = receipts.reserve('account-a', 'room:ABC234', 'retry-1', { operation: 'ready', body: { requestId: 'retry-1' } });
    retryable.finish({ status: 429, body: { error: { code: 'rate_limited' } } });
    await expect(retryable.promise).resolves.toEqual({ status: 429, body: { error: { code: 'rate_limited' } } });
    const retry = receipts.reserve('account-a', 'room:ABC234', 'retry-1', { operation: 'ready', body: { requestId: 'retry-1' } });
    expect(retry.owner).toBe(true);
    retry.finish({ status: 200, body: { ready: true } });
  });

  it('isolates account and scope keys and never treats an unfinished ticket as done', async () => {
    const receipts = new OperationReceipts();
    const pending = receipts.reserve('account-a', 'room:ABC234', 'same-id', { operation: 'leave', body: { requestId: 'same-id' } });
    const sameAccountOtherRoom = receipts.reserve('account-a', 'room:XYZ789', 'same-id', { operation: 'leave', body: { requestId: 'same-id' } });
    const otherAccount = receipts.reserve('account-b', 'room:ABC234', 'same-id', { operation: 'leave', body: { requestId: 'same-id' } });
    expect(sameAccountOtherRoom.owner).toBe(true);
    expect(otherAccount.owner).toBe(true);
    let settled = false;
    void pending.promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    pending.finish({ status: 200, body: { left: true } });
    await expect(pending.promise).resolves.toEqual({ status: 200, body: { left: true } });
  });
});
