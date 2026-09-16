import { describe, expect, it } from 'vitest';
import {
  clientForRole,
  connectClient,
  expectConnectFailure,
  getJson,
  postJson,
  setupLobby,
  startTestServer,
  waitFor,
} from './server-test-utils.ts';

type Lobby = Awaited<ReturnType<typeof setupLobby>>;

/** 给反向断言留出异步到达时间（"不该收到"的消息若存在泄漏会在同一批推送内抵达） */
async function settle(delayMs = 200): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function startGame(context: Awaited<ReturnType<typeof startTestServer>>, lobby: Lobby) {
  for (const client of lobby.clients) {
    await postJson(context, `/api/rooms/${lobby.roomCode}/ready`, { ready: true }, client.cookie);
  }
  await postJson(context, `/api/rooms/${lobby.roomCode}/start`, {}, lobby.hostClient.cookie);
}

describe('实时通道：握手与推送', () => {
  it('握手需要有效会话；成功后收到 hello', async () => {
    const context = await startTestServer({ realtime: true });
    const lobby = await setupLobby(context);

    await expectConnectFailure(context, 'td_session=abc.def');
    const client = await connectClient(context, lobby.clients[0].cookie);
    await waitFor(() => client.hellos.length > 0);
    expect(client.hellos[0].playerId).toBe(lobby.clients[0].playerId);
    expect(client.hellos[0].roomCode).toBe(lobby.roomCode);
  });

  it('开局推送：公共事件广播全员，身份只发本人', async () => {
    const context = await startTestServer({ realtime: true });
    const lobby = await setupLobby(context);
    const socketA = await connectClient(context, lobby.clients[0].cookie);
    const socketB = await connectClient(context, lobby.clients[1].cookie);

    await startGame(context, lobby);

    await waitFor(
      () =>
        socketA.gameEvents.some((event) => event.type === 'game_started') &&
        socketB.gameEvents.some((event) => event.type === 'game_started'),
    );
    await waitFor(
      () =>
        socketA.gameEvents.some((event) => event.type === 'role_assigned') &&
        socketB.gameEvents.some((event) => event.type === 'role_assigned'),
    );
    const rolesA = socketA.gameEvents.filter((event) => event.type === 'role_assigned');
    expect(rolesA).toHaveLength(1);
    expect((rolesA[0].payload as { playerId: string }).playerId).toBe(lobby.clients[0].playerId);
    expect(rolesA[0].flow).toBe('personal');
    expect(socketA.gameEvents.find((event) => event.type === 'game_started')?.flow).toBe('public');

    const rolesB = socketB.gameEvents.filter((event) => event.type === 'role_assigned');
    expect(rolesB).toHaveLength(1);
    expect((rolesB[0].payload as { playerId: string }).playerId).toBe(lobby.clients[1].playerId);
  });

  it('濒死名单只推授权角色，平民收不到也不泄露阵营细节', async () => {
    const context = await startTestServer({ realtime: true });
    const lobby = await setupLobby(context);
    await startGame(context, lobby);
    const room = context.registry.getByCode(lobby.roomCode);
    if (room === null) {
      throw new Error('房间丢失');
    }
    const waterClient = clientForRole(room, lobby.clients, 'water');
    const civilianClient = clientForRole(room, lobby.clients, 'civilian');
    const waterSocket = await connectClient(context, waterClient.cookie);
    const civilianSocket = await connectClient(context, civilianClient.cookie);

    context.clock.advance(90_000);

    await waitFor(() => waterSocket.gameEvents.some((event) => event.type === 'dying_list'));
    await settle();
    expect(civilianSocket.gameEvents.some((event) => event.type === 'dying_list')).toBe(false);
    const listEvent = waterSocket.gameEvents.find((event) => event.type === 'dying_list');
    expect(listEvent?.flow).toBe('personal');
    expect(civilianSocket.gameEvents.some((event) => event.type === 'attack_events')).toBe(false);
  });

  it('同一玩家的多个连接都收到定向推送', async () => {
    const context = await startTestServer({ realtime: true });
    const lobby = await setupLobby(context);
    await startGame(context, lobby);
    const room = context.registry.getByCode(lobby.roomCode);
    if (room === null) {
      throw new Error('房间丢失');
    }
    const waterClient = clientForRole(room, lobby.clients, 'water');
    const tabA = await connectClient(context, waterClient.cookie);
    const tabB = await connectClient(context, waterClient.cookie);

    context.clock.advance(90_000);

    await waitFor(
      () =>
        tabA.gameEvents.some((event) => event.type === 'dying_list') &&
        tabB.gameEvents.some((event) => event.type === 'dying_list'),
    );
  });

  it('聊天推送：公屏广播全员，阵营房只推成员', async () => {
    const context = await startTestServer({ realtime: true });
    const lobby = await setupLobby(context);
    await startGame(context, lobby);
    context.clock.advance(90_000);
    context.clock.advance(45_000);
    const room = context.registry.getByCode(lobby.roomCode);
    if (room === null) {
      throw new Error('房间丢失');
    }
    const civilianClient = clientForRole(room, lobby.clients, 'civilian');
    const spiritClient = clientForRole(room, lobby.clients, 'spirit');
    const civilianSocket = await connectClient(context, civilianClient.cookie);
    const spiritSocket = await connectClient(context, spiritClient.cookie);

    await postJson(
      context,
      '/api/chat',
      { channel: 'public', text: '大家好' },
      civilianClient.cookie,
    );
    await waitFor(
      () => civilianSocket.chatMessages.length === 1 && spiritSocket.chatMessages.length === 1,
    );
    expect(spiritSocket.chatMessages[0].text).toBe('大家好');

    await postJson(
      context,
      '/api/chat',
      { channel: 'faction', text: '夜里动手' },
      spiritClient.cookie,
    );
    await waitFor(() => spiritSocket.chatMessages.length === 2);
    await settle();
    expect(civilianSocket.chatMessages).toHaveLength(1);
    expect(spiritSocket.chatMessages[1].channel).toBe('faction');
  });

  it('断线重连：重新握手成功，HTTP 快照恢复当前状态', async () => {
    const context = await startTestServer({ realtime: true });
    const lobby = await setupLobby(context);
    await startGame(context, lobby);
    const room = context.registry.getByCode(lobby.roomCode);
    if (room === null) {
      throw new Error('房间丢失');
    }
    const civilianClient = clientForRole(room, lobby.clients, 'civilian');

    const first = await connectClient(context, civilianClient.cookie);
    first.socket.disconnect();

    const second = await connectClient(context, civilianClient.cookie);
    await waitFor(() => second.hellos.length > 0);
    expect(second.hellos[0].playerId).toBe(civilianClient.playerId);

    const view = await getJson(context, '/api/view', civilianClient.cookie);
    expect(view.status).toBe(200);
    expect(view.json.phase).toBe('night');
  });
});
