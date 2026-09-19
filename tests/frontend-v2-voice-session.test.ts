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
    private listeners: Array<[string, (...args: any[]) => void]> = [];
    on(event: string, listener: (...args: any[]) => void) { this.listeners.push([event, listener]); return this; }
    removeAllListeners() { this.listeners = []; }
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
      createMicrophoneAudioTrack: async () => {
        const track = { stop: () => undefined, close: () => undefined, setDevice: async () => undefined };
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
