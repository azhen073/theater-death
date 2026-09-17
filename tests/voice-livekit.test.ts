import type { ParticipantInfo } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { createLiveKitVoiceService } from '../voice/livekit.ts';

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (payload === undefined) {
    throw new Error('token 结构异常');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('LiveKit VoiceAdapter', () => {
  it('凭证：不含发布权、保留订阅权、有效期受限于 30 分钟', async () => {
    const service = createLiveKitVoiceService({
      adminUrl: 'http://livekit:7880',
      publicUrl: 'wss://voice.example.test',
      apiKey: 'key123',
      apiSecret: 'secret456',
    });
    const credentials = await service.issueCredentials({ roomName: 'g_test', playerId: 'p_1' });
    expect(credentials.url).toBe('wss://voice.example.test');
    expect(credentials.roomName).toBe('g_test');
    const claims = decodeJwt(credentials.token);
    expect(claims.sub).toBe('p_1');
    const video = claims.video as Record<string, unknown>;
    expect(video.room).toBe('g_test');
    expect(video.roomJoin).toBe(true);
    expect(video.canSubscribe).toBe(true);
    expect(video.canPublish).toBe(false);
    expect((claims.exp as number) - (claims.nbf as number)).toBe(1800);
  });

  it('syncRoom：只为权限不一致的参与者更新发布权', async () => {
    const updates: Array<{ identity: string; canPublish: boolean }> = [];
    const service = createLiveKitVoiceService({
      adminUrl: 'http://livekit:7880',
      publicUrl: 'wss://voice.example.test',
      apiKey: 'key123',
      apiSecret: 'secret456',
      roomClient: {
        listParticipants: async () => [
          { identity: 'p_1', permission: { canPublish: false } } as ParticipantInfo,
          { identity: 'p_2', permission: { canPublish: true } } as ParticipantInfo,
        ],
        updateParticipant: async (_room, identity, options) => {
          updates.push({ identity, canPublish: options.permission?.canPublish ?? false });
          return {};
        },
        removeParticipant: async () => undefined,
        deleteRoom: async () => undefined,
      },
    });
    await service.syncRoom({
      roomName: 'g_test',
      permissions: new Map([
        ['p_1', true],
        ['p_2', true],
      ]),
    });
    expect(updates).toEqual([{ identity: 'p_1', canPublish: true }]);
  });

  it('syncRoom：房间不存在（尚无参与者加入语音）时静默跳过', async () => {
    const service = createLiveKitVoiceService({
      adminUrl: 'http://livekit:7880',
      publicUrl: 'wss://voice.example.test',
      apiKey: 'key123',
      apiSecret: 'secret456',
      roomClient: {
        listParticipants: async () => {
          throw Object.assign(new Error('room not found'), { code: 'not_found' });
        },
        updateParticipant: async () => {
          throw new Error('不应被调用');
        },
        removeParticipant: async () => undefined,
        deleteRoom: async () => undefined,
      },
    });
    await expect(
      service.syncRoom({ roomName: 'g_missing', permissions: new Map([['p_1', true]]) }),
    ).resolves.toBeUndefined();
  });

  it('closeRoom：房间不存在时静默；其他错误照常抛出', async () => {
    const silent = createLiveKitVoiceService({
      adminUrl: 'http://livekit:7880',
      publicUrl: 'wss://voice.example.test',
      apiKey: 'key123',
      apiSecret: 'secret456',
      roomClient: {
        listParticipants: async () => [],
        updateParticipant: async () => ({}),
        removeParticipant: async () => undefined,
        deleteRoom: async () => {
          throw new Error('404 not found');
        },
      },
    });
    await expect(silent.closeRoom('g_missing')).resolves.toBeUndefined();

    const failing = createLiveKitVoiceService({
      adminUrl: 'http://livekit:7880',
      publicUrl: 'wss://voice.example.test',
      apiKey: 'key123',
      apiSecret: 'secret456',
      roomClient: {
        listParticipants: async () => [],
        updateParticipant: async () => ({}),
        removeParticipant: async () => undefined,
        deleteRoom: async () => {
          throw new Error('connection refused');
        },
      },
    });
    await expect(failing.closeRoom('g_test')).rejects.toThrow('connection refused');
  });

  it('removeParticipant：调用媒体服务；参与者不存在时静默；其他错误照常抛出', async () => {
    const calls: Array<{ room: string; identity: string }> = [];
    const ok = createLiveKitVoiceService({
      adminUrl: 'http://livekit:7880',
      publicUrl: 'wss://voice.example.test',
      apiKey: 'key123',
      apiSecret: 'secret456',
      roomClient: {
        listParticipants: async () => [],
        updateParticipant: async () => ({}),
        removeParticipant: async (room, identity) => {
          calls.push({ room, identity });
          return {};
        },
        deleteRoom: async () => undefined,
      },
    });
    await expect(ok.removeParticipant('g_test', 's_1')).resolves.toBeUndefined();
    expect(calls).toEqual([{ room: 'g_test', identity: 's_1' }]);

    const silent = createLiveKitVoiceService({
      adminUrl: 'http://livekit:7880',
      publicUrl: 'wss://voice.example.test',
      apiKey: 'key123',
      apiSecret: 'secret456',
      roomClient: {
        listParticipants: async () => [],
        updateParticipant: async () => ({}),
        removeParticipant: async () => {
          throw Object.assign(new Error('participant not found'), { code: 'not_found' });
        },
        deleteRoom: async () => undefined,
      },
    });
    await expect(silent.removeParticipant('g_test', 's_missing')).resolves.toBeUndefined();

    const failing = createLiveKitVoiceService({
      adminUrl: 'http://livekit:7880',
      publicUrl: 'wss://voice.example.test',
      apiKey: 'key123',
      apiSecret: 'secret456',
      roomClient: {
        listParticipants: async () => [],
        updateParticipant: async () => ({}),
        removeParticipant: async () => {
          throw new Error('connection refused');
        },
        deleteRoom: async () => undefined,
      },
    });
    await expect(failing.removeParticipant('g_test', 's_1')).rejects.toThrow('connection refused');
  });
});
