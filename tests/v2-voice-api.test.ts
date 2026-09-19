import { afterEach, describe, expect, it } from 'vitest';
import {
  closeHarnesses,
  enter,
  json,
  makeHarness,
  post,
  request,
  type HttpHarness,
  type User,
} from './contract-http-utils.ts';
import type { VoiceCredentials, VoiceService } from '../voice/agora.ts';

afterEach(closeHarnesses);

const EXPERIMENTAL_ROLES = {
  laike: 0,
  door: 1,
  water: 0,
  descender: 0,
  researcher: 1,
  civilian: 1,
  death: 1,
  spirit: 1,
  mourner: 0,
};

class FailingVoice implements VoiceService {
  readonly issued: string[] = [];
  failClose = false;
  issueCredentials(input: { roomName: string; uid: number }): VoiceCredentials {
    this.issued.push(`${input.roomName}/${input.uid}`);
    throw new Error('voice service unavailable');
  }
  issuePublishGrant(input: { roomName: string; uid: number }): { token: string; expiresAt: number } {
    return { token: `pub:${input.uid}`, expiresAt: Date.now() + 600_000 };
  }
  issueSubscriberGrant(input: { roomName: string; uid: number }): { token: string } {
    return { token: `sub:${input.uid}` };
  }
  closeRoom(): Promise<void> { return this.failClose ? Promise.reject(new Error('voice service unavailable')) : Promise.resolve(); }
  removeParticipant(): Promise<void> { return Promise.resolve(); }
}

async function startFivePlayerGame(h: HttpHarness): Promise<{ roomCode: string; gameId: string }> {
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'voice-create', playerCount: 5, roles: EXPERIMENTAL_ROLES }), h.users[0]);
  expect(created.status).toBe(201);
  const room = await json(created) as { roomCode: string };
  for (let index = 1; index < 5; index += 1) {
    expect((await enter(h, room.roomCode, h.users[index]!, `voice-enter-${index}`)).response.status).toBe(200);
  }
  for (let index = 0; index < 5; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `voice-ready-${index}`, ready: true }), h.users[index]);
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'voice-start' }), h.users[0]);
  expect(started.status).toBe(200);
  const body = await json(started);
  expect(typeof body.gameId).toBe('string');
  return { roomCode: room.roomCode, gameId: body.gameId as string };
}

function errorCode(body: Record<string, any>): string | undefined { return body.error?.code; }

describe('v2 voice HTTP contract', () => {
  it('VOICE_ENABLED=false exposes no media capability and never calls a media service', async () => {
    const h = await makeHarness();
    const game = await startFivePlayerGame(h);
    const bootstrap = await request(h, '/api/v2/bootstrap');
    expect((await json(bootstrap)).features.voice).toBe(false);
    const token = await request(h, `/api/v2/rooms/${game.roomCode}/voice/token`, post({ requestId: 'voice-disabled-token', gameId: game.gameId }), h.users[0]);
    expect(token.status).toBe(409);
    expect(errorCode(await json(token))).toBe('voice_disabled');
    const sync = await request(h, `/api/v2/rooms/${game.roomCode}/voice/sync`, post({ requestId: 'voice-disabled-sync', gameId: game.gameId }), h.users[0]);
    expect(sync.status).toBe(409);
    expect(errorCode(await json(sync))).toBe('voice_disabled');
  });

  it('voice token maps media issue failure to voice_unavailable without pausing the game', async () => {
    const voice = new FailingVoice();
    const h = await makeHarness(20, voice);
    const game = await startFivePlayerGame(h);
    const token = await request(h, `/api/v2/rooms/${game.roomCode}/voice/token`, post({ requestId: 'voice-failing-token', gameId: game.gameId }), h.users[0]);
    expect(token.status).toBe(503);
    expect(errorCode(await json(token))).toBe('voice_unavailable');
    expect(voice.issued).toHaveLength(1);
    const view = await request(h, `/api/v2/rooms/${game.roomCode}/view`, undefined, h.users[0]);
    expect(view.status).toBe(200);
  });

  it('voice sync succeeds without media side effects when nothing must be aligned', async () => {
    const voice = new FailingVoice();
    const h = await makeHarness(20, voice);
    const game = await startFivePlayerGame(h);
    const sync = await request(h, `/api/v2/rooms/${game.roomCode}/voice/sync`, post({ requestId: 'voice-plain-sync', gameId: game.gameId }), h.users[0]);
    expect(sync.status).toBe(200);
    expect((await json(sync)).synced).toBe(true);
  });

  it('old session cannot obtain a voice token after explicit takeover', async () => {
    const h = await makeHarness(20);
    const game = await startFivePlayerGame(h);
    const replacementSession = h.accounts.createSession(h.users[0]!.userId);
    const replacement: User = { ...h.users[0]!, cookie: `td_account_v2=${replacementSession.token}`, sessionId: replacementSession.session.id };
    const takeover = await request(h, `/api/v2/rooms/${game.roomCode}/takeover`, post({ requestId: 'voice-takeover', gameId: game.gameId }), replacement);
    expect(takeover.status).toBe(200);
    const oldToken = await request(h, `/api/v2/rooms/${game.roomCode}/voice/token`, post({ requestId: 'voice-old-token', gameId: game.gameId }), h.users[0]);
    expect(oldToken.status).toBe(403);
    expect(errorCode(await json(oldToken))).toBe('room_access_required');
  });
});
