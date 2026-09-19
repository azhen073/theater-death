import cookieParser from 'cookie-parser';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPlayerView,
  buildReviewView,
  canPostPublic,
  canReadRoomMessage,
  publishedState,
  roomMembership,
} from '../visibility/index.ts';
import type { Clock } from './clock.ts';
import type { GameCommand } from './commands.ts';
import type { GameState } from '../engine/types.ts';
import type { RulesetConfig } from '../rulesets/types.ts';
import { validateRuleset } from '../rulesets/validate.ts';
import type { VoiceService } from '../voice/agora.ts';
import { voicePermission, SPECTATOR_PERMISSION } from '../voice/policy.ts';
import { healthPayload } from './health.ts';
import type { Broadcaster } from './realtime.ts';
import type {
  CommandReceipt,
  Room,
  RoomMember,
  RoomRegistry,
  RoomSpectator,
} from './rooms.ts';
import { SESSION_COOKIE_NAME, signSession, verifySession, type SessionPayload } from './session.ts';

export interface AppDeps {
  readonly registry: RoomRegistry;
  readonly clock: Clock;
  readonly sessionSecret: string;
  readonly cookieSecure: boolean;
  readonly broadcaster?: Broadcaster;
  /** 未配置语音时为 null；语音接口返回 409 voice_disabled */
  readonly voice?: VoiceService | null;
  /** 前端静态产物目录（web/dist）；不存在则跳过托管（测试/纯 API 场景） */
  readonly webRoot?: string | null;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use(originGuard);

  const commandLimiter = createRateLimiter(8, 16);
  const chatLimiter = createRateLimiter(2, 5);
  const voiceLimiter = createRateLimiter(2, 6);

  app.get('/healthz', (_req, res) => {
    res.json(healthPayload());
  });

