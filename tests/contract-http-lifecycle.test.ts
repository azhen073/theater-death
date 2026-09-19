import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, connectRoom, enter, makeHarness, MockVoice, post, request, waitFor, type HttpHarness, type User } from './contract-http-utils.ts';

afterEach(closeHarnesses);

async function fullStart(h: HttpHarness) {
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'life-create' }), h.users[0]);
  expect(created.status).toBe(201);
  const room = await created.json() as { roomId: string; roomCode: string };
  for (let index = 1; index < 13; index += 1) {
    const joined = await enter(h, room.roomCode, h.users[index]!, `life-enter-${index}`);
    expect(joined.response.status).toBe(200);
  }
  for (let index = 0; index < 13; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `life-ready-${index}`, ready: true }), h.users[index]);
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'life-start' }), h.users[0]);
  expect(started.status).toBe(200);
  return { room, started: await started.json() as { roomId: string; gameId: string } };
}

function playerUser(h: HttpHarness, roomId: string, playerId: string): User {
  const room = h.app.directory.byId.get(roomId)!;
  const participant = [...room.participants.values()].find((seat) => seat.playerId === playerId)!;
  return h.users.find((user) => user.userId === participant.userId)!;
}

async function drainGame(h: HttpHarness, roomId: string): Promise<void> {
  const room = h.app.directory.byId.get(roomId)!;
  for (let guard = 0; guard < 100 && room.runtime?.driver && !room.runtime.driver.done(); guard += 1) {
    const driver = room.runtime.driver;
    const windows = driver.windows();
    if (!windows.length) { await room.enqueue(() => undefined); continue; }
    h.clock.advance(Math.max(0, Math.min(...windows.map((window) => window.closesAt)) - h.clock.now()));
    await room.enqueue(() => undefined);
  }
}

