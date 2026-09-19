import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, enter, makeHarness, MockVoice, post, request, waitFor, type HttpHarness, type User } from './contract-http-utils.ts';

afterEach(closeHarnesses);

async function fullStart(h: HttpHarness) {
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'knowledge-create' }), h.users[0]);
  expect(created.status).toBe(201);
  const room = await created.json() as { roomId: string; roomCode: string };
  for (let index = 1; index < 13; index += 1) {
    const joined = await enter(h, room.roomCode, h.users[index]!, `knowledge-enter-${index}`);
    expect(joined.response.status).toBe(200);
  }
  for (let index = 0; index < 13; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `knowledge-ready-${index}`, ready: true }), h.users[index]);
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'knowledge-start' }), h.users[0]);
  expect(started.status).toBe(200);
  return { room, gameId: (await started.json() as { gameId: string }).gameId };
}

function playerUser(h: HttpHarness, roomId: string, playerId: string): User {
  const room = h.app.directory.byId.get(roomId)!;
  const participant = [...room.participants.values()].find((seat) => seat.playerId === playerId)!;
  return h.users.find((user) => user.userId === participant.userId)!;
}

async function advanceToElectionSignup(h: HttpHarness, roomId: string): Promise<void> {
  const room = h.app.directory.byId.get(roomId)!;
  for (let guard = 0; guard < 40; guard += 1) {
    const driver = room.runtime!.driver!;
    const windows = driver.windows();
    if (windows.some((window) => window.id === 'election_signup')) return;
    const closesAt = Math.min(...windows.map((window) => window.closesAt));
    h.clock.advance(Math.max(0, closesAt - h.clock.now()));
    await room.enqueue(() => undefined);
  }
  throw new Error('did not reach election signup');
}

async function advanceThroughElectionVote(h: HttpHarness, roomId: string): Promise<void> {
  const room = h.app.directory.byId.get(roomId)!;
  for (let guard = 0; guard < 20; guard += 1) {
    const windows = room.runtime!.driver!.windows();
    if (windows.some((window) => window.id === 'election_vote')) return;
    const closesAt = Math.min(...windows.map((window) => window.closesAt));
    h.clock.advance(Math.max(0, closesAt - h.clock.now()));
    await room.enqueue(() => undefined);
  }
  throw new Error('did not reach election vote');
}

