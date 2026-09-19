import { describe, expect, it } from 'vitest';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import type { Room } from '../server/rooms.ts';
import type { VoiceService } from '../voice/agora.ts';
import {
  clientForRole,
  getJson,
  postJson,
  setupLobby,
  setupStartedGame,
  startTestServer,
  waitFor,
  type Client,
} from './server-test-utils.ts';

function createFakeVoice() {
  const removed: Array<{ roomName: string; uid: number }> = [];
  const service: VoiceService = {
    issueCredentials({ roomName, uid }) {
      return { appId: 'appid-test', channel: roomName, uid, token: `sub-${uid}` };
    },
    issuePublishGrant({ roomName, uid }) {
      return { token: `pub-${roomName}-${uid}`, expiresAt: Date.now() + 600_000 };
    },
    issueSubscriberGrant({ roomName, uid }) {
      return { token: `sub-${roomName}-${uid}` };
    },
    async closeRoom() {
      return;
    },
    async removeParticipant(roomName, uid) {
      removed.push({ roomName, uid });
    },
  };
  return { service, removed };
}

/** 把已开局房间强制置为终局（附最小 win 结果），用于终局后行为测试 */
function forceEnded(room: Room): void {
  if (room.state === null) {
    throw new Error('对局未开始');
  }
  room.state = {
    ...room.state,
    phase: 'ended',
    win: { winner: 'death_faction', dayNumber: room.state.dayNumber, reason: '测试强制终局' },
  };
}

