import { describe, expect, it } from 'vitest';
import { ReceiptStore, RequestFingerprintError, requestFingerprint } from '../server/receipts.ts';
import type { CommandReceipt } from '../server/rooms.ts';

function receipt(requestId: string, code = 'accepted'): CommandReceipt {
  return {
    requestId,
    status: code === 'accepted' ? 'accepted' : 'rejected',
    code: code === 'accepted' ? null : code,
    message: null,
  };
}

describe('ReceiptStore 请求幂等与指纹', () => {
  it('不同游戏或不同玩家使用同一 requestId 时彼此独立执行', () => {
    const store = new ReceiptStore();
    let applied = 0;
    const apply = () => {
      applied += 1;
      return receipt('same');
    };

    store.execute('game-a', 'player-a', 'same', { action: 'x' }, apply);
    store.execute('game-b', 'player-a', 'same', { action: 'x' }, apply);
    store.execute('game-a', 'player-b', 'same', { action: 'x' }, apply);

    expect(applied).toBe(3);
  });

  it('同一人同一 requestId 同一 payload 返回原回执且只执行一次', () => {
    const store = new ReceiptStore();
    let applied = 0;
    const first = store.execute('game', 'player', 'req', { action: 'x' }, () => {
      applied += 1;
      return receipt('req');
    });
    const replay = store.execute('game', 'player', 'req', { action: 'x' }, () => {
      applied += 1;
      return receipt('req', 'should_not_run');
    });

    expect(replay).toBe(first);
    expect(applied).toBe(1);
  });

  it('同一键复用不同 payload 时拒绝且不执行', () => {
    const store = new ReceiptStore();
    let applied = 0;
    store.execute('game', 'player', 'req', { action: 'x' }, () => {
      applied += 1;
      return receipt('req');
    });
    const conflict = store.execute('game', 'player', 'req', { action: 'y' }, () => {
      applied += 1;
      return receipt('req', 'should_not_run');
    });

    expect(conflict).toMatchObject({ requestId: 'req', status: 'rejected', code: 'request_id_reused' });
    expect(applied).toBe(1);
  });

  it('对象键顺序不影响指纹，数组顺序影响指纹', () => {
    const store = new ReceiptStore();
    let applied = 0;
    const apply = () => {
      applied += 1;
      return receipt('req');
    };
    const first = store.execute(
      'game',
      'player',
      'req',
      { action: 'x', nested: { b: 2, a: 1 }, targets: ['p_1', 'p_2'] },
      apply,
    );
    const reorderedKeys = store.execute(
      'game',
      'player',
      'req',
      { targets: ['p_1', 'p_2'], nested: { a: 1, b: 2 }, action: 'x' },
      apply,
    );
    const reorderedArray = store.execute(
      'game',
      'player',
      'req',
      { action: 'x', nested: { a: 1, b: 2 }, targets: ['p_2', 'p_1'] },
      apply,
    );

    expect(reorderedKeys).toBe(first);
    expect(reorderedArray).toMatchObject({ status: 'rejected', code: 'request_id_reused' });
    expect(applied).toBe(1);
  });

  it('queued receipts expose pending, deduplicate same payload, and reject conflicts before execution', async () => {
    const store = new ReceiptStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let applied = 0;
    const first = store.executeQueued('game', 'player', 'queued', { action: 'x' }, async () => {
      await gate;
      applied += 1;
      return receipt('queued');
    });
    expect(store.lookup('game', 'player', 'queued')).toEqual({ requestId: 'queued', status: 'pending' });
    const retry = store.executeQueued('game', 'player', 'queued', { action: 'x' }, async () => { applied += 1; return receipt('queued', 'wrong'); });
    const conflict = await store.executeQueued('game', 'player', 'queued', { action: 'y' }, async () => { applied += 1; return receipt('queued', 'wrong'); });
    expect(conflict).toMatchObject({ requestId: 'queued', status: 'rejected', code: 'request_id_reused' });
    release();
    await expect(retry).resolves.toEqual(await first);
    expect(applied).toBe(1);
    expect(store.lookup('game', 'player', 'queued')).toMatchObject({ requestId: 'queued', status: 'accepted' });
  });

  it('tags null, Infinity, and -0 distinctly and rejects payloads deeper than 32 levels', () => {
    expect(requestFingerprint(null)).not.toBe(requestFingerprint('null'));
    expect(requestFingerprint(Infinity)).not.toBe(requestFingerprint(null));
    expect(requestFingerprint(-0)).not.toBe(requestFingerprint(0));
    let nested: unknown = null;
    for (let depth = 0; depth < 34; depth += 1) nested = { next: nested };
    expect(() => requestFingerprint(nested)).toThrow(RequestFingerprintError);
  });
});
