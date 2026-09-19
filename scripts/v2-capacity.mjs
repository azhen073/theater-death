import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const base = process.env.BASE_URL ?? 'http://load-app:3000';
const fixturePath = process.env.FIXTURE_PATH ?? '/app/test-results-v2/load-fixture.json';
const resultPath = process.env.RESULT_PATH ?? '/app/test-results-v2/capacity.json';
const durationMs = Number(process.env.DURATION_MS ?? 5 * 60_000);
if (!Number.isSafeInteger(durationMs) || durationMs < 1000) throw new Error('DURATION_MS must be an integer >=1000');
const intervalMs = 2_500;
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const accounts = fixture.accounts;
if (!Array.isArray(accounts) || accounts.length < 100) throw new Error('fixture must contain 100 accounts');

const stats = { startedAt: new Date().toISOString(), durationMs, http: [], errors: [], receiptMismatches: 0, socketErrors: 0, privacyViolations: 0, selfViolations: 0, sockets: 0, socketConnected: 0, socketDisconnected: 0 };
const sockets = [];
const clients = [];
const diagnosticsSamples = [];
let sampler = null;
let cleanupStarted = false;
let loadStartedAt = null;
let observedDurationMs = 0;
let activeBeforeCleanup = 0;
let minActiveDuringLoad = Number.POSITIVE_INFINITY;
const recordError = (message, detail = {}) => { stats.errors.push({ message, ...detail }); };
const jsonRequest = async (account, path, init = {}, metric = false) => {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('cookie', account.cookie);
  const started = performance.now();
  try {
    const response = await fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(10_000) });
    let body = null;
    try { body = await response.json(); } catch { /* reported below */ }
    const elapsedMs = performance.now() - started;
    if (metric) stats.http.push({ elapsedMs, status: response.status, method: init.method ?? 'GET', path });
    if (response.status >= 500) recordError('http_5xx', { status: response.status, path });
    if (response.status < 200 || response.status >= 300) recordError('http_unexpected_status', { status: response.status, path });
    if (body === null) recordError('http_missing_json', { status: response.status, path });
    return { response, body, elapsedMs };
  } catch (error) {
    if (metric) stats.http.push({ elapsedMs: performance.now() - started, status: 599, method: init.method ?? 'GET', path });
    recordError('http_network_error', { path, error: String(error) });
    return { response: null, body: null, elapsedMs: performance.now() - started };
  }
};
const post = (account, path, body, metric = false) => jsonRequest(account, path, { method: 'POST', body: JSON.stringify(body) }, metric);
const expectOk = async (account, path, body, expected = 200) => {
  const result = await post(account, path, body);
  if (!result.response || result.response.status !== expected) throw new Error(`${path} returned ${result.response?.status ?? 'network error'}: ${JSON.stringify(result.body)}`);
  return result.body;
};

const createRoom = async (players) => {
  const created = await expectOk(players[0], '/api/v2/rooms', { requestId: randomUUID() }, 201);
  if (created.gameId !== null || created.playerId !== null) throw new Error('lobby allocated game identity prematurely');
  for (const player of players.slice(1)) {
    await expectOk(player, `/api/v2/rooms/${created.roomCode}/enter`, { requestId: randomUUID() });
  }
  for (const player of players) await expectOk(player, `/api/v2/rooms/${created.roomCode}/ready`, { requestId: randomUUID(), ready: true });
  const started = await expectOk(players[0], `/api/v2/rooms/${created.roomCode}/start`, { requestId: randomUUID() });
  for (const player of players) {
    const { body } = await jsonRequest(player, `/api/v2/rooms/${created.roomCode}/view`);
    player.expectedPlayerId = body?.viewer?.subjectPlayerId;
    if (!player.expectedPlayerId || body?.private?.self?.nickname !== player.nickname) throw new Error('started player identity mismatch');
  }
  return { ...created, gameId: started.gameId };
};

const validateView = (client, body) => {
  if (!body || typeof body !== 'object') return;
  if (!client.player) {
    if (body.private !== null || (body.capabilities?.allowedCommands?.length ?? 0) !== 0 || body.capabilities?.canPublishVoice || body.capabilities?.canPostPublic || body.capabilities?.canPostFaction || body.chat?.faction?.length || body.submissionState?.length || body.tasks?.length) stats.privacyViolations += 1;
    return;
  }
  if (body.private?.self?.playerId !== client.account.expectedPlayerId) stats.selfViolations += 1;
  for (const messages of Object.values(body.chat ?? {})) {
    const ids = new Set(), intents = new Set();
    for (const message of messages) {
      const intent = JSON.stringify([message.senderId, message.clientMessageId]);
      if (ids.has(message.messageId) || intents.has(intent)) stats.receiptMismatches += 1;
      ids.add(message.messageId); intents.add(intent);
    }
  }
};

