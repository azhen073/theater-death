import { afterEach, describe, expect, it } from 'vitest';
import { beginDay, startDefaultSpeechRound } from '../engine/day.ts';
import { resolveMorning } from '../engine/morning.ts';
import type { GameState } from '../engine/types.ts';
import { createFakeClock } from '../server/clock.ts';
import { AccountStore } from '../server/v2/account-store.ts';
import { RoomAccess } from '../server/v2/access.ts';
import { ApiError } from '../server/v2/errors.ts';
import { V2Media } from '../server/v2/media.ts';
import { Room, type RoomMember } from '../server/rooms.ts';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import type { VoiceCredentials, VoiceService } from '../voice/livekit.ts';
import { runNight, scenario } from './helpers.ts';

const accesses: RoomAccess[] = [];
const stores: AccountStore[] = [];

afterEach(() => {
  for (const access of accesses.splice(0)) access.close();
  for (const store of stores.splice(0)) store.close();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

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

function mockVoice(options: { issue?: () => Promise<VoiceCredentials>; sync?: () => Promise<void>; remove?: () => Promise<void>; close?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const syncs: ReadonlyMap<string, boolean>[] = [];
  const voice: VoiceService = {
    async issueCredentials(input) {
      calls.push(`issue:${input.playerId}`);
      return options.issue?.() ?? { url: 'wss://voice.test', token: 'token', roomName: input.roomName };
    },
    async syncRoom(input) {
      calls.push('sync');
      syncs.push(input.permissions);
      await options.sync?.();
    },
    async closeRoom() { calls.push('close'); await options.close?.(); },
    async removeParticipant(_room, identity) { calls.push(`remove:${identity}`); await options.remove?.(); },
  };
  return { voice, calls, syncs };
}

describe('V2Media 授权与媒体副作用', () => {
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

  it('issue 异步期间接管后拒绝旧 token，并撤销旧 identity', async () => {
    const f = fixture();
    const gate = deferred<VoiceCredentials>();
    const mock = mockVoice({ issue: () => gate.promise });
    const media = new V2Media(mock.voice, () => f.clock.now());
    const pending = media.issue(f.access, f.first);
    const next = f.store.createSession(f.account.id).session;
    f.access.takeover(next);
    gate.resolve({ url: 'wss://voice.test', token: 'old', roomName: f.room.gameId });

    await expect(pending).rejects.toMatchObject({ code: 'authorization_changed' });
    expect(mock.calls).toContain(`remove:${f.mediaId}`);
  });

  it('revoke 与 sync 按 game 串行，接管后最终 sync 不再包含旧 identity；失效 session 不入 permissions', async () => {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    const next = f.store.createSession(f.account.id).session;
    f.access.takeover(next);
    await Promise.all([media.revoke(f.room.gameId, f.mediaId), media.sync(f.access)]);

    expect(mock.calls[0]).toBe(`remove:${f.mediaId}`);
    expect(mock.calls[1]).toBe('sync');
    expect([...mock.syncs[0]!.keys()]).not.toContain(f.mediaId);
    f.store.logout(next.id);
    f.access.expireSessions();
    expect(f.media.permissions(f.access).has(f.mediaId)).toBe(false);
  });

  it('未授权 webhook joined 移除参与者，已授权 identity 执行同步', async () => {
    const f = fixture();
    const mock = mockVoice();
    const media = new V2Media(mock.voice, () => f.clock.now());
    await media.joined(undefined, f.room.gameId, 'unknown');
    expect(mock.calls).toEqual([`remove:unknown`]);
    await media.joined(f.access, f.room.gameId, f.mediaId);
    expect(mock.calls).toContain('sync');
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

  it('sync 失败不阻塞游戏，issue 凭证失败映射为 503', async () => {
    const f = fixture();
    const mock = mockVoice({ sync: async () => { throw new Error('sync down'); }, issue: async () => { throw new Error('issue down'); } });
    const media = new V2Media(mock.voice, () => f.clock.now());
    await expect(media.sync(f.access)).resolves.toBeUndefined();
    await expect(media.issue(f.access, f.first)).rejects.toMatchObject({ code: 'voice_unavailable', status: 503 });
    expect(media.voice).toBe(mock.voice);
    expect(new ApiError(409, 'voice_disabled')).toBeInstanceOf(ApiError);
  });
});
