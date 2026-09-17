import { describe, expect, it } from 'vitest';
import type { VoiceService } from '../voice/livekit.ts';
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
  const issued: Array<{ roomName: string; playerId: string }> = [];
  const syncs: Array<{ roomName: string; permissions: ReadonlyMap<string, boolean> }> = [];
  const closed: string[] = [];
  const removed: Array<{ roomName: string; identity: string }> = [];
  const service: VoiceService = {
    async issueCredentials({ roomName, playerId }) {
      issued.push({ roomName, playerId });
      return { url: 'wss://voice.test', token: `token-${playerId}`, roomName };
    },
    async syncRoom({ roomName, permissions }) {
      syncs.push({ roomName, permissions });
    },
    async closeRoom(roomName) {
      closed.push(roomName);
    },
    async removeParticipant(roomName, identity) {
      removed.push({ roomName, identity });
    },
  };
  return { service, issued, syncs, closed, removed };
}

function errorCode(response: { json: Record<string, unknown> }): unknown {
  return (response.json.error as { code?: unknown } | undefined)?.code;
}

describe('语音 API 与许可同步', () => {
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

  it('开局后签发凭证：夜间全员静音、房间号与玩家身份正确', async () => {
    const fake = createFakeVoice();
    const context = await startTestServer({ voice: fake.service });
    const game = await setupStartedGame(context);
    const token = await postJson(context, '/api/voice/token', {}, game.hostClient.cookie);
    expect(token.status).toBe(200);
    expect(token.json.url).toBe('wss://voice.test');
    expect(token.json.token).toBe(`token-${game.hostClient.playerId}`);
    expect(token.json.roomName).toBe(game.room.gameId);
    expect(token.json.permission).toEqual({ canPublish: false, reason: 'night_silence' });
    expect(fake.issued).toHaveLength(1);

    const view = await getJson(context, '/api/view', game.hostClient.cookie);
    const voice = view.json.voice as { enabled: boolean; permission: unknown };
    expect(voice.enabled).toBe(true);
    expect(voice.permission).toEqual({ canPublish: false, reason: 'night_silence' });
  });

  it('sync 接口：把全员许可同步给媒体服务并返回本人许可', async () => {
    const fake = createFakeVoice();
    const context = await startTestServer({ voice: fake.service });
    const game = await setupStartedGame(context);
    fake.syncs.length = 0;
    const synced = await postJson(context, '/api/voice/sync', {}, game.hostClient.cookie);
    expect(synced.status).toBe(200);
    expect(synced.json.permission).toEqual({ canPublish: false, reason: 'night_silence' });
    expect(fake.syncs).toHaveLength(1);
    expect(fake.syncs[0]?.roomName).toBe(game.room.gameId);
    expect(fake.syncs[0]?.permissions.size).toBe(13);
    expect([...fake.syncs[0]!.permissions.values()].every((value) => value === false)).toBe(true);
  });

  it('状态推进时自动同步媒体许可，并通过 Socket.IO 推送个人许可', async () => {
    const fake = createFakeVoice();
    const context = await startTestServer({ realtime: true, voice: fake.service });
    const game = await setupStartedGame(context);
    const socket = await connectClient(context, game.hostClient.cookie);
    const before = fake.syncs.length;
    context.clock.advance(90_000);
    await waitFor(() => fake.syncs.length > before);
    await waitFor(() => socket.voicePermissions.length > 0);
    expect(socket.voicePermissions[0]).toEqual({ canPublish: false, reason: 'night_silence' });
  });

  it('竞选发言中的候选获得发布权，其他玩家保持禁麦', async () => {
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
