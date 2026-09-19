import { afterEach, describe, expect, it } from 'vitest';
import { beginDay, startDefaultSpeechRound } from '../engine/day.ts';
import { resolveMorning } from '../engine/morning.ts';
import { createFakeClock } from '../server/clock.ts';
import { AccountStore } from '../server/v2/account-store.ts';
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
  room.driver = { windows: () => [{ id: 'speech_round', closesAt: clock.now() + 120_000 }], proposalState: () => null } as unknown as NonNullable<Room['driver']>;
  return { clock, store, room, access, account, first, mediaId: access.mediaId('p_1', access.seats.get('p_1')!.epoch), media: new V2Media(null, () => clock.now()) };
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
    const credentials = await media.issue(f.access, f.first);
    expect(credentials).toMatchObject({ appId: 'appid-test', channel: 'g_media' });
    expect(credentials.token).toMatch(/^pub-\d+$/);

    const observer = f.store.register('media-observer', 'mediaobserver', 'dummy-hash').account;
    const watcher = f.store.createSession(observer.id).session;
    f.access.watch(watcher);
    const watcherCredentials = await media.issue(f.access, watcher);
    expect(watcherCredentials.token).toMatch(/^sub-\d+$/);
  });

  it('revoke 踢出旧 identity；sync 对已移除 identity 不重复踢；失效 session 不入 permissions', async () => {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    await media.issue(f.access, f.first);
    const next = f.store.createSession(f.account.id).session;
    f.access.takeover(next);

    await Promise.all([media.revoke(f.room.gameId, f.mediaId), media.sync(f.access)]);

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
    await media.issue(f.access, f.first);
    f.store.logout(f.first.id);
    f.access.expireSessions();

    await media.sync(f.access);

    expect(mock.calls.filter((call) => call.startsWith('remove:'))).toHaveLength(1);
    await media.sync(f.access);
    expect(mock.calls.filter((call) => call.startsWith('remove:'))).toHaveLength(1);
  });

  it('joined 对未知身份不产生媒体操作（声网下无凭证身份不存在）', async () => {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    await media.joined(undefined, f.room.gameId, 'unknown');
    expect(mock.calls).toEqual([]);
    await media.joined(f.access, f.room.gameId, f.mediaId);
    expect(mock.calls).toEqual([]);
  });

  it('win 状态关闭媒体且拒绝 issue', async () => {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    f.room.state = { ...f.room.state!, win: { winner: 'human', dayNumber: 2, reason: 'test' } };
    await media.sync(f.access);
    expect(mock.calls).toContain('close');
    await expect(media.issue(f.access, f.first)).rejects.toMatchObject({ code: 'voice_unavailable' });
  });

  it('sync 关房失败不阻塞游戏；issue 失败映射为 503', async () => {
    const f = fixture();
    const mock = mockVoice({ close: async () => { throw new Error('close down'); } });
    const media = new V2Media(mock.voice, () => f.clock.now());
    f.room.state = { ...f.room.state!, win: { winner: 'human', dayNumber: 2, reason: 'test' } };
    await expect(media.sync(f.access)).resolves.toBeUndefined();

    const g = fixture();
    const failing = mockVoice({ issue: () => { throw new Error('issue down'); } });
    const failingMedia = new V2Media(failing.voice, () => g.clock.now());
    await expect(failingMedia.issue(g.access, g.first)).rejects.toMatchObject({ code: 'voice_unavailable', status: 503 });
    expect(failingMedia.voice).toBe(failing.voice);
    expect(new ApiError(409, 'voice_disabled')).toBeInstanceOf(ApiError);
  });
});
