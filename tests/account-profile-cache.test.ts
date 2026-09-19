import { describe, expect, it } from 'vitest';
import { AccountStore } from '../server/v2/account-store.ts';

describe('account profile cache', () => {
  it('returns defensive v2.2 profiles with uid and nickname', () => {
    const store = new AccountStore(':memory:', () => 1_000);
    const account = store.register('cache-request', '缓存用户', 'hash').account;
    const first = store.profile(account.id);
    first.nickname = 'mutated-client-copy';
    expect(store.profile(account.id)).toEqual({ userId: account.id, uid: account.uid, nickname: '缓存用户', avatarUrl: null, profileVersion: 0 });
    store.close();
  });
});
