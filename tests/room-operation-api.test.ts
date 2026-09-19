import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, enter, json, makeHarness, post, request, type HttpHarness, type User } from './contract-http-utils.ts';
import { MockVoice } from './contract-http-utils.ts';

afterEach(closeHarnesses);

async function startFullRoom(h: HttpHarness) {
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'full-create' }), h.users[0]);
  expect(created.status).toBe(201);
  const room = await json(created) as { roomId: string; roomCode: string; gameId: null };
  for (let index = 1; index < 13; index += 1) {
    const joined = await enter(h, room.roomCode, h.users[index]!, `full-enter-${index}`);
    expect(joined.response.status).toBe(200);
  }
  for (let index = 0; index < 13; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `full-ready-${index}`, ready: true }), h.users[index]);
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'full-start' }), h.users[0]);
  expect(started.status).toBe(200);
  const startedBody = await json(started);
  expect(typeof startedBody.gameId).toBe('string');
  if (typeof startedBody.gameId !== 'string') throw new Error('start response missing gameId');
  return { room, gameId: startedBody.gameId };
}

function expectErrorBody(body: Record<string, any>, code: string) {
  expect(body.error).toMatchObject({ code });
}

describe('v2 operation receipt HTTP contract', () => {
  it('deduplicates concurrent create requests, preserves the original response, and isolates accounts', async () => {
    const h = await makeHarness();
    const responses = await Promise.all([
      request(h, '/api/v2/rooms', post({ requestId: 'concurrent-create' }), h.users[0]),
      request(h, '/api/v2/rooms', post({ requestId: 'concurrent-create' }), h.users[0]),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const first = await json(responses[0]!);
    const second = await json(responses[1]!);
    expect(second).toEqual(first);
    expect(h.app.directory.byId.size).toBe(1);

    const otherAccount = await request(h, '/api/v2/rooms', post({ requestId: 'concurrent-create' }), h.users[1]);
    expect(otherAccount.status).toBe(201);
    expect((await json(otherAccount)).roomId).not.toBe(first.roomId);
    expect(h.app.directory.byId.size).toBe(2);
  });

  it('rejects changed body and operation on the same account-room request id without replacing the original response', async () => {
    const h = await makeHarness();
    const created = await request(h, '/api/v2/rooms', post({ requestId: 'body-conflict' }), h.users[0]);
    expect(created.status).toBe(201);
    const original = await json(created);
    const changed = await request(h, '/api/v2/rooms', post({ requestId: 'body-conflict', presetId: 'default-13' }), h.users[0]);
    expect(changed.status).toBe(409);
    expectErrorBody(await json(changed), 'request_id_reused');

    const joined = await enter(h, String(original.roomCode), h.users[1]!, 'operation-conflict');
    expect(joined.response.status).toBe(200);
    const operationConflict = await request(h, `/api/v2/rooms/${original.roomCode}/ready`, post({ requestId: 'operation-conflict', ready: true }), h.users[1]);
    expect(operationConflict.status).toBe(409);
    expectErrorBody(await json(operationConflict), 'request_id_reused');
    const view = await json(await request(h, `/api/v2/rooms/${original.roomCode}/view`, {}, h.users[1]));
    expect(view.room.formalMembers.find((member: any) => member.userId === h.users[1]!.userId)?.ready).toBe(false);
  });

  it('replays ready without reversing a later ready request', async () => {
    const h = await makeHarness();
    const created = await request(h, '/api/v2/rooms', post({ requestId: 'ready-create' }), h.users[0]);
    const room = await json(created) as { roomCode: string; roomId: string };
    expect((await enter(h, room.roomCode, h.users[1]!, 'ready-enter')).response.status).toBe(200);
    const first = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: 'ready-on', ready: true }), h.users[1]);
    expect(first.status).toBe(200);
    const later = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: 'ready-off', ready: false }), h.users[1]);
    expect(later.status).toBe(200);
    const replay = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: 'ready-on', ready: true }), h.users[1]);
    expect(replay.status).toBe(200);
    expect(await json(replay)).toEqual(await json(first));
    const view = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[1]));
    expect(view.room.formalMembers.find((member: any) => member.userId === h.users[1]!.userId)?.ready).toBe(false);
  });

  it('replays start after the match begins, and an old start id cannot open a new game after constructed review', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startFullRoom(h);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const matchesBefore = h.logStore.listMatches(room.roomId).length;
    const replay = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'full-start' }), h.users[0]);
    expect(replay.status).toBe(200);
    expect((await json(replay)).gameId).toBe(gameId);
    expect(h.logStore.listMatches(room.roomId)).toHaveLength(matchesBefore);

    stable.runtime!.state = { ...stable.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'constructed_for_receipt_test' } };
    stable.recordCompletion();
    const ended = await request(h, `/api/v2/rooms/${room.roomCode}/end-review`, post({ requestId: 'receipt-end-review', gameId }), h.users[0]);
    expect(ended.status).toBe(200);
    expect(stable.runtime).toBeNull();
    const oldStart = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'full-start' }), h.users[0]);
    expect(oldStart.status).toBe(200);
    expect((await json(oldStart)).gameId).toBe(gameId);
    expect(stable.runtime).toBeNull();
  });

  it('replays leave after the member is gone and dissolve after the room leaves the directory', async () => {
    const h = await makeHarness();
    const created = await request(h, '/api/v2/rooms', post({ requestId: 'leave-create' }), h.users[0]);
    const room = await json(created) as { roomCode: string; roomId: string };
    const leave = await request(h, `/api/v2/rooms/${room.roomCode}/leave`, post({ requestId: 'leave-once' }), h.users[0]);
    expect(leave.status).toBe(200);
    const leaveBody = await json(leave);
    const leaveReplay = await request(h, `/api/v2/rooms/${room.roomCode}/leave`, post({ requestId: 'leave-once' }), h.users[0]);
    expect(leaveReplay.status).toBe(200);
    expect(await json(leaveReplay)).toEqual(leaveBody);

    const dissolved = await request(h, '/api/v2/rooms', post({ requestId: 'dissolve-create' }), h.users[1]);
    const dissolveRoom = await json(dissolved) as { roomCode: string; roomId: string };
    const dissolve = await request(h, `/api/v2/rooms/${dissolveRoom.roomCode}/dissolve`, post({ requestId: 'dissolve-once' }), h.users[1]);
    expect(dissolve.status).toBe(200);
    const dissolveBody = await json(dissolve);
    expect(h.app.directory.byId.has(dissolveRoom.roomId)).toBe(false);
    const dissolveReplay = await request(h, `/api/v2/rooms/${dissolveRoom.roomCode}/dissolve`, post({ requestId: 'dissolve-once' }), h.users[1]);
    expect(dissolveReplay.status).toBe(200);
    expect(await json(dissolveReplay)).toEqual(dissolveBody);
  });

  it('immediately disposes an empty reviewed room after the last formal leave and replays its response', async () => {
    const h = await makeHarness(14);
    const { room } = await startFullRoom(h);
    const spectator = h.users[13]!;
    expect((await enter(h, room.roomCode, spectator, 'review-dispose-spectator')).response.status).toBe(200);
    const stable = h.app.directory.byId.get(room.roomId)!;
    stable.runtime!.state = { ...stable.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'review_dispose' } };
    for (let index = 1; index < 13; index += 1) {
      const response = await request(h, `/api/v2/rooms/${room.roomCode}/leave`, post({ requestId: `review-dispose-leave-${index}` }), h.users[index]);
      expect(response.status).toBe(200);
    }
    // 房主在复盘阶段是普通离开（不解散）；其余 12 名正式成员已先行离开，因此离开后房间空置 → 立即关闭。
    const finalLeave = await request(h, `/api/v2/rooms/${room.roomCode}/leave`, post({ requestId: 'review-dispose-final' }), h.users[0]);
    expect(finalLeave.status).toBe(200);
    const finalBody = await json(finalLeave);
    expect(finalBody).toEqual({ left: true, dissolved: false, seatRetained: false });
    expect((await request(h, '/api/v2/auth/me', {}, h.users[0])).status).toBe(200);
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, spectator)).status).toBe(404);
    expect((await json(await request(h, '/api/v2/me/rooms', {}, spectator))).currentRoomId).toBeNull();
    const replay = await request(h, `/api/v2/rooms/${room.roomCode}/leave`, post({ requestId: 'review-dispose-final' }), h.users[0]);
    expect(replay.status).toBe(200);
    expect(await json(replay)).toEqual(finalBody);
  });

  it('does not replay an invitation to an old controller, while a valid takeover gets the original token and expiry', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startFullRoom(h);
    const invitation = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/invitations`, post({ requestId: 'screen-invite', gameId }), h.users[0]);
    expect(invitation.status).toBe(201);
    const original = await json(invitation);
    const replacementSession = h.accounts.createSession(h.users[0]!.userId);
    const replacement: User = { ...h.users[0]!, cookie: `td_account_v2=${replacementSession.token}`, sessionId: replacementSession.session.id };
    const takeover = await request(h, `/api/v2/rooms/${room.roomCode}/takeover`, post({ requestId: 'screen-takeover' }), replacement);
    expect(takeover.status).toBe(200);
    const oldRetry = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/invitations`, post({ requestId: 'screen-invite', gameId }), h.users[0]);
    expect(oldRetry.status).toBe(403);
    expectErrorBody(await json(oldRetry), 'room_access_required');
    const newRetry = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/invitations`, post({ requestId: 'screen-invite', gameId }), replacement);
    expect(newRetry.status).toBe(201);
    expect(await json(newRetry)).toEqual(original);
  });

  it('keeps voice token and sync dynamic instead of replaying by operation request id', async () => {
    const voice = new MockVoice();
    const h = await makeHarness(20, voice);
    const { room, gameId } = await startFullRoom(h);
    const beforeIssued = voice.issued.length;
    const firstToken = await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, post({ requestId: 'voice-dynamic', gameId }), h.users[0]);
    const secondToken = await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, post({ requestId: 'voice-dynamic', gameId }), h.users[0]);
    expect(firstToken.status).toBe(200);
    expect(secondToken.status).toBe(200);
    await h.app.drain();
    expect(voice.issued.length).toBeGreaterThanOrEqual(beforeIssued + 2);
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/voice/sync`, post({ requestId: 'voice-sync', gameId }), h.users[0])).status).toBe(200);
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/voice/sync`, post({ requestId: 'voice-sync', gameId }), h.users[0])).status).toBe(200);
  });

  it('applies the same receipt to lowercase, encoded, and trailing-slash room aliases', async () => {
    const h = await makeHarness();
    const created = await request(h, '/api/v2/rooms', post({ requestId: 'alias-create' }), h.users[0]);
    const room = await json(created) as { roomCode: string; roomId: string };
    const canonical = await request(h, `/api/v2/rooms/${room.roomCode}/enter`, post({ requestId: 'alias-enter' }), h.users[1]);
    expect(canonical.status).toBe(200);
    const encoded = `%${room.roomCode.charCodeAt(0).toString(16).toUpperCase()}${room.roomCode.slice(1)}`;
    const aliases = [
      `/api/v2/rooms/${room.roomCode.toLowerCase()}/enter/`,
      `/api/v2/rooms/${encoded}/enter`,
    ];
    for (const [index, path] of aliases.entries()) {
      const alias = await request(h, path, post({ requestId: 'alias-enter', marker: `changed-${index}` }), h.users[1]);
      expect(alias.status).toBe(409);
      expectErrorBody(await json(alias), 'request_id_reused');
    }
    expect(h.app.directory.byId.get(room.roomId)?.members.size).toBe(2);
  });
});
