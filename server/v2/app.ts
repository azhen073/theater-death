import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { CONTRACT_VERSION } from '../../contracts/v2.ts';
import type { Clock } from '../clock.ts';
import type { LogStore } from '../log-store.ts';
import { RoomRegistry } from '../rooms.ts';
import { RequestFingerprintError } from '../receipts.ts';
import type { VoiceService } from '../../voice/agora.ts';
import { buildReviewView } from '../../visibility/review.ts';
import { THEATER_DEATH_13_V2 } from '../../rulesets/theater-death-13-v2.ts';
import { validateRuleset } from '../../rulesets/validate.ts';
import type { RulesetConfig } from '../../rulesets/types.ts';
import { AccountStore, type AccountSession } from './account-store.ts';
import type { RoomAccess } from './access.ts';
import { authRouter, requireAccount, textField, type AccountRevocation } from './auth.ts';
import { ApiError } from './errors.ts';
import { gameView } from './view.ts';
import { parseCommand } from './parse-command.ts';
import { RateLimits } from './rate-limit.ts';
import { V2Media } from './media.ts';
import { createMaintenance } from './maintenance.ts';
import { createDiagnostics } from './diagnostics.ts';
import { RoomDirectory } from './room-directory.ts';
import { RoomGovernance } from './governance.ts';
import { EmptyRooms } from './empty-rooms.ts';
import { MemberPresence } from './presence.ts';
import { RoomRounds } from './rounds.ts';
import { ScreenGrants, requireMatch } from './screen-grants.ts';
import { RoomSnapshots } from './snapshots.ts';
import { createRoomRealtime } from './room-realtime.ts';
import type { ActiveMember, StableRoom } from './stable-room.ts';
import { OperationReceipts } from './operation-receipts.ts';
import { bootstrap, catalog, AVATAR_LIMITS } from './catalog.ts';
import type { AvatarStore } from './avatars.ts';
import { createAdminRouter } from './admin-router.ts';

export interface V2Deps { accounts: AccountStore; clock: Clock; logStore: LogStore; origin: string; cookieName?: string; adminCookieName?: string; secureCookies?: boolean; adminPassword?: string | null; avatars?: AvatarStore; voice?: VoiceService | null; verifyWebhook?: (body: string, authorization?: string) => Promise<{ event: string; room?: { name: string }; participant?: { identity: string } }> }

