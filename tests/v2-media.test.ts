import { afterEach, describe, expect, it } from 'vitest';
import { beginDay, startDefaultSpeechRound } from '../engine/day.ts';
import { resolveMorning } from '../engine/morning.ts';
import { createFakeClock } from '../server/clock.ts';
import { AccountStore, type AccountSession } from '../server/v2/account-store.ts';
import { RoomAccess } from '../server/v2/access.ts';
import { ApiError } from '../server/v2/errors.ts';
import { V2Media } from '../server/v2/media.ts';
import { Room, type RoomMember } from '../server/rooms.ts';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import type { VoiceCredentials, VoiceService } from '../voice/agora.ts';
import { runNight, scenario } from './helpers.ts';

const accesses: RoomAccess[] = [];
const stores: AccountStore[] = [];

afterEach(() => {
  for (const access of accesses.splice(0)) access.close();
  for (const store of stores.splice(0)) store.close();
});

function fixture() {
  const clock = createFakeClock(1_000);
  const store = new AccountStore(':memory:', () => clock.now());
  stores.push(store);
  const host: RoomMember = { playerId: 'p_1', nickname: '玩家1', ready: true, joinedAt: clock.now() };
  const room = new Room('MEDIA01', 'g_media', host, THEATER_DEATH_13_V2);
  const account = store.register('media-user', 'mediauser', 'dummy-hash').account;
  const first = store.createSession(account.id).session;
  const access = new RoomAccess(room, store, () => clock.now(), () => undefined);
  access.bind('p_1', first);
  accesses.push(access);
  const morning = resolveMorning(runNight(scenario(), {})).state;
  const day = startDefaultSpeechRound(beginDay({ ...morning, ruleset: THEATER_DEATH_13_V2, dayNumber: 2 }).state).state;
  room.state = day;
  room.driver = { windows: () => [{ id: 'speech_round', instanceId: 'win-media', closesAt: clock.now() + 120_000 }], proposalState: () => null } as unknown as NonNullable<Room['driver']>;
  return { clock, store, room, access, account, first, mediaId: access.mediaId('p_1', access.seats.get('p_1')!.epoch), media: new V2Media(null, () => clock.now()) };
}


/** 观众（第二屏 / 公开观众）在该房间的媒体身份：按会话 id 在 watchers 租约里查。 */
function watcherIdentity(access: RoomAccess, session: AccountSession): string {
  const lease = [...access.watchers.values()].find((item) => item.sessionId === session.id);
  if (!lease) throw new Error('watcher_lease_missing');
  return access.mediaId(lease.id, lease.epoch);
}

