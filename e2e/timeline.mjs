// 完整对局时间线捕获：13 个 API 机器人按实验快板打完整局，保存终局复盘（含时间线）。
// 运行：docker compose --env-file deploy/e2e.env --profile e2e run --rm e2e node timeline.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

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
  return request('/api/command', {
    method: 'POST',
    body: { requestId: `tl-${Date.now()}-${requestSeq}`, action, ...extra },
    cookie: client.cookie,
  });
}

const FAST_BOARD = {
  rulesetId: 'e2e-fast',
  version: '1.0',
  mode: 'experimental',
  roles: { laike: 1, door: 1, water: 1, descender: 1, researcher: 1, civilian: 4, death: 1, spirit: 2, mourner: 1 },
  timersSeconds: { faction: 10, ability: 6, vote: 8, speech: 12, election: 10, handover: 8, lastWords: 8, tieSpeech: 8 },
  sheriff: { enabled: true, voteWeight: 1.5, handover: 'designate_or_destroy' },
  lastWords: { firstNight: true, dayEliminated: true, otherNights: false },
  teamConfirm: 'unanimous_by_revision',
  duplicateTargetPolicy: 'allow',
  attackOrder: 'seat_asc_then_source_priority',
  researcherAnnouncement: { count: 'alive_at_announcement', includesMourner: true },
  stageTriggerSnapshot: 'death_event',
  replayDisclosure: 'all_chat_and_action_log',
  stage1SpiritQuota: 'eligibleLivingSpiritCount',
  stage1DeathQuota: 2,
  stage1OverkillThreshold: 'initialSpiritCount',
  stage2JointQuota: 2,
  guardTargets: 2,
  guardBlocksPerTarget: 1,
  simultaneousWinPriority: 'death_faction',
  researcherCondition: 'currently_dead',
};

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
  if (windows.has('guard') && self.roleId === 'door') return ['SUBMIT_GUARD', { targets: target !== null ? [target] : [] }];
  if (windows.has('laike') && self.roleId === 'laike') return target !== null ? ['SUBMIT_LAIKE', { target }] : null;
  if (windows.has('check') && self.roleId === 'descender') return target !== null ? ['SUBMIT_CHECK', { target }] : null;
  if (windows.has('rescue') && self.roleId === 'water') return ['SUBMIT_RESCUE', { target: null }];
  if (windows.has('revive') && self.roleId === 'water') return ['SUBMIT_REVIVE', { target: null }];
  if (windows.has('last_words')) return ['END_LAST_WORDS', {}];
  if (windows.has('election_signup') && alive && self.seat <= 2) return ['REGISTER_CANDIDACY', {}];
  if (windows.has('election_speech')) return ['END_ELECTION_SPEECH', {}];
  if (windows.has('election_vote') || windows.has('election_revote'))
    return alive ? ['SUBMIT_ELECTION_VOTE', { target: candidateId }] : null;
  if (windows.has('speech_order')) return null;
  if (windows.has('speech_round')) return ['END_SPEECH', {}];
  if (windows.has('tie_speech')) return ['END_TIE_SPEECH', {}];
  if (windows.has('vote') || windows.has('vote_revote'))
    return alive ? ['SUBMIT_DAY_VOTE', { target }] : null;
  if (windows.has('handover')) return ['SUBMIT_HANDOVER', { target: null }];
  return null;
}

const startedAt = Date.now();
const host = await request('/api/rooms', { method: 'POST', body: { nickname: 'timeline', ruleset: FAST_BOARD } });
const roomCode = host.json.roomCode;
const gameId = (await request('/api/view', { cookie: host.cookie })).json.gameId;
const clients = [{ playerId: host.json.playerId, cookie: host.cookie }];
for (let i = 2; i <= 13; i += 1) {
  const joined = await request(`/api/rooms/${roomCode}/join`, { method: 'POST', body: { nickname: `bot${i}` } });
  clients.push({ playerId: joined.json.playerId, cookie: joined.cookie });
}
for (const client of clients) {
  await request(`/api/rooms/${roomCode}/ready`, { method: 'POST', body: { ready: true }, cookie: client.cookie });
}
await request(`/api/rooms/${roomCode}/start`, { method: 'POST', body: {}, cookie: host.cookie });

let ended = false;
const deadline = Date.now() + 360_000;
while (Date.now() < deadline && !ended) {
  for (const client of clients) {
    const view = (await request('/api/view', { cookie: client.cookie })).json;
    if (view === null || view.phase === 'ended') {
      ended = true;
      break;
    }
    const plan = botAction(view, view.view.self);
    if (plan !== null) {
      await command(client, plan[0], plan[1]);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ended) {
  throw new Error('对局未在时限内结束');
}

const review = (await request('/api/review', { cookie: host.cookie })).json.review;
const summary = {
  roomCode,
  gameId,
  wallMs: Date.now() - startedAt,
  endedAtDay: review.endedAtDay,
  winner: review.winner,
  reason: review.reason,
  players: review.players.map((p) => ({ seat: p.seat, nickname: p.nickname, roleId: p.roleId, life: p.life })),
  timelineLength: review.timeline.length,
  eventTypes: review.timeline.reduce((acc, entry) => {
    acc[entry.type] = (acc[entry.type] ?? 0) + 1;
    return acc;
  }, {}),
};
console.log('[timeline] 摘要:', JSON.stringify(summary, null, 2));
mkdirSync('results', { recursive: true });
const outPath = `results/timeline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(outPath, JSON.stringify({ summary, review }, null, 2));
console.log('[timeline] 已写入', outPath);
