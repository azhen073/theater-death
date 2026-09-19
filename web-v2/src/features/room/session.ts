import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { ControlNotice, RoomSnapshot } from '../../../../contracts/v2.ts';
import type { BootstrapDTO } from '../../../../contracts/catalog.ts';
import { SnapshotCursor, controlEffect } from '../../state/snapshot.ts';
import { ApiFailure, errorMessage, get } from '../../transport/http.ts';

export interface RoomReference { roomId: string; roomCode: string }
export type Connection = 'connecting' | 'online' | 'reconnecting' | 'offline';
const controlText: Record<ControlNotice['reason'], string> = {
  kicked: '你已被房主移出房间。', dissolved: '房间已解散。', taken_over: '另一台设备已接管你的房间身份。',
  session_expired: '登录已失效，请重新登录。', account_disabled: '账户已停用，请联系维护者。', host_changed: '房主已变更。', review_ended: '房主已结束复盘，返回大厅。',
  left: '你已离开房间。', screen_revoked: '私人第二屏已撤销，正在恢复公开视角。',
};

/** Mount at the authenticated shell, not the room page: visiting Account is not a disconnect. */
export function useRoomSession(userId: string, reference: RoomReference | null, bootstrap: BootstrapDTO, callbacks: {
  onExpired: () => void; onExit: (message: string) => void;
}) {
  const latestCallbacks = useRef(callbacks); latestCallbacks.current = callbacks;
  const [view, setView] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [notice, setNotice] = useState('');
  const [boundary, setBoundary] = useState(0);
  const cursorRef = useRef<SnapshotCursor | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const roomId = reference?.roomId, roomCode = reference?.roomCode;
  useEffect(() => {
    setView(null); setNotice(''); setConnection('connecting'); setBoundary(value => value + 1);
    if (!roomId || !roomCode) { cursorRef.current = null; refreshRef.current = async () => {}; return; }
    const cursor = new SnapshotCursor(userId, roomId); cursorRef.current = cursor;
    const abort = new AbortController(); let ended = false; let grace: ReturnType<typeof setTimeout> | null = null;
    const socket = io({ path: bootstrap.socket.path, auth: { roomId }, withCredentials: true, autoConnect: false });
    const stop = () => { ended = true; abort.abort(); cursor.revoke(); socket.removeAllListeners(); socket.disconnect(); if (grace) clearTimeout(grace); };
    const apply = (next: RoomSnapshot, ticket = cursor.ticket()) => {
      if (ended) return;
      const change = cursor.accept(next, ticket);
      if (change.updated) {
        setView(cursor.snapshot());
        if (change.gameChanged || change.perspectiveChanged) setBoundary(value => value + 1);
      }
      if (cursor.snapshot() && socket.connected) { setConnection('online'); if (grace) clearTimeout(grace); }
    };
    const refresh = async () => {
      const ticket = cursor.ticket();
      try {
        const next = await get<RoomSnapshot>(`/rooms/${encodeURIComponent(roomCode)}/view`, abort.signal);
        apply(next, ticket);
      } catch (error) {
        if (ended || ticket !== cursor.ticket()) return;
        if (error instanceof ApiFailure && error.code === 'unauthorized') {
          stop(); setView(null); latestCallbacks.current.onExpired();
        } else if (error instanceof ApiFailure && ['room_not_found', 'room_access_required', 'seat_control_required', 'takeover_required'].includes(error.code)) {
          stop(); setView(null); latestCallbacks.current.onExit(errorMessage(error));
        } else { setNotice(errorMessage(error)); setConnection('offline'); }
      }
    };
    refreshRef.current = async () => {
      await refresh();
      if (!ended && cursor.snapshot() && !socket.connected) socket.connect();
    };
    socket.on('view_updated', (next: RoomSnapshot) => apply(next));
    socket.on('connect', () => { if (!ended) { setConnection('connecting'); void refresh(); } });
    socket.on('connect_error', () => { if (!ended) { setConnection('offline'); void refresh(); } });
    socket.on('sync_error', () => {
      if (ended) return;
      setConnection('offline'); setNotice('房间状态暂时无法同步，请重新连接。');
    });
    socket.on('disconnect', reason => {
      if (ended) return;
      if (grace) clearTimeout(grace);
      setConnection(reason === 'ping timeout' ? 'offline' : 'reconnecting');
      grace = setTimeout(() => { if (!ended) setConnection('offline'); }, bootstrap.socket.disconnectGraceMs);
    });
    socket.on('control', (control: ControlNotice) => {
      if (ended || control.roomId !== roomId || !(control.reason in controlText)) return;
      const effect = controlEffect(control.reason);
      setNotice(controlText[control.reason]);
      if (effect === 'refresh') { void refresh(); return; }
      cursor.revoke(); setView(null); setBoundary(value => value + 1); setConnection('connecting');
      if (effect === 'login' || effect === 'exit') {
        stop();
        if (effect === 'login') latestCallbacks.current.onExpired(); else latestCallbacks.current.onExit(controlText[control.reason]);
      } else if (effect === 'clear-private') {
        // The server closes this private subscription. A freshly authorized public view
        // is required before reconnecting; never re-enter or redeem automatically.
        socket.disconnect();
        void refresh().then(() => { if (!ended && cursor.snapshot()) socket.connect(); });
      } else void refresh();
    });
    socket.connect(); void refresh();
    return () => { stop(); if (cursorRef.current === cursor) { cursorRef.current = null; refreshRef.current = async () => {}; } };
  }, [userId, roomId, roomCode, bootstrap.socket.path, bootstrap.socket.disconnectGraceMs]);
  const authorizedView = view && view.roomId === roomId && view.viewer.userId === userId ? view : null;
  return {
    view: authorizedView, connection, notice, boundary,
    refresh: () => refreshRef.current(),
    remaining: (deadline: number) => cursorRef.current?.remaining(deadline) ?? null,
    canWrite: connection === 'online' && authorizedView !== null,
  };
}
