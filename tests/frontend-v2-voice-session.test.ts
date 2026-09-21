/// <reference lib="dom" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceContext } from '../web-v2/src/features/voice/session.ts';

const mocks = vi.hoisted(() => ({
  post: vi.fn(async () => ({ appId: 'appid-test', channel: 'ch', uid: 42, token: 'token' })),
  clients: [] as Array<any>,
  tracks: [] as Array<any>,
}));

vi.mock('../web-v2/src/transport/http.ts', () => ({
  post: mocks.post,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

vi.mock('agora-rtc-sdk-ng', () => {
  class FakeClient {
    remoteUsers: Array<any> = [];
    published: Array<any> = [];
    volumeIndicatorListener: ((users: readonly { uid: number | string; level: number }[]) => void) | null = null;
    enableAudioVolumeIndicator = vi.fn();
    disableAudioVolumeIndicator = vi.fn();
    subscribe = vi.fn(async () => undefined);
    private listeners: Array<[string, (...args: any[]) => void]> = [];
    on(event: string, listener: (...args: any[]) => void) {
      this.listeners.push([event, listener]);
      if (event === 'volume-indicator') this.volumeIndicatorListener = listener as any;
      return this;
    }
    emit(event: string, ...args: any[]) { for (const [name, listener] of this.listeners) if (name === event) listener(...args); }
    removeAllListeners() { this.listeners = []; this.volumeIndicatorListener = null; }
    async join() { return undefined; }
    async leave() { return undefined; }
    async renewToken() { return undefined; }
    async publish(tracks: Array<any>) { this.published.push(...tracks); }
    async unpublish(tracks: Array<any>) { this.published = this.published.filter((item) => !tracks.includes(item)); }
    setClientRole() { return Promise.resolve(); }
  }
  return {
    default: {
      createClient: () => { const client = new FakeClient(); mocks.clients.push(client); return client; },
      createMicrophoneAudioTrack: async (options: Record<string, unknown> = {}) => {
        const track = { options, stop: vi.fn(), close: vi.fn(), setDevice: vi.fn(async () => undefined), setVolume: vi.fn() };
        mocks.tracks.push(track);
        return track;
      },
      getMicrophones: async () => [],
      onAutoplayFailed: null,
    },
  };
});

import { VoiceSession } from '../web-v2/src/features/voice/session.ts';

const context = (overrides: Partial<VoiceContext> = {}): VoiceContext => ({
  roomCode: 'ROOM01', gameId: 'game-1', canPublish: true, readOnly: false, online: true, activePage: true, ...overrides,
});

async function connectedSession() {
  const session = new VoiceSession();
  session.setContext(context());
  await session.join();
  expect(session.state().connection).toBe('connected');
  return { session, client: mocks.clients.at(-1)! };
}

function remoteUser(uid: number) {
  return { uid, audioTrack: { setVolume: vi.fn(), play: vi.fn(), stop: vi.fn() } };
}

describe('v2 voice session intent lifecycle（声网）', () => {
  beforeEach(() => { mocks.post.mockClear(); mocks.clients.length = 0; mocks.tracks.length = 0; });

  it('clears the one-shot microphone intent and stops publishing when publish permission is revoked', async () => {
    const { session, client } = await connectedSession();
    await session.requestMicrophone();
    expect(session.state()).toMatchObject({ requested: true, microphoneEnabled: true });
    expect(client.published).toHaveLength(1);

    session.setContext(context({ canPublish: false }));
    expect(session.state()).toMatchObject({ requested: false, microphoneEnabled: false });
    expect(client.published).toHaveLength(0);
  });

  it('clears microphone intent and stops publishing when leaving the game page', async () => {
    const { session, client } = await connectedSession();
    await session.requestMicrophone();
    session.setContext(context({ activePage: false }));
    expect(session.state()).toMatchObject({ connection: 'connected', requested: false, microphoneEnabled: false });
    expect(client.published).toHaveLength(0);
  });

  it('clears microphone intent and stops publishing while offline', async () => {
    const { session, client } = await connectedSession();
    await session.requestMicrophone();
    session.setContext(context({ online: false }));
    expect(session.state()).toMatchObject({ requested: false, microphoneEnabled: false });
    expect(client.published).toHaveLength(0);
  });
});

describe('v2 voice volume（音量指示 + 输出/输入音量，纯本地）', () => {
  beforeEach(() => { mocks.post.mockClear(); mocks.clients.length = 0; mocks.tracks.length = 0; });

  it('enables the volume indicator after joining, attributes own/remote levels, and disables it on leave', async () => {
    const { session, client } = await connectedSession();
    expect(client.enableAudioVolumeIndicator).toHaveBeenCalledTimes(1);
    expect(session.state()).toMatchObject({ level: 0, remoteLevel: 0 });

    client.emit('volume-indicator', [{ uid: 42, level: 55 }, { uid: 99, level: 70.4 }, { uid: '1000', level: 12 }]);
    expect(session.state()).toMatchObject({ level: 55, remoteLevel: 70 });

    // 非法电平不污染状态
    client.emit('volume-indicator', [{ uid: 42, level: Number.NaN }, { uid: 99, level: 999 }]);
    expect(session.state()).toMatchObject({ level: 0, remoteLevel: 100 });

    await session.leave();
    expect(client.disableAudioVolumeIndicator).toHaveBeenCalledTimes(1);
    expect(session.state()).toMatchObject({ level: 0, remoteLevel: 0, connection: 'idle' });
  });

  it('applies the output volume to already subscribed users and to users who publish later', async () => {
    const { session, client } = await connectedSession();
    const existing = remoteUser(77);
    client.remoteUsers.push(existing);

    session.setOutputVolume(0);
    expect(existing.audioTrack.setVolume).toHaveBeenLastCalledWith(0);

    session.setOutputVolume(130);
    expect(existing.audioTrack.setVolume).toHaveBeenLastCalledWith(100);

    const later = remoteUser(78);
    client.emit('user-published', later, 'audio');
    await vi.waitFor(() => expect(later.audioTrack.setVolume).toHaveBeenCalledWith(100));
    expect(later.audioTrack.play).toHaveBeenCalled();
  });

  it('remembers the input gain and re-applies it to every new microphone track and after a device switch', async () => {
    const { session } = await connectedSession();
    session.setInputVolume(30);
    await session.requestMicrophone();

    const first = mocks.tracks.at(-1)!;
    expect(first.setVolume).toHaveBeenLastCalledWith(30);

    await session.switchDevice('device-2');
    expect(first.setDevice).toHaveBeenCalledWith('device-2');
    expect(first.setVolume).toHaveBeenLastCalledWith(30);

    // 关闭再开麦会新建轨道：增益必须重新应用
    session.stopMicrophone();
    await session.requestMicrophone();
    const second = mocks.tracks.at(-1)!;
    expect(second).not.toBe(first);
    expect(second.setVolume).toHaveBeenLastCalledWith(30);
  });

  it('keeps AGC up to 125 and rebuilds the capture track above it（增益可到 150）', async () => {
    const { session, client } = await connectedSession();

    // 低于阈值：建轨带 AGC
    session.setInputVolume(125);
    await session.requestMicrophone();
    const agcTrack = mocks.tracks.at(-1)!;
    expect(agcTrack.options).toMatchObject({ AEC: true, ANS: true, AGC: true });
    expect(agcTrack.setVolume).toHaveBeenLastCalledWith(125);

    // 跨过阈值：旧轨道被停用，新轨道带 AGC:false 并重新应用增益
    session.setInputVolume(130);
    await vi.waitFor(() => expect(mocks.tracks.length).toBe(2));
    const boosted = mocks.tracks.at(-1)!;
    expect(agcTrack.stop).toHaveBeenCalled();
    expect(agcTrack.close).toHaveBeenCalled();
    expect(boosted.options).toMatchObject({ AGC: false });
    expect(boosted.setVolume).toHaveBeenLastCalledWith(130);
    expect(client.published).toContain(boosted);
    expect(client.published).not.toContain(agcTrack);

    // 继续加大不再重建（AGC 已经是关的），只改轨道音量
    session.setInputVolume(150);
    expect(mocks.tracks.length).toBe(2);
    expect(boosted.setVolume).toHaveBeenLastCalledWith(150);

    // 落回阈值内：再建一条带 AGC 的轨道
    session.setInputVolume(100);
    await vi.waitFor(() => expect(mocks.tracks.length).toBe(3));
    expect(mocks.tracks.at(-1)!.options).toMatchObject({ AGC: true });

    // 没开麦时只记住数值，不建轨
    session.stopMicrophone();
    const before = mocks.tracks.length;
    session.setInputVolume(140);
    expect(mocks.tracks.length).toBe(before);
  });
});