try {
const { body: bootstrap } = await jsonRequest(accounts[0], '/api/v2/bootstrap');
if (bootstrap?.contractVersion !== '2.2') throw new Error('capacity client requires contract 2.2');
const room1 = await createRoom(accounts.slice(0, 13));
const room2 = await createRoom(accounts.slice(13, 26));
const rooms = [room1, room2];
for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
  const room = rooms[roomIndex];
  for (const spectator of accounts.slice(26 + roomIndex * 12, 38 + roomIndex * 12)) {
    await expectOk(spectator, `/api/v2/rooms/${room.roomCode}/enter`, { requestId: randomUUID() });
  }
}

for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
  const room = rooms[roomIndex];
  const playerAccounts = accounts.slice(roomIndex * 13, roomIndex * 13 + 13);
  const spectatorAccounts = accounts.slice(26 + roomIndex * 12, 38 + roomIndex * 12);
  for (const account of [...playerAccounts, ...spectatorAccounts]) {
    const socket = io(base, { path: '/api/v2/socket.io', auth: { roomId: room.roomId }, extraHeaders: { cookie: account.cookie }, reconnection: false, timeout: 10_000 });
    const client = { room, account, player: playerAccounts.includes(account), lastCommand: 0, lastChat: 0, submittedWindows: new Set() };
    socket.on('connect_error', (error) => { stats.socketErrors += 1; recordError('socket_connect_error', { error: String(error) }); });
    socket.on('error', (error) => { stats.socketErrors += 1; recordError('socket_error', { error: String(error) }); });
    socket.on('connect', () => { stats.socketConnected += 1; });
    socket.on('disconnect', (reason) => {
      stats.socketDisconnected += 1;
      if (!cleanupStarted) { stats.socketErrors += 1; recordError('socket_disconnected_during_load', { reason }); }
    });
    socket.on('view_updated', (view) => validateView(client, view));
    sockets.push(socket);
    clients.push(client);
  }
}
await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => {
  if (socket.connected) { resolve(); return; }
  socket.once('connect', resolve);
  socket.once('connect_error', reject);
})));
stats.sockets = sockets.length;

const sampleDiagnostics = async () => {
  const sample = await jsonRequest(accounts[0], '/api/v2/diagnostics', {}, false);
  const rss = Number(sample.body?.rss);
  const eventLoopP99Ms = Number(sample.body?.eventLoopP99Ms);
  if (!Number.isFinite(rss) || !Number.isFinite(eventLoopP99Ms)) recordError('diagnostics_invalid', { body: sample.body });
  else diagnosticsSamples.push({ at: new Date().toISOString(), rss, eventLoopP99Ms });
};
await sampleDiagnostics();
sampler = setInterval(() => { void sampleDiagnostics(); }, 10_000);

const tick = async () => {
  const active = sockets.filter((socket) => socket.connected).length;
  minActiveDuringLoad = Math.min(minActiveDuringLoad, active);
  if (active < sockets.length) recordError('active_socket_floor_breached', { active, expected: sockets.length });
  await Promise.all(clients.map(async (client) => {
    const result = await jsonRequest(client.account, `/api/v2/rooms/${client.room.roomCode}/view`, {}, true);
    if (!result.body) return;
    validateView(client, result.body);
    if (!client.player) return;
    if (result.body.capabilities?.canPostPublic && Date.now() - client.lastChat >= 30_000) {
      const payload = { gameId: client.room.gameId, clientMessageId: randomUUID(), channel: 'public', text: `capacity-${client.account.uid}` };
      const first = await post(client.account, `/api/v2/rooms/${client.room.roomCode}/chat`, payload, true);
      const second = await post(client.account, `/api/v2/rooms/${client.room.roomCode}/chat`, payload, true);
      if (JSON.stringify(first.body) !== JSON.stringify(second.body) || !first.body?.message?.messageId) stats.receiptMismatches += 1;
      client.lastChat = Date.now();
    }
    if (Date.now() - client.lastCommand < 7_500) return;
    const allowed = result.body.capabilities?.allowedCommands ?? [];
    const candidates = [
      ['SUBMIT_DAY_VOTE', 'vote'], ['SUBMIT_ELECTION_VOTE', 'election_vote'], ['SUBMIT_HANDOVER', 'handover'],
      ['EDIT_PROPOSAL', 'faction'], ['START_SPEECH', 'speech_prepare'], ['END_SPEECH', 'speech_round'],
    ];
    const choice = candidates.find(([action, windowId]) => allowed.includes(action) && result.body.windows?.some((item) => item.id === windowId && item.closesAt > result.body.serverTime));
    const action = choice?.[0];
    const window = choice && result.body.windows.find((item) => item.id === choice[1] && item.closesAt > result.body.serverTime);
    if (!window || !action || client.submittedWindows.has(window.instanceId)) return;
    client.lastCommand = Date.now();
    client.submittedWindows.add(window.instanceId);
    const requestId = `capacity-${client.account.uid}-${Date.now()}`;
    const payload = { requestId, gameId: client.room.gameId, action, windowInstanceId: window.instanceId, targets: [] };
    const first = await post(client.account, `/api/v2/rooms/${client.room.roomCode}/command`, payload, true);
    if (action === 'START_SPEECH' || action === 'END_SPEECH') {
      const second = await post(client.account, `/api/v2/rooms/${client.room.roomCode}/command`, payload, true);
      if (JSON.stringify(first.body) !== JSON.stringify(second.body)) stats.receiptMismatches += 1;
    }
  }));
};

