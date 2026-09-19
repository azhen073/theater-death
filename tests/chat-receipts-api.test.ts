import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, connectRoom, enter, json, makeHarness, post, request, waitFor, type HttpHarness, type User } from './contract-http-utils.ts';

afterEach(closeHarnesses);

async function startFullRoom(h: HttpHarness) {
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'chat-create' }), h.users[0]);
  expect(created.status).toBe(201);
  const room = await json(created) as { roomId: string; roomCode: string; gameId: null };
  for (let index = 1; index < 13; index += 1) {
    const joined = await enter(h, room.roomCode, h.users[index]!, `chat-enter-${index}`);
    expect(joined.response.status).toBe(200);
  }
  for (let index = 0; index < 13; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `chat-ready-${index}`, ready: true }), h.users[index]);
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'chat-start' }), h.users[0]);
  expect(started.status).toBe(200);
  const body = await json(started);
  expect(typeof body.gameId).toBe('string');
  if (typeof body.gameId !== 'string') throw new Error('start response missing gameId');
  await advanceToDay(h, room.roomId);
  return { room, gameId: body.gameId };
}

async function advanceToDay(h: HttpHarness, roomId: string): Promise<void> {
  const stable = h.app.directory.byId.get(roomId)!;
  for (let guard = 0; guard < 100 && stable.runtime?.state?.phase === 'night'; guard += 1) {
    const windows = stable.runtime.driver?.windows() ?? [];
    if (windows.length === 0) {
      await stable.enqueue(() => undefined);
      continue;
    }
    const closesAt = Math.min(...windows.map((window) => window.closesAt));
    h.clock.advance(Math.max(0, closesAt - h.clock.now()));
    await stable.enqueue(() => undefined);
  }
  expect(stable.runtime?.state?.phase).toBe('day');
}

function playerUser(h: HttpHarness, roomId: string, playerId: string): User {
  const room = h.app.directory.byId.get(roomId)!;
  const participant = [...room.participants.values()].find((seat) => seat.playerId === playerId)!;
  return h.users.find((user) => user.userId === participant.userId)!;
}

function messageBody(gameId: string, clientMessageId: string, text: string, channel: 'public' | 'faction' = 'public') {
  return { requestId: `request-${clientMessageId}`, gameId, channel, clientMessageId, text };
}

async function sendChat(h: HttpHarness, roomCode: string, user: User, body: Record<string, unknown>) {
  const response = await request(h, `/api/v2/rooms/${roomCode}/chat`, post(body), user);
  return { response, body: await json(response) };
}

