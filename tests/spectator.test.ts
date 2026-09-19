import { describe, expect, it } from 'vitest';
import type { VoiceService } from '../voice/livekit.ts';
import {
  clientForRole,
  connectClient,
  expectConnectFailure,
  getJson,
  postJson,
  setupLobby,
  setupStartedGame,
  startTestServer,
  waitFor,
  type TestContext,
} from './server-test-utils.ts';

function createFakeVoice() {
  const issued: Array<{ roomName: string; playerId: string }> = [];
  const removed: Array<{ roomName: string; identity: string }> = [];
  const service: VoiceService = {
    async issueCredentials({ roomName, playerId }) {
      issued.push({ roomName, playerId });
      return { url: 'wss://voice.test', token: `token-${playerId}`, roomName };
    },
    async syncRoom() {
      return;
    },
    async closeRoom() {
      return;
    },
    async removeParticipant(roomName, identity) {
      removed.push({ roomName, identity });
    },
  };
  return { service, issued, removed };
}

function errorCode(response: { json: Record<string, unknown> }): unknown {
  return (response.json.error as { code?: unknown } | undefined)?.code;
}

async function watchRoom(
  context: TestContext,
  roomCode: string,
  nickname: string,
  bindPlayerId: string,
): Promise<string> {
  const watched = await postJson(context, `/api/rooms/${roomCode}/watch`, {
    nickname,
    bindPlayerId,
  });
  expect(watched.status).toBe(201);
  expect(watched.json.bindPlayerId).toBe(bindPlayerId);
  expect(typeof watched.json.spectatorId).toBe('string');
  return watched.cookie ?? '';
}

function stripSpectatorFields(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  delete copy.spectating;
  delete copy.spectators;
  delete copy.voice;
  return copy;
}

