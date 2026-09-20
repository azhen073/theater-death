import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, enter, json, makeHarness, post, request, type HttpHarness, type User } from './contract-http-utils.ts';

afterEach(closeHarnesses);

async function startRoom(h: HttpHarness) {
  const created = await request(h, '/api/v2/rooms', post({ requestId: 'combined-create' }), h.users[0]);
  const room = await created.json() as { roomId: string; roomCode: string };
  for (let index = 1; index < 13; index += 1) await enter(h, room.roomCode, h.users[index]!, `combined-enter-${index}`);
  for (let index = 0; index < 13; index += 1) await request(h, `/api/v2/rooms/${room.roomCode}/ready`, post({ requestId: `combined-ready-${index}`, ready: true }), h.users[index]);
  const started = await request(h, `/api/v2/rooms/${room.roomCode}/start`, post({ requestId: 'combined-start' }), h.users[0]);
  return { room, gameId: (await started.json() as { gameId: string }).gameId };
}

function userForPlayer(h: HttpHarness, roomId: string, playerId: string): User {
  const participant = [...h.app.directory.byId.get(roomId)!.participants.values()].find(item => item.playerId === playerId)!;
  return h.users.find(user => user.userId === participant.userId)!;
}

describe('v2 atomic proposal edit and self-confirm', () => {
  it('serializes two concurrent edits based on the same revision so exactly one creates a version', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startRoom(h);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const state = stable.runtime!.state!;
    const spirits = state.players.filter(player => player.roleId === 'spirit');
    const faction = stable.runtime!.driver!.windows().find(window => window.id === 'faction')!;
    const targets = state.players.filter(player => player.life === 'alive' && !spirits.includes(player)).slice(0, 2);
    const requests = spirits.map((spirit, index) => request(h, `/api/v2/rooms/${room.roomCode}/command`, post({
      requestId: `combined-race-${index}`, gameId, windowInstanceId: faction.instanceId, action: 'EDIT_PROPOSAL',
      targets: [targets[index]!.playerId], confirmSelf: true, expectedRevision: 0,
    }), userForPlayer(h, room.roomId, spirit.playerId)));
    const receipts = await Promise.all(requests).then(items => Promise.all(items.map(json)));
    expect(receipts.filter(item => item.status === 'accepted')).toHaveLength(1);
    expect(receipts.filter(item => item.code === 'proposal_changed')).toHaveLength(1);
    const proposal = stable.runtime!.driver!.proposalState(spirits[0]!.playerId)!;
    expect(proposal.revision).toBe(1);
    expect(proposal.confirmedBy).toHaveLength(1);
  });

  it('accepts one idempotent request, records edit and confirm at the generated revision, and rejects stale concurrent edits', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startRoom(h);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const runtime = stable.runtime!;
    const state = runtime.state!;
    const spirits = state.players.filter(player => player.roleId === 'spirit');
    const author = spirits[0]!, teammate = spirits[1]!;
    const authorUser = userForPlayer(h, room.roomId, author.playerId);
    const teammateUser = userForPlayer(h, room.roomId, teammate.playerId);
    const target = state.players.find(player => player.life === 'alive' && !spirits.includes(player))!.playerId;
    const faction = runtime.driver!.windows().find(window => window.id === 'faction')!;
    const payload = { requestId: 'combined-edit', gameId, windowInstanceId: faction.instanceId, action: 'EDIT_PROPOSAL', targets: [target], confirmSelf: true, expectedRevision: 0 };

    const accepted = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post(payload), authorUser);
    expect(await json(accepted)).toMatchObject({ requestId: 'combined-edit', status: 'accepted' });
    expect(runtime.driver!.proposalState(author.playerId)).toMatchObject({ revision: 1, targetPlayerIds: [target], confirmedBy: [author.playerId] });
    const replay = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post(payload), authorUser);
    expect(await json(replay)).toEqual(await json(await request(h, `/api/v2/rooms/${room.roomCode}/games/${gameId}/receipts/combined-edit`, {}, authorUser)));
    expect(runtime.driver!.proposalState(author.playerId)?.revision).toBe(1);
    const reused = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ ...payload, expectedRevision: 1 }), authorUser);
    expect(await json(reused)).toMatchObject({ status: 'rejected', code: 'request_id_reused' });

    const view = await json(await request(h, `/api/v2/rooms/${room.roomCode}/view`, {}, authorUser));
    expect(view.capabilities.supportsProposalEditConfirmation).toBe(true);
    expect(view.submissionState).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'EDIT_PROPOSAL', requestId: 'combined-edit', revision: 1, targets: [target] }),
      expect.objectContaining({ action: 'CONFIRM_PROPOSAL', requestId: 'combined-edit', revision: 1, targets: [] }),
    ]));

    const stale = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ ...payload, requestId: 'combined-stale', targets: [], expectedRevision: 0 }), teammateUser);
    expect(await json(stale)).toMatchObject({ status: 'rejected', code: 'proposal_changed' });
    expect(runtime.driver!.proposalState(teammate.playerId)).toMatchObject({ revision: 1, targetPlayerIds: [target], confirmedBy: [author.playerId] });
  });

  it('rejects malformed combination fields and keeps legacy edits unconfirmed', async () => {
    const h = await makeHarness();
    const { room, gameId } = await startRoom(h);
    const stable = h.app.directory.byId.get(room.roomId)!;
    const spirit = stable.runtime!.state!.players.find(player => player.roleId === 'spirit')!;
    const user = userForPlayer(h, room.roomId, spirit.playerId);
    const faction = stable.runtime!.driver!.windows().find(window => window.id === 'faction')!;
    const base = { gameId, windowInstanceId: faction.instanceId, action: 'EDIT_PROPOSAL', targets: [] };
    for (const [index, invalid] of [
      { confirmSelf: true }, { expectedRevision: 0 }, { confirmSelf: false, expectedRevision: 0 },
      { confirmSelf: true, expectedRevision: -1 }, { confirmSelf: true, expectedRevision: 1.5 },
    ].entries()) {
      const response = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ ...base, ...invalid, requestId: `combined-invalid-${index}` }), user);
      expect(await json(response)).toMatchObject({ status: 'rejected', code: 'invalid_proposal_options' });
    }
    const misplaced = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ ...base, action: 'SUBMIT_GUARD', requestId: 'combined-misplaced', confirmSelf: true, expectedRevision: 0 }), user);
    expect(await json(misplaced)).toMatchObject({ status: 'rejected', code: 'invalid_proposal_options' });
    const missingTargets = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ requestId: 'combined-no-targets', gameId, windowInstanceId: faction.instanceId, action: 'EDIT_PROPOSAL', confirmSelf: true, expectedRevision: 0 }), user);
    expect(await json(missingTargets)).toMatchObject({ status: 'rejected', code: 'invalid_proposal_options' });
    const legacy = await request(h, `/api/v2/rooms/${room.roomCode}/command`, post({ ...base, requestId: 'combined-legacy' }), user);
    expect(await json(legacy)).toMatchObject({ status: 'accepted' });
    expect(stable.runtime!.driver!.proposalState(spirit.playerId)).toMatchObject({ revision: 1, confirmedBy: [] });
  });
});