describe('v2 HTTP knowledge projection', () => {
  it('keeps a first-night death hidden through HTTP election, then reveals it in the morning announcement', async () => {
    const voice = new MockVoice();
    const h = await makeHarness(20, voice);
    const { room, gameId } = await fullStart(h);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const runtime = stable.runtime!;
    const state = runtime.state!;
    const death = state.players.find((player) => player.roleId === 'death')!;
    const spirits = state.players.filter((player) => player.roleId === 'spirit');
    const victim = state.players.find((player) => player.roleId === 'civilian')!;
    const deathUser = playerUser(h, room.roomId, death.playerId);
    const victimUser = playerUser(h, room.roomId, victim.playerId);
    const faction = runtime.driver!.windows().find((window) => window.id === 'faction')!;
    const attack = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'kill-one-civilian', gameId, action: 'EDIT_PROPOSAL', windowInstanceId: faction.instanceId, targets: [victim.playerId] }), deathUser);
    expect(await attack.json()).toMatchObject({ requestId: 'kill-one-civilian', status: 'accepted' });
    for (const spirit of spirits) {
      const spiritUser = playerUser(h, room.roomId, spirit.playerId);
      const empty = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: `empty-spirit-${spirit.playerId}`, gameId, action: 'EDIT_PROPOSAL', windowInstanceId: faction.instanceId, targets: [] }), spiritUser);
      expect(await empty.json()).toMatchObject({ status: 'accepted' });
    }
    await advanceToElectionSignup(h, room.roomId);
    expect(stable.runtime!.state!.players.find((player) => player.playerId === victim.playerId)?.life).toBe('dead');

    const spectatorEntry = await enter(h, room.roomCode, h.users[13]!, 'knowledge-spectator');
    expect(spectatorEntry.body).toMatchObject({ kind: 'public_spectator', playerId: null });
    const spectatorViewResponse = await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[13]);
    const spectatorView = await spectatorViewResponse.json() as Record<string, any>;
    const victimViewResponse = await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, victimUser);
    const victimView = await victimViewResponse.json() as Record<string, any>;
    expect(spectatorView.private).toBeNull();
    expect(JSON.stringify(spectatorView)).not.toContain('votes');
    expect(spectatorView.public.seats.find((seat: any) => seat.playerId === victim.playerId)).toMatchObject({ alive: true });
    expect(victimView.private.self).toMatchObject({ playerId: victim.playerId, life: 'alive' });
    expect(victimView.capabilities.allowedCommands).toContain('REGISTER_CANDIDACY');

    const signup = runtime.driver!.windows().find((window) => window.id === 'election_signup')!;
    const candidacy = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'victim-candidacy', gameId, action: 'REGISTER_CANDIDACY', windowInstanceId: signup.instanceId }), victimUser);
    expect(await candidacy.json()).toMatchObject({ requestId: 'victim-candidacy', status: 'accepted' });
    const candidateView = await (await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[0])).json() as Record<string, any>;
    expect(candidateView.public.day.election.candidates).toContain(victim.playerId);
    expect(JSON.stringify(candidateView)).not.toContain('votes');

    h.clock.advance(Math.max(0, signup.closesAt - h.clock.now()));
    await stable.enqueue(() => undefined);
    const prepare = runtime.driver!.windows().find((window) => window.id === 'speech_prepare')!;
    const victimStart = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'victim-start-speech', gameId, action: 'START_SPEECH', windowInstanceId: prepare.instanceId }), victimUser);
    expect(await victimStart.json()).toMatchObject({ requestId: 'victim-start-speech', status: 'accepted' });
    const speech = runtime.driver!.windows().find((window) => window.id === 'election_speech')!;
    const speakingView = await (await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, victimUser)).json() as Record<string, any>;
    expect(speakingView.tasks.some((task: any) => task.action === 'END_ELECTION_SPEECH' && task.windowInstanceId === speech.instanceId)).toBe(true);
    const voiceToken = await request(h, `/api/v2/rooms/${room.roomCode}/voice/token`, post({ requestId: 'victim-voice', gameId }), victimUser);
    expect(voiceToken.status).toBe(200);
    await h.app.drain();
    expect(voice.issued.some((item) => item.roomName === gameId)).toBe(true);
    const voiceBody = await voiceToken.json() as { token: string };
    expect(voiceBody.token.startsWith('pub:')).toBe(true);

    const endSpeech = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'victim-end-election-speech', gameId, action: 'END_ELECTION_SPEECH', windowInstanceId: speech.instanceId }), victimUser);
    expect(await endSpeech.json()).toMatchObject({ requestId: 'victim-end-election-speech', status: 'accepted' });
    await advanceThroughElectionVote(h, room.roomId);
    const vote = runtime.driver!.windows().find((window) => window.id === 'election_vote')!;
    const otherVoter = state.players.find((player) => player.playerId !== victim.playerId && player.life === 'alive')!;
    const otherUser = playerUser(h, room.roomId, otherVoter.playerId);
    const victimVote = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'victim-vote', gameId, action: 'SUBMIT_ELECTION_VOTE', windowInstanceId: vote.instanceId, targets: [victim.playerId] }), victimUser);
    expect(await victimVote.json()).toMatchObject({ status: 'accepted' });
    const otherVote = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'other-vote', gameId, action: 'SUBMIT_ELECTION_VOTE', windowInstanceId: vote.instanceId, targets: [victim.playerId] }), otherUser);
    expect(await otherVote.json()).toMatchObject({ status: 'accepted' });
    const beforeAnnouncement = await (await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[13])).json() as Record<string, any>;
    expect(beforeAnnouncement.public.seats.find((seat: any) => seat.playerId === victim.playerId)).toMatchObject({ alive: true });
    expect(beforeAnnouncement.private).toBeNull();
    expect(JSON.stringify(beforeAnnouncement)).not.toContain('votes');
    h.clock.advance(Math.max(0, vote.closesAt - h.clock.now()));
    await stable.enqueue(() => undefined);
    await waitFor(() => stable.runtime!.state!.day?.step !== 'election');

    for (let guard = 0; guard < 10 && stable.runtime!.state!.phase !== 'morning'; guard += 1) {
      const windows = stable.runtime!.driver!.windows();
      if (!windows.length) { await stable.enqueue(() => undefined); continue; }
      h.clock.advance(Math.max(0, Math.min(...windows.map((window) => window.closesAt)) - h.clock.now()));
      await stable.enqueue(() => undefined);
    }
    const victimAfter = await (await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, victimUser)).json() as Record<string, any>;
    const publicAfter = await (await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[13])).json() as Record<string, any>;
    expect(publicAfter.public.seats.find((seat: any) => seat.playerId === victim.playerId)).toMatchObject({ alive: false });
    expect(victimAfter.private.self).toMatchObject({ playerId: victim.playerId, life: 'dead' });
    expect(publicAfter.private).toBeNull();
  });
});
