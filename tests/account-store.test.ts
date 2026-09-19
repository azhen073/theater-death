import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../server/v2/account-store.ts';

const stores: AccountStore[] = [], dirs: string[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('v2.2 account store', () => {
  it('registers idempotently by request id and keeps the same uid', () => {
    const store = new AccountStore(':memory:', () => 1_000); stores.push(store);
    const first = store.register('request-1', '张三', 'hash-a');
    const replay = store.register('request-1', '张三', 'hash-b');
    expect(first).toMatchObject({ replayed: false, account: { uid: '10000001', nickname: '张三' } });
    expect(replay).toMatchObject({ replayed: true, account: { id: first.account.id, uid: '10000001' } });
    expect(() => store.register('request-1', '李四', 'hash-c')).toThrow();
  });

  it('reopens persisted account profiles and sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'theater-account-v22-')); dirs.push(dir);
    const path = join(dir, 'accounts.sqlite');
    const first = new AccountStore(path, () => 2_000); stores.push(first);
    const account = first.register('request-2', 'Persisted', 'hash-p').account;
    const session = first.createSession(account.id); first.close(); stores.splice(stores.indexOf(first), 1);
    const reopened = new AccountStore(path, () => 2_000); stores.push(reopened);
    expect(reopened.profile(account.id)).toMatchObject({ uid: account.uid, nickname: 'Persisted' });
    expect(reopened.session(session.token)).toMatchObject({ userId: account.id });
  });

  it('does not reuse uid after account deletion', () => {
    const store = new AccountStore(':memory:', () => 3_000); stores.push(store);
    const first = store.register('request-3', 'First', 'hash-a').account;
    store.deleteAccount(first.id);
    const next = store.register('request-4', 'Second', 'hash-b').account;
    expect(next.uid).toBe('10000002');
    expect(store.profileOrNull(first.id)).toBeNull();
  });
});
