import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_PASSWORD, closeAdminHarnesses, createStartedRoom, json, jsonPost, loginAdmin, makeAdminHarness, request } from './admin-test-helper.ts';

afterEach(async () => { await closeAdminHarnesses(); });

describe('v2.2 admin account API', () => {
  it('toggles registration and exposes no invitation/reset-token surface', async () => {
    const harness = await makeAdminHarness(true); const admin = await loginAdmin(harness);
    expect((await request(harness, '/api/v2/admin/settings', {}, admin)).status).toBe(200);
    const closed = await request(harness, '/api/v2/admin/settings', { ...jsonPost({ requestId: 'settings-close', registrationEnabled: false }, admin), method: 'PATCH' }, admin);
    expect(closed.status).toBe(200); expect((await json(closed)).registrationEnabled).toBe(false);
    expect((await request(harness, '/api/v2/auth/register', jsonPost({ requestId: 'closed', nickname: '关闭注册', password: 'eight888' }))).status).toBe(403);
    expect((await request(harness, '/api/v2/admin/invitations', {}, admin)).status).toBe(404);
  });

  it('directly resets a password and deletes the account with idempotent request ids', async () => {
    const harness = await makeAdminHarness(true); const admin = await loginAdmin(harness); const target = harness.users[0]!;
    const reset = await request(harness, `/api/v2/admin/accounts/${target.userId}/reset-password`, jsonPost({ requestId: 'direct-reset', password: 'newpass8' }, admin), admin);
    expect(reset.status).toBe(200);
    expect((await request(harness, '/api/v2/auth/login', jsonPost({ uid: target.uid, password: 'newpass8' }))).status).toBe(200);
    const deleted = await request(harness, `/api/v2/admin/accounts/${target.userId}/delete`, jsonPost({ requestId: 'direct-delete' }, admin), admin);
    expect(deleted.status).toBe(200);
    expect((await request(harness, '/api/v2/auth/login', jsonPost({ uid: target.uid, password: 'newpass8' }))).status).toBe(401);
    expect((await request(harness, `/api/v2/admin/accounts/${target.userId}/delete`, jsonPost({ requestId: 'direct-delete' }, admin), admin)).status).toBe(200);
  });

  it('rejects deletion and nickname changes for a participant in a live match, including after leaving control', async () => {
    const harness = await makeAdminHarness(true); const admin = await loginAdmin(harness); const target = harness.users[0]!;
    const room = await createStartedRoom(harness);
    expect(room.gameId).toBeTruthy();
    const leave = await request(harness, `/api/v2/rooms/${room.roomCode}/leave`, jsonPost({ requestId: 'admin-active-leave' }, target.cookie), target.cookie);
    expect(leave.status).toBe(200);
    const removed = await request(harness, `/api/v2/admin/accounts/${target.userId}/delete`, jsonPost({ requestId: 'admin-active-delete' }, admin), admin);
    expect(removed.status).toBe(409); expect((await json(removed)).error.code).toBe('account_in_active_game');
    const renamed = await request(harness, `/api/v2/admin/accounts/${target.userId}`, { ...jsonPost({ requestId: 'admin-active-rename', nickname: '新昵称' }, admin), method: 'PATCH' }, admin);
    expect(renamed.status).toBe(409); expect((await json(renamed)).error.code).toBe('account_in_active_game');
  });

  it('keeps completed review identity readable after deleting its login account', async () => {
    const harness = await makeAdminHarness(true); const admin = await loginAdmin(harness); const target = harness.users[0]!;
    const started = await createStartedRoom(harness); const room = harness.app.directory.byCode.get(started.roomCode)!;
    room.runtime!.state = { ...room.runtime!.state!, phase: 'ended', win: { winner: 'human', dayNumber: 1, reason: 'delete-history' } };
    room.recordCompletion();
    const removed = await request(harness, `/api/v2/admin/accounts/${target.userId}/delete`, jsonPost({ requestId: 'admin-review-delete' }, admin), admin);
    expect(removed.status).toBe(200);
    const review = await request(harness, `/api/v2/rooms/${started.roomCode}/review`, {}, harness.users[1]!.cookie);
    expect(review.status).toBe(200);
    expect((await json(review)).review.players).toEqual(expect.arrayContaining([expect.objectContaining({ uid: target.uid, nickname: target.nickname, avatarUrl: null })]));
  });
});
