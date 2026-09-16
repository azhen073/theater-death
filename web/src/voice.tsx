import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api.ts';
import type { VoicePermission, VoicePermissionReason } from './types.ts';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface VoiceUiState {
  readonly connection: ConnectionState;
  readonly permission: VoicePermission;
  readonly muted: boolean;
  readonly error: string | null;
  readonly devices: readonly MediaDeviceInfo[];
  readonly activeDeviceId: string | null;
}

const DEFAULT_PERMISSION: VoicePermission = { canPublish: false, reason: 'not_your_turn' };

export function voiceReasonText(reason: VoicePermissionReason): string {
  switch (reason) {
    case 'speaker':
      return '轮到你发言';
    case 'dead_listener':
      return '你已出局，仅可公共旁听';
    case 'night_silence':
      return '夜间全体静音';
    case 'vote_silence':
      return '投票期间全体禁麦';
    case 'not_your_turn':
      return '当前不是你的发言时间';
    case 'game_not_started':
      return '对局未开始';
    case 'game_ended':
      return '对局已结束';
  }
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * 语音连接控制器：凭证由服务端签发（短期、无发布权），
 * 发布权完全由服务端按 R-43 动态授予（LiveKit 服务端权限），本地静音只是叠加状态。
 */
class VoiceController {
  #state: VoiceUiState = {
    connection: 'idle',
    permission: DEFAULT_PERMISSION,
    muted: false,
    error: null,
    devices: [],
    activeDeviceId: null,
  };
  #room: Room | null = null;
  readonly #listeners = new Set<(state: VoiceUiState) => void>();

  subscribe(listener: (state: VoiceUiState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getState(): VoiceUiState {
    return this.#state;
  }

  #set(patch: Partial<VoiceUiState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }

  async join(): Promise<void> {
    if (this.#room !== null || this.#state.connection === 'connecting') {
      return;
    }
    this.#set({ connection: 'connecting', error: null });
    try {
      const credentials = await api.voiceToken();
      const room = new Room({ adaptiveStream: false, dynacast: false });
      this.#room = room;
      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) {
            const element = track.attach();
            element.dataset.voice = 'remote';
            document.body.appendChild(element);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          for (const element of track.detach()) {
            element.remove();
          }
        })
        .on(RoomEvent.Reconnecting, () => this.#set({ connection: 'reconnecting' }))
        .on(RoomEvent.Reconnected, () => {
          this.#set({ connection: 'connected' });
          void this.#resync();
        })
        .on(RoomEvent.Disconnected, () => {
          this.#teardown();
          this.#set({ connection: 'idle' });
        });
      await room.connect(credentials.url, credentials.token);
      this.#set({ connection: 'connected', permission: credentials.permission });
      const synced = await api.voiceSync();
      this.#set({ permission: synced.permission });
      await this.#refreshDevices();
      await this.#applyPublish();
    } catch (error) {
      this.#teardown();
      this.#set({ connection: 'error', error: errorText(error) });
    }
  }

  async leave(): Promise<void> {
    const room = this.#room;
    this.#teardown();
    this.#set({ connection: 'idle', muted: false, error: null });
    if (room !== null) {
      await room.disconnect().catch(() => undefined);
    }
  }

  setPermission(permission: VoicePermission): void {
    this.#set({ permission });
    void this.#applyPublish();
  }

  async toggleMute(): Promise<void> {
    this.#set({ muted: !this.#state.muted });
    await this.#applyPublish();
  }

  async switchDevice(deviceId: string): Promise<void> {
    this.#set({ activeDeviceId: deviceId });
    const room = this.#room;
    if (room === null) {
      return;
    }
    try {
      await room.switchActiveDevice('audioinput', deviceId);
    } catch {
      // 切换失败保留原设备
    }
  }

  async #resync(): Promise<void> {
    try {
      const synced = await api.voiceSync();
      this.#set({ permission: synced.permission });
      await this.#applyPublish();
    } catch {
      // 重连后同步失败：等待下一次服务端推送
    }
  }

  async #applyPublish(): Promise<void> {
    const room = this.#room;
    if (room === null) {
      return;
    }
    const shouldPublish = this.#state.permission.canPublish && !this.#state.muted;
    try {
      await room.localParticipant.setMicrophoneEnabled(shouldPublish);
    } catch {
      // 服务端尚未授权或设备不可用；界面以许可状态为准
    }
  }

  async #refreshDevices(): Promise<void> {
    try {
      const devices = await Room.getLocalDevices('audioinput');
      this.#set({
        devices,
        activeDeviceId: this.#state.activeDeviceId ?? devices[0]?.deviceId ?? null,
      });
    } catch {
      // 设备枚举失败不阻塞语音
    }
  }

  #teardown(): void {
    const room = this.#room;
    this.#room = null;
    for (const element of Array.from(document.querySelectorAll('audio[data-voice="remote"]'))) {
      element.remove();
    }
    if (room !== null) {
      room.removeAllListeners();
    }
  }
}

export function VoicePanel(props: { enabled: boolean; permission: VoicePermission }) {
  const controllerRef = useRef<VoiceController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new VoiceController();
  }
  const controller = controllerRef.current;
  const [state, setState] = useState<VoiceUiState>(() => controller.getState());

  useEffect(() => controller.subscribe(setState), [controller]);

  useEffect(() => {
    controller.setPermission({
      canPublish: props.permission.canPublish,
      reason: props.permission.reason,
    });
  }, [controller, props.permission.canPublish, props.permission.reason]);

  useEffect(() => {
    return () => {
      void controller.leave();
    };
  }, [controller]);

  if (!props.enabled) {
    return (
      <section className="card voice">
        <h3>语音</h3>
        <p className="muted">语音未启用 · 文字测试模式（公屏与阵营房照常使用）</p>
      </section>
    );
  }

  const { connection, permission, muted, error, devices, activeDeviceId } = state;
  const joined = connection === 'connected' || connection === 'reconnecting';

  return (
    <section className="card voice">
      <h3>语音</h3>
      {connection === 'idle' && (
        <>
          <button type="button" onClick={() => void controller.join()}>
            加入语音
          </button>
          <p className="muted">加入后可听所有发言；只有轮到你发言时才能开麦。</p>
        </>
      )}
      {connection === 'connecting' && <p className="muted">正在连接语音…（浏览器会请求麦克风权限）</p>}
      {connection === 'error' && (
        <>
          <p className="error">语音连接失败：{error}（可继续使用文字）</p>
          <button type="button" onClick={() => void controller.join()}>
            重试
          </button>
        </>
      )}
      {joined && (
        <>
          <p>
            <span className={connection === 'reconnecting' ? 'conn warn' : 'conn on'}>
              {connection === 'reconnecting' ? '语音重连中…' : '语音已连接'}
            </span>
          </p>
          <p className="muted">
            {permission.canPublish
              ? muted
                ? '轮到你发言（你已静音，可取消静音）'
                : '轮到你发言，可以开麦'
              : voiceReasonText(permission.reason)}
          </p>
          <div className="voice-controls">
            <button type="button" onClick={() => void controller.toggleMute()}>
              {muted ? '取消静音' : '静音'}
            </button>
            <button type="button" onClick={() => void controller.leave()}>
              离开语音
            </button>
          </div>
          {devices.length > 0 && (
            <label className="voice-device">
              麦克风
              <select
                value={activeDeviceId ?? ''}
                onChange={(event) => void controller.switchDevice(event.target.value)}
              >
                {devices.map((device, index) => (
                  <option key={device.deviceId || String(index)} value={device.deviceId}>
                    {device.label === '' ? `麦克风 ${index + 1}` : device.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </section>
  );
}
