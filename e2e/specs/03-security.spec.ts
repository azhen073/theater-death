import { expect, test } from '@playwright/test';
import {
  api,
  chat,
  command,
  createRoom,
  getView,
  joinRoom,
  setReady,
  setupLobby,
  startGame,
  type Client,
} from '../helpers/api.ts';
import { waitFor } from '../helpers/cloud.ts';
import { FAST_BOARD } from '../helpers/board.ts';

function selfOf(view: Record<string, unknown>): { playerId: string; roleId: string } {
  const inner = view.view as { self: { playerId: string; roleId: string } };
  return inner.self;
}

test('大厅安全边界：无会话拒绝、跨房间隔离、未开局命令与语音令牌拒绝', async () => {
  test.setTimeout(60_000);

  // 无会话：受保护端点全部 401
  for (const path of ['/api/view', '/api/review', '/api/chat?channel=public']) {
    const response = await api.get(path);
    expect(response.status, `${path} 应 401`).toBe(401);
  }
  for (const path of ['/api/command', '/api/chat', '/api/voice/token']) {
    const response = await api.post(path, {});
    expect(response.status, `${path} 应 401`).toBe(401);
  }

  const roomA = await createRoom({ nickname: '房主A', ruleset: FAST_BOARD });
  const roomB = await createRoom({ nickname: '房主B', ruleset: FAST_BOARD });

  // 跨房间：A 的会话访问 B 的房间码端点被拒
  const crossReady = await api.post(`/api/rooms/${roomB.roomCode}/ready`, { ready: true }, roomA.client.cookie);
  expect(crossReady.status).toBe(404);

  // 跨房间：A 的视图始终是自己的房间（不泄露 B）
  const viewA = await getView(roomA.client);
  expect(viewA.roomCode).toBe(roomA.roomCode);

  // 大厅阶段提交对局命令：受理但不生效（game_not_started）
  const lobbyCommand = await command(roomA.client, 'REGISTER_CANDIDACY');
  expect(lobbyCommand.status).toBe(200);
  expect(lobbyCommand.json.status).toBe('rejected');
  expect(lobbyCommand.json.code).toBe('game_not_started');

  // 未开局签发音令牌：409
  const token = await api.post('/api/voice/token', {}, roomA.client.cookie);
  expect(token.status).toBe(409);
});

test('对局内越权反例：角色越权、夜间白天命令、夜间公屏、阵营房边界、未终局复盘', async () => {
  test.setTimeout(120_000);

  const lobby = await setupLobby({ ruleset: FAST_BOARD, prefix: '玩家' });
  for (const client of lobby.clients) {
    await setReady(lobby.roomCode, client);
  }
  await startGame(lobby.roomCode, lobby.host);

  // 等待进入夜间
  await waitFor(
    async () => {
      const view = await getView(lobby.host);
      return view.phase === 'night' ? view : false;
    },
    { label: '进入夜间', timeoutMs: 15_000 },
  );

  // 收集所有玩家的身份
  const players: Array<{ client: Client; roleId: string }> = [];
  for (const client of lobby.clients) {
    const view = await getView(client);
    players.push({ client, roleId: selfOf(view).roleId });
  }
  const nonDoor = players.find((player) => player.roleId !== 'door');
  const nonDeathFaction = players.filter(
    (player) => player.roleId !== 'death' && player.roleId !== 'spirit',
  );
  expect(nonDoor).toBeDefined();

  // 非守门人提交守护命令：被拒
  const guard = await command(nonDoor!.client, 'SUBMIT_GUARD', { targets: [] });
  expect(guard.status).toBe(200);
  expect(guard.json.status).toBe('rejected');

  // 夜间提交白天投票命令：被拒
  const dayVote = await command(nonDoor!.client, 'SUBMIT_DAY_VOTE', { target: null });
  expect(dayVote.status).toBe(200);
  expect(dayVote.json.status).toBe('rejected');

  // 夜间公屏禁发：403
  const nightChat = await chat(nonDoor!.client, 'public', '夜里偷偷说话');
  expect(nightChat.status).toBe(403);

  // 阵营房边界：非死神阵营玩家发阵营房消息全部被拒（13 - 3 = 10 人）
  let forbidden = 0;
  for (const player of nonDeathFaction) {
    const result = await chat(player.client, 'faction', '越权尝试');
    if (result.status === 403) {
      forbidden += 1;
    }
  }
  expect(forbidden).toBe(nonDeathFaction.length);

  // 未终局复盘：403
  const review = await api.get('/api/review', lobby.host.cookie);
  expect(review.status).toBe(403);

  // 非成员读取阵营房：未开局 409（外部人所在房间尚无对局）
  const outsider = await createRoom({ nickname: '外部人' });
  const factionRead = await api.get('/api/chat?channel=faction', outsider.client.cookie);
  expect(factionRead.status).toBe(409);
});
