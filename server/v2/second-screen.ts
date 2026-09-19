import { Router } from 'express';
import { textField } from './auth.ts';
import { ApiError } from './errors.ts';
import { spectatorContext, type SpectatorDeps } from './spectators.ts';

export function secondScreenRouter(deps: SpectatorDeps) {
  const router = Router(); const { mutate } = spectatorContext(deps);
  router.post('/rooms/:code/second-screen/invitations', async (req, res) => {
    res.status(201).json(await mutate(req, (meta, s) => {
      const viewer = meta.resolve(s);
      if (!viewer || viewer.identity.readOnly || !viewer.identity.subjectPlayerId) throw new ApiError(403, 'seat_control_required');
      return meta.inviteScreen(viewer.identity.subjectPlayerId);
    }));
  });
  router.post('/rooms/:code/second-screen/redeem', async (req, res) => {
    res.status(201).json(await mutate(req, (meta, s) => ({ spectatorId: meta.redeem(s, textField(req.body?.token, 'token')), mode: 'private' })));
  });
  router.post('/rooms/:code/second-screen/revoke', async (req, res) => {
    res.json(await mutate(req, (meta, s) => {
      const viewer = meta.resolve(s);
      if (!viewer || viewer.identity.readOnly || !viewer.identity.subjectPlayerId) throw new ApiError(403, 'seat_control_required');
      meta.revokeScreens(viewer.identity.subjectPlayerId); return { revoked: true };
    }));
  });
  return router;
}
