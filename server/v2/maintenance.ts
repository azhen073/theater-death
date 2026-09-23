import type { RoomDirectory } from './room-directory.ts';
import type { EmptyRooms } from './empty-rooms.ts';
import type { StableRoom } from './stable-room.ts';

/** D 组频道对账的调度参数：间隔与执行体（执行体在媒体自己的串行队列里跑，不占游戏队列）。 */
export interface ReconcileOptions { readonly intervalMs: number; readonly run: (room: StableRoom) => Promise<void> }

/** Expired authentication removes control, not formal membership. Empty policy owns disposal. */
export function createMaintenance(directory: RoomDirectory, empty: EmptyRooms, collectAssets?: () => Promise<unknown>, reconcile?: ReconcileOptions) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<void> | null = null;
  let nextAssetCollection = 0;
  const nextReconcile = new Map<string, number>();
  const reconciling = new Set<string>();
  /** 到点才跑、同一房间不并发；失败静默（媒体失败不改变胜负、不暂停计时）。 */
  const reconcileRoom = (room: StableRoom): void => {
    if (!reconcile || reconciling.has(room.roomId)) return;
    const now = directory.deps.clock.now();
    if (now < (nextReconcile.get(room.roomId) ?? 0)) return;
    nextReconcile.set(room.roomId, now + reconcile.intervalMs);
    reconciling.add(room.roomId);
    void reconcile.run(room).catch(() => undefined).finally(() => { reconciling.delete(room.roomId); });
  };
  const sweep = (): Promise<void> => {
    if (active) return active;
    active = (async () => {
      directory.deps.accounts.collectExpired();
      for (const room of [...directory.byId.values()]) await directory.transaction(() => room.enqueue(() => {
        if (room.dissolved) return;
        for (const member of room.members.values()) if (member.sessionId && !directory.deps.accounts.sessionActive(member.sessionId)) directory.releaseControl(room, member, 'session_expired');
        for (const [key, invite] of room.access?.invitations ?? []) if (invite.expiresAt <= directory.deps.clock.now()) room.access!.invitations.delete(key);
        empty.observe(room); empty.expireIfDue(room);
        directory.deps.changed(room);
      }));
      for (const room of [...directory.byId.values()]) {
        if (room.dissolved) { nextReconcile.delete(room.roomId); continue; }
        reconcileRoom(room);
      }
      if (collectAssets && directory.deps.clock.now() >= nextAssetCollection) {
        await collectAssets();
        nextAssetCollection = directory.deps.clock.now() + 3600_000;
      }
    })().finally(() => { active = null; });
    return active;
  };
  return {
    sweep,
    start() { if (!timer) { timer = setInterval(() => { void sweep().catch(() => console.warn('room_maintenance_failed')); }, 1000); timer.unref(); } },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
    drain() { return active ?? Promise.resolve(); },
  };
}
