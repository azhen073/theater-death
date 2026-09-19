import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, enter, json, makeHarness, post, request, waitFor, type HttpHarness, type User } from './contract-http-utils.ts';

afterEach(closeHarnesses);

async function startRoom(h: HttpHarness) {
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'receipt-create' }), h.users[0]);
  expect(created.status).toBe(201);
  const room = await created.json() as { roomId: string; roomCode: string };
  for (let index = 1; index < 13; index += 1) {
    const joined = await enter(h, room.roomCode, h.users[index]!, `receipt-enter-${index}`);
    expect(joined.response.status).toBe(200);
  }
  for (let index = 0; index < 13; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `receipt-ready-${index}`, ready: true }), h.users[index]);
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'receipt-start' }), h.users[0]);
  expect(started.status).toBe(200);
  return { room, gameId: (await started.json() as { gameId: string }).gameId };
}

function userForPlayer(h: HttpHarness, roomId: string, playerId: string): User {
  const room = h.app.directory.byId.get(roomId)!;
  const participant = [...room.participants.values()].find((seat) => seat.playerId === playerId)!;
  return h.users.find((user) => user.userId === participant.userId)!;
}

describe('v2 HTTP command receipts', () => {
  it('returns not_seen without executing, deduplicates gated retries, isolates players, and evaluates deadline at execution', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startRoom(h);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const runtime = stable.runtime!;
    const state = runtime.state!;
    const death = state.players.find((player) => player.roleId === 'death')!;
    const door = state.players.find((player) => player.roleId === 'door')!;
    const target = state.players.find((player) => player.playerId !== death.playerId && player.playerId !== door.playerId && player.life === 'alive')!.playerId;
    const deathUser = userForPlayer(h, room.roomId, death.playerId);
    const doorUser = userForPlayer(h, room.roomId, door.playerId);
    const faction = runtime.driver!.windows().find((window) => window.id === 'faction')!;
    const guard = runtime.driver!.windows().find((window) => window.id === 'guard')!;
    const beforeSeq = runtime.state!.eventSeq;
    const beforeWindows = runtime.driver!.windows().map((window) => window.instanceId);
    const unseen = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/never-seen`, {}, deathUser);
    expect(unseen.status).toBe(200);
    expect(await json(unseen)).toEqual({ requestId: 'never-seen', status: 'not_seen' });
    expect(runtime.state!.eventSeq).toBe(beforeSeq);
    expect(runtime.driver!.windows().map((window) => window.instanceId)).toEqual(beforeWindows);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stable.enqueue(() => gate);
    const payload = { requestId: 'gated', gameId, action: 'EDIT_PROPOSAL', windowInstanceId: faction.instanceId, targets: [target] };
    const first = request(h, `/api/v2/rooms/${room.roomCode}/command`, post(payload), deathUser);
    await waitFor(() => stable.receipts.lookup(gameId, death.playerId, 'gated').status === 'pending');
    const pendingLookup = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/gated`, {}, deathUser);
    expect(await json(pendingLookup)).toEqual({ requestId: 'gated', status: 'pending' });
    const retry = request(h, `/api/v2/rooms/${room.roomCode}/command`, post(payload), deathUser);
    const conflict = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ ...payload, targets: [] }), deathUser);
    expect(await json(conflict)).toMatchObject({ requestId: 'gated', status: 'rejected', code: 'request_id_reused' });
    release();
    const [firstResponse, retryResponse] = await Promise.all([first, retry]);
    const firstReceipt = await json(firstResponse);
    expect(firstReceipt).toMatchObject({ requestId: 'gated', status: 'accepted' });
    expect(await json(retryResponse)).toEqual(firstReceipt);
    expect(runtime.driver!.proposalState(death.playerId)?.revision).toBe(1);
    const conflictAfter = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ ...payload, targets: [state.players.find((player) => player.playerId !== target && player.playerId !== death.playerId)!.playerId] }), deathUser);
    expect(await json(conflictAfter)).toMatchObject({ requestId: 'gated', status: 'rejected', code: 'request_id_reused' });
    expect(runtime.driver!.proposalState(death.playerId)?.revision).toBe(1);
    const otherPlayerLookup = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/gated`, {}, doorUser);
    expect(await json(otherPlayerLookup)).toEqual({ requestId: 'gated', status: 'not_seen' });
    const completedLookup = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/gated`, {}, deathUser);
    expect(await json(completedLookup)).toEqual(firstReceipt);

    const sharedGuard = { requestId: 'shared-player-id', gameId, action: 'SUBMIT_GUARD', windowInstanceId: guard.instanceId, targets: [target] };
    const guardResponse = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post(sharedGuard), doorUser);
    expect(await json(guardResponse)).toMatchObject({ requestId: 'shared-player-id', status: 'accepted' });
    const otherPlayer = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'shared-player-id', gameId, action: 'EDIT_PROPOSAL', windowInstanceId: faction.instanceId, targets: [target] }), deathUser);
    expect(await json(otherPlayer)).toMatchObject({ requestId: 'shared-player-id', status: 'accepted' });

    let releaseLate!: () => void;
    const lateGate = new Promise<void>((resolve) => { releaseLate = resolve; });
    stable.enqueue(() => lateGate);
    const latePayload = { requestId: 'late-gated', gameId, action: 'SUBMIT_GUARD', windowInstanceId: guard.instanceId, targets: [target] };
    const lateRequest = request(h, `/api/v2/rooms/${room.roomCode}/command`, post(latePayload), doorUser);
    await waitFor(() => stable.receipts.lookup(gameId, door.playerId, 'late-gated').status === 'pending');
    h.clock.elapse(Math.max(0, guard.closesAt - h.clock.now()) + 1);
    const stillPending = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/late-gated`, {}, doorUser);
    expect(await json(stillPending)).toEqual({ requestId: 'late-gated', status: 'pending' });
    releaseLate();
    expect(await json(await lateRequest)).toMatchObject({ requestId: 'late-gated', status: 'rejected', code: 'window_closed' });
    const lateDone = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/late-gated`, {}, doorUser);
    expect(await json(lateDone)).toMatchObject({ requestId: 'late-gated', status: 'rejected', code: 'window_closed' });
  });

  it('restricts receipt lookup to the controlling player and rejects public, private, and taken-over viewers', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startRoom(h);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const state = stable.runtime!.state!;
    const door = state.players.find((player) => player.roleId === 'door')!;
    const doorUser = userForPlayer(h, room.roomId, door.playerId);
    const target = state.players.find((player) => player.playerId !== door.playerId)!.playerId;
    const guard = stable.runtime!.driver!.windows().find((window) => window.id === 'guard')!;
    const accepted = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'private-receipt', gameId, action: 'SUBMIT_GUARD', windowInstanceId: guard.instanceId, targets: [target] }), doorUser);
    expect(await json(accepted)).toMatchObject({ status: 'accepted' });
    const spectator = await enter(h, room.roomCode, h.users[13]!, 'receipt-spectator');
    expect(spectator.body.kind).toBe('public_spectator');
    const publicLookup = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/private-receipt`, {}, h.users[13]);
    expect(publicLookup.status).toBe(403);
    const invite = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/invitations`, post({ requestId: 'receipt-invite', gameId }), doorUser);
    const inviteBody = await json(invite);
    const redeem = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/redeem`, post({ requestId: 'receipt-redeem', gameId, token: inviteBody.token }), h.users[13]);
    expect(redeem.status).toBe(200);
    const privateView = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[13]));
    expect(privateView.submissionState).toContainEqual(expect.objectContaining({ action: 'SUBMIT_GUARD', windowInstanceId: guard.instanceId, requestId: null, targets: [target] }));
    const privateLookup = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/private-receipt`, {}, h.users[13]);
    expect(privateLookup.status).toBe(403);
    const replacement = h.accounts.createSession(h.users[0]!.userId);
    const oldHost = h.users[0]!;
    const newer: User = { ...oldHost, cookie: `td_account_v2=${replacement.token}`, sessionId: replacement.session.id };
    const takeover = await request(h, `/api/v2/rooms/${room.roomCode}/takeover`, post({ requestId: 'receipt-takeover' }), newer);
    expect(takeover.status).toBe(200);
    const oldLookup = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/private-receipt`, {}, oldHost);
    expect(oldLookup.status).toBe(403);
  });

  it('publishes only current-window submissions, preserves accepted state after rejects, and clears receipts after review', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startRoom(h);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const runtime = stable.runtime!;
    const state = runtime.state!;
    const door = state.players.find((player) => player.roleId === 'door')!;
    const doorUser = userForPlayer(h, room.roomId, door.playerId);
    const target = state.players.find((player) => player.playerId !== door.playerId)!.playerId;
    const target2 = state.players.find((player) => player.playerId !== door.playerId && player.playerId !== target && player.life === 'alive')!.playerId;
    const guard = runtime.driver!.windows().find((window) => window.id === 'guard')!;
    const acceptedPayload = { requestId: 'visible-submit', gameId, action: 'SUBMIT_GUARD', windowInstanceId: guard.instanceId, targets: [target] };
    expect(await json(await request(h, `/api/v2/rooms/${room.roomCode}/command`, post(acceptedPayload), doorUser))).toMatchObject({ status: 'accepted' });
    const doorView = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, doorUser));
    expect(doorView.submissionState).toContainEqual(expect.objectContaining({ action: 'SUBMIT_GUARD', windowInstanceId: guard.instanceId, requestId: 'visible-submit', targets: [target] }));
    const secondAccepted = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ ...acceptedPayload, requestId: 'visible-submit-2', targets: [target2] }), doorUser);
    expect(await json(secondAccepted)).toMatchObject({ status: 'accepted' });
    const rejected = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ ...acceptedPayload, requestId: 'invalid-submit', targets: [door.playerId] }), doorUser);
    expect(await json(rejected)).toMatchObject({ status: 'rejected', code: 'guard_self_forbidden' });
    const unchanged = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, doorUser));
    expect(unchanged.submissionState).toContainEqual(expect.objectContaining({ requestId: 'visible-submit-2', targets: [target2] }));
    h.clock.elapse(Math.max(0, guard.closesAt - h.clock.now()) + 1);
    await stable.enqueue(() => undefined);
    const afterWindow = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, doorUser));
    expect(afterWindow.submissionState).toEqual([]);

    await stable.enqueue(() => { stable.runtime!.state = { ...stable.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'receipt-retention-fixture' } }; });
    h.app.refresh(stable);
    const reviewLookup = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/visible-submit`, {}, doorUser);
    expect(await json(reviewLookup)).toMatchObject({ requestId: 'visible-submit', status: 'accepted' });
    const ended = await request(h, `/api/v2/rooms/${room.roomCode}/end-review`, post({ requestId: 'receipt-end-review', gameId }), h.users[0]);
    expect(ended.status).toBe(200);
    for (let index = 0; index < 13; index += 1) {
      expect((await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `receipt-next-ready-${index}`, ready: true }), h.users[index])).status).toBe(200);
    }
    const next = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'receipt-next-start' }), h.users[0]);
    expect(next.status).toBe(200);
    const nextGameId = (await next.json() as { gameId: string }).gameId;
    expect(nextGameId).not.toBe(gameId);
    const staleLookup = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/visible-submit`, {}, h.users[0]);
    expect(staleLookup.status).toBe(409);
  });
});