function mockVoice(options: { issue?: (input: { roomName: string; uid: number }) => VoiceCredentials; close?: () => Promise<void>; remove?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const voice: VoiceService = {
    issueCredentials(input) {
      calls.push(`issue:${input.uid}`);
      if (options.issue) return options.issue(input);
      return { appId: 'appid-test', channel: input.roomName, uid: input.uid, token: `sub-${input.uid}` };
    },
    issuePublishGrant(input) {
      calls.push(`publish:${input.uid}`);
      return { token: `pub-${input.uid}`, expiresAt: 600_000 };
    },
    issueSubscriberGrant(input) {
      calls.push(`subscribe:${input.uid}`);
      return { token: `sub-${input.uid}` };
    },
    async closeRoom() { calls.push('close'); await options.close?.(); },
    async removeParticipant(_room, uid) { calls.push(`remove:${uid}`); await options.remove?.(); },
  };
  return { voice, calls };
}

describe('V2Media 授权与媒体副作用（声网）', () => {
  it('自由发言阶段：多名发布者同时有效，送达聚合按窗口计数且任何发布者自己的回执都不算', async () => {
    const f = fixture();
    // 切换到自由发言窗口（存活玩家都有发布权）
    f.room.state = { ...f.room.state!, day: { ...f.room.state!.day!, step: 'free_speech', freeSpeechDone: true } };
    f.room.driver = { windows: () => [{ id: 'free_speech', instanceId: 'win-free', closesAt: f.clock.now() + 120_000 }], proposalState: () => null } as unknown as NonNullable<Room['driver']>;
    // 再绑定两名正式玩家：自由发言阶段应当同时拥有发布权
    for (const [playerId, nickname] of [['p_2', 'mediaplayerb'], ['p_3', 'mediaplayerc']] as const) {
      const account = f.store.register(`media-${playerId}`, nickname, 'dummy-hash').account;
      f.access.bind(playerId, f.store.createSession(account.id).session);
    }
    const permissions = f.media.permissions(f.access);
    const publishIds = [...permissions].filter(([, canPublish]) => canPublish).map(([identity]) => identity);
    expect(publishIds.length).toBeGreaterThan(1);
    expect(publishIds).toContain(f.mediaId);

    // 发布者自己的回执不计入聚合
    const own = f.media.recordReceipt(f.access, f.mediaId, 'win-free', 'playing');
    expect(own.recorded).toBe(false);

    // 观众（非发布者）的回执计入；窗口实例变化即作废
    const observer = f.store.register('media-free-observer', 'mediafreeobserver', 'dummy-hash').account;
    const watcher = f.store.createSession(observer.id).session;
    f.access.watch(watcher);
    const watcherIdentity = [...f.access.watchers.values()][0]!;
    const watcherMediaId = f.access.mediaId(watcherIdentity.id, watcherIdentity.epoch);
    const recorded = f.media.recordReceipt(f.access, watcherMediaId, 'win-free', 'playing');
    expect(recorded.recorded).toBe(true);
    expect(recorded.delivery).toMatchObject({ windowInstanceId: 'win-free', delivered: 1, listeners: 1 });
    expect(f.media.recordReceipt(f.access, watcherMediaId, 'win-old', 'playing').recorded).toBe(false);

    // 频道 uid 映射只暴露正式玩家席位，供客户端把远端电平归属到座位（签发凭证时登记 uid）
    f.media = new V2Media(mockVoice().voice, () => f.clock.now());
    await f.media.issue(f.media.matchScope(f.access), f.mediaId);
    const uids = f.media.uidMap('g_media');
    expect(Object.values(uids)).toContain('p_1');
    expect(Object.values(uids).every((playerId) => playerId.startsWith('p_'))).toBe(true);
  });

  it('permissions 由 gameView 当前发言者权限计算，observer 永远不可发布', () => {
    const f = fixture();
    const observer = f.store.register('media-observer', 'mediaobserver', 'dummy-hash').account;
    const watcher = f.store.createSession(observer.id).session;
    f.access.watch(watcher);
    const permissions = f.media.permissions(f.access);
    expect(permissions.get(f.mediaId)).toBe(true);
    const watcherLease = [...f.access.watchers.values()][0]!;
    expect(permissions.get(f.access.mediaId(watcherLease.id, watcherLease.epoch))).toBe(false);
  });

  it('issue 按当前权限签发发布 token（轮到的发言者）或订阅 token（其余人）', async () => {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    const credentials = await media.issue(media.matchScope(f.access), f.mediaId);
    expect(credentials).toMatchObject({ appId: 'appid-test', channel: 'g_media' });
    expect(credentials.token).toMatch(/^pub-\d+$/);

    const observer = f.store.register('media-observer', 'mediaobserver', 'dummy-hash').account;
    const watcher = f.store.createSession(observer.id).session;
    f.access.watch(watcher);
    const watcherCredentials = await media.issue(media.matchScope(f.access), watcherIdentity(f.access, watcher));
    expect(watcherCredentials.token).toMatch(/^sub-\d+$/);
  });

  it('revoke 踢出旧 identity；sync 对已移除 identity 不重复踢；失效 session 不入 permissions', async () => {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    await media.issue(media.matchScope(f.access), f.mediaId);
    const next = f.store.createSession(f.account.id).session;
    f.access.takeover(next);

    await Promise.all([media.revoke(f.room.gameId, f.mediaId), media.sync(media.matchScope(f.access))]);

    expect(mock.calls.filter((call) => call.startsWith('remove:'))).toHaveLength(1);
    const removedUid = Number(mock.calls.find((call) => call.startsWith('remove:'))!.slice('remove:'.length));
    expect(Number.isInteger(removedUid)).toBe(true);
    f.store.logout(next.id);
    f.access.expireSessions();
    expect(f.media.permissions(f.access).has(f.mediaId)).toBe(false);
  });

  it('sync 踢出已无租约的已知 identity', async () => {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    await media.issue(media.matchScope(f.access), f.mediaId);
    f.store.logout(f.first.id);
    f.access.expireSessions();

    await media.sync(media.matchScope(f.access));

    expect(mock.calls.filter((call) => call.startsWith('remove:'))).toHaveLength(1);
    await media.sync(media.matchScope(f.access));
    expect(mock.calls.filter((call) => call.startsWith('remove:'))).toHaveLength(1);
  });

  it('joined 对未知身份不产生媒体操作（声网下无凭证身份不存在）', async () => {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    await media.joined(undefined, 'unknown');
    expect(mock.calls).toEqual([]);
    await media.joined(media.matchScope(f.access), f.mediaId);
    expect(mock.calls).toEqual([]);
  });

  it('win 状态关闭媒体且拒绝 issue', async () => {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    f.room.state = { ...f.room.state!, win: { winner: 'human', dayNumber: 2, reason: 'test' } };
    await media.sync(media.matchScope(f.access));
    expect(mock.calls).toContain('close');
    await expect(media.issue(media.matchScope(f.access), f.mediaId)).rejects.toMatchObject({ code: 'voice_unavailable' });
  });

  it('sync 关房失败不阻塞游戏；issue 失败映射为 503', async () => {
    const f = fixture();
    const mock = mockVoice({ close: async () => { throw new Error('close down'); } });
    const media = new V2Media(mock.voice, () => f.clock.now());
    f.room.state = { ...f.room.state!, win: { winner: 'human', dayNumber: 2, reason: 'test' } };
    await expect(media.sync(media.matchScope(f.access))).resolves.toBeUndefined();

    const g = fixture();
    const failing = mockVoice({ issue: () => { throw new Error('issue down'); } });
    const failingMedia = new V2Media(failing.voice, () => g.clock.now());
    await expect(failingMedia.issue(failingMedia.matchScope(g.access), g.mediaId)).rejects.toMatchObject({ code: 'voice_unavailable', status: 503 });
    expect(failingMedia.voice).toBe(failing.voice);
    expect(new ApiError(409, 'voice_disabled')).toBeInstanceOf(ApiError);
  });

  it('踢出失败保留映射：后续 sync 重试，成功后不再重复踢', async () => {
    const f = fixture();
    const calls: string[] = [];
    let failing = true;
    const voice: VoiceService = {
      issueCredentials: (input) => ({ appId: 'appid-test', channel: input.roomName, uid: input.uid, token: `sub-${input.uid}` }),
      issuePublishGrant: (input) => ({ token: `pub-${input.uid}`, expiresAt: 1 }),
      issueSubscriberGrant: (input) => ({ token: `sub-${input.uid}` }),
      async closeRoom() { /* noop */ },
      async removeParticipant(_room, uid) { calls.push(`remove:${uid}`); if (failing) throw new Error('rest down'); },
    };
    const media = new V2Media(voice, () => f.clock.now());
    await media.issue(media.matchScope(f.access), f.mediaId);
    f.store.logout(f.first.id);
    f.access.expireSessions();

    await media.sync(media.matchScope(f.access));
    await media.sync(media.matchScope(f.access));
    expect(calls).toHaveLength(2); // 两次都没踢成功，映射仍在 → 还会重试

    failing = false;
    await media.sync(media.matchScope(f.access));
    expect(calls).toHaveLength(3);
    await media.sync(media.matchScope(f.access));
    expect(calls).toHaveLength(3); // 踢成功后不再重复
  });

  it('required 的 sync 失败后队列不被吞：后续媒体操作照常执行', async () => {
    const f = fixture();
    let closes = 0;
    const voice: VoiceService = {
      issueCredentials: (input) => ({ appId: 'appid-test', channel: input.roomName, uid: input.uid, token: `sub-${input.uid}` }),
      issuePublishGrant: (input) => ({ token: `pub-${input.uid}`, expiresAt: 1 }),
      issueSubscriberGrant: (input) => ({ token: `sub-${input.uid}` }),
      // 第一次关房必失败（与微任务时序无关），第二次成功
      async closeRoom() { closes += 1; if (closes === 1) throw new Error('close down'); },
      async removeParticipant() { /* noop */ },
    };
    const media = new V2Media(voice, () => f.clock.now());
    f.room.state = { ...f.room.state!, win: { winner: 'human', dayNumber: 2, reason: 'test' } };

    // 关键：第二次入队发生在第一次失败落定之前（此时队列里挂着的正是 rejected promise）
    const first = media.sync(media.matchScope(f.access), true);
    const second = media.sync(media.matchScope(f.access), true);
    await expect(first).rejects.toThrow('close down');
    // 修复前：第二次的 work 被 .then 在 rejected promise 上跳过 → 这里会以同一错误 reject，closes 停在 1
    await expect(second).resolves.toBeUndefined();
    expect(closes).toBe(2);
  });
});

/** 造一个"能对账"的声网适配器：频道内用户由测试给定 */
function reconcilingVoice(options: { users: number[]; fail?: boolean; query?: boolean }) {
  const calls: string[] = [];
  const voice: VoiceService = {
    issueCredentials: (input) => ({ appId: 'appid-test', channel: input.roomName, uid: input.uid, token: `sub-${input.uid}` }),
    issuePublishGrant: (input) => ({ token: `pub-${input.uid}`, expiresAt: 1 }),
    issueSubscriberGrant: (input) => ({ token: `sub-${input.uid}` }),
    async closeRoom() { /* noop */ },
    async removeParticipant(_room, uid) { calls.push(`remove:${uid}`); },
    ...(options.query === false ? {} : {
      async queryChannelUsers() {
        if (options.fail) throw new Error('query down');
        return { channelExist: true, mode: 1, users: options.users };
      },
    }),
  };
  return { voice, calls };
}

describe('V2Media 送达回执聚合（C 组）', () => {
  function setup() {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    const observer = f.store.register('delivery-observer', '旁观者', 'dummy-hash').account;
    const watcher = f.store.createSession(observer.id).session;
    f.access.watch(watcher);
    const lease = [...f.access.watchers.values()][0]!;
    return { f, media, receiver: f.access.mediaId(lease.id, lease.epoch) };
  }

  it('接收端回执按发言窗口聚合；同一接收端后报覆盖前报；发言者自己的回执不算', async () => {
    const { f, media, receiver } = setup();
    await media.issue(media.matchScope(f.access), f.mediaId);

    const first = media.recordReceipt(f.access, receiver, 'win-media', 'playing');
    expect(first.recorded).toBe(true);
    expect(first.push).toBe(true);
    expect(first.delivery).toMatchObject({ windowInstanceId: 'win-media', delivered: 1, listeners: 1 });

    media.recordReceipt(f.access, receiver, 'win-media', 'silent-output');
    expect(media.deliveryFor(f.room.gameId)).toMatchObject({ delivered: 0, silentOutput: 1, listeners: 1 });

    // 发言者自己的回执是自证，不算送达
    expect(media.recordReceipt(f.access, f.mediaId, 'win-media', 'playing').recorded).toBe(false);
    // 不在当前窗口 / 不在权限表里的身份
    expect(media.recordReceipt(f.access, receiver, 'win-other', 'playing').recorded).toBe(false);
    expect(media.recordReceipt(f.access, 'v2:g_media:p_9:nope', 'win-media', 'playing').recorded).toBe(false);
  });

  it('push 节流：同状态不推、状态变化但未满 1 秒不推、满 1 秒后才推', async () => {
    const { f, media, receiver } = setup();
    await media.issue(media.matchScope(f.access), f.mediaId);

    expect(media.recordReceipt(f.access, receiver, 'win-media', 'playing').push).toBe(true);
    expect(media.recordReceipt(f.access, receiver, 'win-media', 'playing').push).toBe(false);
    expect(media.recordReceipt(f.access, receiver, 'win-media', 'blocked').push).toBe(false);
    f.clock.advance(1_000);
    expect(media.recordReceipt(f.access, receiver, 'win-media', 'playing').push).toBe(true);
  });

  it('发言窗口更换后旧聚合作废（sync 清理），对局结束也清空', async () => {
    const { f, media, receiver } = setup();
    await media.issue(media.matchScope(f.access), f.mediaId);
    media.recordReceipt(f.access, receiver, 'win-media', 'playing');
    expect(media.deliveryFor(f.room.gameId)).not.toBeNull();

    f.room.driver = { windows: () => [{ id: 'speech_round', instanceId: 'win-2', closesAt: f.clock.now() + 120_000 }], proposalState: () => null } as unknown as NonNullable<Room['driver']>;
    await media.sync(media.matchScope(f.access));
    expect(media.deliveryFor(f.room.gameId)).toBeNull();

    media.recordReceipt(f.access, receiver, 'win-2', 'playing');
    f.room.state = { ...f.room.state!, win: { winner: 'human', dayNumber: 2, reason: 'test' } };
    await media.sync(media.matchScope(f.access));
    expect(media.deliveryFor(f.room.gameId)).toBeNull();
  });
});

describe('V2Media 频道对账（D 组）', () => {
  it('踢掉频道里不认识的 uid，保留已知 uid（听众同样合法在线，不得误踢）', async () => {
    const f = fixture();
    const mock = reconcilingVoice({ users: [1, 2, 999] });
    const media = new V2Media(mock.voice, () => f.clock.now());
    await media.issue(media.matchScope(f.access), f.mediaId);                        // 发言者 → uid 1
    const observer = f.store.register('reconcile-observer', '旁观者', 'dummy-hash').account;
    const watcher = f.store.createSession(observer.id).session;
    f.access.watch(watcher);
    await media.issue(media.matchScope(f.access), watcherIdentity(f.access, watcher));                        // 听众 → uid 2（只有订阅凭证）

    await media.reconcile(media.matchScope(f.access));
    expect(mock.calls).toEqual(['remove:999']);
    expect(media.reconcileSnapshot()).toMatchObject({ rounds: 1, unknownKicks: 1, notInChannel: 0, failures: 0, skipped: 0 });
  });

  it('统计"该在却不在"的身份数', async () => {
    const f = fixture();
    const mock = reconcilingVoice({ users: [] });
    const media = new V2Media(mock.voice, () => f.clock.now());
    await media.issue(media.matchScope(f.access), f.mediaId);
    await media.reconcile(media.matchScope(f.access));
    expect(mock.calls).toEqual([]);
    expect(media.reconcileSnapshot()).toMatchObject({ rounds: 1, notInChannel: 1, unknownKicks: 0 });
  });

  it('每轮最多踢 3 个未知 uid', async () => {
    const f = fixture();
    const mock = reconcilingVoice({ users: [901, 902, 903, 904] });
    const media = new V2Media(mock.voice, () => f.clock.now());
    await media.issue(media.matchScope(f.access), f.mediaId);
    await media.reconcile(media.matchScope(f.access));
    expect(mock.calls).toHaveLength(3);
  });

  it('查询失败只计失败并保持游戏可用；适配器不支持查询则跳过', async () => {
    const f = fixture();
    const failing = reconcilingVoice({ users: [], fail: true });
    const media = new V2Media(failing.voice, () => f.clock.now());
    await media.issue(media.matchScope(f.access), f.mediaId);
    await expect(media.reconcile(media.matchScope(f.access))).resolves.toBeUndefined();
    expect(media.reconcileSnapshot()).toMatchObject({ rounds: 0, failures: 1 });

    const g = fixture();
    const unsupported = reconcilingVoice({ users: [], query: false });
    const plain = new V2Media(unsupported.voice, () => g.clock.now());
    await plain.issue(plain.matchScope(g.access), g.mediaId);
    await plain.reconcile(plain.matchScope(g.access));
    expect(plain.reconcileSnapshot()).toMatchObject({ skipped: 1, rounds: 0 });
  });
});

describe('房间频道（Q-12：大厅 / 复盘自由开麦）', () => {
  const member = (memberId: string, kind: 'formal' | 'public_spectator', sessionId: string | null = `s-${memberId}`) => ({ memberId, epoch: `e-${memberId}`, sessionId, kind });
  const roomSource = (...members: ReturnType<typeof member>[]) => ({ roomId: 'r_lobby', members: new Map(members.map((item) => [item.memberId, item])) });

  it('频道名独立于任何一局；正式成员可发布、观众只订阅、离线成员不入表', () => {
    const media = new V2Media(null, () => 1_000);
    const scope = media.roomScope(roomSource(member('m_a', 'formal'), member('m_b', 'public_spectator'), member('m_c', 'formal', null)));
    expect(scope.channel).toBe('l_r_lobby');
    expect(scope.ended).toBe(false);
    expect(scope.match).toBeNull();
    expect([...scope.members]).toEqual([
      ['v2:l_r_lobby:m_a:e-m_a', true],
      ['v2:l_r_lobby:m_b:e-m_b', false],
    ]);
  });

  it('签发：正式成员拿发布凭证、观众拿订阅凭证；uid 映射的主体是 memberId', async () => {
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => 1_000);
    const scope = media.roomScope(roomSource(member('m_a', 'formal'), member('m_b', 'public_spectator')));
    const formal = await media.issue(scope, 'v2:l_r_lobby:m_a:e-m_a');
    const spectator = await media.issue(scope, 'v2:l_r_lobby:m_b:e-m_b');
    expect(formal).toMatchObject({ channel: 'l_r_lobby' });
    expect(formal.token).toMatch(/^pub-\d+$/);
    expect(spectator.token).toMatch(/^sub-\d+$/);
    expect(media.uidMap('l_r_lobby')).toEqual({ '1': 'm_a', '2': 'm_b' });
  });

  it('sync 回收已离线成员（epoch 轮换后的旧身份不再在表内）', async () => {
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => 1_000);
    const online = roomSource(member('m_a', 'formal'), member('m_b', 'formal'));
    await media.issue(media.roomScope(online), 'v2:l_r_lobby:m_a:e-m_a');
    await media.issue(media.roomScope(online), 'v2:l_r_lobby:m_b:e-m_b');

    // m_b 离线：表里只剩 m_a，重连后的 m_b 会拿到新身份
    const afterLeave = roomSource(member('m_a', 'formal'), member('m_b', 'formal', null));
    await media.sync(media.roomScope(afterLeave));
    expect(mock.calls.filter((call) => call.startsWith('remove:'))).toHaveLength(1);
  });

  it('房间频道不产生送达回执（没有发言窗口），也不因对局结束而关房', async () => {
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => 1_000);
    const scope = media.roomScope(roomSource(member('m_a', 'formal')));
    await media.issue(scope, 'v2:l_r_lobby:m_a:e-m_a');
    await media.sync(scope, true);
    expect(mock.calls).not.toContain('close');
    expect(media.deliveryFor('l_r_lobby')).toBeNull();
  });
});
