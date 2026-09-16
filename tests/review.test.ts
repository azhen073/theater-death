import { describe, expect, it } from 'vitest';
import {
  clientForRole,
  getJson,
  postJson,
  setupStartedGame,
  startTestServer,
  TEST_SESSION_SECRET,
} from './server-test-utils.ts';

interface ReviewResponse {
  winner: string;
  reason: string;
  endedAtDay: number;
  players: Array<{ seat: number; nickname: string; roleId: string; life: string }>;
  timeline: Array<{ type: string; dayNumber: number }>;
  chat: {
    public: Array<{ text: string; senderSeat: number | null }>;
    faction: Array<{ text: string }>;
  };
}

describe('终局复盘（R-53 / T-48）', () => {
  it('未终局时请求复盘被拒绝；无会话被拒绝', async () => {
    const context = await startTestServer();
    const { clients } = await setupStartedGame(context);

    const early = await getJson(context, '/api/review', clients[0].cookie);
    expect(early.status).toBe(403);
    expect((early.json.error as { code: string }).code).toBe('game_not_ended');

    const anonymous = await getJson(context, '/api/review', '');
    expect(anonymous.status).toBe(401);
  });

  it('终局复盘公开身份、状态、胜负、行动时间线与含加入前历史的全部交流', async () => {
    const context = await startTestServer();
    const { room, clients } = await setupStartedGame(context);
    const death = clientForRole(room, clients, 'death');

    const room0 = room.state;
    if (room0 === null) {
      throw new Error('对局未开始');
    }
    const killTargetIds = [
      ...room0.players.filter((player) => player.roleId === 'civilian').map((player) => player.playerId),
      ...room0.players.filter((player) => player.roleId === 'researcher').map((player) => player.playerId),
    ];

    let chatSent = false;
    for (const [index, targetId] of killTargetIds.entries()) {
      const receipt = await postJson(
        context,
        '/api/command',
        { requestId: `kill-${index}`, action: 'EDIT_PROPOSAL', targets: [targetId] },
        death.cookie,
      );
      const deathState = room.state?.players.find((player) => player.roleId === 'death');
      const diagnostic = JSON.stringify({
        receipt: receipt.json,
        phase: room.state?.phase,
        dayNumber: room.state?.dayNumber,
        nightStage: room.state?.nightStage,
        stage: room.state?.stage,
        deathLife: deathState?.life,
        now: context.clock.now(),
        windows: room.driver?.windows(),
      });
      expect(receipt.json.status, diagnostic).toBe('accepted');

      context.clock.advance(90_000);
      context.clock.advance(45_000);

      if (room.state?.phase === 'day' && !chatSent) {
        const speaker = room.state.players.find(
          (player) =>
            player.life !== 'dead' && clients.some((client) => client.playerId === player.playerId),
        );
        const speakerClient = clients.find((client) => client.playerId === speaker?.playerId);
        if (speakerClient === undefined) {
          throw new Error('找不到白天存活玩家');
        }
        const sent = await postJson(
          context,
          '/api/chat',
          { channel: 'public', text: '复盘会看到这条' },
          speakerClient.cookie,
        );
        expect(sent.status).toBe(201);
        chatSent = true;
      }

      let guard = 0;
      while (
        room.state?.phase !== 'night' &&
        room.state?.phase !== 'ended' &&
        guard < 100
      ) {
        context.clock.advance(60_000);
        guard += 1;
      }
      if (room.state?.phase === 'ended') {
        break;
      }
    }

    expect(room.state?.phase).toBe('ended');
    expect(room.state?.win?.winner).toBe('death_faction');

    const spirit = clientForRole(room, clients, 'spirit');
    room.chat.push({
      id: room.nextMessageId,
      channel: 'faction',
      senderId: spirit.playerId,
      text: '阵营房加入前消息',
      at: context.clock.now(),
      eventSeq: 1,
    });
    room.nextMessageId += 1;

    const response = await getJson(context, '/api/review', clients[0].cookie);
    expect(response.status).toBe(200);
    const review = response.json.review as unknown as ReviewResponse;

    expect(review.winner).toBe('death_faction');
    expect(review.reason).toBe(room.state?.win?.reason);
    expect(review.endedAtDay).toBe(room.state?.win?.dayNumber);

    expect(review.players).toHaveLength(13);
    expect(review.players.filter((player) => player.life === 'dead')).toHaveLength(5);
    expect(
      review.players.filter((player) => player.life === 'dead' && player.roleId === 'civilian'),
    ).toHaveLength(4);
    expect(
      review.players.filter((player) => player.life === 'dead' && player.roleId === 'researcher'),
    ).toHaveLength(1);

    const types = new Set(review.timeline.map((entry) => entry.type));
    expect(types.has('game_started')).toBe(true);
    expect(types.has('night_started')).toBe(true);
    expect(types.has('attack_events')).toBe(true);
    expect(types.has('deaths_announced')).toBe(true);
    expect(types.has('game_ended')).toBe(true);

    expect(review.chat.public.some((message) => message.text === '复盘会看到这条')).toBe(true);
    expect(review.chat.faction.some((message) => message.text === '阵营房加入前消息')).toBe(true);
    expect(JSON.stringify(review)).not.toContain(TEST_SESSION_SECRET);
  });
});
