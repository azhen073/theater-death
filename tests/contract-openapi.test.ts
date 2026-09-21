import { afterEach, describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { closeHarnesses, connectRoom, enter, json, makeHarness, post, request, waitFor, type HttpHarness } from './contract-http-utils.ts';

const openapi = JSON.parse(readFileSync(new URL('../docs/openapi-v2.2.json', import.meta.url), 'utf8')) as { components: { schemas: Record<string, any> } };
const ajv = new Ajv2020({ strict: true });
const exportedFixtures: Array<{ file: string; schema: string; endpoint: string; scenario: string }> = [];
const fixtureRoot = process.env.EXPORT_CONTRACT_FIXTURES;

async function exportFixture(file: string, schema: string, endpoint: string, scenario: string, payload: unknown): Promise<void> {
  if (!fixtureRoot) return;
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(`${fixtureRoot}/${file}`, JSON.stringify(payload, null, 2) + '\n');
  exportedFixtures.push({ file, schema, endpoint, scenario });
  await writeFile(`${fixtureRoot}/index.json`, JSON.stringify(exportedFixtures, null, 2) + '\n');
}

function refs(value: any): any {
  if (Array.isArray(value)) return value.map(refs);
  if (!value || typeof value !== 'object') return value;
  const output = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, refs(child)]));
  if (typeof value.$ref === 'string' && value.$ref.startsWith('#/components/schemas/')) output.$ref = `#/$defs/${value.$ref.slice('#/components/schemas/'.length)}`;
  return output;
}

function validator(schema: any) {
  return ajv.compile({ $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: refs(openapi.components.schemas), ...refs(schema) });
}

function assertSchema(schema: any, payload: unknown, label: string): void {
  const check = validator(schema);
  expect(check(payload), `${label}: ${JSON.stringify(check.errors)}`).toBe(true);
}

function responseSchema(path: string, method: 'get' | 'post', status: string) {
  return (openapi as any).paths[path][method].responses[status].content['application/json'].schema;
}

async function startFull(h: HttpHarness) {
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'contract-create' }), h.users[0]);
  expect(created.status).toBe(201);
  const room = await json(created) as { roomId: string; roomCode: string };
  assertSchema(responseSchema('/rooms', 'post', '201'), room, 'room entry');
  for (let index = 1; index < 13; index += 1) {
    const entered = await enter(h, room.roomCode, h.users[index]!, `contract-enter-${index}`);
    expect(entered.response.status).toBe(200);
  }
  for (let index = 0; index < 13; index += 1) {
    const ready = await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `contract-ready-${index}`, ready: true }), h.users[index]);
    expect(ready.status).toBe(200);
  }
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'contract-start' }), h.users[0]);
  expect(started.status).toBe(200);
  const startedBody = await json(started);
  if (typeof startedBody.gameId !== 'string') throw new Error('missing gameId');
  return { room, gameId: startedBody.gameId };
}