describe('观战（绑定玩家的只读第二屏）', () => {
  it('大厅期观战加入：成功绑定并出现在观战席；守卫拒绝非法加入', async () => {
    const context = await startTestServer();
    const lobby = await setupLobby(context);
    const bind = lobby.clients[1];
    const cookie = await watchRoom(context, lobby.roomCode, '观众', bind.playerId);

    const room = context.registry.getByCode(lobby.roomCode);
    expect(room?.spectators).toHaveLength(1);
    expect(room?.members).toHaveLength(13);

    const view = await getJson(context, '/api/view', cookie);
    expect(view.status).toBe(200);
    const you = view.json.you as { playerId: string; nickname: string };
    expect(you.playerId).toBe(bind.playerId);
    const spectating = view.json.spectating as { nickname: string; bindPlayerId: string };
    expect(spectating.nickname).toBe('观众');
    expect(spectating.bindPlayerId).toBe(bind.playerId);

    const again = await postJson(context, `/api/rooms/${lobby.roomCode}/watch`, {
      nickname: '观众2',
      bindPlayerId: bind.playerId,
    });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('player_already_watched');

    const unknownPlayer = await postJson(context, `/api/rooms/${lobby.roomCode}/watch`, {
      nickname: '观众2',
      bindPlayerId: 'p_nope',
    });
    expect(unknownPlayer.status).toBe(404);
    expect(errorCode(unknownPlayer)).toBe('player_not_found');

    const unknownRoom = await postJson(context, '/api/rooms/ZZZZZZ/watch', {
      nickname: '观众2',
      bindPlayerId: bind.playerId,
    });
    expect(unknownRoom.status).toBe(404);

    const badNickname = await postJson(context, `/api/rooms/${lobby.roomCode}/watch`, {
      nickname: '',
      bindPlayerId: bind.playerId,
    });
    expect(badNickname.status).toBe(400);

    const badBind = await postJson(context, `/api/rooms/${lobby.roomCode}/watch`, {
      nickname: '观众2',
    });
    expect(badBind.status).toBe(400);
  });

  it('对局中观战：视图与绑定玩家一致（仅语音许可与标记字段不同）；全量只读', async () => {
    const fake = createFakeVoice();
    const context = await startTestServer({ voice: fake.service });
    const game = await setupStartedGame(context);
    const bind = game.clients[3];
    const cookie = await watchRoom(context, game.roomCode, '观众', bind.playerId);

    const playerView = await getJson(context, '/api/view', bind.cookie);
    const spectatorView = await getJson(context, '/api/view', cookie);
    expect(playerView.status).toBe(200);
    expect(spectatorView.status).toBe(200);
    expect(stripSpectatorFields(spectatorView.json)).toEqual(stripSpectatorFields(playerView.json));
    expect((spectatorView.json.spectating as { bindPlayerId: string }).bindPlayerId).toBe(
      bind.playerId,
    );
    expect(
      (spectatorView.json.voice as { permission: { reason: string } }).permission.reason,
    ).toBe('spectator');
    expect(Array.isArray(spectatorView.json.spectators)).toBe(true);

    const command = await postJson(
      context,
      '/api/command',
      { requestId: 'sp-1', action: 'REGISTER_CANDIDACY' },
      cookie,
    );
    expect(command.status).toBe(403);
    expect(errorCode(command)).toBe('spectator_readonly');

    const chat = await postJson(context, '/api/chat', { channel: 'public', text: '偷偷发言' }, cookie);
    expect(chat.status).toBe(403);
    expect(errorCode(chat)).toBe('spectator_readonly');

    const sync = await postJson(context, '/api/voice/sync', {}, cookie);
    expect(sync.status).toBe(403);
    expect(errorCode(sync)).toBe('spectator_readonly');

    const ready = await postJson(
      context,
      `/api/rooms/${game.roomCode}/ready`,
      { ready: true },
      cookie,
    );
    expect(ready.status).toBe(403);

    const playerToken = await postJson(context, '/api/voice/token', {}, bind.cookie);
    expect(playerToken.status).toBe(200);
    const spectatorToken = await postJson(context, '/api/voice/token', {}, cookie);
    expect(spectatorToken.status).toBe(200);
    expect(spectatorToken.json.permission).toEqual({ canPublish: false, reason: 'spectator' });
    const issued = fake.issued.at(-1);
    expect(issued?.playerId.startsWith('s_')).toBe(true);
  });

  it('观众读取范围 = 绑定玩家：公屏放行、阵营房按绑定玩家的成员资格', async () => {
    const context = await startTestServer();
    const game = await setupStartedGame(context);
    const spirit = clientForRole(game.room, game.clients, 'spirit');
    const civilian = clientForRole(game.room, game.clients, 'civilian');
    const spiritWatcher = await watchRoom(context, game.roomCode, '魂灵观众', spirit.playerId);
    const civilianWatcher = await watchRoom(context, game.roomCode, '平民观众', civilian.playerId);

    const publicRead = await getJson(context, '/api/chat?channel=public', spiritWatcher);
    expect(publicRead.status).toBe(200);

    const factionRead = await getJson(context, '/api/chat?channel=faction', spiritWatcher);
    expect(factionRead.status).toBe(200);

    const factionDenied = await getJson(context, '/api/chat?channel=faction', civilianWatcher);
    expect(factionDenied.status).toBe(403);
    expect(errorCode(factionDenied)).toBe('room_forbidden');
  });

  it('观众不计入开局人数；退出观战与玩家离开大厅都会释放绑定', async () => {
    const context = await startTestServer();
    const lobby = await setupLobby(context);
    const bind = lobby.clients[1];
    const room = context.registry.getByCode(lobby.roomCode);
    const cookie = await watchRoom(context, lobby.roomCode, '观众', bind.playerId);

    const leave = await postJson(context, '/api/spectate/leave', {}, cookie);
    expect(leave.status).toBe(200);
    const afterLeave = await getJson(context, '/api/view', cookie);
    expect(afterLeave.status).toBe(403);
    expect(room?.spectators).toHaveLength(0);

    const cookie2 = await watchRoom(context, lobby.roomCode, '观众', bind.playerId);
    const playerLeft = await postJson(context, `/api/rooms/${lobby.roomCode}/leave`, {}, bind.cookie);
    expect(playerLeft.status).toBe(200);
    expect(room?.spectators).toHaveLength(0);
    const afterBindLeave = await getJson(context, '/api/view', cookie2);
    expect(afterBindLeave.status).toBe(403);

    const refill = await postJson(context, `/api/rooms/${lobby.roomCode}/join`, { nickname: '补位' });
    expect(refill.status).toBe(201);

    const roster = [
      ...lobby.clients.slice(0, 1),
      ...lobby.clients.slice(2),
      { cookie: refill.cookie ?? '', playerId: refill.json.playerId as string },
    ];
    for (const client of roster) {
      await postJson(context, `/api/rooms/${lobby.roomCode}/ready`, { ready: true }, client.cookie);
    }
    const start = await postJson(
      context,
      `/api/rooms/${lobby.roomCode}/start`,
      {},
      lobby.hostClient.cookie,
    );
    expect(start.status).toBe(200);
    expect(room?.state).not.toBeNull();
  });

  it('观战入口名单公开可读：昵称/座位/存活/已观战标记，不含身份字段', async () => {
    const context = await startTestServer();
    const game = await setupStartedGame(context);
    const bind = game.clients[1];
    await watchRoom(context, game.roomCode, '观众', bind.playerId);

    const list = await getJson(context, `/api/rooms/${game.roomCode}/members`);
    expect(list.status).toBe(200);
    expect(list.json.phase).toBe('started');
    const members = list.json.members as Array<Record<string, unknown>>;
    expect(members).toHaveLength(13);
    const bound = members.find((member) => member.playerId === bind.playerId);
    expect(bound?.watched).toBe(true);
    expect(typeof bound?.seat).toBe('number');
    expect(typeof bound?.alive).toBe('boolean');
    expect(JSON.stringify(list.json).includes('roleId')).toBe(false);

    const missing = await getJson(context, '/api/rooms/ZZZZZZ/members');
    expect(missing.status).toBe(404);
  });

  it('观众复盘权利与玩家一致：终局前 403，终局后放行', async () => {
    const context = await startTestServer();
    const game = await setupStartedGame(context);
    const death = clientForRole(game.room, game.clients, 'death');
    const cookie = await watchRoom(context, game.roomCode, '观众', death.playerId);

    const early = await getJson(context, '/api/review', cookie);
    expect(early.status).toBe(403);
    expect(errorCode(early)).toBe('game_not_ended');

    const state = game.room.state;
    if (state === null) {
      throw new Error('对局未开始');
    }
    const killTargetIds = [
      ...state.players
        .filter((player) => player.roleId === 'civilian')
        .map((player) => player.playerId),
      ...state.players
        .filter((player) => player.roleId === 'researcher')
        .map((player) => player.playerId),
    ];
    for (const [index, targetId] of killTargetIds.entries()) {
      const receipt = await postJson(
        context,
        '/api/command',
        { requestId: `sp-kill-${index}`, action: 'EDIT_PROPOSAL', targets: [targetId] },
        death.cookie,
      );
      expect(receipt.json.status).toBe('accepted');
      context.clock.advance(90_000);
      context.clock.advance(45_000);
      let guard = 0;
      while (
        game.room.state?.phase !== 'night' &&
        game.room.state?.phase !== 'ended' &&
        guard < 100
      ) {
        context.clock.advance(60_000);
        guard += 1;
      }
      if (game.room.state?.phase === 'ended') {
        break;
      }
    }
    expect(game.room.state?.phase).toBe('ended');

    const review = await getJson(context, '/api/review', cookie);
    expect(review.status).toBe(200);
    const body = review.json.review as { winner: string; players: Array<{ roleId: string }> };
    expect(body.winner).toBe('death_faction');
    expect(body.players.some((player) => player.roleId === 'death')).toBe(true);
  });

  it('实时通道：观众与绑定玩家收到同一事件流；退出观战后旧凭证失效', async () => {
    const context = await startTestServer({ realtime: true });
    const lobby = await setupLobby(context);
    const bind = lobby.clients[1];
    const cookie = await watchRoom(context, lobby.roomCode, '观众', bind.playerId);

    const playerSocket = await connectClient(context, bind.cookie);
    const spectatorSocket = await connectClient(context, cookie);
    expect(playerSocket.hellos[0]?.kind).toBe('player');
    expect(spectatorSocket.hellos[0]?.kind).toBe('spectator');
    expect(spectatorSocket.hellos[0]?.playerId).toBe(bind.playerId);
    expect(typeof spectatorSocket.hellos[0]?.spectatorId).toBe('string');

    for (const client of lobby.clients) {
      await postJson(context, `/api/rooms/${lobby.roomCode}/ready`, { ready: true }, client.cookie);
    }
    await postJson(context, `/api/rooms/${lobby.roomCode}/start`, {}, lobby.hostClient.cookie);

    await waitFor(
      () =>
        playerSocket.gameEvents.length > 0 &&
        spectatorSocket.gameEvents.length === playerSocket.gameEvents.length,
    );
    expect(spectatorSocket.gameEvents).toEqual(playerSocket.gameEvents);
    expect(spectatorSocket.gameEvents.some((event) => event.type === 'role_assigned')).toBe(true);

    await postJson(context, '/api/spectate/leave', {}, cookie);
    await expectConnectFailure(context, cookie);
  });
});
