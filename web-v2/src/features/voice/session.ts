import AgoraRTC, { type IAgoraRTCClient, type IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import type { VoiceCredentials } from '../../../../contracts/v2.ts';
import { VOICE_INPUT_DEFAULT, agcEnabledFor, clampInputGain } from '../../presentation/voice-levels.ts';
import { errorMessage, post } from '../../transport/http.ts';
import { newRequestId } from '../../transport/ids.ts';

export type VoiceConnection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export interface VoiceContext {
  roomCode: string;
  gameId: string;
  canPublish: boolean;
  readOnly: boolean;
  online: boolean;
  activePage: boolean;
}
export interface VoiceState {
  connection: VoiceConnection;
  requested: boolean;
  microphoneEnabled: boolean;
  audioBlocked: boolean;
  error: string;
  microphoneError: string;
  devices: readonly MediaDeviceInfo[];
  activeDeviceId: string;
  /** 自己麦克风的电平 0–100（本地采集，增益之后）。 */
  level: number;
  /** 远端音量指示里最高的一项 0–100：发言窗口内只有一人有发布权，因此可归属为当前发言者。 */
  remoteLevel: number;
}

const initialState = (): VoiceState => ({ connection: 'idle', requested: false, microphoneEnabled: false, audioBlocked: false, error: '', microphoneError: '', devices: [], activeDeviceId: '', level: 0, remoteLevel: 0 });
const mediaError = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '麦克风权限被拒绝，请在浏览器设置中允许后重试。';
    if (error.name === 'NotFoundError') return '没有找到可用麦克风。';
    if (error.name === 'NotReadableError') return '麦克风无法读取，可能正被其他程序占用。';
  }
  return error instanceof Error ? `麦克风启用失败：${error.message}` : '麦克风启用失败。';
};
const isPermissionRace = (error: unknown) => /permission|not.?authorized|denied|forbidden/i.test(error instanceof Error ? error.message : String(error));

/**
 * 音量指示是可选 API：用结构化垫片调用，避免因 SDK 版本 typings 差异（或未提供该能力）让构建失败。
 * 真实名字与取值范围在容器内核对 typings 后再收紧；即使不可用也只是没有电平，不影响通话。
 */
interface VolumeIndicatorApi {
  enableAudioVolumeIndicator?: (intervalMs?: number) => void;
  disableAudioVolumeIndicator?: () => void;
  onVolumeIndicator?: (listener: (users: readonly { uid: number | string; level: number }[]) => void) => void;
}
const volumeIndicatorApi = (client: IAgoraRTCClient): VolumeIndicatorApi => {
  const target = client as unknown as {
    enableAudioVolumeIndicator?: (intervalMs?: number) => void;
    disableAudioVolumeIndicator?: () => void;
    on?: (event: string, listener: (users: readonly { uid: number | string; level: number }[]) => void) => unknown;
  };
  return {
    enableAudioVolumeIndicator: target.enableAudioVolumeIndicator?.bind(target),
    disableAudioVolumeIndicator: target.disableAudioVolumeIndicator?.bind(target),
    onVolumeIndicator: typeof target.on === 'function' ? (listener) => { target.on!('volume-indicator', listener); } : undefined,
  };
};
const VOLUME_INDICATOR_INTERVAL_MS = 200;

/**
 * One authenticated room media session (Agora). Credentials and tracks never leave memory.
 * Publish rights live in the short-lived token: the server issues a publish token only while
 * the snapshot's canPublishVoice is true, and renewToken applies it immediately.
 */
export class VoiceSession {
  #state = initialState();
  #context: VoiceContext | null = null;
  #client: IAgoraRTCClient | null = null;
  #track: IMicrophoneAudioTrack | null = null;
  #generation = 0;
  #retry: number | null = null;
  #retryCount = 0;
  #uid = 0;
  #outputVolume = 100;
  #inputVolume = VOICE_INPUT_DEFAULT;
  #agcEnabled = true;
  #rebuilding = false;
  #listeners = new Set<(state: VoiceState) => void>();

