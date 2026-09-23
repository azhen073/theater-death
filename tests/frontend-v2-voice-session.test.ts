/// <reference lib="dom" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceContext } from '../web-v2/src/features/voice/session.ts';

const mocks = vi.hoisted(() => ({
  post: vi.fn(async () => ({ appId: 'appid-test', channel: 'ch', uid: 42, token: 'token' })),
  clients: [] as Array<any>,
  tracks: [] as Array<any>,
  /** 让 join() 返回一个与服务端签发值不同的 uid（默认 undefined = 不返回） */
  joinUid: undefined as number | undefined,
  /** 卡住 unpublish，用于验证"关麦后立刻重开"不会在旧轨道取消发布前新建轨道 */
  unpublishGate: null as Promise<void> | null,
}));

vi.mock('../web-v2/src/transport/http.ts', () => ({
  post: mocks.post,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

vi.mock('agora-rtc-sdk-ng', () => {
  class FakeClient {
    remoteUsers: Array<any> = [];
    published: Array<any> = [];
    connectionState = 'CONNECTED';
    getLocalAudioStats = () => ({ sendBitrate: 1234 });
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
    join = vi.fn(async () => mocks.joinUid);
    leave = vi.fn(async () => undefined);
    renewToken = vi.fn(async (_token: string) => undefined);
    async publish(tracks: Array<any>) { this.published.push(...tracks); }
    async unpublish(tracks: Array<any>) { if (mocks.unpublishGate !== null) await mocks.unpublishGate; this.published = this.published.filter((item) => !tracks.includes(item)); }
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
  roomCode: 'ROOM01', gameId: 'game-1', canPublish: true, readOnly: false, online: true, activePage: true, deliveryWindow: null, ...overrides,
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
  beforeEach(() => { mocks.post.mockClear(); mocks.clients.length = 0; mocks.tracks.length = 0; mocks.joinUid = undefined; mocks.unpublishGate = null; });

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
  beforeEach(() => { mocks.post.mockClear(); mocks.clients.length = 0; mocks.tracks.length = 0; mocks.joinUid = undefined; mocks.unpublishGate = null; });

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

describe('v2 voice connection resilience（凭证续期 / 重连 / 排障）', () => {
  beforeEach(() => { mocks.post.mockClear(); mocks.clients.length = 0; mocks.tracks.length = 0; mocks.joinUid = undefined; mocks.unpublishGate = null; });

  it('加入凭证即将过期：按 SDK 要求重新取 token 并 renewToken', async () => {
    const { client } = await connectedSession();
    const before = mocks.post.mock.calls.length;
    client.emit('token-privilege-will-expire');
    await vi.waitFor(() => expect(client.renewToken).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls.length).toBe(before + 1);
  });

  it('加入凭证已过期：重新 join，并在原本正在发言时自动恢复开麦', async () => {
    const { session, client } = await connectedSession();
    await session.requestMicrophone();
    expect(client.published).toHaveLength(1);

    client.emit('token-privilege-did-expire');
    expect(session.state().notice).toContain('已过期');
    await vi.waitFor(() => expect(mocks.clients.length).toBe(2));
    expect(client.leave).toHaveBeenCalled();
    const rejoined = mocks.clients.at(-1)!;
    await vi.waitFor(() => expect(session.state().connection).toBe('connected'));
    await vi.waitFor(() => expect(rejoined.published).toHaveLength(1));
    expect(session.state()).toMatchObject({ microphoneEnabled: true, notice: '' });
  });

  it('SDK 质量异常写入提示，恢复事件清除提示；无关码不提示', async () => {
    const { session, client } = await connectedSession();
    client.emit('exception', { code: 1001, msg: 'FRAMERATE_INPUT_TOO_LOW' });
    expect(session.state().notice).toBe('');

    client.emit('exception', { code: 2001, msg: 'AUDIO_INPUT_LEVEL_TOO_LOW' });
    expect(session.state().notice).toContain('麦克风输入音量过低');

    client.emit('exception', { code: 4001, msg: 'AUDIO_INPUT_LEVEL_TOO_LOW_RECOVER' });
    expect(session.state().notice).toBe('');
  });

  it('关麦后立刻重开：旧轨道取消发布完成前不会新建第二条轨道', async () => {
    const { session, client } = await connectedSession();
    await session.requestMicrophone();
    expect(mocks.tracks.length).toBe(1);

    let release = () => undefined;
    mocks.unpublishGate = new Promise<void>((resolve) => { release = () => resolve(); });
    session.stopMicrophone();
    const restart = session.requestMicrophone();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // 修复前：此时已经建好并发布第二条轨道（短暂双发）
    expect(mocks.tracks.length).toBe(1);
    release();
    await restart;
    expect(mocks.tracks.length).toBe(2);
    expect(client.published).toHaveLength(1);
  });

  it('自己的电平按 SDK 返回的 uid 归属（与服务端签发值不一致时也不例外）', async () => {
    mocks.joinUid = 9999;
    const { session, client } = await connectedSession();
    client.emit('volume-indicator', [{ uid: 9999, level: 33 }, { uid: 42, level: 77 }]);
    expect(session.state()).toMatchObject({ level: 33, remoteLevel: 77 });
  });

  it('离开后保留所选麦克风设备（会话内），重新加入仍用它', async () => {
    const { session } = await connectedSession();
    await session.requestMicrophone();
    await session.switchDevice('device-2');
    expect(session.state().activeDeviceId).toBe('device-2');

    await session.leave();
    expect(session.state()).toMatchObject({ connection: 'idle', activeDeviceId: 'device-2' });

    await session.join();
    await session.requestMicrophone();
    expect(mocks.tracks.at(-1)!.options).toMatchObject({ microphoneId: 'device-2' });
  });
});

describe('v2 voice delivery receipts（C 组送达回执）', () => {
  beforeEach(() => { mocks.post.mockClear(); mocks.clients.length = 0; mocks.tracks.length = 0; mocks.joinUid = undefined; mocks.unpublishGate = null; });

  const receiptCalls = () => mocks.post.mock.calls.filter(([path]) => String(path).includes('/voice/receipt'));
  const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 20)); };

  it('订阅并播放成功后上报 playing，并带上客户端自检快照', async () => {
    const { session, client } = await connectedSession();
    session.setContext(context({ deliveryWindow: 'win-1' }));
    client.emit('user-published', remoteUser(78), 'audio');
    await vi.waitFor(() => expect(receiptCalls()).toHaveLength(1));
    const [path, body] = receiptCalls()[0]!;
    expect(String(path)).toBe('/rooms/ROOM01/voice/receipt');
    expect(body).toMatchObject({ gameId: 'game-1', windowInstanceId: 'win-1', state: 'playing' });
    expect(body.client).toMatchObject({ connectionState: 'CONNECTED', sendBitrate: 1234, remoteUsers: 0 });
  });

  it('订阅/播放失败上报 failed（不再被静默吞掉）', async () => {
    const { session, client } = await connectedSession();
    session.setContext(context({ deliveryWindow: 'win-1' }));
    client.subscribe.mockRejectedValueOnce(new Error('subscribe failed'));
    client.emit('user-published', remoteUser(79), 'audio');
    await vi.waitFor(() => expect(receiptCalls()).toHaveLength(1));
    expect(receiptCalls()[0]![1]).toMatchObject({ state: 'failed' });
  });

  it('自动播放被拦截时上报 blocked', async () => {
    const { session } = await connectedSession();
    session.setContext(context({ deliveryWindow: 'win-1' }));
    const agora = (await import('agora-rtc-sdk-ng')).default as unknown as { onAutoplayFailed: () => void };
    agora.onAutoplayFailed();
    await vi.waitFor(() => expect(receiptCalls()).toHaveLength(1));
    expect(receiptCalls()[0]![1]).toMatchObject({ state: 'blocked' });
  });

  it('同一窗口同一状态 1 秒内只发一条，状态变化立即发', async () => {
    const { session, client } = await connectedSession();
    session.setContext(context({ deliveryWindow: 'win-1' }));
    client.emit('user-published', remoteUser(80), 'audio');
    await vi.waitFor(() => expect(receiptCalls()).toHaveLength(1));

    client.emit('user-published', remoteUser(81), 'audio');
    await settle();
    expect(receiptCalls()).toHaveLength(1);

    session.setOutputVolume(0);
    await vi.waitFor(() => expect(receiptCalls()).toHaveLength(2));
    expect(receiptCalls()[1]![1]).toMatchObject({ state: 'silent-output' });
  });

  it('没有发言窗口或未真正连上时不上报（避免错误自证）', async () => {
    const { session, client } = await connectedSession();
    // 没有发言窗口
    session.setOutputVolume(0);
    await settle();
    // 有窗口但连接不在 CONNECTED（重连中）
    session.setContext(context({ deliveryWindow: 'win-1' }));
    client.connectionState = 'RECONNECTING';
    client.emit('user-published', remoteUser(82), 'audio');
    await settle();
    expect(receiptCalls()).toHaveLength(0);
  });
});