describe('v2 HTTP lifecycle contract', () => {
  it('logs out only the current control session, then maintenance keeps expired participants formal and offline', async () => {
    const h = await makeHarness();
    const { room } = await fullStart(h);
    const otherSession = h.accounts.createSession(h.users[0]!.userId);
    const other = { ...h.users[0]!, cookie: `td_account_v2=${otherSession.token}`, sessionId: otherSession.session.id };
    const otherLogout = await request(h, '/api/v2/auth/logout', post({}), other);
    expect(otherLogout.status).toBe(200);
    expect(h.app.directory.byId.get(room.roomId)?.members.has(h.users[0]!.userId)).toBe(true);
    const currentView = await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[0]);
    expect(currentView.status).toBe(200);
    const currentLogout = await request(h, '/api/v2/auth/logout', post({}), h.users[0]);
    expect(currentLogout.status).toBe(200);
    const stable = h.app.directory.byId.get(room.roomId)!;
    expect(stable.members.has(h.users[0]!.userId)).toBe(false);
    expect(stable.participants.has(h.users[0]!.userId)).toBe(true);

    h.accounts.logout(h.users[1]!.sessionId);
    await h.app.revokeUser(h.users[1]!.userId);
    const expired = stable.members.get(h.users[1]!.userId)!;
    expect(expired.kind).toBe('formal');
    expect(expired.sessionId).toBeNull();
    expect(expired.presence).toBe('offline');
    h.accounts.logout(h.users[2]!.sessionId);
    await h.app.maintenance.sweep();
    const maintained = stable.members.get(h.users[2]!.userId)!;
    expect(maintained.kind).toBe('formal');
    expect(maintained.sessionId).toBeNull();
    expect(maintained.presence).toBe('offline');
  });

  it('HTTP takeover disconnects the old room socket and rejects old HTTP and voice control', async () => {
    const voice = new MockVoice();
    const h = await makeHarness(20, voice);
    const { room, started } = await fullStart(h);
    const live = await connectRoom(h, h.users[0]!, room.roomId);
    const voiceBefore = await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, post({ requestId: 'voice-before', gameId: started.gameId }), h.users[0]);
    expect(voiceBefore.status).toBe(200);
    const oldIdentity = voice.issued.at(-1)!.playerId;
    const replacement = h.accounts.createSession(h.users[0]!.userId);
    const newer: User = { ...h.users[0]!, cookie: `td_account_v2=${replacement.token}`, sessionId: replacement.session.id };
    const noTakeover = await request(h, `/api/v2/rooms/${room.roomCode}/enter`, post({ requestId: 'enter-without-takeover' }), newer);
    expect(noTakeover.status).toBe(409);
    expect((await noTakeover.json() as { error: { code: string } }).error).toMatchObject({ code: 'takeover_required' });
    const takeover = await request(h, `/api/v2/rooms/${room.roomCode}/takeover`, post({ requestId: 'http-takeover' }), newer);
    expect(takeover.status).toBe(200);
    await waitFor(() => live.controls.some((notice) => notice.reason === 'taken_over') && !live.socket.connected);
    expect((await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[0])).status).toBe(403);
    const oldVoice = await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, post({ requestId: 'old-voice', gameId: started.gameId }), h.users[0]);
    expect(oldVoice.status).toBe(403);
    await h.app.drain();
    expect(voice.removed.some((entry) => entry.identity === oldIdentity)).toBe(true);
  });

  it('runs a real first night and first-day election timeout over HTTP, ends review, starts a new game, and rejects the old gameId', async () => {
    const h = await makeHarness();
    const { room, started } = await fullStart(h);
    const live = await connectRoom(h, h.users[0]!, room.roomId);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const runtime = stable.runtime!;
    const state = runtime.state!;
    const death = state.players.find((player) => player.roleId === 'death')!;
    const spirits = state.players.filter((player) => player.roleId === 'spirit');
    const deathUser = playerUser(h, room.roomId, death.playerId);
    const faction = runtime.driver!.windows().find((window) => window.id === 'faction')!;
    const targetIds = spirits.map((player) => player.playerId);
    const deathProposal = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'real-death', gameId: started.gameId, action: 'EDIT_PROPOSAL', windowInstanceId: faction.instanceId, targets: [death.playerId] }), deathUser);
    expect(await deathProposal.json()).toMatchObject({ requestId: 'real-death', status: 'accepted' });
    for (const spirit of spirits) {
      const spiritUser = playerUser(h, room.roomId, spirit.playerId);
      const proposal = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: `real-spirit-${spirit.playerId}`, gameId: started.gameId, action: 'EDIT_PROPOSAL', windowInstanceId: faction.instanceId, targets: targetIds }), spiritUser);
      expect(await proposal.json()).toMatchObject({ status: 'accepted' });
    }
    await drainGame(h, room.roomId);
    expect(stable.runtime?.state?.phase).toBe('ended');
    expect(stable.runtime?.state?.win).toMatchObject({ winner: 'human' });
    await waitFor(() => live.views.at(-1)?.room.phase === 'review');
    const reviewVersion = live.views.at(-1)!.viewVersion;
    const ended = await request(h, `/api/v2/rooms/${room.roomCode}/end-review`, post({ requestId: 'end-review', gameId: started.gameId }), h.users[0]);
    expect(ended.status).toBe(200);
    expect(await ended.json()).toMatchObject({ roomId: room.roomId, roomCode: room.roomCode, gameId: null, endedGameId: started.gameId });
    await waitFor(() => live.views.at(-1)?.room.phase === 'lobby');
    expect(live.views.at(-1)!.viewVersion).toBeGreaterThan(reviewVersion);
    expect(live.socket.connected).toBe(true);
    for (let index = 0; index < 13; index += 1) {
      const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `next-ready-${index}`, ready: true }), h.users[index]);
      expect(ready.status).toBe(200);
    }
    const next = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'next-start' }), h.users[0]);
    expect(next.status).toBe(200);
    const nextBody = await next.json() as { gameId: string };
    expect(nextBody.gameId).not.toBe(started.gameId);
    await waitFor(() => live.views.at(-1)?.gameId === nextBody.gameId);
    const stale = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'old-game-command', gameId: started.gameId, action: 'END_SPEECH', windowInstanceId: 'old-window' }), h.users[0]);
    expect(stale.status).toBe(409);
    expect((await stale.json() as { error: { code: string } }).error).toMatchObject({ code: 'stale_game' });
  });
});