describe('client contract OpenAPI verification', () => {
  afterEach(closeHarnesses);

  it('validates every committed contract fixture against its declared schema', () => {
    const indexFiles = ['manual-fragments-index.json', 'full-index.json'];
    const indexes = indexFiles.flatMap((file) => JSON.parse(readFileSync(new URL(`./fixtures/contract-2.1/${file}`, import.meta.url), 'utf8')) as Array<{ file: string; schema: string; endpoint: string; scenario: string }>);
    expect(indexes.length).toBeGreaterThanOrEqual(8);
    const fullNames = new Set(indexes.filter((fixture) => fixture.file.endsWith('-full.json')).map((fixture) => fixture.file));
    for (const required of ['lobby-formal-full.json', 'lobby-observer-full.json', 'night-door-full.json', 'night-spirit-full.json', 'started-public-observer-full.json', 'private-second-screen-full.json', 'day-election-full.json', 'post-review-lobby-full.json']) expect(fullNames.has(required)).toBe(true);
    for (const fixture of indexes) {
      const payload = JSON.parse(readFileSync(new URL(`./fixtures/contract-2.1/${fixture.file}`, import.meta.url), 'utf8'));
      const schema = openapi.components.schemas[fixture.schema]
        ?? (fixture.schema === 'ChatAck' ? responseSchema('/rooms/{code}/chat', 'post', '201') : null)
        ?? (fixture.schema === 'ReviewWrapper' ? responseSchema('/rooms/{code}/review', 'get', '200') : null)
        ?? (fixture.schema === 'MeRooms' ? responseSchema('/me/rooms', 'get', '200') : null);
      if (!schema) throw new Error(`unknown fixture schema ${fixture.schema}`);
      assertSchema(schema, payload, `${fixture.endpoint} ${fixture.scenario}`);
    }
  });

  it('validates legacy and atomic proposal commands while rejecting incomplete or misplaced proposal options', () => {
    const check = validator(openapi.components.schemas.Command);
    const base = { requestId: 'schema-proposal', gameId: 'g1', windowInstanceId: 'w1', action: 'EDIT_PROPOSAL', targets: [] };
    expect(check(base)).toBe(true);
    expect(check({ ...base, confirmSelf: true, expectedRevision: 0 })).toBe(true);
    expect(check({ ...base, confirmSelf: true })).toBe(false);
    expect(check({ ...base, expectedRevision: 0 })).toBe(false);
    expect(check({ ...base, confirmSelf: false, expectedRevision: 0 })).toBe(false);
    expect(check({ ...base, action: 'SUBMIT_GUARD', confirmSelf: true, expectedRevision: 0 })).toBe(false);
  });

  it('validates anonymous catalog/auth/room/snapshot/realtime payloads against OpenAPI schemas', async () => {
    const h = await makeHarness();
    const bootstrap = await request(h, '/api/v2/bootstrap');
    const catalog = await request(h, '/api/v2/catalog');
    expect(bootstrap.status).toBe(200); expect(catalog.status).toBe(200);
    const bootstrapBody = await json(bootstrap); const catalogBody = await json(catalog);
    assertSchema(responseSchema('/bootstrap', 'get', '200'), bootstrapBody, 'bootstrap');
    assertSchema(responseSchema('/catalog', 'get', '200'), catalogBody, 'catalog');
    await exportFixture('bootstrap-full.json', 'Bootstrap', 'GET /api/v2/bootstrap', 'anonymous bootstrap', bootstrapBody);
    await exportFixture('catalog-full.json', 'Catalog', 'GET /api/v2/catalog', 'anonymous catalog', catalogBody);

    const me = await request(h, '/api/v2/auth/me', {}, h.users[0]);
    expect(me.status).toBe(200);
    const meBody = await json(me); assertSchema(responseSchema('/auth/me', 'get', '200'), meBody, 'auth me');
    await exportFixture('auth-me-full.json', 'AuthMe', 'GET /api/v2/auth/me', 'authenticated account', meBody);
    const lobby = await request(h, '/api/v2/rooms', post({ requestId: 'contract-lobby' }), h.users[0]);
    expect(lobby.status).toBe(201);
    const lobbyBody = await json(lobby);
    assertSchema(responseSchema('/rooms', 'post', '201'), lobbyBody, 'lobby entry');
    await exportFixture('lobby-entry-full.json', 'RoomEntry', 'POST /api/v2/rooms', 'formal lobby entry', lobbyBody);
    for (let index = 1; index < 13; index += 1) {
      const entered = await enter(h, lobbyBody.roomCode, h.users[index]!, `contract-lobby-fill-${index}`);
      expect(entered.response.status).toBe(200);
    }
    const lobbyView = await request(h, `/api/v2/rooms/${lobbyBody.roomCode}/view`, {}, h.users[0]);
    expect(lobbyView.status).toBe(200);
    const lobbyFormalBody = await json(lobbyView); assertSchema(responseSchema('/rooms/{code}/view', 'get', '200'), lobbyFormalBody, 'formal lobby snapshot');
    await exportFixture('lobby-formal-full.json', 'RoomSnapshot', 'GET /api/v2/rooms/{code}/view', 'formal lobby snapshot', lobbyFormalBody);
    const observer = await enter(h, lobbyBody.roomCode, h.users[13]!, 'contract-lobby-observer');
    expect(observer.response.status).toBe(200);
    expect(observer.body.kind).toBe('public_spectator');
    const observerView = await request(h, `/api/v2/rooms/${lobbyBody.roomCode}/view`, {}, h.users[13]);
    const lobbyObserverBody = await json(observerView); assertSchema(responseSchema('/rooms/{code}/view', 'get', '200'), lobbyObserverBody, 'lobby observer snapshot');
    await exportFixture('lobby-observer-full.json', 'RoomSnapshot', 'GET /api/v2/rooms/{code}/view', 'public observer lobby snapshot', lobbyObserverBody);
    const rooms = await request(h, '/api/v2/me/rooms', {}, h.users[0]);
    expect(rooms.status).toBe(200);
    const roomsBody = await json(rooms); assertSchema(responseSchema('/me/rooms', 'get', '200'), roomsBody, 'me rooms');
    await exportFixture('me-rooms-lobby-full.json', 'MeRooms', 'GET /api/v2/me/rooms', 'lobby current rooms', roomsBody);
  });

  it('validates started private/public/second-screen views, command receipt, chat acknowledgement, review, and Socket.IO frame', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startFull(h);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const roleUser = (roleId: string) => {
      const player = stable.runtime!.state!.players.find((candidate) => candidate.roleId === roleId)!;
      const participant = [...stable.participants.values()].find((seat) => seat.playerId === player.playerId)!;
      return h.users.find((user) => user.userId === participant.userId)!;
    };
    const doorUser = roleUser('door');
    const spiritUser = roleUser('spirit');
    const doorViewResponse = await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, doorUser);
    expect(doorViewResponse.status).toBe(200);
    const doorView = await json(doorViewResponse);
    assertSchema(responseSchema('/rooms/{code}/view', 'get', '200'), doorView, 'started door private view');
    expect(doorView.private?.self?.roleId).toBe('door');
    await exportFixture('night-door-full.json', 'RoomSnapshot', 'GET /api/v2/rooms/{code}/view', 'started door private snapshot', doorView);
    const spiritViewResponse = await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, spiritUser);
    const spiritView = await json(spiritViewResponse);
    assertSchema(responseSchema('/rooms/{code}/view', 'get', '200'), spiritView, 'started spirit private view');
    expect(spiritView.private?.self?.roleId).toBe('spirit');
    expect(spiritView.private?.proposal?.effective).toBeDefined();
    await exportFixture('night-spirit-full.json', 'RoomSnapshot', 'GET /api/v2/rooms/{code}/view', 'started spirit effective proposal snapshot', spiritView);
    const deathUser = roleUser('death');
    const deathViewResponse = await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, deathUser);
    expect(deathViewResponse.status).toBe(200);
    const deathView = await json(deathViewResponse);
    assertSchema(responseSchema('/rooms/{code}/view', 'get', '200'), deathView, 'started death private view');
    expect(deathView.private?.self?.roleId).toBe('death');
    expect(deathView.private?.knowledge?.spiritSeats?.length).toBeGreaterThan(0);
    await exportFixture('night-death-full.json', 'RoomSnapshot', 'GET /api/v2/rooms/{code}/view', 'started death knowledge snapshot', deathView);
    const observer = await enter(h, room.roomCode, h.users[13]!, 'contract-public-observer');
    expect(observer.response.status).toBe(200);
    const publicViewResponse = await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[13]);
    const publicView = await json(publicViewResponse);
    assertSchema(responseSchema('/rooms/{code}/view', 'get', '200'), publicView, 'started public observer view');
    expect(publicView.private).toBeNull();
    await exportFixture('started-public-observer-full.json', 'RoomSnapshot', 'GET /api/v2/rooms/{code}/view', 'started public observer snapshot', publicView);

    const inviteResponse = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/invitations`, post({ requestId: 'contract-invite', gameId }), doorUser);
    expect(inviteResponse.status).toBe(201);
    const invite = await json(inviteResponse);
    const redeemed = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/redeem`, post({ requestId: 'contract-redeem', gameId, token: invite.token }), h.users[14]);
    expect(redeemed.status).toBe(200);
    const privateScreenResponse = await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[14]);
    const privateScreen = await json(privateScreenResponse);
    assertSchema(responseSchema('/rooms/{code}/view', 'get', '200'), privateScreen, 'private second-screen view');
    expect(privateScreen.viewer.kind).toBe('private_spectator');
    expect(privateScreen.private).toBeTruthy();
    await exportFixture('private-second-screen-full.json', 'RoomSnapshot', 'GET /api/v2/rooms/{code}/view', 'private second-screen snapshot', privateScreen);

    const live = await connectRoom(h, doorUser, room.roomId);
    expect(live.views[0]).toBeDefined();
    assertSchema(responseSchema('/rooms/{code}/view', 'get', '200'), live.views[0], 'socket view frame');
    await exportFixture('socket-full-snapshot.json', 'RoomSnapshot', 'Socket.IO view_updated', 'started private Socket.IO snapshot', live.views[0]);

    const command = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'contract-command', gameId, action: 'END_SPEECH', windowInstanceId: 'contract-window' }), doorUser);
    expect(command.status).toBe(200);
    const commandBody = await json(command); assertSchema(responseSchema('/rooms/{code}/command', 'post', '200'), commandBody, 'command receipt');
    await exportFixture('command-receipt-full.json', 'CommandReceipt', 'POST /api/v2/rooms/{code}/command', 'started command receipt', commandBody);

    const lookup = await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/contract-command`, {}, doorUser);
    expect(lookup.status).toBe(200);
    const lookupBody = await json(lookup); assertSchema(responseSchema('/rooms/{code}/games/{gameId}/receipts/{requestId}', 'get', '200'), lookupBody, 'receipt lookup');
    await exportFixture('receipt-lookup-full.json', 'ReceiptLookup', 'GET /api/v2/rooms/{code}/games/{gameId}/receipts/{requestId}', 'started receipt lookup', lookupBody);
    for (let guard = 0; guard < 100 && stable.runtime?.state?.phase === 'night'; guard += 1) {
      const windows = stable.runtime.driver?.windows() ?? [];
      if (windows.length === 0) { await stable.enqueue(() => undefined); continue; }
      h.clock.advance(Math.max(0, Math.min(...windows.map((window) => window.closesAt)) - h.clock.now()));
      await stable.enqueue(() => undefined);
    }
    expect(stable.runtime?.state?.phase).toBe('day');
    const dayView = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, doorUser));
    assertSchema(responseSchema('/rooms/{code}/view', 'get', '200'), dayView, 'day election snapshot');
    await exportFixture('day-election-full.json', 'RoomSnapshot', 'GET /api/v2/rooms/{code}/view', 'day election snapshot', dayView);
    const chat = await request(h, `/api/v2/rooms/${room.roomCode}/chat`, post({ gameId, channel: 'public', clientMessageId: 'contract-chat', text: 'contract message' }), doorUser);
    expect(chat.status).toBe(201);
    const chatBody = await json(chat); assertSchema(responseSchema('/rooms/{code}/chat', 'post', '201'), chatBody, 'chat acknowledgement');
    await exportFixture('chat-ack-full.json', 'ChatAck', 'POST /api/v2/rooms/{code}/chat', 'public chat acknowledgement', chatBody);
    stable.runtime!.state = { ...stable.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'constructed_contract_review' } };
    stable.recordCompletion();
    const review = await request(h, `/api/v2/rooms/${room.roomCode}/review`, {}, doorUser);
    expect(review.status).toBe(200);
    const reviewBody = await json(review); assertSchema(responseSchema('/rooms/{code}/review', 'get', '200'), reviewBody, 'constructed review');
    await exportFixture('review-constructed-full.json', 'ReviewWrapper', 'GET /api/v2/rooms/{code}/review', 'constructed review (not a real gameplay chain)', reviewBody);
    const revoke = await request(h, `/api/v2/rooms/${room.roomCode}/second-screen/revoke`, post({ requestId: 'contract-revoke', gameId }), doorUser);
    expect(revoke.status).toBe(200);
    const publicAgain = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, h.users[14]));
    expect(publicAgain.viewer.kind).toBe('public_spectator');
    expect(publicAgain.private).toBeNull();
    const ended = await request(h, `/api/v2/rooms/${room.roomCode}/end-review`, post({ requestId: 'contract-end-review', gameId }), h.users[0]);
    expect(ended.status).toBe(200);
    const lobbyAgain = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, doorUser));
    expect(lobbyAgain.room.phase).toBe('lobby');
    assertSchema(responseSchema('/rooms/{code}/view', 'get', '200'), lobbyAgain, 'post-review lobby snapshot');
    await exportFixture('post-review-lobby-full.json', 'RoomSnapshot', 'GET /api/v2/rooms/{code}/view', 'lobby after end-review', lobbyAgain);
    const roomsAfter = await json(await request(h, '/api/v2/me/rooms', {}, h.users[0]));
    assertSchema(responseSchema('/me/rooms', 'get', '200'), roomsAfter, 'post-review me rooms');
    await exportFixture('me-rooms-post-review-full.json', 'MeRooms', 'GET /api/v2/me/rooms', 'rooms after end-review', roomsAfter);
    live.socket.disconnect();
  });
});
