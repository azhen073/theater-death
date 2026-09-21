// 容量验收：13 个 API 机器人、正式板（真实时长）完整日夜循环（D1 夜 → D2 夜）。
// 记录阶段里程碑、命令延迟分位与拒绝分类；结果写入 results/。
// 运行：docker compose --env-file deploy/e2e.env --profile e2e run --rm e2e node capacity.mjs

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const STUCK_WINDOW_MS = 15 * 60 * 1000;

let requestSeq = 0;

async function request(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookieList =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const rawSetCookie = setCookieList[0] ?? res.headers.get('set-cookie');
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json, cookie: rawSetCookie?.split(';')[0] ?? null };
}

async function command(client, action, extra = {}) {
  requestSeq += 1;
  const started = performance.now();
  const res = await request('/api/command', {
    method: 'POST',
    body: { requestId: `cap-${Date.now()}-${requestSeq}`, action, ...extra },
    cookie: client.cookie,
  });
  const latency = performance.now() - started;
  return { status: res.status, json: res.json, latency };
}

function botAction(view, self) {
  const windows = new Set(view.windows.map((w) => w.id));
  const alive = self.life === 'alive';
  const others = view.view.seats.filter((s) => s.alive && s.playerId !== self.playerId);
  const target = others[0]?.playerId ?? null;
  const candidateSeat = view.hints.candidateSeats[0];
  const candidateId =
    candidateSeat === undefined
      ? null
      : view.view.seats.find((s) => s.seat === candidateSeat)?.playerId ?? null;

  if (view.phase !== 'night' && view.phase !== 'day' && view.phase !== 'morning') return null;
  if (windows.has('faction') && (self.roleId === 'death' || self.roleId === 'spirit')) {
    if (view.proposal === null) return null;
    if (view.proposal.revision === 0) return target !== null ? ['EDIT_PROPOSAL', { targets: [target] }] : null;
    if (!view.proposal.confirmedBy.includes(self.playerId))
      return ['CONFIRM_PROPOSAL', { revision: view.proposal.revision }];
    return null;
  }
  if (windows.has('guard') && self.roleId === 'door')
    return ['SUBMIT_GUARD', { targets: target !== null ? [target] : [] }];
  if (windows.has('laike') && self.roleId === 'laike')
    return target !== null ? ['SUBMIT_LAIKE', { target }] : null;
  if (windows.has('check') && self.roleId === 'descender')
    return target !== null ? ['SUBMIT_CHECK', { target }] : null;
  if (windows.has('rescue') && self.roleId === 'water') return ['SUBMIT_RESCUE', { target: null }];
  if (windows.has('revive') && self.roleId === 'water') return ['SUBMIT_REVIVE', { target: null }];
  if (windows.has('last_words')) return ['END_LAST_WORDS', {}];
  if (windows.has('election_signup') && alive && self.seat <= 2) return ['REGISTER_CANDIDACY', {}];
  if (windows.has('election_speech')) return ['END_ELECTION_SPEECH', {}];
  if (windows.has('election_vote') || windows.has('election_revote'))
    return alive && self.seat > 2 ? ['SUBMIT_ELECTION_VOTE', { target: candidateId }] : null;
  if (windows.has('speech_order')) return null;
  if (windows.has('speech_round')) return ['END_SPEECH', {}];
  if (windows.has('tie_speech')) return ['END_TIE_SPEECH', {}];
  if (windows.has('vote') || windows.has('vote_revote'))
    return alive ? ['SUBMIT_DAY_VOTE', { target }] : null;
  if (windows.has('handover')) return ['SUBMIT_HANDOVER', { target: null }];
  return null;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[index] * 10) / 10;
}

const milestones = [];
const mark = (label, extra = {}) => {
  milestones.push({ label, at: Date.now(), ...extra });
  console.log(`[capacity] ${label}`, JSON.stringify(extra));
};

const startedAt = Date.now();
mark('开始建局');
const host = await request('/api/rooms', { method: 'POST', body: { nickname: '房主' } });
const roomCode = host.json.roomCode;
const clients = [{ playerId: host.json.playerId, cookie: host.cookie }];
for (let i = 2; i <= 13; i += 1) {
  const joined = await request(`/api/rooms/${roomCode}/join`, {
    method: 'POST',
    body: { nickname: `bot${i}` },
  });
  clients.push({ playerId: joined.json.playerId, cookie: joined.cookie });
}
for (const client of clients) {
  await request(`/api/rooms/${roomCode}/ready`, { method: 'POST', body: { ready: true }, cookie: client.cookie });
}
mark('13 人就绪');

const startRes = await request(`/api/rooms/${roomCode}/start`, {
  method: 'POST',
  body: {},
  cookie: host.cookie,
});
if (startRes.status !== 200) {
  throw new Error(`开局失败 ${startRes.status}: ${JSON.stringify(startRes.json)}`);
}
mark('开局');

const latencies = [];
let commands = 0;
let rejected = 0;
const rejectCodes = new Map();
let firstNightSeen = false;
let reachedSecondNight = false;
let maxDay = 0;

const viewOf = async (client) => (await request('/api/view', { cookie: client.cookie })).json;

while (Date.now() - startedAt < STUCK_WINDOW_MS) {
  for (const client of clients) {
    const view = await viewOf(client);
    if (view === null || view.phase === 'ended') {
      reachedSecondNight = true;
      break;
    }
    if (view.phase === 'night') {
      if (!firstNightSeen) {
        firstNightSeen = true;
        mark('首夜开始', { day: view.view.dayNumber });
      }
      if (view.view.dayNumber >= 2 && !reachedSecondNight) {
        reachedSecondNight = true;
        mark('到达第二夜（完整日夜循环完成）', { day: view.view.dayNumber });
        break;
      }
    }
    if (typeof view.view.dayNumber === 'number' && view.view.dayNumber > maxDay) {
      const prev = maxDay;
      maxDay = view.view.dayNumber;
      if (prev > 0) {
        mark('进入白天', { day: maxDay });
      }
    }
    const plan = botAction(view, view.view.self);
    if (plan !== null) {
      const [action, extra] = plan;
      const result = await command(client, action, extra);
      commands += 1;
      latencies.push(result.latency);
      if (result.json !== null && result.json.status === 'rejected') {
        rejected += 1;
        const code = result.json.code ?? 'unknown';
        rejectCodes.set(code, (rejectCodes.get(code) ?? 0) + 1);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (reachedSecondNight) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const finishedAt = Date.now();
const sorted = [...latencies].sort((a, b) => a - b);
const report = {
  roomCode,
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date(finishedAt).toISOString(),
  wallMs: finishedAt - startedAt,
  reachedSecondNight,
  commands,
  rejected,
  rejectCodes: Object.fromEntries(rejectCodes),
  latencyMs: {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length > 0 ? Math.round(sorted[sorted.length - 1] * 10) / 10 : null,
  },
  milestones: milestones.map((m) => ({ ...m, elapsedMs: m.at - startedAt })),
};

console.log('[capacity] 结果:', JSON.stringify(report, null, 2));
const fs = await import('node:fs');
fs.mkdirSync('results', { recursive: true });
const outPath = `results/capacity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log('[capacity] 已写入', outPath);
if (!reachedSecondNight) {
  process.exit(1);
}
