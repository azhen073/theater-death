import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, enter, json, makeHarness, post, request, type HttpHarness } from './contract-http-utils.ts';
import type { ChannelUserQuery, VoiceCredentials, VoiceService } from '../voice/agora.ts';

afterEach(closeHarnesses);

/** 一个"签发成功、可查询频道"的声网适配器（对账与回执测试都不需要真实凭据） */
class QueryableVoice implements VoiceService {
  readonly removed: number[] = [];
  users: number[] = [];
  issueCredentials(input: { roomName: string; uid: number }): VoiceCredentials {
    return { appId: 'appid-test', channel: input.roomName, uid: input.uid, token: `sub:${input.uid}` };
  }
  issuePublishGrant(input: { roomName: string; uid: number }): { token: string; expiresAt: number } {
    return { token: `pub:${input.uid}`, expiresAt: Date.now() + 150_000 };
  }
  issueSubscriberGrant(input: { roomName: string; uid: number }): { token: string } {
    return { token: `sub:${input.uid}` };
  }
  closeRoom(): Promise<void> { return Promise.resolve(); }
  removeParticipant(_roomName: string, uid: number): Promise<void> { this.removed.push(uid); return Promise.resolve(); }
  queryChannelUsers(): Promise<ChannelUserQuery> { return Promise.resolve({ channelExist: true, mode: 1, users: this.users }); }
}

const EXPERIMENTAL_ROLES = {
  laike: 0,
  door: 1,
  water: 0,
  descender: 0,
  researcher: 1,
  civilian: 1,
  death: 1,
  spirit: 1,
  mourner: 0,
};

async function startFivePlayerGame(h: HttpHarness): Promise<{ roomCode: string; gameId: string }> {
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'delivery-create', playerCount: 5, roles: EXPERIMENTAL_ROLES }), h.users[0]);
  expect(created.status).toBe(201);
  const room = await json(created) as { roomCode: string };
  for (let index = 1; index < 5; index += 1) {
    expect((await enter(h, room.roomCode, h.users[index]!, `delivery-enter-${index}`)).response.status).toBe(200);
  }
  for (let index = 0; index < 5; index += 1) {
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `delivery-ready-${index}`, ready: true }), h.users[index])).status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'delivery-start' }), h.users[0]);
  expect(started.status).toBe(200);
  return { roomCode: room.roomCode, gameId: (await json(started)).gameId as string };
}

const errorCode = (body: Record<string, any>): string | undefined => body.error?.code;

describe('v2 voice receipt HTTP contract（C 组）', () => {
  it('未启用语音时回执端点返回 voice_disabled，且不调用任何媒体服务', async () => {
    const h = await makeHarness();
    const game = await startFivePlayerGame(h);
    const response = await request(h, `/api/v2/rooms/${game.roomCode}/voice/receipt`, post({ requestId: 'receipt-disabled', gameId: game.gameId, windowInstanceId: 'win', state: 'playing' }), h.users[0]);
    expect(response.status).toBe(409);
    expect(errorCode(await json(response))).toBe('voice_disabled');
  });

  it('校验窗口与状态：缺窗口或非法状态都被拒绝', async () => {
    const h = await makeHarness(20, new QueryableVoice());
    const game = await startFivePlayerGame(h);
    const missingWindow = await request(h, `/api/v2/rooms/${game.roomCode}/voice/receipt`, post({ requestId: 'receipt-no-window', gameId: game.gameId, state: 'playing' }), h.users[0]);
    expect(missingWindow.status).toBe(400);
    // 平台统一的字段校验码（与其它端点一致），不是笼统的 invalid_request_payload
    expect(errorCode(await json(missingWindow))).toBe('invalid_window_instance_id');

    const badState = await request(h, `/api/v2/rooms/${game.roomCode}/voice/receipt`, post({ requestId: 'receipt-bad-state', gameId: game.gameId, windowInstanceId: 'win', state: 'teleport' }), h.users[0]);
    expect(badState.status).toBe(400);
    expect(errorCode(await json(badState))).toBe('invalid_request_payload');
  });

  it('没有正在发言的窗口时回 recorded:false（不报错、不产生聚合）', async () => {
    const h = await makeHarness(20, new QueryableVoice());
    const game = await startFivePlayerGame(h);
    const response = await request(h, `/api/v2/rooms/${game.roomCode}/voice/receipt`, post({ requestId: 'receipt-no-speaker', gameId: game.gameId, windowInstanceId: 'win', state: 'playing' }), h.users[0]);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ recorded: false, delivery: null });
  });

  it('身份一律由服务端解析：body 里伪造的 identity/uid 字段被忽略', async () => {
    const h = await makeHarness(20, new QueryableVoice());
    const game = await startFivePlayerGame(h);
    const forged = await request(h, `/api/v2/rooms/${game.roomCode}/voice/receipt`, post({ requestId: 'receipt-forged', gameId: game.gameId, windowInstanceId: 'win', state: 'playing', identity: 'v2:forged', uid: 999 }), h.users[0]);
    expect(forged.status).toBe(200);
    expect(await json(forged)).toEqual({ recorded: false, delivery: null });
  });

  it('未进入房间的账号拿不到回执端点（room_access_required）', async () => {
    const h = await makeHarness(20, new QueryableVoice());
    const game = await startFivePlayerGame(h);
    const outsider = h.users[19]!;
    const response = await request(h, `/api/v2/rooms/${game.roomCode}/voice/receipt`, post({ requestId: 'receipt-outsider', gameId: game.gameId, windowInstanceId: 'win', state: 'playing' }), outsider);
    expect(response.status).toBe(403);
    expect(errorCode(await json(response))).toBe('room_access_required');
  });

  it('发言者的视图里只有在持有发布权且窗口存在时才可能带 voice 字段（公共视图永不包含）', async () => {
    const h = await makeHarness(20, new QueryableVoice());
    const game = await startFivePlayerGame(h);
    const view = await json(await request(h, `/api/v2/rooms/${game.roomCode}/view`, undefined, h.users[0])) as { public?: unknown; private?: Record<string, unknown> | null };
    expect(JSON.stringify(view.public)).not.toContain('delivery');
    // 首夜没有发言窗口：即使本人有权限也不下发
    expect(view.private?.voice).toBeUndefined();
  });
});