describe('HTTP：房间与开局', () => {
  it('创建房间、加入与满员限制', async () => {
    const context = await startTestServer();
    const host = await postJson(context, '/api/rooms', { nickname: '房主' });
    expect(host.status).toBe(201);
    expect(host.json.roomCode as string).toMatch(/^[A-Z2-9]{6}$/);
    expect(host.rawSetCookie).toContain('td_session=');
    expect(host.rawSetCookie).toContain('HttpOnly');
    expect(host.rawSetCookie).toContain('SameSite=Strict');

    const roomCode = host.json.roomCode as string;
    for (let index = 2; index <= 13; index += 1) {
      const joined = await postJson(context, `/api/rooms/${roomCode}/join`, {
        nickname: `玩家${index}`,
      });
      expect(joined.status).toBe(201);
    }
    const overflow = await postJson(context, `/api/rooms/${roomCode}/join`, { nickname: '多余' });
    expect(overflow.status).toBe(409);
    expect((overflow.json.error as Record<string, unknown>).code).toBe('room_full');

    const missing = await postJson(context, '/api/rooms/ZZZZZZ/join', { nickname: '迷路' });
    expect(missing.status).toBe(404);
  });

  it('开局顺序校验：未满员、未准备、重复开局', async () => {
    const context = await startTestServer();
    const host = await postJson(context, '/api/rooms', { nickname: '房主' });
    const roomCode = host.json.roomCode as string;
    const hostCookie = host.cookie ?? '';

    const notFull = await postJson(context, `/api/rooms/${roomCode}/start`, {}, hostCookie);
    expect(notFull.status).toBe(409);
    expect((notFull.json.error as Record<string, unknown>).code).toBe('room_not_full');

    const clients: Client[] = [{ playerId: host.json.playerId as string, cookie: hostCookie }];
    for (let index = 2; index <= 13; index += 1) {
      const joined = await postJson(context, `/api/rooms/${roomCode}/join`, {
        nickname: `玩家${index}`,
      });
      clients.push({ playerId: joined.json.playerId as string, cookie: joined.cookie ?? '' });
    }

    const notReady = await postJson(context, `/api/rooms/${roomCode}/start`, {}, hostCookie);
    expect((notReady.json.error as Record<string, unknown>).code).toBe('not_ready');

    const nonHost = await postJson(context, `/api/rooms/${roomCode}/start`, {}, clients[5].cookie);
    expect(nonHost.status).toBe(403);

    for (const client of clients) {
      await postJson(context, `/api/rooms/${roomCode}/ready`, { ready: true }, client.cookie);
    }
    const started = await postJson(context, `/api/rooms/${roomCode}/start`, {}, hostCookie);
    expect(started.status).toBe(200);
    expect(started.json.started).toBe(true);

    const again = await postJson(context, `/api/rooms/${roomCode}/start`, {}, hostCookie);
    expect((again.json.error as Record<string, unknown>).code).toBe('room_started');

    const view = await getJson(context, '/api/view', hostCookie);
    expect(view.status).toBe(200);
    expect(view.json.phase).toBe('night');
    const windows = view.json.windows as Array<{ id: string }>;
    expect(windows.map((window) => window.id)).toEqual(['guard', 'faction', 'laike']);
  });

  it('T-02：同凭证刷新恢复原席位；无凭证与伪造凭证拒绝', async () => {
    const context = await startTestServer();
    const { room, clients } = await setupStartedGame(context);
    const client = clients[3];

    const first = await getJson(context, '/api/view', client.cookie);
    const second = await getJson(context, '/api/view', client.cookie);
    const firstView = first.json.view as Record<string, unknown>;
    const secondView = second.json.view as Record<string, unknown>;
    const firstSelf = firstView.self as Record<string, unknown>;
    const secondSelf = secondView.self as Record<string, unknown>;
    expect(secondSelf.playerId).toBe(firstSelf.playerId);
    expect(secondSelf.seat).toBe(firstSelf.seat);
    expect(secondSelf.seat).toBe(room.state?.players.find((player) => player.playerId === client.playerId)?.seat);

    const anonymous = await getJson(context, '/api/view');
    expect(anonymous.status).toBe(401);

    const forged = await getJson(context, '/api/view', 'td_session=abc.def');
    expect(forged.status).toBe(401);
  });

  it('视图裁剪：平民看不到他人身份与阵营房', async () => {
    const context = await startTestServer();
    const { room, clients } = await setupStartedGame(context);
    const civilianClient = clientForRole(room, clients, 'civilian');

    const view = await getJson(context, '/api/view', civilianClient.cookie);
    const serialized = JSON.stringify(view.json);
    expect(serialized).not.toContain('spirit');
    expect(serialized).not.toContain('mourner');
    expect(serialized).not.toContain('death_faction');
    const viewBody = view.json.view as Record<string, unknown>;
    expect(viewBody.room).toBeNull();
  });

  it('跨房凭证不能操作其他房间', async () => {
    const context = await startTestServer();
    const { roomCode } = await setupStartedGame(context);
    const stranger = await postJson(context, '/api/rooms', { nickname: '路人' });
    const strangerCookie = stranger.cookie ?? '';
    const attempt = await postJson(
      context,
      `/api/rooms/${roomCode}/ready`,
      { ready: true },
      strangerCookie,
    );
    expect(attempt.status).toBe(404);
  });
});