  app.post('/api/rooms', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const nickname = readNickname(req.body);
    if (nickname === null) {
      fail(res, 400, 'invalid_nickname', '昵称需为 1-12 个字符');
      return;
    }
    let ruleset: RulesetConfig | undefined;
    if (body.ruleset !== undefined) {
      const validation = validateRuleset(body.ruleset);
      if (!validation.ok) {
        fail(
          res,
          400,
          'invalid_ruleset',
          `板子配置校验失败：${validation.issues.map((issue) => issue.message).join('；')}`,
        );
        return;
      }
      ruleset = body.ruleset as RulesetConfig;
    }
    const { room, member } = deps.registry.createRoom(nickname, ruleset);
    setSessionCookie(res, deps, room.gameId, member.playerId);
    res.status(201).json({ roomCode: room.code, playerId: member.playerId });
  });

  app.post('/api/rooms/:code/join', (req, res) => {
    const nickname = readNickname(req.body);
    if (nickname === null) {
      fail(res, 400, 'invalid_nickname', '昵称需为 1-12 个字符');
      return;
    }
    const result = deps.registry.joinRoom(String(req.params.code ?? '').toUpperCase(), nickname);
    if (!result.ok) {
      fail(res, result.status, result.code, result.message);
      return;
    }
    setSessionCookie(res, deps, result.room.gameId, result.member.playerId);
    res.status(201).json({ roomCode: result.room.code, playerId: result.member.playerId });
  });

  /**
   * 观战加入：绑定一名玩家（只读第二屏）。大厅/对局/终局均可加入；
   * 每个玩家最多一名观众；不占玩家席位。
   */
  app.post('/api/rooms/:code/watch', (req, res) => {
    const nickname = readNickname(req.body);
    if (nickname === null) {
      fail(res, 400, 'invalid_nickname', '昵称需为 1-12 个字符');
      return;
    }
    const bindPlayerId = readString((req.body as Record<string, unknown> | null)?.bindPlayerId, 1, 80);
    if (bindPlayerId === null) {
      fail(res, 400, 'invalid_bind_player', 'bindPlayerId 必填');
      return;
    }
    const result = deps.registry.watchRoom(
      String(req.params.code ?? '').toUpperCase(),
      nickname,
      bindPlayerId,
    );
    if (!result.ok) {
      fail(res, result.status, result.code, result.message);
      return;
    }
    setSessionCookie(res, deps, result.room.gameId, result.spectator.spectatorId, 'spectator');
    res.status(201).json({
      roomCode: result.room.code,
      spectatorId: result.spectator.spectatorId,
      bindPlayerId: result.spectator.bindPlayerId,
    });
  });

  /** 观战入口的公开名单（昵称/座位/存活均为公开信息，不含任何身份） */
  app.get('/api/rooms/:code/members', (req, res) => {
    const room = deps.registry.getByCode(String(req.params.code ?? '').toUpperCase());
    if (room === null) {
      fail(res, 404, 'room_not_found', '房间不存在');
      return;
    }
    const published = room.state === null ? null : publishedState(room.state, room.events);
    res.json({
      roomCode: room.code,
      phase: room.state === null ? 'lobby' : 'started',
      requiredPlayers: room.requiredPlayerCount(),
      memberCount: room.members.length,
      members: room.members.map((member) => {
        const player = room.state?.players.find((item) => item.playerId === member.playerId);
        const publishedPlayer = published?.players.find((item) => item.playerId === member.playerId);
        return {
          playerId: member.playerId,
          nickname: member.nickname,
          seat: player?.seat ?? null,
          alive: publishedPlayer === undefined ? null : publishedPlayer.life !== 'dead',
          watched: room.spectators.some((item) => item.bindPlayerId === member.playerId),
        };
      }),
    });
  });

  app.post('/api/rooms/:code/ready', (req, res) => {
    const context = resolveRoomMember(req, res, deps);
    if (context === null) {
      return;
    }
    const { room, member } = context;
    if (room.code !== String(req.params.code ?? '').toUpperCase()) {
      fail(res, 404, 'room_not_found', '房间码与会话不一致');
      return;
    }
    if (room.state !== null) {
      fail(res, 409, 'room_started', '对局已经开始');
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    member.ready = typeof body.ready === 'boolean' ? body.ready : true;
    res.json({ ready: member.ready });
  });

  app.post('/api/rooms/:code/start', (req, res) => {
    const context = resolveRoomMember(req, res, deps);
    if (context === null) {
      return;
    }
    const { room, member } = context;
    if (room.code !== String(req.params.code ?? '').toUpperCase()) {
      fail(res, 404, 'room_not_found', '房间码与会话不一致');
      return;
    }
    if (member.playerId !== room.hostPlayerId) {
      fail(res, 403, 'not_host', '只有房主可以开始对局');
      return;
    }
    if (room.state !== null) {
      fail(res, 409, 'room_started', '对局已经开始');
      return;
    }
    const required = room.requiredPlayerCount();
    if (room.members.length !== required) {
      fail(res, 409, 'room_not_full', `需要 ${required} 名玩家，当前 ${room.members.length}`);
      return;
    }
    if (!room.members.every((item) => item.ready)) {
      fail(res, 409, 'not_ready', '还有玩家未准备');
      return;
    }
    const startedState = deps.registry.startGame(room);
    res.json({ started: true, dayNumber: startedState.dayNumber });
  });

  app.post('/api/rooms/:code/leave', (req, res) => {
    const context = resolveRoomMember(req, res, deps);
    if (context === null) {
      return;
    }
    const { room, member } = context;
    if (room.code !== String(req.params.code ?? '').toUpperCase()) {
      fail(res, 404, 'room_not_found', '房间码与会话不一致');
      return;
    }
    const result = deps.registry.leaveRoom(room, member.playerId);
    if (!result.ok) {
      fail(res, result.status, result.code, result.message);
      return;
    }
    clearSessionCookie(res, deps);
    res.json({ left: true, dissolved: result.dissolved });
  });

  /** 房主移出成员（仅未开局）或观战者（不限阶段）；被移出者会话由成员校验自然失效 */
  app.post('/api/rooms/:code/kick', (req, res) => {
    const context = resolveRoomMember(req, res, deps);
    if (context === null) {
      return;
    }
    const { room, member } = context;
    if (room.code !== String(req.params.code ?? '').toUpperCase()) {
      fail(res, 404, 'room_not_found', '房间码与会话不一致');
      return;
    }
    if (member.playerId !== room.hostPlayerId) {
      fail(res, 403, 'not_host', '只有房主可以移出成员');
      return;
    }
    const body = (req.body ?? {}) as { targetPlayerId?: unknown; targetSpectatorId?: unknown };
    const targetPlayerId = typeof body.targetPlayerId === 'string' ? body.targetPlayerId : null;
    const targetSpectatorId =
      typeof body.targetSpectatorId === 'string' ? body.targetSpectatorId : null;
    if ((targetPlayerId === null) === (targetSpectatorId === null)) {
      fail(res, 400, 'invalid_target', '需要且只能指定一名目标（玩家或观战者）');
      return;
    }
    if (targetPlayerId !== null) {
      const result = deps.registry.kickMember(room, targetPlayerId);
      if (!result.ok) {
        fail(res, result.status, result.code, result.message);
        return;
      }
      res.json({ kicked: true, kind: 'player' });
      return;
    }
    if (targetSpectatorId === null) {
      fail(res, 400, 'invalid_target', '需要且只能指定一名目标（玩家或观战者）');
      return;
    }
    const spectator = room.spectators.find((item) => item.spectatorId === targetSpectatorId);
    const result = deps.registry.kickSpectator(room, targetSpectatorId);
    if (!result.ok) {
      fail(res, result.status, result.code, result.message);
      return;
    }
    if (spectator !== undefined) {
      removeVoiceViewer(deps, room.gameId, spectator.uid);
    }
    res.json({ kicked: true, kind: 'spectator' });
  });

  /** 观众退出观战（对局中也可退出，不影响对局） */
  app.post('/api/spectate/leave', (req, res) => {
    const session = requireSession(req, res, deps);
    if (session === null) {
      return;
    }
    if (session.kind !== 'spectator') {
      fail(res, 403, 'not_spectator', '当前不是观战会话');
      return;
    }
    const room = deps.registry.getByGameId(session.gameId);
    if (room !== null) {
      const spectator = room.spectators.find((item) => item.spectatorId === session.playerId);
      deps.registry.removeSpectator(room, session.playerId);
      if (spectator !== undefined) {
        removeVoiceViewer(deps, room.gameId, spectator.uid);
      }
    }
    clearSessionCookie(res, deps);
    res.json({ left: true });
  });

  app.get('/api/view', (req, res) => {
    const viewer = resolveViewer(req, res, deps);
    if (viewer === null) {
      return;
    }
    const { room } = viewer;
    const subjectId = viewerSubjectId(viewer);
    const spectating = spectatingMark(viewer);
    const voiceEnabled = deps.voice !== null && deps.voice !== undefined;
    if (room.state === null) {
      const subject = room.members.find((item) => item.playerId === subjectId);
      if (subject === undefined) {
        fail(res, 403, 'not_member', '你已不在该房间中');
        return;
      }
      res.json({ ...lobbyView(room, subject, voiceEnabled), spectating, spectators: spectatorList(room) });
      return;
    }
    res.json({
      phase: room.state.phase,
      rulesetMode: room.ruleset.mode,
      roomCode: room.code,
      voice: {
        enabled: voiceEnabled,
        permission:
          viewer.kind === 'spectator'
            ? SPECTATOR_PERMISSION
            : voicePermission(room.state, subjectId),
      },
      view: buildPlayerView({
        state: room.state,
        events: room.events,
        playerId: subjectId,
      }),
      proposal: room.driver?.proposalState(subjectId) ?? null,
      hints: gameHints(room.state),
      windows: room.driver?.windows() ?? [],
      serverTime: deps.clock.now(),
      spectating,
      spectators: spectatorList(room),
    });
  });

  app.get('/api/review', (req, res) => {
    const viewer = resolveViewer(req, res, deps);
    if (viewer === null) {
      return;
    }
    const { room } = viewer;
    if (room.state === null) {
      fail(res, 409, 'game_not_started', '对局尚未开始');
      return;
    }
    const review = buildReviewView({
      state: room.state,
      events: room.events,
      messages: room.chat,
    });
    if (review === null) {
      fail(res, 403, 'game_not_ended', '对局尚未结束，不能查看复盘');
      return;
    }
    res.json({ review });
  });

  app.post('/api/command', async (req, res) => {
    const viewer = resolveViewer(req, res, deps);
    if (viewer === null) {
      return;
    }
    if (viewer.kind === 'spectator') {
      fail(res, 403, 'spectator_readonly', '观战者只能观看，不能提交操作');
      return;
    }
    const { room, session } = viewer;
    if (!commandLimiter(session.playerId, deps.clock.now())) {
      fail(res, 429, 'rate_limited', '操作过于频繁');
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = readString(body.requestId, 1, 80);
    const action = readString(body.action, 1, 40);
    if (requestId === null || action === null) {
      fail(res, 400, 'invalid_request', 'requestId 与 action 必填');
      return;
    }
    const parsed = toGameCommand(action, body, session.playerId);
    if (parsed === null) {
      fail(res, 400, 'unknown_action', `未知操作 ${action}`);
      return;
    }
    if ('error' in parsed) {
      fail(res, 400, parsed.error.code, parsed.error.message);
      return;
    }

    const receipt = await room.enqueue<CommandReceipt>(() => {
      const cached = room.receipts.get(requestId);
      if (cached !== undefined) {
        return cached;
      }
      if (room.driver === null) {
        return {
          requestId,
          status: 'rejected',
          code: 'game_not_started',
          message: '对局尚未开始',
        };
      }
      const result = room.driver.submit(parsed);
      const entry: CommandReceipt = {
        requestId,
        status: result.accepted ? 'accepted' : 'rejected',
        code: result.code,
        message: result.message,
      };
      room.receipts.set(requestId, entry);
      if (room.receipts.size > 2000) {
        const oldest = room.receipts.keys().next().value;
        if (oldest !== undefined) {
          room.receipts.delete(oldest);
        }
      }
      return entry;
    });
    res.json(receipt);
  });

  app.post('/api/chat', async (req, res) => {
    const viewer = resolveViewer(req, res, deps);
    if (viewer === null) {
      return;
    }
    if (viewer.kind === 'spectator') {
      fail(res, 403, 'spectator_readonly', '观战者只能观看，不能发言');
      return;
    }
    const { room, session } = viewer;
    if (!chatLimiter(session.playerId, deps.clock.now())) {
      fail(res, 429, 'rate_limited', '发言过于频繁');
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const channel = body.channel === 'public' || body.channel === 'faction' ? body.channel : null;
    const text = readString(body.text, 1, 500);
    if (channel === null || text === null) {
      fail(res, 400, 'invalid_message', 'channel 需为 public/faction，text 为 1-500 字符');
      return;
    }

    const result = await room.enqueue(() => {
      const state = room.state;
      if (state === null) {
        return {
          ok: false as const,
          status: 409,
          code: 'game_not_started',
          message: '对局尚未开始',
        };
      }
      if (channel === 'public') {
        if (!canPostPublic(state, session.playerId)) {
          return {
            ok: false as const,
            status: 403,
            code: 'chat_forbidden',
            message: '当前不能发送公屏消息',
          };
        }
      } else {
        const membership = roomMembership(state, session.playerId);
        if (membership === null || !membership.canWrite) {
          return {
            ok: false as const,
            status: 403,
            code: 'chat_forbidden',
            message: '当前不能发送阵营房消息',
          };
        }
      }
      const message = {
        id: room.nextMessageId,
        channel,
        senderId: session.playerId,
        text,
        at: deps.clock.now(),
        eventSeq: state.eventSeq,
      } as const;
      room.nextMessageId += 1;
      room.chat.push(message);
      deps.registry.logMessage(room, message);
      deps.broadcaster?.emitChat(room.gameId, state, message);
      return { ok: true as const, message };
    });

    if (!result.ok) {
      fail(res, result.status, result.code, result.message);
      return;
    }
    res.status(201).json({
      id: result.message.id,
      channel: result.message.channel,
      at: result.message.at,
      eventSeq: result.message.eventSeq,
    });
  });

  app.get('/api/chat', (req, res) => {
    const viewer = resolveViewer(req, res, deps);
    if (viewer === null) {
      return;
    }
    const { room } = viewer;
    const subjectId = viewerSubjectId(viewer);
    if (room.state === null) {
      fail(res, 409, 'game_not_started', '对局尚未开始');
      return;
    }
    const channel =
      req.query.channel === 'public' || req.query.channel === 'faction' ? req.query.channel : null;
    if (channel === null) {
      fail(res, 400, 'invalid_channel', 'channel 需为 public/faction');
      return;
    }
    const sinceRaw = typeof req.query.since === 'string' ? Number(req.query.since) : 0;
    const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? sinceRaw : 0;
    const state = room.state;
    let messages = room.chat.filter(
      (message) => message.channel === channel && message.id > since,
    );
    if (channel === 'faction') {
      const membership = roomMembership(state, subjectId);
      if (membership === null) {
        fail(res, 403, 'room_forbidden', '你不属于该阵营房');
        return;
      }
      messages = messages.filter((message) =>
        canReadRoomMessage(state, subjectId, message.eventSeq),
      );
    }
    res.json({
      messages: messages.map((message) => ({
        id: message.id,
        channel: message.channel,
        senderId: message.senderId,
        text: message.text,
        at: message.at,
        eventSeq: message.eventSeq,
      })),
    });
  });

  app.post('/api/voice/token', (req, res) => {
    const viewer = resolveViewer(req, res, deps);
    if (viewer === null) {
      return;
    }
    const { room, session } = viewer;
    const voice = deps.voice ?? null;
    if (voice === null) {
      fail(res, 409, 'voice_disabled', '语音未启用（文字测试模式）');
      return;
    }
    if (room.state === null) {
      fail(res, 409, 'game_not_started', '对局尚未开始，暂不能加入语音');
      return;
    }
    if (room.state.win !== null) {
      fail(res, 409, 'game_ended', '对局已经结束');
      return;
    }
    if (!voiceLimiter(session.playerId, deps.clock.now())) {
      fail(res, 429, 'rate_limited', '操作过于频繁');
      return;
    }
    if (viewer.kind === 'spectator') {
      // 观众只订阅不发布：凭证为订阅角色，也不进入玩家动态授权
      const credentials = voice.issueCredentials({
        roomName: room.gameId,
        uid: viewer.spectator.uid,
      });
      res.json({ ...credentials, permission: SPECTATOR_PERMISSION });
      return;
    }
    const player = room.state.players.find((item) => item.playerId === session.playerId);
    if (player === undefined) {
      fail(res, 403, 'not_member', '你已不在该房间中');
      return;
    }
    const permission = voicePermission(room.state, session.playerId);
    const credentials = voice.issueCredentials({ roomName: room.gameId, uid: player.seat });
    res.json({ ...credentials, permission });
  });

  app.post('/api/voice/sync', (req, res) => {
    const viewer = resolveViewer(req, res, deps);
    if (viewer === null) {
      return;
    }
    if (viewer.kind === 'spectator') {
      fail(res, 403, 'spectator_readonly', '观战者不需要同步发布权限');
      return;
    }
    const { room, session } = viewer;
    const voice = deps.voice ?? null;
    if (voice === null) {
      fail(res, 409, 'voice_disabled', '语音未启用（文字测试模式）');
      return;
    }
    if (room.state === null) {
      fail(res, 409, 'game_not_started', '对局尚未开始');
      return;
    }
    if (!voiceLimiter(session.playerId, deps.clock.now())) {
      fail(res, 429, 'rate_limited', '操作过于频繁');
      return;
    }
    const state = room.state;
    const player = state.players.find((item) => item.playerId === session.playerId);
    if (player === undefined) {
      fail(res, 403, 'not_member', '你已不在该房间中');
      return;
    }
    // 客户端重连后主动对齐：返回本人当前许可与对应的短期 token（发布或订阅）
    const permission = voicePermission(state, session.playerId);
    let token: string;
    if (permission.canPublish) {
      room.voiceGranted.add(session.playerId);
      token = voice.issuePublishGrant({ roomName: room.gameId, uid: player.seat }).token;
    } else {
      room.voiceGranted.delete(session.playerId);
      token = voice.issueSubscriberGrant({ roomName: room.gameId, uid: player.seat }).token;
    }
    res.json({ permission, token });
  });

  const webRoot = deps.webRoot ?? null;
  if (webRoot !== null && existsSync(webRoot)) {
    app.use(express.static(webRoot));
    app.use((req, res, next) => {
      if (
        req.method !== 'GET' ||
        req.path === '/healthz' ||
        req.path === '/socket.io' ||
        req.path.startsWith('/socket.io/') ||
        req.path.startsWith('/api/') ||
        !req.accepts('html')
      ) {
        next();
        return;
      }
      res.sendFile(join(webRoot, 'index.html'));
    });
  }

  return app;
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function setSessionCookie(
  res: Response,
  deps: AppDeps,
  gameId: string,
  playerId: string,
  kind?: 'spectator',
): void {
  const token = signSession(
    { gameId, playerId, issuedAt: deps.clock.now(), ...(kind === 'spectator' ? { kind } : {}) },
    deps.sessionSecret,
  );
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: deps.cookieSecure,
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

/** 观战者离开观战（被移出或主动退出）时移除其媒体参与者；失败只记日志，不影响业务结果 */
function removeVoiceViewer(deps: AppDeps, gameId: string, uid: number): void {
  const voice = deps.voice ?? null;
  if (voice === null) {
    return;
  }
  void voice.removeParticipant(gameId, uid).catch((error: unknown) => {
    console.warn(`[theater-death] 移除语音参与者失败：${String(error)}`);
  });
}

function clearSessionCookie(res: Response, deps: AppDeps): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: deps.cookieSecure,
    path: '/',
  });
}

function requireSession(req: Request, res: Response, deps: AppDeps): SessionPayload | null {
  const raw: unknown = req.cookies?.[SESSION_COOKIE_NAME];
  const session = typeof raw === 'string' ? verifySession(raw, deps.sessionSecret) : null;
  if (session === null) {
    fail(res, 401, 'unauthorized', '需要有效的会话凭证');
    return null;
  }
  return session;
}

function resolveRoomMember(
  req: Request,
  res: Response,
  deps: AppDeps,
): { room: Room; session: SessionPayload; member: RoomMember } | null {
  const session = requireSession(req, res, deps);
  if (session === null) {
    return null;
  }
  const room = deps.registry.getByGameId(session.gameId);
  if (room === null) {
    fail(res, 404, 'room_not_found', '房间不存在或服务已重启');
    return null;
  }
  room.lastActivityAt = deps.clock.now();
  const member = room.members.find((item) => item.playerId === session.playerId);
  if (member === undefined) {
    fail(res, 403, 'not_member', '你已不在该房间中');
    return null;
  }
  return { room, session, member };
}

/** 会话解析：玩家或观战者（观战者以绑定玩家视角读取只读视图） */
export type ViewerContext =
  | { readonly kind: 'player'; readonly room: Room; readonly session: SessionPayload; readonly member: RoomMember }
  | {
      readonly kind: 'spectator';
      readonly room: Room;
      readonly session: SessionPayload;
      readonly spectator: RoomSpectator;
    };

function resolveViewer(req: Request, res: Response, deps: AppDeps): ViewerContext | null {
  const session = requireSession(req, res, deps);
  if (session === null) {
    return null;
  }
  const room = deps.registry.getByGameId(session.gameId);
  if (room === null) {
    fail(res, 404, 'room_not_found', '房间不存在或服务已重启');
    return null;
  }
  room.lastActivityAt = deps.clock.now();
  if (session.kind === 'spectator') {
    const spectator = room.spectators.find((item) => item.spectatorId === session.playerId);
    if (spectator === undefined) {
      fail(res, 403, 'not_member', '你已不在该房间中');
      return null;
    }
    return { kind: 'spectator', room, session, spectator };
  }
  const member = room.members.find((item) => item.playerId === session.playerId);
  if (member === undefined) {
    fail(res, 403, 'not_member', '你已不在该房间中');
    return null;
  }
  return { kind: 'player', room, session, member };
}

/** 观战者视角的读取主体（绑定玩家）；房间成员必然存在（加入时校验，玩家退出时清理） */
function viewerSubjectId(viewer: ViewerContext): string {
  return viewer.kind === 'player' ? viewer.member.playerId : viewer.spectator.bindPlayerId;
}

function spectatorList(room: Room): {
  spectatorId: string;
  nickname: string;
  bindPlayerId: string;
}[] {
  return room.spectators.map((spectator) => ({
    spectatorId: spectator.spectatorId,
    nickname: spectator.nickname,
    bindPlayerId: spectator.bindPlayerId,
  }));
}

function spectatingMark(viewer: ViewerContext): {
  spectatorId: string;
  nickname: string;
  bindPlayerId: string;
} | null {
  if (viewer.kind !== 'spectator') {
    return null;
  }
  return {
    spectatorId: viewer.spectator.spectatorId,
    nickname: viewer.spectator.nickname,
    bindPlayerId: viewer.spectator.bindPlayerId,
  };
}

function lobbyView(
  room: Room,
  member: RoomMember,
  voiceEnabled: boolean,
): Record<string, unknown> {
  return {
    phase: 'lobby',
    rulesetMode: room.ruleset.mode,
    requiredPlayers: room.requiredPlayerCount(),
    voice: { enabled: voiceEnabled },
    roomCode: room.code,
    gameId: room.gameId,
    you: {
      playerId: member.playerId,
      nickname: member.nickname,
      ready: member.ready,
      isHost: member.playerId === room.hostPlayerId,
    },
    members: room.members.map((item) => ({
      playerId: item.playerId,
      nickname: item.nickname,
      ready: item.ready,
      isHost: item.playerId === room.hostPlayerId,
    })),
  };
}

function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const source = req.get('origin') ?? req.get('referer');
  if (source === undefined) {
    next();
    return;
  }
  try {
    const url = new URL(source);
    if (url.host === req.get('host')) {
      next();
      return;
    }
  } catch {
    // 非法来源头按不允许处理
  }
  fail(res, 403, 'origin_forbidden', '请求来源不被允许');
}