loadStartedAt = Date.now();
const deadline = loadStartedAt + durationMs;
while (Date.now() < deadline) {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
}
} catch (error) {
  recordError('setup_or_load_failed', { error: String(error) });
} finally {
  observedDurationMs = loadStartedAt === null ? 0 : Date.now() - loadStartedAt;
  activeBeforeCleanup = sockets.filter((socket) => socket.connected).length;
  if (sampler) clearInterval(sampler);
  cleanupStarted = true;
  for (const socket of sockets) socket.disconnect();
}
const sorted = stats.http.map((item) => item.elapsedMs).sort((a, b) => a - b);
const percentile = (values, p) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : null;
const report = {
  startedAt: stats.startedAt,
  finishedAt: new Date().toISOString(),
  durationMs,
  observedDurationMs,
  contractVersion: '2.2',
  clients: { accounts: 100, activeSockets: stats.sockets, rooms: 2, players: 26, publicSpectators: 24 },
  ordinaryApi: { samples: sorted.length, p95Ms: percentile(sorted, 0.95), excluded: ['/healthz', '/api/v2/auth/login', '/api/v2/diagnostics'] },
  diagnostics: diagnosticsSamples.length ? { samples: diagnosticsSamples.length, peakRss: Math.max(...diagnosticsSamples.map((sample) => sample.rss)), maxEventLoopP99Ms: Math.max(...diagnosticsSamples.map((sample) => sample.eventLoopP99Ms)) } : null,
  sockets: { created: sockets.length, connected: stats.socketConnected, disconnectedIncludingCleanup: stats.socketDisconnected, activeAtEnd: activeBeforeCleanup, minActiveDuringLoad: Number.isFinite(minActiveDuringLoad) ? minActiveDuringLoad : 0 },
  errors: { count: stats.errors.length, http5xxOrNetwork: stats.errors.filter((e) => e.message === 'http_5xx' || e.message === 'http_network_error').length, unexpectedHttp: stats.errors.filter((e) => e.message.startsWith('http_')).length, socket: stats.socketErrors, receiptMismatches: stats.receiptMismatches, privacyViolations: stats.privacyViolations, selfViolations: stats.selfViolations, samples: stats.errors.slice(0, 20) },
  thresholds: { ordinaryApiP95Ms: 300, eventLoopP99Ms: 100, rssBytes: 1_000_000_000 },
};
await mkdir(dirname(resultPath), { recursive: true });
await writeFile(resultPath, JSON.stringify(report, null, 2));
const failed = observedDurationMs < durationMs || report.ordinaryApi.p95Ms === null || report.ordinaryApi.p95Ms >= 300 || report.errors.count > 0 || report.errors.http5xxOrNetwork > 0 || report.errors.unexpectedHttp > 0 || report.errors.socket > 0 || report.errors.receiptMismatches > 0 || report.errors.privacyViolations > 0 || report.errors.selfViolations > 0 || report.sockets.minActiveDuringLoad < 50 || !report.diagnostics || !Number.isFinite(report.diagnostics.maxEventLoopP99Ms) || !Number.isFinite(report.diagnostics.peakRss) || report.diagnostics.maxEventLoopP99Ms >= 100 || report.diagnostics.peakRss >= 1_000_000_000;
if (failed) process.exitCode = 1;