describe('v2 chat acknowledgement and receipt contract', () => {
  it('deduplicates concurrent sends into one SQL/chat row and replays the exact acknowledgement', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startFullRoom(h);
    const body = messageBody(gameId, 'concurrent-chat', 'hello');
    const responses = await Promise.all([
      sendChat(h, room.roomCode, h.users[0]!, body),
      sendChat(h, room.roomCode, h.users[0]!, body),
    ]);
    expect(responses.map(({ response }) => response.status)).toEqual([201, 201]);
    expect(responses[1]!.body).toEqual(responses[0]!.body);
    expect(h.logStore.listMessages(gameId, 0)).toHaveLength(1);
    expect(h.app.directory.byId.get(room.roomId)!.runtime!.chat).toHaveLength(1);
  });

  it('rejects changed text or channel for the same client message id and keeps other players independent', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startFullRoom(h);
    const original = messageBody(gameId, 'same-client-id', 'original');
    const first = await sendChat(h, room.roomCode, h.users[0]!, original);
    expect(first.response.status).toBe(201);
    const changedText = await sendChat(h, room.roomCode, h.users[0]!, { ...original, text: 'changed' });
    expect(changedText.response.status).toBe(409);
    expect(changedText.body.error).toMatchObject({ code: 'request_id_reused' });
    const changedChannel = await sendChat(h, room.roomCode, h.users[0]!, { ...original, channel: 'faction', text: 'original' });
    expect(changedChannel.response.status).toBe(409);
    expect(changedChannel.body.error).toMatchObject({ code: 'request_id_reused' });

    const other = await sendChat(h, room.roomCode, h.users[1]!, original);
    expect(other.response.status).toBe(201);
    expect(other.body.message.messageId).not.toBe(first.body.message.messageId);
    expect(h.logStore.listMessages(gameId, 0)).toHaveLength(2);
  });

  it('denies an old controller retry while preserving the acknowledgement for the current controller', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startFullRoom(h);
    const original = messageBody(gameId, 'controller-chat', 'before takeover');
    const first = await sendChat(h, room.roomCode, h.users[0]!, original);
    expect(first.response.status).toBe(201);
    const replacementSession = h.accounts.createSession(h.users[0]!.userId);
    const replacement: User = { ...h.users[0]!, cookie: `td_account_v2=${replacementSession.token}`, sessionId: replacementSession.session.id };
    const takeover = await request(h, `/api/v2/rooms/${room.roomCode}/takeover`, post({ requestId: 'chat-takeover' }), replacement);
    expect(takeover.status).toBe(200);
    const oldRetry = await sendChat(h, room.roomCode, h.users[0]!, original);
    expect(oldRetry.response.status).toBe(403);
    expect(oldRetry.body.error).toMatchObject({ code: 'room_access_required' });
    const currentRetry = await sendChat(h, room.roomCode, replacement, original);
    expect(currentRetry.response.status).toBe(201);
    expect(currentRetry.body).toEqual(first.body);
    expect(h.logStore.listMessages(gameId, 0)).toHaveLength(1);
  });

  it('keeps HTTP and Socket.IO message ids equal, and preserves them after reconnect in the same game', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startFullRoom(h);
    const live = await connectRoom(h, h.users[0]!, room.roomId);
    const sent = await sendChat(h, room.roomCode, h.users[0]!, messageBody(gameId, 'socket-chat', 'streamed'));
    expect(sent.response.status).toBe(201);
    const messageId = sent.body.message.messageId as string;
    await waitFor(() => live.views.some((view) => view.chat.public.some((message: any) => message.messageId === messageId)));
    expect(live.views.at(-1)!.chat.public.find((message: any) => message.messageId === messageId)).toMatchObject({ messageId, text: 'streamed' });
    live.socket.disconnect();
    const reconnected = await connectRoom(h, h.users[0]!, room.roomId);
    expect(reconnected.views.at(-1)!.chat.public.find((message: any) => message.messageId === messageId)).toMatchObject({ messageId, text: 'streamed' });
    reconnected.socket.disconnect();
  });

  it('does not expose faction messages or global-sequence cursor gaps to a public watcher', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startFullRoom(h);
    const runtime = h.app.directory.byId.get(room.roomId)!.runtime!;
    const spirit = runtime.state!.players.find((player) => player.roleId === 'spirit')!;
    const factionUser = playerUser(h, room.roomId, spirit.playerId);
    const faction = await sendChat(h, room.roomCode, factionUser, messageBody(gameId, 'faction-hidden', 'secret', 'faction'));
    expect(faction.response.status).toBe(201);
    const publicMessage = await sendChat(h, room.roomCode, factionUser, messageBody(gameId, 'public-visible', 'hello public'));
    expect(publicMessage.response.status).toBe(201);
    const watcher = h.users[13]!;
    expect((await enter(h, room.roomCode, watcher, 'public-watch')).response.status).toBe(200);
    const view = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, watcher));
    expect(view.chat.faction).toEqual([]);
    expect(view.chat.public).toHaveLength(1);
    expect(view.chat.public[0]).toMatchObject({ messageId: publicMessage.body.message.messageId, cursor: 1, text: 'hello public' });
    const playerView = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, factionUser));
    expect(playerView.chat.faction).toHaveLength(1);
    expect(playerView.chat.faction[0].cursor).toBe(1);
    expect(playerView.chat.faction[0].messageId).toBe(faction.body.message.messageId);
  });

  it('does not consume fresh chat rate quota on receipt retries and isolates the next game after review reset', async () => {
    const h = await makeHarness();
    const first = await startFullRoom(h);
    const original = messageBody(first.gameId, 'quota-retry', 'retry-safe');
    const firstChat = await sendChat(h, first.room.roomCode, h.users[0]!, original);
    expect(firstChat.response.status).toBe(201);
    for (let index = 0; index < 8; index += 1) {
      const retry = await sendChat(h, first.room.roomCode, h.users[0]!, original);
      expect(retry.response.status).toBe(201);
    }
    const stable = h.app.directory.byId.get(first.room.roomId)!;
    stable.runtime!.state = { ...stable.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'constructed_chat_review' } };
    stable.recordCompletion();
    const reviewRetry = await sendChat(h, first.room.roomCode, h.users[0]!, original);
    expect(reviewRetry.response.status).toBe(201);
    expect(reviewRetry.body).toEqual(firstChat.body);
    const reviewNewMessage = await sendChat(h, first.room.roomCode, h.users[0]!, messageBody(first.gameId, 'review-new-message', 'must be rejected'));
    expect(reviewNewMessage.response.status).toBe(403);
    expect(reviewNewMessage.body.error).toMatchObject({ code: 'chat_forbidden' });
    const reviewResponse = await request(h, `/api/v2/rooms/${first.room.roomCode}/review`, {}, h.users[0]);
    expect(reviewResponse.status).toBe(200);
    const review = await json(reviewResponse);
    expect(review.review.chat.public.some((message: any) => message.messageId === firstChat.body.message.messageId)).toBe(true);
    const ended = await request(h, `/api/v2/rooms/${first.room.roomCode}/end-review`, post({ requestId: 'chat-end-review', gameId: first.gameId }), h.users[0]);
    expect(ended.status).toBe(200);
    for (let index = 0; index < 13; index += 1) {
      const ready = await request(h, `/api/v2/rooms/${first.room.roomCode}/ready`, post({ requestId: `chat-next-ready-${index}`, ready: true }), h.users[index]);
      expect(ready.status).toBe(200);
    }
    const started = await request(h, `/api/v2/rooms/${first.room.roomCode}/start`, post({ requestId: 'chat-next-start' }), h.users[0]);
    expect(started.status).toBe(200);
    const next = await json(started);
    expect(next.gameId).not.toBe(first.gameId);
    await advanceToDay(h, first.room.roomId);
    const nextChat = await sendChat(h, first.room.roomCode, h.users[0]!, messageBody(next.gameId as string, 'quota-retry', 'new game'));
    expect(nextChat.response.status).toBe(201);
    expect(nextChat.body.message.messageId).not.toBe(firstChat.body.message.messageId);
    const staleRetry = await sendChat(h, first.room.roomCode, h.users[0]!, original);
    expect(staleRetry.response.status).toBe(409);
    expect(staleRetry.body.error).toMatchObject({ code: 'stale_game' });
    expect(h.logStore.listMessages(first.gameId, 0)).toHaveLength(1);
    expect(h.logStore.listMessages(next.gameId, 0)).toHaveLength(1);
  });
});