describe('HTTP：命令与幂等', () => {
  it('命令提交、同 requestId 重放原回执、不同身份拒绝', async () => {
    const context = await startTestServer();
    const { room, clients } = await setupStartedGame(context);
    const spiritClient = clientForRole(room, clients, 'spirit');
    const civilian = room.state?.players.find((player) => player.roleId === 'civilian');
    if (civilian === undefined) {
      throw new Error('缺少平民');
    }

    const first = await postJson(
      context,
      '/api/command',
      { requestId: 'req-1', action: 'EDIT_PROPOSAL', targets: [civilian.playerId] },
      spiritClient.cookie,
    );
    expect(first.status).toBe(200);
    expect(first.json.status).toBe('accepted');

    const replay = await postJson(
      context,
      '/api/command',
      { requestId: 'req-1', action: 'EDIT_PROPOSAL', targets: [civilian.playerId] },
      spiritClient.cookie,
    );
    expect(replay.json).toEqual(first.json);

    const confirm = await postJson(
      context,
      '/api/command',
      { requestId: 'req-2', action: 'CONFIRM_PROPOSAL', revision: 1 },
      spiritClient.cookie,
    );
    expect(confirm.json.status).toBe('accepted');

    const civilianPlayer = room.state?.players.find(
      (player) => player.roleId === 'civilian' && player.playerId === civilian.playerId,
    );
    const civilianClient = clients.find((item) => item.playerId === civilianPlayer?.playerId);
    if (civilianClient === undefined) {
      throw new Error('缺少平民会话');
    }
    const denied = await postJson(
      context,
      '/api/command',
      { requestId: 'req-3', action: 'EDIT_PROPOSAL', targets: [] },
      civilianClient.cookie,
    );
    expect(denied.json.status).toBe('rejected');
    expect(denied.json.code).toBe('not_faction_member');

    const unknown = await postJson(
      context,
      '/api/command',
      { requestId: 'req-4', action: 'FLY_AWAY' },
      spiritClient.cookie,
    );
    expect(unknown.status).toBe(400);
  });

  it('窗口结束后命令被拒绝，引擎只执行一次', async () => {
    const context = await startTestServer();
    const { room, clients } = await setupStartedGame(context);
    const spiritClient = clientForRole(room, clients, 'spirit');
    const civilian = room.state?.players.find((player) => player.roleId === 'civilian');
    if (civilian === undefined) {
      throw new Error('缺少平民');
    }

    const accepted = await postJson(
      context,
      '/api/command',
      { requestId: 'req-a', action: 'EDIT_PROPOSAL', targets: [civilian.playerId] },
      spiritClient.cookie,
    );
    expect(accepted.json.status).toBe('accepted');

    context.clock.advance(90_000);
    context.clock.advance(45_000);

    const late = await postJson(
      context,
      '/api/command',
      { requestId: 'req-late', action: 'EDIT_PROPOSAL', targets: [] },
      spiritClient.cookie,
    );
    expect(late.json.status).toBe('rejected');
    expect(late.json.code).toBe('window_not_open');
  });
});

describe('HTTP：聊天与日志', () => {
  it('公屏限白天活人；阵营房限成员且死亡只读（此处验证成员与时间）', async () => {
    const context = await startTestServer();
    const { room, clients } = await setupStartedGame(context);
    const civilianClient = clientForRole(room, clients, 'civilian');
    const spiritClient = clientForRole(room, clients, 'spirit');

    const nightDenied = await postJson(
      context,
      '/api/chat',
      { channel: 'public', text: '夜晚不该能说话' },
      civilianClient.cookie,
    );
    expect(nightDenied.status).toBe(403);

    const civilianFaction = await postJson(
      context,
      '/api/chat',
      { channel: 'faction', text: '我不是成员' },
      civilianClient.cookie,
    );
    expect(civilianFaction.status).toBe(403);

    context.clock.advance(90_000);
    context.clock.advance(45_000);

    const dayMessage = await postJson(
      context,
      '/api/chat',
      { channel: 'public', text: '大家好' },
      civilianClient.cookie,
    );
    expect(dayMessage.status).toBe(201);

    const factionMessage = await postJson(
      context,
      '/api/chat',
      { channel: 'faction', text: '夜里行动' },
      spiritClient.cookie,
    );
    expect(factionMessage.status).toBe(201);

    const history = await getJson(context, '/api/chat?channel=public', spiritClient.cookie);
    expect((history.json.messages as unknown[]).length).toBe(1);

    const civilianFactionRead = await getJson(
      context,
      '/api/chat?channel=faction',
      civilianClient.cookie,
    );
    expect(civilianFactionRead.status).toBe(403);

    const spiritFactionRead = await getJson(
      context,
      '/api/chat?channel=faction',
      spiritClient.cookie,
    );
    expect((spiritFactionRead.json.messages as unknown[]).length).toBe(1);
  });

  it('事件与消息写入 SQLite 日志', async () => {
    const context = await startTestServer();
    const { room, clients } = await setupStartedGame(context);
    const civilianClient = clientForRole(room, clients, 'civilian');

    context.clock.advance(90_000);
    context.clock.advance(45_000);
    await postJson(
      context,
      '/api/chat',
      { channel: 'public', text: '记录一下' },
      civilianClient.cookie,
    );

    const events = context.logStore.listEvents(room.gameId, 0);
    expect(events.some((event) => event.type === 'game_started')).toBe(true);
    expect(events.some((event) => event.type === 'night_started')).toBe(true);
    expect(events.some((event) => event.type === 'deaths_announced')).toBe(false);

    const messages = context.logStore.listMessages(room.gameId, 0);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('记录一下');
    expect(messages[0].channel).toBe('public');
  });
});

