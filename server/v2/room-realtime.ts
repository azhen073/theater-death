import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import type { ControlNotice, ControlReason } from '../../contracts/v2.ts';
import type { AccountSession } from './account-store.ts';
import { accountSession } from './auth.ts';
import { ApiError } from './errors.ts';
import type { RoomDirectory } from './room-directory.ts';
import type { RoomSnapshots } from './snapshots.ts';
import type { StableRoom } from './stable-room.ts';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, type MemberPresence } from './presence.ts';

interface RealtimeDeps { directory: RoomDirectory; snapshots: RoomSnapshots; presence: MemberPresence; origin: string; cookieName?: string }
const terminal = new Set<ControlReason>(['kicked', 'dissolved', 'taken_over', 'session_expired', 'account_disabled', 'left', 'screen_revoked']);

/** Room subscriptions survive match changes. Each frame rechecks the current account and lease. */
export function createRoomRealtime(deps: RealtimeDeps) {
  let io: IOServer | null = null;
  let closing = false;
  const pending = new Set<string>();
  const resolve = (cookie: string, roomId: string) => {
    const session = accountSession(deps.directory.deps.accounts, cookie, deps.cookieName);
    const room = deps.directory.byId.get(roomId);
    if (!session || !room || room.dissolved) return null;
    try { deps.directory.member(room, session); return { room, session }; } catch { return null; }
  };
  const notice = (socket: Socket, data: ControlNotice) => {
    socket.emit('control', data);
    if (terminal.has(data.reason)) socket.disconnect(true);
  };
  const invalidReason = (socket: Socket): ControlReason => {
    const session = accountSession(deps.directory.deps.accounts, socket.data.cookie as string, deps.cookieName);
    if (!session) return 'session_expired';
    const room = deps.directory.byId.get(socket.data.roomId as string);
    if (!room || room.dissolved) return 'dissolved';
    return room.members.has(session.userId) ? 'taken_over' : 'kicked';
  };
  const send = (socket: Socket) => {
    if (closing || !socket.connected) return;
    const roomId = socket.data.roomId as string;
    const resolved = resolve(socket.data.cookie as string, roomId);
    if (!resolved) { notice(socket, { roomId, gameId: null, reason: invalidReason(socket) }); return; }
    let snapshot;
    try { snapshot = deps.snapshots.read(resolved.room, resolved.session); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'room_not_found') notice(socket, { roomId, gameId: resolved.room.gameId, reason: 'dissolved' });
      else { console.warn('snapshot_projection_failed'); socket.emit('sync_error', { code: 'snapshot_unavailable' }); socket.disconnect(true); }
      return;
    }
    if (socket.data.version === snapshot.viewVersion) return;
    socket.data.version = snapshot.viewVersion;
    socket.emit('view_updated', snapshot);
  };
  const refresh = (roomId: string) => {
    if (closing || pending.has(roomId)) return;
    pending.add(roomId);
    queueMicrotask(() => {
      pending.delete(roomId);
      if (closing) return;
      for (const socket of io?.sockets.sockets.values() ?? []) if (socket.data.roomId === roomId) send(socket);
    });
  };
  return {
    refresh,
    control(room: StableRoom, sessionId: string | null, reason: ControlReason) {
      if (closing) return;
      for (const socket of io?.sockets.sockets.values() ?? []) {
        if (socket.data.roomId !== room.roomId || (sessionId !== null && socket.data.sessionId !== sessionId)) continue;
        notice(socket, { roomId: room.roomId, gameId: room.gameId, reason });
      }
    },
    attachV2(server: HttpServer) {
      if (io) throw new Error('Realtime server already attached');
      io = new IOServer(server, {
        path: '/api/v2/socket.io', pingInterval: HEARTBEAT_INTERVAL_MS, pingTimeout: HEARTBEAT_TIMEOUT_MS,
        allowRequest(req, callback) { callback(null, !req.headers.origin || req.headers.origin === deps.origin); },
      });
      io.use((socket, next) => {
        const roomId: unknown = socket.handshake.auth.roomId;
        const cookie = socket.handshake.headers.cookie ?? '';
        const resolved = typeof roomId === 'string' && roomId.length <= 80 ? resolve(cookie, roomId) : null;
        if (!resolved) return next(new Error('unauthorized'));
        socket.data.roomId = roomId; socket.data.cookie = cookie;
        socket.data.sessionId = resolved.session.id; socket.data.session = resolved.session;
        next();
      });
      io.on('connection', (socket) => {
        const room = deps.directory.byId.get(socket.data.roomId as string);
        if (!room || room.dissolved) { notice(socket, { roomId: socket.data.roomId as string, gameId: null, reason: 'dissolved' }); return; }
        const session = socket.data.session as AccountSession;
        socket.on('disconnect', (reason) => {
          if (!closing) void deps.presence.disconnect(room, session, socket.id, reason).catch(() => console.warn('presence_disconnect_failed'));
        });
        void deps.presence.connect(room, session, socket.id).then(() => send(socket)).catch(() => {
          if (!closing && socket.connected) notice(socket, { roomId: room.roomId, gameId: room.gameId, reason: invalidReason(socket) });
        });
      });
    },
    connectionCount(roomId?: string): number { return [...(io?.sockets.sockets.values() ?? [])].filter((s) => !roomId || s.data.roomId === roomId).length; },
    close() { closing = true; pending.clear(); io?.close(); },
  };
}
