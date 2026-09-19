import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore, type AccountSession } from '../server/v2/account-store.ts';
import { RoomAccess } from '../server/v2/access.ts';
import { ApiError } from '../server/v2/errors.ts';
import { Room, type RoomMember } from '../server/rooms.ts';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';

const stores: AccountStore[] = [];
const accesses: RoomAccess[] = [];
afterEach(() => {
  for (const access of accesses.splice(0)) access.close();
  for (const store of stores.splice(0)) store.close();
});

function errorCode(action: () => unknown): string {
  try { action(); } catch (error) { expect(error).toBeInstanceOf(ApiError); return (error as ApiError).code; }
  throw new Error('expected ApiError');
}

function fixture() {
  const now = { value: 1_000 };
  const store = new AccountStore(':memory:', () => now.value);
  stores.push(store);
  const host: RoomMember = { playerId: 'p_1', nickname: '玩家1', ready: true, joinedAt: now.value };
  const room = new Room('R1', 'g1', host, THEATER_DEATH_13);
  const users = new Map<string, AccountSession>();
  for (const username of ['user_a', 'user_b', 'user_c', 'user_d']) {
    const account = store.register(`access-${username}`, username, 'dummy-hash').account;
    users.set(username, store.createSession(account.id).session);
  }
  const revoked: string[] = [];
  const access = new RoomAccess(room, store, () => now.value, (identity) => revoked.push(identity));
  accesses.push(access);
  return { now, store, room, users, access, revoked };
}

describe('16 席位访问租约', () => {
  it('登录不接管旧 session，显式 takeover 才失效旧 resolve 并撤销媒体', () => {
    const f = fixture();
    const first = f.users.get('user_a')!;
  const secondAccount = f.store.byId(f.users.get('user_a')!.userId)!;
    const second = f.store.createSession(secondAccount.id).session;
    f.access.bind('p_1', first);
    expect(f.access.resolve(first)).not.toBeNull();
    expect(f.access.resolve(second)).toBeNull();
    expect(f.access.takeover(second)).toBe('p_1');
    expect(f.access.resolve(first)).toBeNull();
    expect(f.access.resolve(second)).not.toBeNull();
    expect(f.revoked).toHaveLength(1);
  });

  it('leave 只释放连接租约并保留席位，账号 logout 后 resolve 失效', () => {
    const f = fixture();
    const session = f.users.get('user_a')!;
    f.access.bind('p_1', session);
    f.access.leave(session);
    expect(f.access.ownSeat(session.userId)).toBe('p_1');
    expect(f.access.resolve(session)).toBeNull();
    const newSession = f.store.createSession(session.userId).session;
    expect(f.access.resolve(newSession)).toBeNull();
    f.store.logout(newSession.id);
    expect(f.access.resolve(newSession)).toBeNull();
  });
});

describe('17 公开观战访问', () => {
  it('公开观战 subject 为 null 且只读，玩家不能观战同局', () => {
    const f = fixture();
    const player = f.users.get('user_a')!;
    const publicViewer = f.users.get('user_b')!;
    f.access.bind('p_1', player);
    const watcherId = f.access.watch(publicViewer);
    expect(watcherId).toEqual(expect.any(String));
    const resolved = f.access.resolve(publicViewer);
    expect(resolved?.identity).toEqual({ subjectPlayerId: null, readOnly: true });
    expect(errorCode(() => f.access.watch(player))).toBe('player_cannot_spectate');
  });
});

describe('18 私人第二屏访问', () => {
  it('兑换 token 绑定 subject、一次性消费且每个 subject 只能有一个观众', () => {
    const f = fixture();
    const player = f.users.get('user_a')!;
    const watcher = f.users.get('user_b')!;
    const secondWatcher = f.users.get('user_c')!;
    f.access.bind('p_1', player);
    const invite = f.access.inviteScreen('p_1');
    const watcherId = f.access.redeem(watcher, invite.token);
    expect(watcherId).toEqual(expect.any(String));
    expect(f.access.resolve(watcher)?.identity).toEqual({ subjectPlayerId: 'p_1', readOnly: true });
    expect(errorCode(() => f.access.redeem(watcher, invite.token))).toBe('invalid_screen_invitation');
    const another = f.access.inviteScreen('p_1');
    expect(errorCode(() => f.access.redeem(secondWatcher, another.token))).toBe('second_screen_unavailable');
    expect(errorCode(() => f.access.watch(watcher, 'p_1'))).toBe('already_watching');
  });

  it('第二屏 token 五分钟过期且不能跨 room 兑换', () => {
    const f = fixture();
    const player = f.users.get('user_a')!;
    const watcher = f.users.get('user_b')!;
    f.access.bind('p_1', player);
    const invite = f.access.inviteScreen('p_1');
    f.now.value += 300_000;
    expect(errorCode(() => f.access.redeem(watcher, invite.token))).toBe('invalid_screen_invitation');

    const fresh = f.access.inviteScreen('p_1');
    const otherRoom = new Room('R2', 'g2', { ...f.room.members[0]!, playerId: 'q_1' }, THEATER_DEATH_13);
    const otherAccess = new RoomAccess(otherRoom, f.store, () => f.now.value, () => undefined);
    accesses.push(otherAccess);
    expect(errorCode(() => otherAccess.redeem(watcher, fresh.token))).toBe('invalid_screen_invitation');
  });

  it('revokeScreens 使 subject 观众 resolve 失效并撤销媒体', () => {
    const f = fixture();
    const player = f.users.get('user_a')!;
    const watcher = f.users.get('user_b')!;
    f.access.bind('p_1', player);
    const invite = f.access.inviteScreen('p_1');
    f.access.redeem(watcher, invite.token);
    const before = f.revoked.length;
    f.access.revokeScreens('p_1');
    expect(f.access.resolve(watcher)).toBeNull();
    expect(f.revoked.length).toBe(before + 1);
  });
});
