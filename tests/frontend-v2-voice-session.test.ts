/// <reference lib="dom" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceContext } from '../web-v2/src/features/voice/session.ts';

const mocks = vi.hoisted(() => ({ post: vi.fn(async () => ({ url: 'wss://voice.test', token: 'token', roomName: 'game-1' })), rooms: [] as Array<any> }));
vi.mock('../web-v2/src/transport/http.ts', () => ({
  post: mocks.post,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'error',
}));

class FakeRoom {
  readonly localParticipant = { identity: 'media-1', setMicrophoneEnabled: vi.fn(async () => undefined) };
  canPlaybackAudio = true;
  private readonly listeners = new Map<string, (...args: unknown[]) => void>();
  on(event: string, listener: (...args: unknown[]) => void) { this.listeners.set(event, listener); return this; }
  removeAllListeners() { this.listeners.clear(); }
  async connect() { return undefined; }
  async disconnect() { return undefined; }
  async switchActiveDevice() { return undefined; }
}

vi.mock('livekit-client', () => ({
  Room: class extends FakeRoom {
    constructor() { super(); mocks.rooms.push(this); }
    static async getLocalDevices() { return []; }
  },
  RoomEvent: {
    TrackSubscribed: 'TrackSubscribed', TrackUnsubscribed: 'TrackUnsubscribed',
    AudioPlaybackStatusChanged: 'AudioPlaybackStatusChanged', ParticipantPermissionsChanged: 'ParticipantPermissionsChanged',
    Reconnecting: 'Reconnecting', Reconnected: 'Reconnected', Disconnected: 'Disconnected',
  },
  Track: { Kind: { Audio: 'audio' } },
}));

import { VoiceSession } from '../web-v2/src/features/voice/session.ts';

const context = (overrides: Partial<VoiceContext> = {}) => ({
  roomCode: 'ROOM01', gameId: 'game-1', canPublish: true, readOnly: false, online: true, activePage: true, ...overrides,
});

async function connectedSession() {
  const session = new VoiceSession();
  session.setContext(context());
  await session.join();
  expect(session.state().connection).toBe('connected');
  return { session, room: mocks.rooms.at(-1)! };
}

describe('v2 voice session intent lifecycle', () => {
  beforeEach(() => { mocks.post.mockClear(); mocks.rooms.length = 0; });

  it('clears the one-shot microphone intent and disables the track when publish permission is revoked', async () => {
    const { session, room } = await connectedSession();
    await session.requestMicrophone();
    expect(session.state()).toMatchObject({ requested: true, microphoneEnabled: true });

    session.setContext(context({ canPublish: false }));
    expect(session.state()).toMatchObject({ requested: false, microphoneEnabled: false });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
  });

  it('clears microphone intent and track when leaving the game page', async () => {
    const { session, room } = await connectedSession();
    await session.requestMicrophone();
    session.setContext(context({ activePage: false }));
    expect(session.state()).toMatchObject({ connection: 'connected', requested: false, microphoneEnabled: false });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
  });

  it('clears microphone intent and track while offline', async () => {
    const { session, room } = await connectedSession();
    await session.requestMicrophone();
    session.setContext(context({ online: false }));
    expect(session.state()).toMatchObject({ requested: false, microphoneEnabled: false });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
  });
});
