import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, createRoom, enter, json, makeHarness, post, request, type HttpHarness, type User } from './contract-http-utils.ts';

afterEach(closeHarnesses);

async function fillRoom(h: HttpHarness, count = 13) {
  const created = await createRoom(h);
  expect(created.response.status).toBe(201);
  const room = created.body as { roomId: string; roomCode: string; gameId: null; memberId: string; kind: string; playerId: null };
  expect(room).toMatchObject({ gameId: null, kind: 'formal', playerId: null });
  for (let index = 1; index < count; index += 1) {
    const joined = await enter(h, room.roomCode, h.users[index]!, `enter-${index}`);
    expect(joined.response.status).toBe(200);
    expect(joined.body).toMatchObject({ roomId: room.roomId, roomCode: room.roomCode, gameId: null, kind: 'formal', playerId: null });
  }
  return room;
}

async function startRoom(h: HttpHarness, count = 13) {
  const room = await fillRoom(h, count);
  for (let index = 0; index < count; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `ready-${index}`, ready: true }), h.users[index]);
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'start-1' }), h.users[0]);
  expect(started.status).toBe(200);
  return { room, started: await json(started) };
}

function userForPlayer(h: HttpHarness, roomId: string, playerId: string): User {
  const room = h.app.directory.byId.get(roomId)!;
  const participant = [...room.participants.values()].find((seat) => seat.playerId === playerId)!;
  return h.users.find((user) => user.userId === participant.userId)!;
}

describe('v2 HTTP core', () => {
  it('uses the roomId contract, requestId mutations, username profiles, one current room, and spectator promotion', async () => {
    const h = await makeHarness();
    expect((await request(h, '/api/rooms')).status).toBe(404);
    expect((await request(h, '/api/v2/rooms', post({}))).status).toBe(401);
    expect((await request(h, '/api/v2/rooms', post({ nickname: 'missing-request-id' }), h.users[0])).status).toBe(400);
    const room = await fillRoom(h);
    const spectator = await enter(h, room.roomCode, h.users[13]!, 'spectator-enter');
    expect(spectator.response.status).toBe(200);
    expect(spectator.body).toMatchObject({ kind: 'public_spectator', playerId: null });
    const released = await request(h, `/api/v2/rooms/${room.roomCode}/leave`, post({ requestId: 'formal-leave-for-promote' }), h.users[12]);
    expect(released.status).toBe(200);
    const promotion = await request(h, `/api/v2/rooms/${room.roomCode}/promote`, post({ requestId: 'promote-1' }), h.users[13]);
    expect(promotion.status).toBe(200);
    expect(await json(promotion)).toMatchObject({ kind: 'formal', playerId: null });
    const duplicate = await createRoom(h, h.users[0], 'create-other-room');
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.error).toMatchObject({ code: 'already_in_room' });
    const rooms = await request(h, '/api/v2/me/rooms', {}, h.users[0]);
    expect(rooms.status).toBe(200);
    expect((await json(rooms)).rooms[0]).toMatchObject({ roomId: room.roomId, activeHere: true, controlling: true, kind: 'formal', playerId: null });
    const secondSession = h.accounts.createSession(h.users[0]!.userId);
    const otherDevice: User = { ...h.users[0]!, cookie: `td_account_v2=${secondSession.token}`, sessionId: secondSession.session.id };
    const otherRooms = await request(h, '/api/v2/me/rooms', {}, otherDevice);
    expect((await json(otherRooms)).rooms[0]).toMatchObject({ activeHere: false, controlling: false, requiresTakeover: true });
  });

  it('starts without online presence, keeps different-player request ids separate, and rejects a genuinely late window command', async () => {
    const h = await makeHarness();
    const { room, started } = await startRoom(h);
    expect(started).toMatchObject({ started: true, roomId: room.roomId });
    expect(typeof started.gameId).toBe('string');
    const stable = h.app.directory.byId.get(room.roomId)!;
    const runtime = stable.runtime!;
    const state = runtime.state!;
    const door = state.players.find((player) => player.roleId === 'door')!;
    const death = state.players.find((player) => player.roleId === 'death')!;
    const doorUser = userForPlayer(h, room.roomId, door.playerId);
    const deathUser = userForPlayer(h, room.roomId, death.playerId);
    const target = state.players.find((player) => player.playerId !== door.playerId && player.life === 'alive')!.playerId;
    const guard = runtime.driver!.windows().find((window) => window.id === 'guard')!;
    const faction = runtime.driver!.windows().find((window) => window.id === 'faction')!;
    const guardResponse = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'same-request', gameId: started.gameId, action: 'SUBMIT_GUARD', windowInstanceId: guard.instanceId, targets: [target] }), doorUser);
    const proposalResponse = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'same-request', gameId: started.gameId, action: 'EDIT_PROPOSAL', windowInstanceId: faction.instanceId, targets: [target] }), deathUser);
    expect(await json(guardResponse)).toMatchObject({ requestId: 'same-request', status: 'accepted' });
    expect(await json(proposalResponse)).toMatchObject({ requestId: 'same-request', status: 'accepted' });
    const civilian = state.players.find((player) => player.roleId === 'civilian')!;
    const civilianUser = userForPlayer(h, room.roomId, civilian.playerId);
    const forbidden = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'forbidden', gameId: started.gameId, action: 'SUBMIT_GUARD', windowInstanceId: guard.instanceId, targets: [target] }), civilianUser);
    expect(await json(forbidden)).toMatchObject({ requestId: 'forbidden', status: 'rejected', code: 'action_forbidden' });
    h.clock.elapse(Math.max(0, guard.closesAt - h.clock.now()) + 1);
    const late = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'late', gameId: started.gameId, action: 'SUBMIT_GUARD', windowInstanceId: guard.instanceId, targets: [target] }), doorUser);
    expect(await json(late)).toMatchObject({ requestId: 'late', status: 'rejected', code: 'window_closed' });
    expect([...stable.members.values()].every((member) => member.presence === 'offline')).toBe(true);
  });

  it('does not dissolve a playing room when its host leaves and retains the participant seat', async () => {
    const h = await makeHarness();
    const { room, started } = await startRoom(h);
    const left = await request(h, `/api/v2/rooms/${room.roomCode}/leave`, post({ requestId: 'host-leave' }), h.users[0]);
    expect(left.status).toBe(200);
    expect(await json(left)).toMatchObject({ left: true, seatRetained: true });
    expect(h.app.directory.byCode.has(room.roomCode)).toBe(true);
    expect(h.app.directory.byId.get(room.roomId)?.phase).toBe('playing');
    expect(h.app.directory.byId.get(room.roomId)?.participants.has(h.users[0]!.userId)).toBe(true);
    const stale = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'stale', gameId: started.gameId, action: 'END_SPEECH', windowInstanceId: 'none' }), h.users[0]);
    expect(stale.status).toBe(403);
  });
});
