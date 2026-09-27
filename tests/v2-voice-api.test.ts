import { afterEach, describe, expect, it } from 'vitest';
import {
  closeHarnesses,
  enter,
  json,
  makeHarness,
  MockVoice,
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
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'voice-create', publicChat: 'alive_only', freeSpeech: false, playerCount: 5, roles: EXPERIMENTAL_ROLES }), h.users[0]);
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

describe('v2 房间频道语音（Q-12：大厅与复盘自由开麦）', () => {
  /** 建房并让前 5 名用户成为正式玩家（第 6 名加入即公开观众）。 */
  async function lobbyRoom(h: HttpHarness) {
    const created = await request(h, '/api/v2/rooms', post({ requestId: 'q12-create', publicChat: 'alive_only', freeSpeech: false, playerCount: 5, roles: EXPERIMENTAL_ROLES }), h.users[0]);
    expect(created.status).toBe(201);
    const room = await json(created) as { roomCode: string; roomId: string };
    for (let index = 1; index < 5; index += 1) {
      expect((await enter(h, room.roomCode, h.users[index]!, `q12-enter-${index}`)).response.status).toBe(200);
    }
    return room;
  }

  it('大厅：正式成员拿发布凭证、观众只拿订阅凭证，且请求不带 gameId；频道名独立于任何一局', async () => {
    const voice = new MockVoice();
    const h = await makeHarness(20, voice);
    const room = await lobbyRoom(h);
    const spectatorJoin = await enter(h, room.roomCode, h.users[5]!, 'q12-enter-observer');
    expect(spectatorJoin.response.status).toBe(200);

    const channel = `l_${room.roomId}`;
    const formal = await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, post({ requestId: 'q12-token-formal' }), h.users[0]);
    expect(formal.status).toBe(200);
    expect(await json(formal)).toMatchObject({ channel });
    expect((await json(await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, post({ requestId: 'q12-token-formal-2' }), h.users[0]))).token).toMatch(/^pub:/);

    const spectator = await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, post({ requestId: 'q12-token-observer' }), h.users[5]);
    expect(spectator.status).toBe(200);
    expect((await json(spectator)).token).toMatch(/^sub:/);

    // 快照：大厅也有语音范围与发布权（观众为 false），uid 主体等签发后才出现
    const view = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, undefined, h.users[0]));
    expect(view.room.phase).toBe('lobby');
    expect(view.voice).toMatchObject({ channel });
    expect(view.capabilities.canPublishVoice).toBe(true);
    const observerView = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, undefined, h.users[5]));
    expect(observerView.voice).toMatchObject({ channel });
    expect(observerView.capabilities.canPublishVoice).toBe(false);
  });

  it('开局即关闭大厅频道，并把身份换成对局频道（成员 → playerId）', async () => {
    const voice = new MockVoice();
    const h = await makeHarness(20, voice);
    const room = await lobbyRoom(h);
    const before = await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, post({ requestId: 'q12-lobby-token' }), h.users[0]);
    expect((await json(before)).channel).toBe(`l_${room.roomId}`);

    for (let index = 0; index < 5; index += 1) {
      expect((await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `q12-ready-${index}`, ready: true }), h.users[index])).status).toBe(200);
    }
    const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'q12-start' }), h.users[0]);
    expect(started.status).toBe(200);
    const gameId = (await json(started)).gameId as string;
    expect(voice.closed).toContain(`l_${room.roomId}`);

    const match = await json(await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, post({ requestId: 'q12-match-token', gameId }), h.users[0]));
    expect(match.channel).toBe(gameId);
    const view = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, undefined, h.users[0]));
    expect(view.voice).toMatchObject({ channel: gameId });
  });

  it('复盘：回到房间频道，正式成员仍可自由开麦（终局不给对局频道发凭证）', async () => {
    const voice = new MockVoice();
    const h = await makeHarness(20, voice);
    const game = await startFivePlayerGame(h);
    // 让本局直接进入终局（review 相位的判定依据就是 runtime.state.win）
    const runtime = h.app.directory.byId.get([...h.app.directory.byId.keys()][0]!)!.runtime!;
    runtime.state = { ...runtime.state!, win: { winner: 'human', dayNumber: 2, reason: 'q12-test' } };

    const view = await json(await request(h, `/api/v2/rooms/${game.roomCode}/view`, undefined, h.users[0]));
    expect(view.room.phase).toBe('review');
    expect(view.voice.channel).toMatch(/^l_/);
    expect(view.capabilities.canPublishVoice).toBe(true);

    const review = await request(h, `/api/v2/rooms/${game.roomCode}/voice/token`, post({ requestId: 'q12-review-token' }), h.users[0]);
    expect(review.status).toBe(200);
    const credentials = await json(review);
    expect(credentials.channel).toMatch(/^l_/);
    expect(credentials.token).toMatch(/^pub:/);
    // 相位以服务端为准：复盘时即使请求里带着旧 gameId，也只会拿到房间频道凭证（绝不进对局频道）
    const stale = await json(await request(h, `/api/v2/rooms/${game.roomCode}/voice/token`, post({ requestId: 'q12-review-match-token', gameId: game.gameId }), h.users[0]));
    expect(stale.channel).toBe(credentials.channel);
    expect(stale.token).toMatch(/^pub:/);
  });
});
