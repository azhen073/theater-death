import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { AccountStore } from '../server/v2/account-store.ts';
import { authRouter } from '../server/v2/auth.ts';

const stores: AccountStore[] = [], servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve())); for (const store of stores.splice(0)) store.close(); });

describe('v2.2 account profile contract', () => {
  it('returns uid and nickname consistently from profile and registration', () => {
    const store = new AccountStore(':memory:', () => 1_000); stores.push(store);
    const account = store.register('profile-1', '资料用户', 'hash').account;
    expect(store.profile(account.id)).toEqual({ userId: account.id, uid: '10000001', nickname: '资料用户', avatarUrl: null, profileVersion: 0 });
    expect(store.rename(account.id, '新昵称')).toMatchObject({ uid: '10000001', nickname: '新昵称', profileVersion: 1 });
  });

  it('supports Unicode nickname normalization and rejects malformed names', () => {
    const store = new AccountStore(':memory:', () => 1_000); stores.push(store);
    expect(store.register('profile-2', 'e\u0301e', 'hash').account.nickname).toBe('ée');
    for (const nickname of ['', 'a', 'a b', 'a'.repeat(33)]) expect(() => store.register(`bad-${nickname}`, nickname, 'hash')).toThrow();
  });
});