function createRateLimiter(
  ratePerSecond: number,
  burst: number,
): (key: string, now: number) => boolean {
  const buckets = new Map<string, { tokens: number; last: number }>();
  return (key, now) => {
    if (buckets.size > 5000) {
      for (const [bucketKey, bucket] of buckets) {
        if (now - bucket.last > 60_000) {
          buckets.delete(bucketKey);
        }
      }
    }
    const bucket = buckets.get(key) ?? { tokens: burst, last: now };
    const elapsed = Math.max(0, now - bucket.last) / 1000;
    bucket.tokens = Math.min(burst, bucket.tokens + elapsed * ratePerSecond);
    bucket.last = now;
    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return true;
  };
}

function readNickname(body: unknown): string | null {
  if (body === null || typeof body !== 'object') {
    return null;
  }
  const value = (body as Record<string, unknown>).nickname;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 12) {
    return null;
  }
  return trimmed;
}

function readString(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (value.length < minLength || value.length > maxLength) {
    return null;
  }
  return value;
}

/** 对局视图的派生提示：天理、当前操作焦点、可选候选（避免客户端从事件流推演） */
function gameHints(state: GameState): {
  sheriffSeat: number | null;
  speakerSeat: number | null;
  candidateSeats: number[];
} {
  const seatOf = (playerId: string | null | undefined): number | null => {
    if (playerId === null || playerId === undefined) {
      return null;
    }
    return state.players.find((player) => player.playerId === playerId)?.seat ?? null;
  };

  const day = state.day;
  let speakerId: string | null = null;
  let candidateSeats: number[] = [];
  if (day !== null) {
    switch (day.step) {
      case 'first_night_last_words':
      case 'elimination_last_words':
        speakerId = day.lastWords?.queue[day.lastWords.index] ?? null;
        break;
      case 'election': {
        const election = day.election;
        if (election !== null) {
          if (election.phase === 'speech') {
            speakerId = election.speechOrder[election.speechIndex] ?? null;
          }
          const targets =
            election.phase === 'revote'
              ? election.tiedIds
              : election.speechOrder.filter(
                  (candidateId) => !election.withdrawn.includes(candidateId),
                );
          candidateSeats = targets
            .map((candidateId) => seatOf(candidateId))
            .filter((seat): seat is number => seat !== null)
            .sort((left, right) => left - right);
        }
        break;
      }
      case 'speech_round':
        speakerId = day.speechRound?.order[day.speechRound.index] ?? null;
        break;
      case 'vote':
        if (day.ballot?.phase === 'tie_speech') {
          speakerId = day.ballot.tiedIds[day.ballot.tieSpeechIndex] ?? null;
        }
        break;
      case 'handover':
        speakerId = day.handover?.resolved === false ? day.handover.deadSheriffId : null;
        break;
      default:
        break;
    }
  }

  return {
    sheriffSeat: seatOf(state.sheriff.holderId),
    speakerSeat: seatOf(speakerId),
    candidateSeats,
  };
}

