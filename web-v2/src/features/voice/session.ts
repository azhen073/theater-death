import AgoraRTC, { type IAgoraRTCClient, type IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import type { VoiceCredentials } from '../../../../contracts/v2.ts';
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
}

const initialState = (): VoiceState => ({ connection: 'idle', requested: false, microphoneEnabled: false, audioBlocked: false, error: '', microphoneError: '', devices: [], activeDeviceId: '' });
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
      client.on('user-published', (user, mediaType) => {
        void (async () => {
          if (mediaType !== 'audio') return;
          await client!.subscribe(user, mediaType);
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
    try { await track.setDevice(deviceId); this.#set({ activeDeviceId: deviceId }); }
    catch (error) { this.#set({ microphoneError: mediaError(error) }); }
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
        this.#track = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true, ...(deviceId === '' ? {} : { microphoneId: deviceId }) });
      }
      await client.publish([this.#track]);
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
  #teardownClient() {
    this.#clearRetry();
    const client = this.#client; this.#client = null;
    void this.#stopTrack();
    client?.removeAllListeners();
  }
}