export function createV2App(deps: V2Deps) {
  const { accounts, clock } = deps;
  const access = new Map<string, RoomAccess>();
  const limits = new RateLimits(() => clock.now());
  const operations = new OperationReceipts();
  const media = new V2Media(deps.voice ?? null, () => clock.now());
  const diagnostics = createDiagnostics();
  let closing = false;
  let hub: ReturnType<typeof createRoomRealtime>;
  let governance: RoomGovernance;
  let empty: EmptyRooms;
  let snapshots: RoomSnapshots;
  const forGame = (gameId: string) => [...directory.byId.values()].find((room) => room.gameId === gameId);
  const refresh = (room: StableRoom, event?: { disconnectedMemberId: string }) => {
    if (closing) return;
    if (!room.dissolved) {
      governance.reconcile(room, event); empty.observe(room); room.recordCompletion();
      if (!room.dissolved && room.access && room.gameId) { access.set(room.gameId, room.access); void media.sync(room.access); }
    }
    hub?.refresh(room.roomId);
  };
  const gameChanged = (gameId: string) => { const room = forGame(gameId); if (room) refresh(room); };
  const registry = new RoomRegistry({
    clock, ruleset: THEATER_DEATH_13_V2, logStore: deps.logStore, strictWindows: true,
    broadcaster: { attach() { throw new Error('Use account-authenticated realtime'); }, emitGameEvents: gameChanged, emitChat: gameChanged, emitVoicePermission: gameChanged },
  });
  const directory = new RoomDirectory({
    clock, accounts, logStore: deps.logStore, registry,
    revokeMedia: (gameId, identity) => { void media.revoke(gameId, identity); },
    changed: refresh,
    control: (room, sessionId, reason) => hub?.control(room, sessionId, reason),
    beforeMutation: (room) => empty.expireIfDue(room),
    removed: (room) => { snapshots.forget(room.roomId); empty.forget(room.roomId); if (room.gameId) { access.delete(room.gameId); void media.closeRoom(room.gameId); } },
    closedMatch: (gameId) => { access.delete(gameId); void media.closeRoom(gameId); },
  });
  governance = new RoomGovernance(directory);
  empty = new EmptyRooms(directory, governance);
  const presence = new MemberPresence(directory);
  const rounds = new RoomRounds(directory, governance);
  const grants = new ScreenGrants(directory);
  snapshots = new RoomSnapshots({ directory, profile: (id) => accounts.profile(id), submissions: (room, id) => room.activeSubmissions(id) });
  hub = createRoomRealtime({ directory, snapshots, presence, origin: deps.origin, cookieName: deps.cookieName });
  const maintenance = createMaintenance(directory, empty, deps.avatars ? () => deps.avatars!.collect() : undefined);
  const revokeUser = async (userId: string, event: AccountRevocation = { reason: 'credentials_changed' }) => {
    for (const room of [...directory.byId.values()]) await directory.transaction(() => room.enqueue(() => {
      if (room.dissolved) return;
      const member = room.members.get(userId);
      if (!member) return;
      if (event.reason === 'logout') {
        if (member.sessionId !== event.sessionId) return;
        directory.removeMember(room, member, 'left');
      } else if (member.sessionId && !accounts.sessionActive(member.sessionId)) directory.releaseControl(room, member, 'session_expired');
      refresh(room);
    }));
  };
  const admin = createAdminRouter({ accounts, directory, governance, ...(deps.avatars ? { avatars: deps.avatars } : {}), ...(deps.adminCookieName ? { adminCookieName: deps.adminCookieName } : {}), origin: deps.origin, secureCookies: deps.secureCookies ?? false, password: deps.adminPassword ?? null, refresh, revokeUser });

  const app = express();
  app.disable('x-powered-by');
  if (deps.verifyWebhook) app.post('/api/v2/voice/webhook', express.raw({ type: 'application/webhook+json', limit: '64kb' }), async (req, res) => {
    let event;
    try {
      if (!Buffer.isBuffer(req.body)) throw new Error('invalid_webhook');
      event = await deps.verifyWebhook!(req.body.toString('utf8'), req.get('authorization'));
    } catch { res.status(401).json({ error: { code: 'invalid_webhook' } }); return; }
    if (event.event === 'participant_joined' && event.room && event.participant) await media.joined(access.get(event.room.name), event.room.name, event.participant.identity);
    res.status(204).end();
  });
  const rawAvatar = express.raw({ type: () => true, limit: AVATAR_LIMITS.maxBytes });
  app.put('/api/v2/me/avatar', (req, _res, next) => {
    try {
      requireAccount(accounts, req, deps.cookieName);
      if (req.headers.origin && req.headers.origin !== deps.origin) throw new ApiError(403, 'origin_forbidden');
      if (!deps.avatars) throw new ApiError(409, 'avatars_disabled');
      if (!AVATAR_LIMITS.formats.includes((req.get('content-type') ?? '').split(';')[0]!.toLowerCase())) throw new ApiError(415, 'invalid_avatar');
      limited(req, 'avatar', 5, 60_000);
      next();
    } catch (error) { next(error); }
  }, (req, res, next) => rawAvatar(req, res, (error) => next((error as { status?: number })?.status === 413 ? new ApiError(413, 'avatar_too_large') : error)), async (req, res) => {
    const current = requireAccount(accounts, req, deps.cookieName);
    const profile = await deps.avatars!.put(current.userId, req.body, (req.get('content-type') ?? '').split(';')[0]!.toLowerCase(), () => { requireAccount(accounts, req, deps.cookieName); });
    for (const room of directory.byId.values()) if (room.members.has(current.userId) || room.participants.has(current.userId)) refresh(room);
    res.json(profile);
  });
  app.get('/api/v2/avatars/:assetId', async (req, res) => {
    requireAccount(accounts, req, deps.cookieName);
    if (!deps.avatars) throw new ApiError(409, 'avatars_disabled');
    const bytes = await deps.avatars.read(String(req.params.assetId));
    requireAccount(accounts, req, deps.cookieName);
    res.set('Cache-Control', 'private, max-age=604800, immutable').set('X-Content-Type-Options', 'nosniff').type('image/webp').send(bytes);
  });
  app.use(express.json({ limit: '32kb' }));
  app.use((req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers.origin && req.headers.origin !== deps.origin) return next(new ApiError(403, 'origin_forbidden'));
      if (!req.is('application/json')) return next(new ApiError(415, 'json_required'));
    }
    next();
  });
  app.use('/api/v2/auth', authRouter(accounts, deps.secureCookies ?? false, revokeUser, deps.cookieName));
  app.use('/api/v2/admin', admin.router);
  app.get('/api/v2/bootstrap', (_req, res) => res.json(bootstrap(!!deps.voice, !!deps.avatars, accounts.registrationEnabled())));
  app.get('/api/v2/catalog', (_req, res) => res.json(catalog()));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', apiVersion: 2, contractVersion: CONTRACT_VERSION, rulesVersion: '2.0' }));
  app.get('/', (_req, res) => res.json({ service: 'theater-death-v2', api: '/api/v2', contractVersion: CONTRACT_VERSION, ui: 'not-included' }));
  const router = express.Router();
  const session = (req: Request) => requireAccount(accounts, req, deps.cookieName);
  router.use((req, _res, next) => { try { session(req); next(); } catch (error) { next(error); } });
  const limited = (req: Request, category: string, burst: number, period: number) => {
    const s = session(req);
    if (!limits.allow(category + ':' + s.userId, burst, period) || !limits.allow(category + ':ip:' + req.ip, burst * 5, period)) throw new ApiError(429, 'rate_limited');
    return s;
  };
  const intent = (req: Request) => { textField(req.body?.requestId, 'request_id', 1, 80); return session(req); };
  const matchId = (req: Request) => textField(req.body?.gameId, 'game_id');
  const roomFor = (req: Request) => {
    const room = directory.byCode.get(String(req.params.code).toUpperCase());
    if (!room || room.dissolved) throw new ApiError(404, 'room_not_found');
    return room;
  };
  const entry = (room: StableRoom, member: ActiveMember) => ({
    roomId: room.roomId, roomCode: room.code, gameId: room.gameId, memberId: member.memberId, kind: member.kind,
    playerId: room.participants.get(member.userId)?.playerId ?? null,
  });
  const mutate = <T>(req: Request, apply: (room: StableRoom, session: AccountSession) => T) => {
    const room = roomFor(req); const s = intent(req);
    return directory.mutate(room, () => apply(room, session(req)), s);
  };
  router.patch('/me/profile', async (req, res) => {
    const current = session(req), nickname = req.body?.nickname;
    const profile = await directory.transaction(async () => {
      const rooms = [...directory.byId.values()].filter(room => !room.dissolved && (room.members.has(current.userId) || room.participants.has(current.userId)));
      if (rooms.some(room => room.phase === 'playing')) throw new ApiError(409, 'account_in_active_game');
      const next = accounts.rename(current.userId, nickname);
      for (const room of rooms) await room.enqueue(() => { const member = room.members.get(current.userId); if (member) member.nickname = next.nickname; refresh(room); });
      return next;
    });
    res.json(profile);
  });
  const player = (room: StableRoom, s: AccountSession) => {
    const member = directory.member(room, s);
    const seat = room.participants.get(member.userId);
    if (member.kind !== 'formal' || !seat || !room.access?.resolve(s)) throw new ApiError(403, 'seat_control_required');
    return seat.playerId;
  };
  const operationPaths: Array<[string, string]> = [
    ['/rooms', 'create'],
    ...['enter', 'takeover', 'promote', 'leave', 'ready', 'start', 'transfer-host', 'kick', 'dissolve', 'end-review', 'second-screen/invitations', 'second-screen/redeem', 'second-screen/revoke'].map((operation): [string, string] => ['/rooms/:code/' + operation, operation]),
  ];
  // Registered on the same route patterns as handlers, so encoded/case/trailing-slash
  // aliases accepted by Express cannot bypass idempotency.
  for (const [path, operation] of operationPaths) router.post(path, async (req, res, next) => {
    try {
      const s = intent(req);
      const code = req.params.code === undefined ? null : String(req.params.code).toUpperCase();
      if (code !== null && !/^[A-Z2-9]{6}$/.test(code)) throw new ApiError(404, 'room_not_found');
      const authorizeResponse = () => {
        const current = session(req);
        // Never replay a capability-bearing invitation to a device that lost control.
        if (operation === 'second-screen/invitations') {
          const room = roomFor(req); requireMatch(room, matchId(req)); player(room, current);
        }
      };
      authorizeResponse();
      const ticket = operations.reserve(s.userId, code === null ? 'create' : 'room:' + code, textField(req.body.requestId, 'request_id', 1, 80), { operation, body: req.body });
      if (!ticket.owner) {
        const response = await ticket.promise;
        authorizeResponse();
        res.status(response.status).json(structuredClone(response.body));
        return;
      }
      const send = res.json.bind(res);
      res.json = (body: unknown) => {
        ticket.finish({ status: res.statusCode, body });
        if (res.statusCode < 400) authorizeResponse();
        return send(body);
      };
      limited(req, 'room-write', 30, 2000);
      next();
    } catch (error) { next(error); }
  });
  router.post('/rooms', async (req, res) => {
    const s = limited(req, 'create', 5, 60_000); intent(req);
    if (req.body?.presetId !== undefined && req.body.presetId !== 'default-13') throw new ApiError(400, 'invalid_preset');
    const ruleset: RulesetConfig = req.body?.roles === undefined ? structuredClone(THEATER_DEATH_13_V2) : { ...structuredClone(THEATER_DEATH_13_V2), mode: 'experimental', roles: req.body.roles };
    const validation = validateRuleset(ruleset);
    if (!validation.ok) throw new ApiError(400, 'invalid_ruleset', validation.issues.map((v) => v.code).join(','));
    const count = Object.values(ruleset.roles).reduce((a, b) => a + b, 0);
    if (count > 64) throw new ApiError(400, 'player_limit');
    if (req.body?.playerCount !== undefined && req.body.playerCount !== count) throw new ApiError(400, 'player_count_mismatch');
    const room = await directory.create(s, ruleset);
    res.status(201).json(entry(room, room.members.get(s.userId)!));
  });
  router.get('/me/rooms', async (req, res) => {
    await maintenance.sweep();
    const s = session(req);
    res.json({ currentRoomId: directory.current.get(s.userId) ?? null, rooms: [...directory.byId.values()].filter((r) => r.members.has(s.userId) || r.participants.has(s.userId)).map((r) => {
      const member = r.members.get(s.userId);
      return { roomId: r.roomId, roomCode: r.code, gameId: r.gameId, phase: r.phase, memberId: member?.memberId ?? null, kind: member?.kind ?? null, playerId: r.participants.get(s.userId)?.playerId ?? null, activeHere: member?.sessionId === s.id, controlling: member?.kind === 'formal' && member.sessionId === s.id, canRecover: r.participants.has(s.userId), requiresTakeover: !!member?.sessionId && member.sessionId !== s.id && accounts.sessionActive(member.sessionId) };
    }) });
  });
  for (const route of ['enter', 'takeover'] as const) router.post('/rooms/:code/' + route, async (req, res) => {
    const s = limited(req, route, 10, 60_000); intent(req); const room = roomFor(req);
    const member = await directory.enter(room, s, route === 'takeover');
    res.json(entry(room, member));
  });
  router.post('/rooms/:code/promote', async (req, res) => { const s = intent(req); const room = roomFor(req); res.json(entry(room, await directory.promote(room, s))); });
  // 房主在大厅/复盘退出即解散整房；对局进行中房主退出仍是「暂离」（RoomGovernance.leave）。
  router.post('/rooms/:code/leave', async (req, res) => { const s = intent(req); res.json(await governance.leave(roomFor(req), s)); });
  router.post('/rooms/:code/ready', async (req, res) => res.json(await mutate(req, (room, s) => {
    const member = directory.member(room, s);
    if (member.kind !== 'formal') throw new ApiError(403, 'seat_control_required');
    if (room.phase !== 'lobby') throw new ApiError(409, 'lobby_required');
    if (typeof req.body?.ready !== 'boolean') throw new ApiError(400, 'invalid_ready');
    member.ready = req.body.ready; return { ready: member.ready };
  })));
  router.post('/rooms/:code/start', async (req, res) => res.json(await mutate(req, (room, s) => {
    governance.host(room, s); const runtime = room.startMatch();
    return { started: true, roomId: room.roomId, gameId: runtime.gameId };
  })));
  router.post('/rooms/:code/transfer-host', async (req, res) => { const s = intent(req); const room = roomFor(req); await governance.transfer(room, s, textField(req.body?.memberId, 'member_id')); res.json({ hostMemberId: room.hostMemberId }); });
  router.post('/rooms/:code/kick', async (req, res) => { const s = intent(req); await governance.kick(roomFor(req), s, textField(req.body?.memberId, 'member_id')); res.json({ removed: true }); });
  router.post('/rooms/:code/dissolve', async (req, res) => { const s = intent(req); await governance.dissolve(roomFor(req), s); res.json({ dissolved: true }); });
  router.post('/rooms/:code/end-review', async (req, res) => { const s = intent(req); res.json(await rounds.endReview(roomFor(req), s, matchId(req))); });
  router.get('/rooms/:code/view', (req, res) => res.json(snapshots.read(roomFor(req), session(req))));
  router.get('/rooms/:code/review', (req, res) => {
    const room = roomFor(req); directory.member(room, session(req)); const runtime = room.runtime;
    if (!runtime?.state?.win) throw new ApiError(403, 'game_not_ended');
    room.recordCompletion();
    const review = buildReviewView({ state: runtime.state, events: runtime.events, messages: runtime.chat })!;
    res.json({ review: { ...review, startedAt: room.matchStartedAt, endedAt: room.matchEndedAt, durationMs: room.matchEndedAt! - room.matchStartedAt!, players: review.players.map(({ nickname: _name, ...p }) => {
      const subject = [...room.participants.values()].find((m) => m.playerId === p.playerId)!;
      const profile = accounts.profileOrNull(subject.userId);
      return { ...p, uid: subject.uid, nickname: subject.nickname, avatarUrl: profile?.avatarUrl ?? null };
    }) } });
  });
  router.post('/rooms/:code/command', async (req, res) => {
    limited(req, 'command', 16, 2000);
    const room = roomFor(req); const s = intent(req); const gameId = matchId(req);
    requireMatch(room, gameId); const id = player(room, s);
    const requestId = textField(req.body.requestId, 'request_id', 1, 80);
    const receipt = await room.receipts.executeQueued(gameId, id, requestId, req.body, () => room.enqueue(() => {
      try {
        if (room.dissolved || directory.byId.get(room.roomId) !== room) throw new ApiError(404, 'room_not_found');
        requireMatch(room, gameId); player(room, session(req));
        const runtime = room.runtime!; const command = parseCommand(req.body, id);
        const currentWindow = runtime.driver?.windows().some((w) => w.instanceId === command.windowInstanceId);
        const cap = gameView(runtime, { subjectPlayerId: id, readOnly: false }, clock.now()).capabilities;
        if (currentWindow && !cap?.allowedCommands.includes(command.type)) return { requestId, status: 'rejected' as const, code: 'action_forbidden', message: '当前无此行动权限' };
        if (command.type === 'EDIT_PROPOSAL' && command.confirmSelf && !cap?.allowedCommands.includes('CONFIRM_PROPOSAL')) {
          return { requestId, status: 'rejected' as const, code: 'action_forbidden', message: '当前无此确认权限' };
        }
        const result = runtime.driver!.submit(command);
        if (result.accepted) {
          const acceptedAt = clock.now();
          const combinedRevision = command.type === 'EDIT_PROPOSAL' && command.confirmSelf
            ? runtime.driver!.proposalState(id)?.revision ?? null : null;
          room.rememberSubmission(id, {
            action: command.type, windowInstanceId: command.windowInstanceId!, requestId, acceptedAt,
            targets: Array.isArray(req.body.targets) ? [...req.body.targets] : [],
            revision: combinedRevision ?? (typeof req.body.revision === 'number' ? req.body.revision : null),
            direction: req.body.direction === 'asc' || req.body.direction === 'desc' ? req.body.direction : null,
          });
          if (command.type === 'EDIT_PROPOSAL' && command.confirmSelf && combinedRevision !== null) room.rememberSubmission(id, {
            action: 'CONFIRM_PROPOSAL', windowInstanceId: command.windowInstanceId!, requestId, acceptedAt,
            targets: [], revision: combinedRevision, direction: null,
          });
        }
        refresh(room);
        return { requestId, status: result.accepted ? 'accepted' as const : 'rejected' as const, code: result.code, message: result.message };
      } catch (error) {
        if (error instanceof ApiError) return { requestId, status: 'rejected' as const, code: error.code, message: error.message };
        throw error;
      }
    }));
    res.json(receipt);
  });
  router.get('/rooms/:code/games/:gameId/receipts/:requestId', (req, res) => {
    const room = roomFor(req); const s = session(req); const gameId = String(req.params.gameId);
    requireMatch(room, gameId); const id = player(room, s);
    res.json(room.receipts.lookup(gameId, id, textField(req.params.requestId, 'request_id', 1, 80)));
  });
  router.post('/rooms/:code/chat', async (req, res) => {
    const s = session(req); const room = roomFor(req); const gameId = matchId(req);
    const receipt = await directory.mutate(room, () => {
      requireMatch(room, gameId); const current = session(req); const id = player(room, current); const runtime = room.runtime!;
      const clientMessageId = textField(req.body?.clientMessageId, 'client_message_id', 1, 80);
      return room.chatReceipts.execute(gameId, id, clientMessageId, req.body, () => {
        limited(req, 'chat', 5, 2500);
        const snapshot = gameView(runtime, { subjectPlayerId: id, readOnly: false }, clock.now());
        const channel = req.body?.channel;
        if (channel !== 'public' && channel !== 'faction') throw new ApiError(400, 'invalid_channel');
        if (!(channel === 'public' ? snapshot.capabilities?.canPostPublic : snapshot.capabilities?.canPostFaction)) throw new ApiError(403, 'chat_forbidden');
        const text = textField(req.body?.text, 'text', 1, 500).trim();
        if (!text) throw new ApiError(400, 'invalid_text');
        const message = { id: runtime.nextMessageId, messageId: randomUUID(), clientMessageId, channel: channel as 'public' | 'faction', senderId: id, text, at: clock.now(), eventSeq: runtime.state!.eventSeq };
        // Persist before changing the in-memory stream; a failed write can safely retry.
        registry.logMessage(runtime, message); runtime.nextMessageId++; runtime.chat.push(message);
        return { gameId, channel: message.channel, message: snapshots.read(room, current).chat[message.channel].find((m) => m.messageId === message.messageId)! };
      });
    }, s);
    requireMatch(room, gameId); player(room, session(req));
    res.status(201).json(receipt);
  });
  router.post('/rooms/:code/second-screen/invitations', async (req, res) => { const s = intent(req); limited(req, 'screen', 10, 60_000); res.status(201).json(await grants.invite(roomFor(req), s, matchId(req))); });
  router.post('/rooms/:code/second-screen/redeem', async (req, res) => { const s = intent(req); limited(req, 'screen', 10, 60_000); res.json(await grants.redeem(roomFor(req), s, matchId(req), textField(req.body?.token, 'token'))); });
  router.post('/rooms/:code/second-screen/revoke', async (req, res) => { const s = intent(req); await grants.revoke(roomFor(req), s, matchId(req)); res.json({ revoked: true }); });
  router.post('/rooms/:code/voice/token', async (req, res) => { const s = intent(req); limited(req, 'voice', 6, 3000); const room = roomFor(req); directory.member(room, s); requireMatch(room, matchId(req)); res.json(await media.issue(room.access!, s)); });
  router.post('/rooms/:code/voice/sync', async (req, res) => { const s = intent(req); limited(req, 'voice', 6, 3000); const room = roomFor(req); directory.member(room, s); requireMatch(room, matchId(req)); if (!deps.voice) throw new ApiError(409, 'voice_disabled'); try { await media.sync(room.access!, true); } catch { throw new ApiError(503, 'voice_unavailable'); } res.json({ synced: true }); });
  router.get('/diagnostics', (_req, res) => res.json({ ...diagnostics.snapshot(), rooms: directory.byId.size, playingRooms: [...directory.byId.values()].filter((r) => r.phase === 'playing').length, connections: hub.connectionCount() }));
  app.use('/api/v2', router);
  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found' } }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ error: { code: 'invalid_json' } }); return; }
    if (error instanceof RequestFingerprintError) { res.status(400).json({ error: { code: 'invalid_request_payload' } }); return; }
    if ((error as { status?: number })?.status === 413) { res.status(413).json({ error: { code: 'request_too_large' } }); return; }
    console.error('v2_request_failed', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: { code: 'internal_error' } });
  });
  return {
    app, registry, directory, access, hub, router, refresh, snapshots, presence, governance, empty, rounds, grants, revokeUser, media, maintenance,
    close() {
      closing = true; maintenance.stop(); diagnostics.close(); admin.close(); hub.close(); presence.close(); empty.close();
      for (const room of directory.byId.values()) { room.runtime?.driver?.dispose(); room.access?.close(); }
    },
    async drain() {
      await maintenance.drain();
      await directory.transaction(() => Promise.all([...directory.byId.values()].map((room) => room.enqueue(() => undefined))));
      await media.drain();
    },
  };
}