function readStringArray(value: unknown, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxLength) {
    return null;
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length < 1 || item.length > 80) {
      return null;
    }
    result.push(item);
  }
  return result;
}

function readOptionalTarget(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string' && value.length >= 1 && value.length <= 80) {
    return value;
  }
  return undefined;
}

type ParsedCommand = GameCommand | { error: { code: string; message: string } };

function toGameCommand(
  action: string,
  body: Record<string, unknown>,
  playerId: string,
): ParsedCommand | null {
  switch (action) {
    case 'SUBMIT_GUARD': {
      const targets = readStringArray(body.targets, 2);
      if (targets === null) {
        return {
          error: { code: 'invalid_targets', message: 'targets 需为最多 2 个玩家编号的数组' },
        };
      }
      return { type: 'SUBMIT_GUARD', playerId, targetIds: targets };
    }
    case 'SUBMIT_LAIKE': {
      const target = readOptionalTarget(body.target);
      if (target === undefined) {
        return { error: { code: 'invalid_target', message: 'target 需为玩家编号或 null' } };
      }
      return { type: 'SUBMIT_LAIKE', playerId, targetId: target };
    }
    case 'EDIT_PROPOSAL': {
      const targets = readStringArray(body.targets, 4);
      if (targets === null) {
        return { error: { code: 'invalid_targets', message: 'targets 需为玩家编号数组' } };
      }
      return { type: 'EDIT_PROPOSAL', playerId, targets };
    }
    case 'CONFIRM_PROPOSAL': {
      const revision = body.revision;
      if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
        return { error: { code: 'invalid_revision', message: 'revision 需为正整数' } };
      }
      return { type: 'CONFIRM_PROPOSAL', playerId, revision };
    }
    case 'SUBMIT_CHECK': {
      const target = readString(body.target, 1, 80);
      if (target === null) {
        return { error: { code: 'invalid_target', message: 'target 必填' } };
      }
      return { type: 'SUBMIT_CHECK', playerId, targetId: target };
    }
    case 'SUBMIT_RESCUE': {
      const target = readOptionalTarget(body.target);
      if (target === undefined) {
        return { error: { code: 'invalid_target', message: 'target 需为玩家编号或 null' } };
      }
      return { type: 'SUBMIT_RESCUE', playerId, targetId: target };
    }
    case 'SUBMIT_REVIVE': {
      const target = readOptionalTarget(body.target);
      if (target === undefined) {
        return { error: { code: 'invalid_target', message: 'target 需为玩家编号或 null' } };
      }
      return { type: 'SUBMIT_REVIVE', playerId, targetId: target };
    }
    case 'END_LAST_WORDS':
      return { type: 'END_LAST_WORDS', playerId };
    case 'REGISTER_CANDIDACY':
      return { type: 'REGISTER_CANDIDACY', playerId };
    case 'WITHDRAW_CANDIDACY':
      return { type: 'WITHDRAW_CANDIDACY', playerId };
    case 'END_ELECTION_SPEECH':
      return { type: 'END_ELECTION_SPEECH', playerId };
    case 'SUBMIT_ELECTION_VOTE': {
      const target = readOptionalTarget(body.target);
      if (target === undefined) {
        return { error: { code: 'invalid_target', message: 'target 需为玩家编号或 null' } };
      }
      return { type: 'SUBMIT_ELECTION_VOTE', playerId, targetId: target };
    }
    case 'DESIGNATE_SPEECH': {
      const start = readString(body.start, 1, 80);
      const direction = body.direction;
      if (start === null) {
        return { error: { code: 'invalid_start', message: 'start 必填' } };
      }
      if (direction !== 'asc' && direction !== 'desc') {
        return { error: { code: 'invalid_direction', message: 'direction 需为 asc 或 desc' } };
      }
      return { type: 'DESIGNATE_SPEECH', playerId, startPlayerId: start, direction };
    }
    case 'END_SPEECH':
      return { type: 'END_SPEECH', playerId };
    case 'SUBMIT_DAY_VOTE': {
      const target = readOptionalTarget(body.target);
      if (target === undefined) {
        return { error: { code: 'invalid_target', message: 'target 需为玩家编号或 null' } };
      }
      return { type: 'SUBMIT_DAY_VOTE', playerId, targetId: target };
    }
    case 'END_TIE_SPEECH':
      return { type: 'END_TIE_SPEECH', playerId };
    case 'SUBMIT_HANDOVER': {
      const target = readOptionalTarget(body.target);
      if (target === undefined) {
        return { error: { code: 'invalid_target', message: 'target 需为玩家编号或 null' } };
      }
      return { type: 'SUBMIT_HANDOVER', playerId, targetId: target };
    }
    default:
      return null;
  }
}
