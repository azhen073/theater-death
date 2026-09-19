import { Router, type Request } from 'express';
import type { RoomRegistry } from '../rooms.ts';
import type { Clock } from '../clock.ts';
import type { AccountStore, AccountSession } from './account-store.ts';
import type { RoomAccess } from './access.ts';
import { requireAccount, textField } from './auth.ts';
import { ApiError } from './errors.ts';
import { RateLimits } from './rate-limit.ts';

export interface SpectatorDeps { accounts: AccountStore; clock: Clock; registry: RoomRegistry; access: Map<string, RoomAccess>; refresh: (id: string) => void; cookieName?: string }
export function spectatorContext(deps: SpectatorDeps) {
  const limits = new RateLimits(() => deps.clock.now());
  const mutate = async <T>(req: Request, operation: (meta: RoomAccess, session: AccountSession) => T) => {
    const session = requireAccount(deps.accounts, req, deps.cookieName);
    if (!limits.allow(session.userId, 10, 60_000)) throw new ApiError(429, 'rate_limited');
    const room = deps.registry.getByCode(String(req.params.code).toUpperCase());
    const meta = room ? deps.access.get(room.gameId) : null;
    if (!meta) throw new ApiError(404, 'room_not_found');
    return meta.room.enqueue(() => {
      const current = requireAccount(deps.accounts, req, deps.cookieName);
      const result = operation(meta, current);
      meta.lastConnectedAt = deps.clock.now(); deps.refresh(meta.room.gameId);
      return result;
    });
  };
  return { mutate };
}
export function publicSpectatorRouter(deps: SpectatorDeps) {
  const router = Router(); const { mutate } = spectatorContext(deps);
  router.post('/rooms/:code/watch', async (req, res) => {
    res.status(201).json(await mutate(req, (meta, s) => {
      if (req.body?.bindPlayerId !== undefined || req.body?.subjectPlayerId !== undefined) throw new ApiError(400, 'public_view_only');
      return { spectatorId: meta.watch(s), mode: 'public' };
    }));
  });
  router.post('/rooms/:code/unwatch', async (req, res) => {
    res.json(await mutate(req, (meta, s) => {
      const viewer = meta.resolve(s);
      if (!viewer || !viewer.identity.readOnly) throw new ApiError(403, 'spectator_required');
      meta.unwatch(s.userId); return { left: true };
    }));
  });
  router.post('/rooms/:code/kick-spectator', async (req, res) => {
    res.json(await mutate(req, (meta, s) => {
      const viewer = meta.resolve(s);
      if (!viewer || viewer.identity.readOnly || viewer.identity.subjectPlayerId !== meta.room.hostPlayerId) throw new ApiError(403, 'not_host');
      const id = textField(req.body?.spectatorId, 'spectator_id');
      const watcher = [...meta.watchers.values()].find((w) => w.id === id);
      if (!watcher) throw new ApiError(404, 'spectator_not_found');
      meta.unwatch(watcher.userId); return { removed: true };
    }));
  });
  router.get('/rooms/:code/spectators', async (req, res) => {
    res.json(await mutate(req, (meta, s) => {
      const viewer = meta.resolve(s);
      if (!viewer || viewer.identity.readOnly || viewer.identity.subjectPlayerId !== meta.room.hostPlayerId) throw new ApiError(403, 'not_host');
      return { spectators: [...meta.watchers.values()].map((w) => ({ spectatorId: w.id, subjectPlayerId: w.subject })) };
    }));
  });
  return router;
}
