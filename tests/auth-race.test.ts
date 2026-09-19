import { describe, expect, it } from 'vitest';
import { AccountStore } from '../server/v2/account-store.ts';

describe('v2.2 registration race safety', () => {
  it('concurrent same request id yields one account and one uid', async () => {
    const store = new AccountStore(':memory:', () => 1_000);
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => store.register('race-request', '竞速用户', 'hash-a')),
      Promise.resolve().then(() => store.register('race-request', '竞速用户', 'hash-b')),
    ]);
    expect(first.account.id).toBe(second.account.id);
    expect(first.account.uid).toBe('10000001');
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    store.close();
  });
});
