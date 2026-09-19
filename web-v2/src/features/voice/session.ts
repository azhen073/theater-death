import type { Room as LiveKitRoom, RemoteTrack } from 'livekit-client';
import type { VoiceCredentials, VoiceSyncResult } from '../../../../contracts/v2.ts';
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

/** One authenticated room media session. Credentials and tracks never leave memory. */
export class VoiceSession {
  #state = initialState();
  #context: VoiceContext | null = null;
  #room: LiveKitRoom | null = null;
  #generation = 0;
  #retry: number | null = null;
  #retryCount = 0;
  #listeners = new Set<(state: VoiceState) => void>();
  #audioElements = new Set<HTMLMediaElement>();

  state() { return this.#state; }
  subscribe(listener: (state: VoiceState) => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #set(patch: Partial<VoiceState>) { this.#state = { ...this.#state, ...patch }; for (const listener of this.#listeners) listener(this.#state); }

  setContext(context: VoiceContext | null) {
    const changedGame = this.#context !== null && (context === null || context.gameId !== this.#context.gameId || context.roomCode !== this.#context.roomCode);
    const lostPermission = this.#context?.canPublish === true && context?.canPublish !== true;
    this.#context = context;
    if (changedGame) { void this.leave(); return; }
    if (!context?.online || !context.activePage || !context.canPublish || context.readOnly || lostPermission) this.#clearIntent();
  }

  async join(): Promise<void> {
    const context = this.#context;
    if (!context || this.#room || this.#state.connection === 'connecting') return;
    const generation = ++this.#generation;
    this.#set({ connection: 'connecting', error: '', microphoneError: '' });
    let room: LiveKitRoom | null = null;
    try {
      const credentials = await post<VoiceCredentials>(`/rooms/${encodeURIComponent(context.roomCode)}/voice/token`, { requestId: newRequestId(), gameId: context.gameId });
      if (generation !== this.#generation) return;
      const livekit = await import('livekit-client');
      if (generation !== this.#generation) return;
      room = new livekit.Room({ adaptiveStream: false, dynacast: false });
      this.#room = room;
      room.on(livekit.RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== livekit.Track.Kind.Audio) return;
        const element = track.attach(); this.#audioElements.add(element); document.body.appendChild(element);
        void element.play().catch(() => this.#set({ audioBlocked: true }));
      }).on(livekit.RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const element of track.detach()) { this.#audioElements.delete(element); element.remove(); }
      }).on(livekit.RoomEvent.AudioPlaybackStatusChanged, () => this.#set({ audioBlocked: !room!.canPlaybackAudio }))
        .on(livekit.RoomEvent.ParticipantPermissionsChanged, (_previous, participant) => {
          if (participant.identity !== room!.localParticipant.identity) return;
          if (participant.permissions?.canPublish === true && this.#state.requested) void this.#applyMicrophone();
          if (participant.permissions?.canPublish !== true) this.#clearIntent();
        }).on(livekit.RoomEvent.Reconnecting, () => { this.#clearIntent(); this.#set({ connection: 'reconnecting' }); })
        .on(livekit.RoomEvent.Reconnected, () => { this.#set({ connection: 'connected' }); void this.#syncAfterReconnect(); })
        .on(livekit.RoomEvent.Disconnected, () => { if (this.#room === room) { this.#teardownRoom(); this.#set({ connection: 'idle' }); } });
      await room.connect(credentials.url, credentials.token);
      if (generation !== this.#generation) { await room.disconnect(); return; }
      await this.#sync();
      if (generation !== this.#generation) { await room.disconnect(); return; }
      this.#set({ connection: 'connected' });
    } catch (error) {
      if (generation !== this.#generation) return;
      if (room) await room.disconnect().catch(() => undefined);
      this.#teardownRoom(); this.#set({ connection: 'error', error: errorMessage(error) });
    }
  }

  async requestMicrophone(): Promise<void> {
    const context = this.#context;
    if (!context?.online || !context.activePage || !context.canPublish || context.readOnly || this.#state.connection !== 'connected') return;
    this.#set({ requested: true, microphoneError: '' });
    try { await this.#sync(); }
    catch (error) { this.#clearIntent(); this.#set({ microphoneError: errorMessage(error) }); return; }
    await this.#applyMicrophone();
  }

  stopMicrophone() { this.#clearIntent(); }
  async switchDevice(deviceId: string) {
    if (!this.#room) return;
    try { await this.#room.switchActiveDevice('audioinput', deviceId); this.#set({ activeDeviceId: deviceId }); }
    catch (error) { this.#set({ microphoneError: mediaError(error) }); }
  }
  async enableAudio() { if (this.#room) await this.#room.startAudio().catch(() => undefined); this.#set({ audioBlocked: this.#room ? !this.#room.canPlaybackAudio : false }); }

  async leave() {
    ++this.#generation;
    const room = this.#room;
    this.#clearIntent(); this.#teardownRoom(); this.#set(initialState());
    if (room) await room.disconnect().catch(() => undefined);
  }

  async #sync() {
    const context = this.#context;
    if (!context) throw new Error('voice_context_missing');
    await post<VoiceSyncResult>(`/rooms/${encodeURIComponent(context.roomCode)}/voice/sync`, { requestId: newRequestId(), gameId: context.gameId });
  }
  async #syncAfterReconnect() {
    this.#clearIntent();
    try { await this.#sync(); } catch (error) { this.#set({ error: errorMessage(error) }); }
  }
  async #applyMicrophone() {
    const room = this.#room, context = this.#context;
    if (!room || !context?.online || !context.activePage || !context.canPublish || context.readOnly || !this.#state.requested) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      if (!this.#state.requested || this.#context?.canPublish !== true) { await room.localParticipant.setMicrophoneEnabled(false); return; }
      this.#clearRetry(); this.#set({ microphoneEnabled: true, microphoneError: '' }); await this.#refreshDevices();
    } catch (error) {
      if (/insufficient permissions/i.test(error instanceof Error ? error.message : String(error)) && this.#retryCount < 8 && this.#state.requested) {
        this.#retryCount++; this.#retry = window.setTimeout(() => { this.#retry = null; void this.#applyMicrophone(); }, 800); return;
      }
      this.#clearIntent(); this.#set({ microphoneError: mediaError(error) });
    }
  }
  #clearIntent() {
    this.#clearRetry();
    const room = this.#room;
    this.#set({ requested: false, microphoneEnabled: false });
    if (room) void room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
  }
  #clearRetry() { this.#retryCount = 0; if (this.#retry !== null) { clearTimeout(this.#retry); this.#retry = null; } }
  async #refreshDevices() {
    try {
      const livekit = await import('livekit-client');
      const devices = await livekit.Room.getLocalDevices('audioinput');
      this.#set({ devices, activeDeviceId: this.#state.activeDeviceId || devices[0]?.deviceId || '' });
    } catch { /* Device labels are optional; active audio remains usable. */ }
  }
  #teardownRoom() {
    this.#clearRetry();
    const room = this.#room; this.#room = null;
    room?.removeAllListeners();
    for (const element of this.#audioElements) element.remove(); this.#audioElements.clear();
  }
}