  state() { return this.#state; }
  subscribe(listener: (state: VoiceState) => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #set(patch: Partial<VoiceState>) { this.#state = { ...this.#state, ...patch }; for (const listener of this.#listeners) listener(this.#state); }

  setContext(context: VoiceContext | null) {
    const changedGame = this.#context !== null && (context === null || context.gameId !== this.#context.gameId || context.roomCode !== this.#context.roomCode);
    const lostPermission = this.#context?.canPublish === true && context?.canPublish !== true;
    this.#context = context;
    if (changedGame) { void this.leave(); return; }
    if (!context?.online || !context.activePage || !context.canPublish || context.readOnly || lostPermission) this.#clearIntent();
    if (lostPermission && this.#client !== null) void this.#renewForContext().catch(() => undefined);
  }

  async join(): Promise<void> {
    const context = this.#context;
    if (!context || this.#client || this.#state.connection === 'connecting') return;
    const generation = ++this.#generation;
    this.#set({ connection: 'connecting', error: '', microphoneError: '' });
    let client: IAgoraRTCClient | null = null;
    try {
      const credentials = await post<VoiceCredentials>(`/rooms/${encodeURIComponent(context.roomCode)}/voice/token`, { requestId: newRequestId(), gameId: context.gameId });
      if (generation !== this.#generation) return;
      AgoraRTC.onAutoplayFailed = () => this.#set({ audioBlocked: true });
      client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      this.#client = client;
      this.#uid = Number(credentials.uid);
      const indicator = volumeIndicatorApi(client);
      indicator.onVolumeIndicator?.((users) => {
        let own = 0;
        let remote = 0;
        for (const user of users) {
          const level = typeof user.level === 'number' && Number.isFinite(user.level) ? Math.min(100, Math.max(0, Math.round(user.level))) : 0;
          if (Number(user.uid) === this.#uid) own = Math.max(own, level);
          else remote = Math.max(remote, level);
        }
        this.#set({ level: own, remoteLevel: remote });
      });
      client.on('user-published', (user, mediaType) => {
        void (async () => {
          if (mediaType !== 'audio') return;
          await client!.subscribe(user, mediaType);
          user.audioTrack?.setVolume(this.#outputVolume);
          user.audioTrack?.play();
        })().catch(() => undefined);
      });
      client.on('user-unpublished', (user, mediaType) => {
        if (mediaType === 'audio') user.audioTrack?.stop();
      });
      client.on('connection-state-change', (current) => {
        if (current === 'RECONNECTING') { this.#clearIntent(); this.#set({ connection: 'reconnecting' }); }
        else if (current === 'CONNECTED') { this.#set({ connection: 'connected' }); void this.#afterReconnect(); }
        else if (current === 'DISCONNECTED' && this.#client === client) { this.#teardownClient(); this.#set({ connection: 'idle' }); }
      });
      await client.join(credentials.appId, credentials.channel, credentials.token, credentials.uid);
      if (generation !== this.#generation) { await client.leave().catch(() => undefined); return; }
      indicator.enableAudioVolumeIndicator?.(VOLUME_INDICATOR_INTERVAL_MS);
      this.#applyOutputVolume();
      this.#set({ connection: 'connected' });
      void this.#refreshDevices();
    } catch (error) {
      if (generation !== this.#generation) return;
      if (client) await client.leave().catch(() => undefined);
      this.#teardownClient(); this.#set({ connection: 'error', error: errorMessage(error) });
    }
  }

  async requestMicrophone(): Promise<void> {
    const context = this.#context;
    if (!context?.online || !context.activePage || !context.canPublish || context.readOnly || this.#state.connection !== 'connected') return;
    this.#set({ requested: true, microphoneError: '' });
    try { await this.#renewForContext(); }
    catch (error) { this.#clearIntent(); this.#set({ microphoneError: errorMessage(error) }); return; }
    await this.#applyMicrophone();
  }

  stopMicrophone() { this.#clearIntent(); }
  async switchDevice(deviceId: string) {
    const track = this.#track;
    if (!track) return;
    try { await track.setDevice(deviceId); track.setVolume(this.#inputVolume); this.#set({ activeDeviceId: deviceId }); }
    catch (error) { this.#set({ microphoneError: mediaError(error) }); }
  }

  /** 远端播放音量 0–100（本机偏好，不上报服务端）。 */
  setOutputVolume(volume: number) {
    this.#outputVolume = Math.min(100, Math.max(0, Math.round(volume)));
    this.#applyOutputVolume();
  }

  /** 自己麦克风采集增益 0–100；每次重新开麦都会新建轨道，故值由会话记住并在开麦后重新应用。 */
  /** 自己麦克风采集增益 0–150；跨过 AGC 阈值（125）时重建采集轨道。每次重新开麦也会新建轨道，故值由会话记住。 */
  setInputVolume(volume: number) {
    const next = clampInputGain(volume);
    const needsRebuild = agcEnabledFor(next) !== this.#agcEnabled;
    this.#inputVolume = next;
    if (needsRebuild) this.#agcEnabled = agcEnabledFor(next);
    const track = this.#track;
    if (track === null) return;
    if (needsRebuild) { void this.#rebuildTrack().catch(() => undefined); return; }
    track.setVolume(this.#inputVolume);
  }
  /** AGC 开关只存在于建轨参数里，因此跨阈值时重建轨道并在新轨道上重新应用增益。 */
  async #rebuildTrack(): Promise<void> {
    if (this.#rebuilding || this.#track === null) return;
    this.#rebuilding = true;
    try { await this.#stopTrack(); await this.#applyMicrophone(); }
    finally { this.#rebuilding = false; }
  }
  async enableAudio() {
    const client = this.#client;
    if (client) for (const user of client.remoteUsers) user.audioTrack?.play();
    this.#set({ audioBlocked: false });
  }

  async leave() {
    ++this.#generation;
    const client = this.#client;
    this.#clearIntent(); this.#teardownClient(); this.#set(initialState());
    if (client) await client.leave().catch(() => undefined);
  }

  /** The server signs the token matching the current snapshot permission; renewToken applies it immediately. */
  async #renewForContext(): Promise<void> {
    const client = this.#client, context = this.#context;
    if (!client || !context) return;
    const credentials = await post<VoiceCredentials>(`/rooms/${encodeURIComponent(context.roomCode)}/voice/token`, { requestId: newRequestId(), gameId: context.gameId });
    await client.renewToken(credentials.token);
  }
  async #afterReconnect() {
    try { await this.#renewForContext(); if (this.#state.requested) await this.#applyMicrophone(); }
    catch (error) { this.#set({ error: errorMessage(error) }); }
  }
  async #applyMicrophone() {
    const client = this.#client, context = this.#context;
    if (!client || !context?.online || !context.activePage || !context.canPublish || context.readOnly || !this.#state.requested) return;
    try {
      await client.setClientRole('host').catch(() => undefined);
      if (this.#track === null) {
        const deviceId = this.#state.activeDeviceId;
        // AGC 是建轨参数：增益 >125 手动放大时关闭它，避免自动增益把手动放大压回
        this.#agcEnabled = agcEnabledFor(this.#inputVolume);
        this.#track = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: this.#agcEnabled, ...(deviceId === '' ? {} : { microphoneId: deviceId }) });
      }
      await client.publish([this.#track]);
      this.#track.setVolume(this.#inputVolume);
      if (!this.#state.requested || this.#context?.canPublish !== true) { await this.#stopTrack(); return; }
      this.#clearRetry(); this.#set({ microphoneEnabled: true, microphoneError: '' }); await this.#refreshDevices();
    } catch (error) {
      if (isPermissionRace(error) && this.#retryCount < 8 && this.#state.requested) {
        this.#retryCount++; this.#retry = window.setTimeout(() => { this.#retry = null; void this.#applyMicrophone(); }, 800); return;
      }
      this.#clearIntent(); this.#set({ microphoneError: mediaError(error) });
    }
  }
  async #stopTrack() {
    const client = this.#client, track = this.#track;
    this.#track = null;
    if (track === null) return;
    if (client) await client.unpublish([track]).catch(() => undefined);
    track.stop(); track.close();
  }
  #clearIntent() {
    this.#clearRetry();
    this.#set({ requested: false, microphoneEnabled: false });
    if (this.#track !== null) void this.#stopTrack();
  }
  #clearRetry() { this.#retryCount = 0; if (this.#retry !== null) { clearTimeout(this.#retry); this.#retry = null; } }
  async #refreshDevices() {
    try {
      const devices = await AgoraRTC.getMicrophones();
      this.#set({ devices, activeDeviceId: this.#state.activeDeviceId || devices[0]?.deviceId || '' });
    } catch { /* Device labels are optional; active audio remains usable. */ }
  }
  #applyOutputVolume() {
    const client = this.#client;
    if (!client) return;
    for (const user of client.remoteUsers) user.audioTrack?.setVolume(this.#outputVolume);
  }
  #teardownClient() {
    this.#clearRetry();
    const client = this.#client; this.#client = null;
    if (client) volumeIndicatorApi(client).disableAudioVolumeIndicator?.();
    this.#uid = 0;
    void this.#stopTrack();
    client?.removeAllListeners();
  }
}
