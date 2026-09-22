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
  /** 非致命提示（SDK 质量异常、凭证过期重连等）；排障用，不影响通话。 */
  notice: string;
  devices: readonly MediaDeviceInfo[];
  activeDeviceId: string;
  /** 自己麦克风的电平 0–100（本地采集，增益之后）。 */
  level: number;
  /** 远端音量指示里最高的一项 0–100：发言窗口内只有一人有发布权，因此可归属为当前发言者。 */
  remoteLevel: number;
}

const initialState = (): VoiceState => ({ connection: 'idle', requested: false, microphoneEnabled: false, audioBlocked: false, error: '', microphoneError: '', notice: '', devices: [], activeDeviceId: '', level: 0, remoteLevel: 0 });

/**
 * `exception` 事件只报音视频质量异常（见 SDK 事件表），与本项目相关的是音频四项及其恢复项。
 * 键为事件码，recover 表示"已恢复正常"（用于清掉提示）；视频类异常不提示。
 */
const VOICE_EXCEPTIONS: Record<number, { label: string; recover: boolean }> = {
  2001: { label: '麦克风输入音量过低', recover: false },
  2002: { label: '远端音量过低', recover: false },
  2003: { label: '发送音频码率过低', recover: false },
  2005: { label: '接收音频解码失败', recover: false },
  4001: { label: '麦克风输入音量恢复正常', recover: true },
  4002: { label: '远端音量恢复正常', recover: true },
  4003: { label: '发送音频码率恢复正常', recover: true },
};
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
  /** 正在进行的取消发布/关轨任务：新建轨道前必须等它结束，否则会出现两条轨道同时发布（回声）。 */
  #stopTask: Promise<void> | null = null;
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
      // 加入凭证 30 分钟后过期：SDK 在过期前 30 秒给一次机会续期，过期后必须重新 join（官方 typings）
      client.on('token-privilege-will-expire', () => { void this.#renewForContext().catch(() => undefined); });
      client.on('token-privilege-did-expire', () => { void this.#rejoinAfterExpire(); });
      client.on('exception', (event: { code?: number; msg?: string }) => {
        const info = typeof event?.code === 'number' ? VOICE_EXCEPTIONS[event.code] : undefined;
        if (!info) return; // 视频类异常与本项目无关
        console.warn('[voice] exception', event.code, event.msg ?? '');
        this.#set({ notice: info.recover ? '' : `语音质量异常：${info.label}` });
      });
      client.on('connection-state-change', (current) => {
        if (current === 'RECONNECTING') { this.#clearIntent(); this.#set({ connection: 'reconnecting' }); }
        else if (current === 'CONNECTED') { this.#set({ connection: 'connected' }); void this.#afterReconnect(); }
        else if (current === 'DISCONNECTED' && this.#client === client) { this.#teardownClient(); this.#set({ connection: 'idle' }); }
      });
      const joinedUid = await client.join(credentials.appId, credentials.channel, credentials.token, credentials.uid);
      if (generation !== this.#generation) { await client.leave().catch(() => undefined); return; }
      // 以 SDK 实际采用的 uid 为准（服务端与 SDK 不一致时电平归属才不会错）
      const reported = Number(joinedUid);
      if (Number.isFinite(reported)) this.#uid = reported;
      indicator.enableAudioVolumeIndicator?.(VOLUME_INDICATOR_INTERVAL_MS);
      this.#applyOutputVolume();
      this.#set({ connection: 'connected', notice: '' });
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
    this.#clearIntent(); this.#teardownClient(); this.#resetState();
    if (client) await client.leave().catch(() => undefined);
  }

  /** 会话复位；设备选择在会话内保留（与 v1 行为一致）。 */
  #resetState() { this.#set({ ...initialState(), activeDeviceId: this.#state.activeDeviceId }); }

  /** 加入凭证已过期：SDK 要求重新 join（官方 typings）；保留"正在发言"的意图并在重连后自动恢复开麦。 */
  async #rejoinAfterExpire(): Promise<void> {
    const context = this.#context;
    if (!context) return;
    const resumeMicrophone = this.#state.requested === true && context.canPublish === true;
    ++this.#generation;
    const client = this.#client;
    this.#clearIntent(); this.#teardownClient(); this.#resetState();
    this.#set({ notice: '语音凭证已过期，正在重新加入…' });
    if (client) await client.leave().catch(() => undefined);
    await this.join();
    if (resumeMicrophone && this.#state.connection === 'connected') await this.requestMicrophone();
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
      // 等上一次取消发布/关轨结束再建新轨，否则旧轨道还在发布时就会多出一条（短暂双发、可能自听回声）
      if (this.#stopTask !== null) await this.#stopTask.catch(() => undefined);
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
    const task = (async () => {
      if (client) await client.unpublish([track]).catch(() => undefined);
      track.stop(); track.close();
    })();
    this.#stopTask = task;
    try { await task; } finally { if (this.#stopTask === task) this.#stopTask = null; }
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
    // 离开后不再把自动播放失败记到已销毁的会话上（新会话 join 时会重新注册）
    AgoraRTC.onAutoplayFailed = () => undefined;
    this.#uid = 0;
    void this.#stopTrack();
    client?.removeAllListeners();
  }
}