describe('HTTP：对局视图派生信息（M3d）', () => {
  it('view 返回阵营协商草稿与界面提示', async () => {
    const context = await startTestServer();
    const { room, clients } = await setupStartedGame(context);
    const deathClient = clientForRole(room, clients, 'death');
    const civilianClient = clientForRole(room, clients, 'civilian');

    const civilianView = await getJson(context, '/api/view', civilianClient.cookie);
    expect(civilianView.json.phase).toBe('night');
    expect(civilianView.json.proposal).toBe(null);
    expect(civilianView.json.hints).toEqual({
      sheriffSeat: null,
      speakerSeat: null,
      candidateSeats: [],
    });

    const edit = await postJson(
      context,
      '/api/command',
      { requestId: 'proposal-1', action: 'EDIT_PROPOSAL', targets: [] },
      deathClient.cookie,
    );
    expect(edit.json.status).toBe('accepted');

    const deathView = await getJson(context, '/api/view', deathClient.cookie);
    const proposal = deathView.json.proposal as Record<string, unknown>;
    expect(proposal.pool).toBe('death');
    expect(proposal.revision).toBe(1);
    expect(proposal.activeMemberIds).toEqual([deathClient.playerId]);
    expect(proposal.locked).toBe(true);
  });
});

describe('HTTP：实验模式房间（R-54 / T-49）', () => {
  it('默认创建为正式模式；正式模式的变体配置被拒绝', async () => {
    const context = await startTestServer();
    const formal = await postJson(context, '/api/rooms', { nickname: '房主' });
    expect(formal.status).toBe(201);
    const formalRoom = context.registry.getByCode(formal.json.roomCode as string);
    const formalStored = context.logStore.getRoom(formalRoom?.gameId ?? '');
    expect((formalStored?.ruleset as { mode?: string }).mode).toBe('formal');

    const variant = {
      ...THEATER_DEATH_13,
      roles: { ...THEATER_DEATH_13.roles, spirit: 3, civilian: 3 },
    };
    const rejected = await postJson(context, '/api/rooms', { nickname: '房主', ruleset: variant });
    expect(rejected.status).toBe(400);
    const rejectedError = rejected.json.error as Record<string, unknown>;
    expect(rejectedError.code).toBe('invalid_ruleset');
    expect(String(rejectedError.message)).toContain('正式模式');
  });

  it('实验模式房间：大厅醒目标记、按实验板子开局、实验值落盘', async () => {
    const context = await startTestServer();
    const experimentalRuleset = {
      ...THEATER_DEATH_13,
      mode: 'experimental' as const,
      roles: { ...THEATER_DEATH_13.roles, spirit: 3, civilian: 3 },
    };
    const host = await postJson(context, '/api/rooms', {
      nickname: '房主',
      ruleset: experimentalRuleset,
    });
    expect(host.status).toBe(201);
    const roomCode = host.json.roomCode as string;

    const clients: Client[] = [
      { playerId: host.json.playerId as string, cookie: host.cookie ?? '' },
    ];
    for (let index = 2; index <= 13; index += 1) {
      const joined = await postJson(context, `/api/rooms/${roomCode}/join`, {
        nickname: `玩家${index}`,
      });
      expect(joined.status).toBe(201);
      clients.push({ playerId: joined.json.playerId as string, cookie: joined.cookie ?? '' });
    }

    const lobby = await getJson(context, '/api/view', clients[0].cookie);
    expect(lobby.json.phase).toBe('lobby');
    expect(lobby.json.rulesetMode).toBe('experimental');
    expect(lobby.json.requiredPlayers).toBe(13);

    for (const client of clients) {
      await postJson(context, `/api/rooms/${roomCode}/ready`, { ready: true }, client.cookie);
    }
    const started = await postJson(context, `/api/rooms/${roomCode}/start`, {}, clients[0].cookie);
    expect(started.status).toBe(200);

    const room = context.registry.getByCode(roomCode);
    const gameView = await getJson(context, '/api/view', clients[0].cookie);
    expect(gameView.json.rulesetMode).toBe('experimental');

    const storedRuleset = context.logStore.getRoom(room?.gameId ?? '')?.ruleset as {
      mode?: string;
      roles?: Record<string, number>;
    };
    expect(storedRuleset.mode).toBe('experimental');
    expect(storedRuleset.roles?.spirit).toBe(3);

    const roleCounts = (room?.state?.players ?? []).reduce<Record<string, number>>(
      (counts, player) => {
        counts[player.roleId] = (counts[player.roleId] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(roleCounts.spirit).toBe(3);
    expect(roleCounts.civilian).toBe(3);
  });
});

describe('HTTP：离开与解散房间', () => {
  it('普通成员退出后席位释放，可重新加入', async () => {
    const context = await startTestServer();
    const lobby = await setupLobby(context);
    const leaver = lobby.clients[12];

    const left = await postJson(context, `/api/rooms/${lobby.roomCode}/leave`, {}, leaver.cookie);
    expect(left.status).toBe(200);
    expect(left.json.dissolved).toBe(false);

    const afterLeave = await getJson(context, '/api/view', leaver.cookie);
    expect(afterLeave.status).toBe(403);

    const rejoined = await postJson(context, `/api/rooms/${lobby.roomCode}/join`, {
      nickname: '回来了',
    });
    expect(rejoined.status).toBe(201);
  });

  it('房主解散房间：房间消失，其余成员会话失效', async () => {
    const context = await startTestServer();
    const lobby = await setupLobby(context);

    const dissolved = await postJson(
      context,
      `/api/rooms/${lobby.roomCode}/leave`,
      {},
      lobby.hostClient.cookie,
    );
    expect(dissolved.status).toBe(200);
    expect(dissolved.json.dissolved).toBe(true);

    const otherView = await getJson(context, '/api/view', lobby.clients[1].cookie);
    expect(otherView.status).toBe(404);
    const joinAttempt = await postJson(context, `/api/rooms/${lobby.roomCode}/join`, {
      nickname: '新来的',
    });
    expect(joinAttempt.status).toBe(404);
  });

  it('对局开始后不能退出', async () => {
    const context = await startTestServer();
    const { roomCode, clients } = await setupStartedGame(context);
    const leave = await postJson(context, `/api/rooms/${roomCode}/leave`, {}, clients[0].cookie);
    expect(leave.status).toBe(409);
    expect((leave.json.error as Record<string, unknown>).code).toBe('game_started');
  });

  it('终局后普通成员可退出：席位释放、会话失效，房间与他人复盘保留', async () => {
    const context = await startTestServer();
    const { roomCode, clients, room } = await setupStartedGame(context);
    forceEnded(room);
    const leaver = clients[12];

    const left = await postJson(context, `/api/rooms/${roomCode}/leave`, {}, leaver.cookie);
    expect(left.status).toBe(200);
    expect(left.json.dissolved).toBe(false);

    const afterLeave = await getJson(context, '/api/view', leaver.cookie);
    expect(afterLeave.status).toBe(403);

    expect(context.registry.getByCode(roomCode)).not.toBeNull();
    const others = await getJson(context, '/api/view', clients[0].cookie);
    expect(others.status).toBe(200);
    const review = await getJson(context, '/api/review', clients[0].cookie);
    expect(review.status).toBe(200);
  });

  it('终局后房主退出不解散：其他成员仍能查看复盘', async () => {
    const context = await startTestServer();
    const { roomCode, clients, hostClient, room } = await setupStartedGame(context);
    forceEnded(room);

    const left = await postJson(context, `/api/rooms/${roomCode}/leave`, {}, hostClient.cookie);
    expect(left.status).toBe(200);
    expect(left.json.dissolved).toBe(false);
    expect(context.registry.getByCode(roomCode)).not.toBeNull();

    const otherView = await getJson(context, '/api/view', clients[1].cookie);
    expect(otherView.status).toBe(200);
    const otherReview = await getJson(context, '/api/review', clients[1].cookie);
    expect(otherReview.status).toBe(200);
  });

  it('终局后最后一名成员退出：房间销毁', async () => {
    const context = await startTestServer();
    const { roomCode, clients, room } = await setupStartedGame(context);
    forceEnded(room);

    let last = 0;
    for (const client of clients) {
      const left = await postJson(context, `/api/rooms/${roomCode}/leave`, {}, client.cookie);
      expect(left.status).toBe(200);
      last = left.json.dissolved === true ? 1 : 0;
    }
    expect(last, '最后一名成员退出时应报告 dissolved').toBe(1);
    expect(context.registry.getByCode(roomCode)).toBeNull();

    const gone = await getJson(context, '/api/view', clients[0].cookie);
    expect(gone.status).toBe(404);
  });
});

describe('HTTP：房主踢人', () => {
  it('房主移出成员：席位释放、被移出者会话失效且可重新加入', async () => {
    const context = await startTestServer();
    const lobby = await setupLobby(context);
    const target = lobby.clients[12];

    const kicked = await postJson(
      context,
      `/api/rooms/${lobby.roomCode}/kick`,
      { targetPlayerId: target.playerId },
      lobby.hostClient.cookie,
    );
    expect(kicked.status).toBe(200);
    expect(kicked.json.kind).toBe('player');

    const hostView = await getJson(context, '/api/view', lobby.hostClient.cookie);
    expect((hostView.json.members as unknown[]).length).toBe(12);

    const targetView = await getJson(context, '/api/view', target.cookie);
    expect(targetView.status).toBe(403);
    expect((targetView.json.error as Record<string, unknown>).code).toBe('not_member');

    const rejoined = await postJson(context, `/api/rooms/${lobby.roomCode}/join`, {
      nickname: '又回来了',
    });
    expect(rejoined.status).toBe(201);
  });

  it('非房主移出成员被拒绝', async () => {
    const context = await startTestServer();
    const lobby = await setupLobby(context);
    const denied = await postJson(
      context,
      `/api/rooms/${lobby.roomCode}/kick`,
      { targetPlayerId: lobby.clients[12].playerId },
      lobby.clients[1].cookie,
    );
    expect(denied.status).toBe(403);
    expect((denied.json.error as Record<string, unknown>).code).toBe('not_host');
  });

  it('房主不能移出自己', async () => {
    const context = await startTestServer();
    const lobby = await setupLobby(context);
    const denied = await postJson(
      context,
      `/api/rooms/${lobby.roomCode}/kick`,
      { targetPlayerId: lobby.hostClient.playerId },
      lobby.hostClient.cookie,
    );
    expect(denied.status).toBe(409);
    expect((denied.json.error as Record<string, unknown>).code).toBe('cannot_kick_self');
  });

  it('对局开始后不能移出成员', async () => {
    const context = await startTestServer();
    const { roomCode, clients, hostClient } = await setupStartedGame(context);
    const denied = await postJson(
      context,
      `/api/rooms/${roomCode}/kick`,
      { targetPlayerId: clients[12].playerId },
      hostClient.cookie,
    );
    expect(denied.status).toBe(409);
    expect((denied.json.error as Record<string, unknown>).code).toBe('game_started');
  });

  it('移出成员时其观战者连带被移除', async () => {
    const context = await startTestServer();
    const lobby = await setupLobby(context);
    const target = lobby.clients[12];
    const watched = await postJson(context, `/api/rooms/${lobby.roomCode}/watch`, {
      nickname: '看客',
      bindPlayerId: target.playerId,
    });
    expect(watched.status).toBe(201);
    const spectatorCookie = watched.cookie ?? '';

    const kicked = await postJson(
      context,
      `/api/rooms/${lobby.roomCode}/kick`,
      { targetPlayerId: target.playerId },
      lobby.hostClient.cookie,
    );
    expect(kicked.status).toBe(200);

    const spectatorView = await getJson(context, '/api/view', spectatorCookie);
    expect(spectatorView.status).toBe(403);
  });

  it('房主可单独移出观战者（对局中也可）；被绑定玩家视图的观战名单清空', async () => {
    const context = await startTestServer();
    const { roomCode, clients, hostClient } = await setupStartedGame(context);
    const watched = await postJson(context, `/api/rooms/${roomCode}/watch`, {
      nickname: '局中看客',
      bindPlayerId: clients[5].playerId,
    });
    expect(watched.status).toBe(201);
    const spectatorCookie = watched.cookie ?? '';
    const spectatorId = watched.json.spectatorId as string;

    const denied = await postJson(
      context,
      `/api/rooms/${roomCode}/kick`,
      { targetSpectatorId: spectatorId },
      clients[1].cookie,
    );
    expect(denied.status).toBe(403);

    const kicked = await postJson(
      context,
      `/api/rooms/${roomCode}/kick`,
      { targetSpectatorId: spectatorId },
      hostClient.cookie,
    );
    expect(kicked.status).toBe(200);
    expect(kicked.json.kind).toBe('spectator');

    const spectatorView = await getJson(context, '/api/view', spectatorCookie);
    expect(spectatorView.status).toBe(403);

    const playerView = await getJson(context, '/api/view', clients[5].cookie);
    expect((playerView.json.spectators as unknown[]).length).toBe(0);
  });

  it('目标校验：不存在 404；两个都缺或都给 400', async () => {
    const context = await startTestServer();
    const lobby = await setupLobby(context);
    const notFound = await postJson(
      context,
      `/api/rooms/${lobby.roomCode}/kick`,
      { targetPlayerId: 'p_missing' },
      lobby.hostClient.cookie,
    );
    expect(notFound.status).toBe(404);

    const neither = await postJson(
      context,
      `/api/rooms/${lobby.roomCode}/kick`,
      {},
      lobby.hostClient.cookie,
    );
    expect(neither.status).toBe(400);

    const both = await postJson(
      context,
      `/api/rooms/${lobby.roomCode}/kick`,
      { targetPlayerId: lobby.clients[1].playerId, targetSpectatorId: 's_missing' },
      lobby.hostClient.cookie,
    );
    expect(both.status).toBe(400);
  });
});

describe('HTTP：踢观战者与语音参与者清理', () => {
  it('房主移出观战者时调用 removeParticipant（房间名 = gameId）', async () => {
    const fakeVoice = createFakeVoice();
    const context = await startTestServer({ voice: fakeVoice.service });
    const lobby = await setupLobby(context);
    const hostView = await getJson(context, '/api/view', lobby.hostClient.cookie);
    const gameId = hostView.json.gameId as string;

    const watched = await postJson(context, `/api/rooms/${lobby.roomCode}/watch`, {
      nickname: '语音看客',
      bindPlayerId: lobby.clients[1].playerId,
    });
    expect(watched.status).toBe(201);
    const spectatorId = watched.json.spectatorId as string;

    const kicked = await postJson(
      context,
      `/api/rooms/${lobby.roomCode}/kick`,
      { targetSpectatorId: spectatorId },
      lobby.hostClient.cookie,
    );
    expect(kicked.status).toBe(200);
    await waitFor(() => fakeVoice.removed.length === 1);
    expect(fakeVoice.removed).toEqual([{ roomName: gameId, uid: 1000 }]);
  });

  it('观战者主动退出观战时同样移除媒体参与者', async () => {
    const fakeVoice = createFakeVoice();
    const context = await startTestServer({ voice: fakeVoice.service });
    const lobby = await setupLobby(context);
    const watched = await postJson(context, `/api/rooms/${lobby.roomCode}/watch`, {
      nickname: '主动退出的看客',
      bindPlayerId: lobby.clients[1].playerId,
    });
    expect(watched.status).toBe(201);
    const spectatorId = watched.json.spectatorId as string;
    const spectatorCookie = watched.cookie ?? '';

    const left = await postJson(context, '/api/spectate/leave', {}, spectatorCookie);
    expect(left.status).toBe(200);
    await waitFor(() => fakeVoice.removed.length === 1);
    expect(fakeVoice.removed[0]?.uid).toBe(1000);
  });
});
