import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import type { Broadcaster } from '../realtime.ts';
import type { Room } from '../rooms.ts';
import { gameView, type ViewIdentity } from './view.ts';
import { publishedState } from '../../visibility/knowledge.ts';
import { canReadRoomMessage } from '../../visibility/rooms.ts';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from './presence.ts';

export interface ResolvedViewer { room: Room; identity: ViewIdentity; principalId: string; mediaIdentity: string }
export type ResolveViewer = (cookie: string, gameId: string) => ResolvedViewer | null;

export function chatView(viewer: ResolvedViewer) {
  const { room, identity } = viewer;
  const known = room.state === null ? null : publishedState(room.state, room.events);
  const publicMessages = room.chat.filter((m) => m.channel === 'public');
  const privateMessages = known === null || identity.subjectPlayerId === null ? [] : room.chat.filter((m) => m.channel === 'faction' && canReadRoomMessage(known, identity.subjectPlayerId!, m.eventSeq));
  const present = (items: typeof room.chat) => items.map((m, i) => ({ cursor: i + 1, senderId: m.senderId, text: m.text, at: m.at }));
  return { public: present(publicMessages), faction: present(privateMessages) };
}

/** Every push resolves authorization afresh; revoked sockets never receive another private frame. */
export function createV2Realtime(resolve: ResolveViewer, now: () => number, origin: string) {
  let io: IOServer | null = null;
  const pending = new Set<string>();
  const refresh = (gameId: string) => {
    if (pending.has(gameId)) return;
    pending.add(gameId);
    queueMicrotask(() => {
      pending.delete(gameId);
      for (const socket of io?.sockets.sockets.values() ?? []) {
        if (socket.data.gameId !== gameId) continue;
        const viewer = resolve(socket.data.cookie as string, gameId);
        if (!viewer) { socket.disconnect(true); continue; }
        const snapshot = { ...gameView(viewer.room, viewer.identity, now()), chat: chatView(viewer) };
        const { serverTime: _time, ...stable } = snapshot;
        const fingerprint = JSON.stringify(stable);
        if (socket.data.fingerprint === fingerprint) continue;
        socket.data.fingerprint = fingerprint;
        socket.emit('view_updated', snapshot);
      }
    });
  };
  const broadcaster: Broadcaster = {
    attach() { throw new Error('Use attachV2 with account authentication'); },
    emitGameEvents(gameId) { refresh(gameId); },
    emitChat(gameId) { refresh(gameId); },
    emitVoicePermission(gameId) { refresh(gameId); },
  };
  return {
    broadcaster, refresh,
    attachV2(server: HttpServer) {
      io = new IOServer(server, { path: '/api/v2/socket.io', pingInterval: HEARTBEAT_INTERVAL_MS, pingTimeout: HEARTBEAT_TIMEOUT_MS, allowRequest(req, callback) { callback(null, !req.headers.origin || req.headers.origin === origin); } });
      io.use((socket, next) => {
        const gameId: unknown = socket.handshake.auth.gameId;
        const cookie = socket.handshake.headers.cookie ?? '';
        if (typeof gameId !== 'string' || !resolve(cookie, gameId)) return next(new Error('unauthorized'));
        socket.data.gameId = gameId;
        socket.data.cookie = cookie;
        next();
      });
      io.on('connection', (socket) => { refresh(socket.data.gameId as string); });
    },
    close() { io?.close(); },
    hasConnections(gameId: string) { return [...(io?.sockets.sockets.values() ?? [])].some((s) => s.data.gameId === gameId); },
  };
}
