import type { RoomDirectory } from './room-directory.ts';
import type { EmptyRooms } from './empty-rooms.ts';

/** Expired authentication removes control, not formal membership. Empty policy owns disposal. */
export function createMaintenance(directory: RoomDirectory, empty: EmptyRooms, collectAssets?: () => Promise<unknown>) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<void> | null = null;
  let nextAssetCollection = 0;
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
