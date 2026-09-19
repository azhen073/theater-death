import { describe, expect, it } from 'vitest';
import type { VoiceService } from '../voice/agora.ts';
import {
  connectClient,
  getJson,
  postJson,
  setupLobby,
  setupStartedGame,
  startTestServer,
  waitFor,
} from './server-test-utils.ts';

function createFakeVoice() {
  const issued: Array<{ roomName: string; uid: number }> = [];
  const grants: Array<{ roomName: string; uid: number }> = [];
  const revokes: Array<{ roomName: string; uid: number }> = [];
  const closed: string[] = [];
  const removed: Array<{ roomName: string; uid: number }> = [];
  let seq = 0;
  const service: VoiceService = {
    issueCredentials({ roomName, uid }) {
      issued.push({ roomName, uid });
      return { appId: 'appid-test', channel: roomName, uid, token: `sub-${++seq}` };
    },
    issuePublishGrant({ roomName, uid }) {
      grants.push({ roomName, uid });
      return { token: `pub-${++seq}`, expiresAt: Date.now() + 600_000 };
    },
    issueSubscriberGrant({ roomName, uid }) {
      revokes.push({ roomName, uid });
      return { token: `resub-${++seq}` };
    },
    async closeRoom(roomName) {
      closed.push(roomName);
    },
    async removeParticipant(roomName, uid) {
      removed.push({ roomName, uid });
    },
  };
  return { service, issued, grants, revokes, closed, removed };
}

function errorCode(response: { json: Record<string, unknown> }): unknown {
  return (response.json.error as { code?: unknown } | undefined)?.code;
}

describe('语音 API 与许可授权', () => {
  it('未配置语音时：token 接口 409，视图标记未启用', async () => {
    const context = await startTestServer();
    const lobby = await setupLobby(context);
    const token = await postJson(context, '/api/voice/token', {}, lobby.hostClient.cookie);
    expect(token.status).toBe(409);
    expect(errorCode(token)).toBe('voice_disabled');
    const view = await getJson(context, '/api/view', lobby.hostClient.cookie);
    expect((view.json.voice as { enabled: boolean }).enabled).toBe(false);
  });

  it('大厅（已启用语音）：不能加入语音，视图标记启用', async () => {
    const fake = createFakeVoice();
    const context = await startTestServer({ voice: fake.service });
    const lobby = await setupLobby(context);
    const token = await postJson(context, '/api/voice/token', {}, lobby.hostClient.cookie);
    expect(token.status).toBe(409);
    expect(errorCode(token)).toBe('game_not_started');
    const view = await getJson(context, '/api/view', lobby.hostClient.cookie);
    expect((view.json.voice as { enabled: boolean }).enabled).toBe(true);
  });

  it('开局后签发凭证：夜间全员静音、appId/频道/uid（座位号）与许可正确', async () => {
    const fake = createFakeVoice();
    const context = await startTestServer({ voice: fake.service });
    const game = await setupStartedGame(context);
    const token = await postJson(context, '/api/voice/token', {}, game.hostClient.cookie);
    expect(token.status).toBe(200);
    expect(token.json.appId).toBe('appid-test');
    expect(token.json.channel).toBe(game.room.gameId);
    const hostSeat = game.room.state?.players.find(
      (player) => player.playerId === game.hostClient.playerId,
    )?.seat;
    expect(token.json.uid).toBe(hostSeat);
    expect(token.json.permission).toEqual({ canPublish: false, reason: 'night_silence' });
    expect(fake.issued).toHaveLength(1);
    expect(fake.issued[0]?.uid).toBe(hostSeat);

    const view = await getJson(context, '/api/view', game.hostClient.cookie);
    const voice = view.json.voice as { enabled: boolean; permission: unknown };
    expect(voice.enabled).toBe(true);
    expect(voice.permission).toEqual({ canPublish: false, reason: 'night_silence' });
  });

  it('sync 接口：返回本人许可与对应凭证（禁麦时为订阅凭证）', async () => {
    const fake = createFakeVoice();
    const context = await startTestServer({ voice: fake.service });
    const game = await setupStartedGame(context);
    const synced = await postJson(context, '/api/voice/sync', {}, game.hostClient.cookie);
    expect(synced.status).toBe(200);
    expect(synced.json.permission).toEqual({ canPublish: false, reason: 'night_silence' });
    expect(typeof synced.json.token).toBe('string');
    expect(fake.revokes).toHaveLength(1);
    expect(fake.revokes[0]?.roomName).toBe(game.room.gameId);
  });

  it('状态推进时通过 Socket.IO 推送个人许可', async () => {
    const fake = createFakeVoice();
    const context = await startTestServer({ realtime: true, voice: fake.service });
    const game = await setupStartedGame(context);
    const socket = await connectClient(context, game.hostClient.cookie);
    context.clock.advance(90_000);
    await waitFor(() => socket.voicePermissions.length > 0);
    expect(socket.voicePermissions[0]).toEqual({
      permission: { canPublish: false, reason: 'night_silence' },
    });
  });

  it('竞选发言中的候选获得发布凭证，其他玩家保持禁麦', async () => {
    const fake = createFakeVoice();
    const context = await startTestServer({ voice: fake.service });
    const game = await setupStartedGame(context);

    context.clock.advance(90_000);
    context.clock.advance(45_000);
    await waitFor(() => game.room.state?.day !== null);
    expect(game.room.state?.day?.step).toBe('election');
    expect(game.room.state?.day?.election?.phase).toBe('signup');

    const seatOne = game.room.state?.players.find((player) => player.seat === 1);
    expect(seatOne).toBeDefined();
    const candidate = game.clients.find((client) => client.playerId === seatOne?.playerId);
    expect(candidate).toBeDefined();
    const registered = await postJson(
      context,
      '/api/command',
      { requestId: 'voice-register-1', action: 'REGISTER_CANDIDACY' },
      candidate!.cookie,
    );
    expect(registered.status).toBe(200);
    expect(registered.json.status).toBe('accepted');

    context.clock.advance(30_000);
    expect(game.room.state?.day?.election?.phase).toBe('speech');

    const candidateToken = await postJson(context, '/api/voice/token', {}, candidate!.cookie);
    expect(candidateToken.status).toBe(200);
    expect(candidateToken.json.permission).toEqual({ canPublish: true, reason: 'speaker' });

    // sync 对齐时拿到发布凭证（短期授权）
    const grantsBefore = fake.grants.length;
    const synced = await postJson(context, '/api/voice/sync', {}, candidate!.cookie);
    expect(synced.status).toBe(200);
    expect(synced.json.permission).toEqual({ canPublish: true, reason: 'speaker' });
    expect(typeof synced.json.token).toBe('string');
    expect(fake.grants.length).toBe(grantsBefore + 1);
    expect(fake.grants.at(-1)?.uid).toBe(seatOne?.seat);

    const other = game.clients.find((client) => client.playerId !== candidate!.playerId);
    expect(other).toBeDefined();
    const otherToken = await postJson(context, '/api/voice/token', {}, other!.cookie);
    expect(otherToken.status).toBe(200);
    expect(otherToken.json.permission).toEqual({
      canPublish: false,
      reason: 'not_your_turn',
    });
  });

  it('未登录访问语音接口返回 401', async () => {
    const fake = createFakeVoice();
    const context = await startTestServer({ voice: fake.service });
    const token = await postJson(context, '/api/voice/token', {});
    expect(token.status).toBe(401);
    const synced = await postJson(context, '/api/voice/sync', {});
    expect(synced.status).toBe(401);
  });
});
