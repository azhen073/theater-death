import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, enter, json, makeHarness, post, request, type HttpHarness, type User } from './contract-http-utils.ts';

afterEach(closeHarnesses);

async function fullStart(h: HttpHarness) {
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'release-create' }), h.users[0]);
  expect(created.status).toBe(201);
  const room = await json(created) as { roomId: string; roomCode: string };
  for (let index = 1; index < 13; index += 1) expect((await enter(h, room.roomCode, h.users[index]!, `release-enter-${index}`)).response.status).toBe(200);
  for (let index = 0; index < 13; index += 1) expect((await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `release-ready-${index}`, ready: true }), h.users[index])).status).toBe(200);
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'release-start' }), h.users[0]);
  expect(started.status).toBe(200);
  return { room, gameId: (await json(started)).gameId as string };
}

function playerUser(h: HttpHarness, roomId: string, playerId: string): User {
  const room = h.app.directory.byId.get(roomId)!;
  const participant = [...room.participants.values()].find((seat) => seat.playerId === playerId)!;
  return h.users.find((user) => user.userId === participant.userId)!;
}

async function waitWindow(h: HttpHarness, roomId: string, id: string): Promise<{ instanceId: string; closesAt: number }> {
  const room = h.app.directory.byId.get(roomId)!;
  for (let guard = 0; guard < 120; guard += 1) {
    const window = room.runtime?.driver?.windows().find((candidate) => candidate.id === id);
    if (window) return window as { instanceId: string; closesAt: number };
    const windows = room.runtime?.driver?.windows() ?? [];
    if (!windows.length) { await room.enqueue(() => undefined); continue; }
    h.clock.advance(Math.max(0, Math.min(...windows.map((candidate) => candidate.closesAt)) - h.clock.now()));
    await room.enqueue(() => undefined);
  }
  throw new Error(`window ${id} did not open`);
}

async function sendCommand(h: HttpHarness, roomCode: string, user: User, body: Record<string, unknown>) {
  const response = await request(h, `/api/v2/rooms/${roomCode}/command`, post(body), user);
  expect(response.status).toBe(200);
  const receipt = await json(response);
  expect(receipt).toMatchObject({ requestId: body.requestId, status: 'accepted' });
  return receipt;
}

async function finishCurrentWindow(h: HttpHarness, roomId: string): Promise<void> {
  const room = h.app.directory.byId.get(roomId)!;
  const windows = room.runtime?.driver?.windows() ?? [];
  if (windows.length) h.clock.advance(Math.max(0, Math.min(...windows.map((window) => window.closesAt)) - h.clock.now()));
  await room.enqueue(() => undefined);
}

