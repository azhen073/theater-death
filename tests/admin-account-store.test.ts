import { describe, expect, it } from 'vitest';
import { AccountStore } from '../server/v2/account-store.ts';

describe('v2.2 administrator account store actions', () => {
  it('directly changes a password and revokes existing sessions', () => {
    const store = new AccountStore(':memory:', () => 1_000);
    const account = store.register('admin-reset', '管理员目标', 'old-hash').account;
    const session = store.createSession(account.id);
    store.changePassword(account.id, 'new-hash');
    expect(store.session(session.token)).toBeNull();
    expect(store.byId(account.id)?.passwordHash).toBe('new-hash');
    store.close();
  });

  it('deletes credentials while retaining an auditable tombstone request record', () => {
    const store = new AccountStore(':memory:', () => 2_000);
    const account = store.register('admin-delete', '待删除用户', 'hash').account;
    const session = store.createSession(account.id);
    expect(store.deleteAccount(account.id)).toMatchObject({ uid: account.uid, nickname: '待删除用户' });
    expect(store.session(session.token)).toBeNull();
    expect(store.byId(account.id)).toBeNull();
    expect(store.registrationRequest('admin-delete')).toMatchObject({ userId: null, uid: account.uid, nickname: '待删除用户' });
    store.close();
  });
});