describe('v2 release HTTP non-terminal election, elimination, and handover flow', () => {
  it('runs two real nights with elected civilian天理, public speech/放逐, and both required handovers', async () => {
    const h = await makeHarness();
    const { room, gameId } = await fullStart(h);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const runtime = stable.runtime!;
    const initial = runtime.state!;
    const civilians = initial.players.filter((player) => player.roleId === 'civilian' && player.life === 'alive');
    expect(civilians.length).toBeGreaterThanOrEqual(3);
    const candidate = civilians[0]!;
    const successor = civilians[1]!;
    const third = civilians[2]!;
    const candidateUser = playerUser(h, room.roomId, candidate.playerId);
    const successorUser = playerUser(h, room.roomId, successor.playerId);
    const thirdUser = playerUser(h, room.roomId, third.playerId);

    const signup = await waitWindow(h, room.roomId, 'election_signup');
    await sendCommand(h, room.roomCode, candidateUser, { requestId: 'release-candidacy', gameId, action: 'REGISTER_CANDIDACY', windowInstanceId: signup.instanceId });
    const electionPrepare = await waitWindow(h, room.roomId, 'speech_prepare');
    await sendCommand(h, room.roomCode, candidateUser, { requestId: 'release-election-start', gameId, action: 'START_SPEECH', windowInstanceId: electionPrepare.instanceId });
    const electionSpeech = await waitWindow(h, room.roomId, 'election_speech');
    await sendCommand(h, room.roomCode, candidateUser, { requestId: 'release-election-end', gameId, action: 'END_ELECTION_SPEECH', windowInstanceId: electionSpeech.instanceId });
    const electionVote = await waitWindow(h, room.roomId, 'election_vote');
    for (const player of stable.runtime!.state!.players.filter((item) => item.life !== 'dead')) {
      await sendCommand(h, room.roomCode, playerUser(h, room.roomId, player.playerId), { requestId: `release-election-vote-${player.playerId}`, gameId, action: 'SUBMIT_ELECTION_VOTE', windowInstanceId: electionVote.instanceId, targets: [candidate.playerId] });
    }
    expect(stable.runtime!.state!.sheriff.holderId).toBe(candidate.playerId);
    expect(stable.runtime!.state!.win).toBeNull();

    const speechOrder = await waitWindow(h, room.roomId, 'speech_order');
    await sendCommand(h, room.roomCode, candidateUser, { requestId: 'release-designate-speech', gameId, action: 'DESIGNATE_SPEECH', windowInstanceId: speechOrder.instanceId, targets: [successor.playerId], direction: 'asc' });
    while (stable.runtime!.driver!.windows().some((window) => window.id === 'speech_round')) {
      const day = stable.runtime!.state!.day!;
      const speakerId = day.speechRound!.order[day.speechRound!.index]!;
      const speech = stable.runtime!.driver!.windows().find((window) => window.id === 'speech_round')!;
      await sendCommand(h, room.roomCode, playerUser(h, room.roomId, speakerId), { requestId: `release-speech-${day.speechRound!.index}`, gameId, action: 'END_SPEECH', windowInstanceId: speech.instanceId });
    }
    const dayVote = await waitWindow(h, room.roomId, 'vote');
    for (const player of stable.runtime!.state!.players.filter((item) => item.life !== 'dead')) {
      await sendCommand(h, room.roomCode, playerUser(h, room.roomId, player.playerId), { requestId: `release-day-vote-${player.playerId}`, gameId, action: 'SUBMIT_DAY_VOTE', windowInstanceId: dayVote.instanceId, targets: [candidate.playerId] });
    }
    expect(stable.runtime!.state!.players.find((player) => player.playerId === candidate.playerId)?.life).toBe('dead');
    expect(stable.runtime!.state!.win).toBeNull();
    expect((await enter(h, room.roomCode, h.users[13]!, 'release-public-observer')).response.status).toBe(200);
    const firstPublicView = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[13]));
    expect(firstPublicView.public.seats.find((seat: any) => seat.playerId === candidate.playerId)).toMatchObject({ alive: false });
    const firstLastWords = await waitWindow(h, room.roomId, 'last_words');
    await sendCommand(h, room.roomCode, candidateUser, { requestId: 'release-first-last-words', gameId, action: 'END_LAST_WORDS', windowInstanceId: firstLastWords.instanceId });
    const firstHandover = await waitWindow(h, room.roomId, 'handover');
    expect(stable.runtime!.driver!.windows().some((window) => window.id === 'speech_round')).toBe(false);
    await sendCommand(h, room.roomCode, candidateUser, { requestId: 'release-first-handover', gameId, action: 'SUBMIT_HANDOVER', windowInstanceId: firstHandover.instanceId, targets: [successor.playerId] });
    expect(stable.runtime!.state!.sheriff.holderId).toBe(successor.playerId);
    expect(stable.runtime!.state!.win).toBeNull();

    for (let guard = 0; guard < 100 && stable.runtime!.state!.phase !== 'night'; guard += 1) await finishCurrentWindow(h, room.roomId);
    expect(stable.runtime!.state!.phase).toBe('night');
    const secondRuntime = stable.runtime!;
    const secondGameId = secondRuntime.gameId;
    const death = secondRuntime.state!.players.find((player) => player.roleId === 'death')!;
    const spirits = secondRuntime.state!.players.filter((player) => player.roleId === 'spirit' && player.life !== 'dead');
    const deathUser = playerUser(h, room.roomId, death.playerId);
    const faction = await waitWindow(h, room.roomId, 'faction');
    await sendCommand(h, room.roomCode, deathUser, { requestId: 'release-night-two-kill', gameId: secondGameId, action: 'EDIT_PROPOSAL', windowInstanceId: faction.instanceId, targets: [successor.playerId] });
    for (const spirit of spirits) await sendCommand(h, room.roomCode, playerUser(h, room.roomId, spirit.playerId), { requestId: `release-night-two-empty-${spirit.playerId}`, gameId: secondGameId, action: 'EDIT_PROPOSAL', windowInstanceId: faction.instanceId, targets: [] });

    let sawLastWords = false;
    let sawHandover = false;
    for (let guard = 0; guard < 120 && !sawHandover; guard += 1) {
      const windows = secondRuntime.driver!.windows();
      sawLastWords ||= windows.some((window) => window.id === 'last_words');
      const handover = windows.find((window) => window.id === 'handover');
      if (handover) { sawHandover = true; break; }
      if (!windows.length) { await stable.enqueue(() => undefined); continue; }
      h.clock.advance(Math.max(0, Math.min(...windows.map((window) => window.closesAt)) - h.clock.now()));
      await stable.enqueue(() => undefined);
    }
    expect(sawLastWords).toBe(false);
    expect(sawHandover).toBe(true);
    expect(stable.runtime!.state!.players.find((player) => player.playerId === successor.playerId)?.life).toBe('dead');
    expect(stable.runtime!.state!.win).toBeNull();
    const secondPublicView = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[13]));
    expect(secondPublicView.public.seats.find((seat: any) => seat.playerId === successor.playerId)).toMatchObject({ alive: false });
    const deathsAnnouncement = [...secondPublicView.public.events].reverse().find((event: any) => event.type === 'deaths_announced');
    expect(deathsAnnouncement?.payload?.seats).toContain(successor.seat);
    const secondHandover = secondRuntime.driver!.windows().find((window) => window.id === 'handover')!;
    expect(secondRuntime.driver!.windows().some((window) => window.id === 'speech_round')).toBe(false);
    await sendCommand(h, room.roomCode, successorUser, { requestId: 'release-second-handover', gameId: secondGameId, action: 'SUBMIT_HANDOVER', windowInstanceId: secondHandover.instanceId, targets: [third.playerId] });
    expect(stable.runtime!.state!.sheriff.holderId).toBe(third.playerId);
    expect(stable.runtime!.state!.win).toBeNull();
    expect(stable.runtime!.gameId).toBe(gameId);
    void thirdUser;
  });
});
