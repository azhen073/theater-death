import { afterEach, describe, expect, it } from 'vitest';
import { acceptProfile, HttpFailure, postJson, SnapshotCursor } from '../docs/examples/contract-client.ts';
import { closeHarnesses, createRoom, makeHarness, request, type HttpHarness } from './contract-http-utils.ts';
import type { Profile, RoomSnapshot } from '../contracts/v2.ts';

afterEach(closeHarnesses);

async function snapshotFixture(h: HttpHarness): Promise<RoomSnapshot> {
  const created = await createRoom(h);
  expect(created.response.status).toBe(201);
  const body = created.body as { roomId: string; roomCode: string };
  const response = await request(h, `/api/v2/rooms/${body.roomCode}/view`, {}, h.users[0]);
  expect(response.status).toBe(200);
  return await response.json() as RoomSnapshot;
}

function mutate(view: RoomSnapshot, changes: Partial<RoomSnapshot>): RoomSnapshot {
  return { ...structuredClone(view), ...changes };
}

describe('contract client example helpers', () => {
  it('accepts only the active account and room, rejects older versions, and reports game changes', async () => {
    const h = await makeHarness();
    const base = await snapshotFixture(h);
    let now = 1_000;
    const cursor = new SnapshotCursor(base.viewer.userId, base.roomId, () => now);
    expect(cursor.accept(base)).toEqual({ updated: true, gameChanged: false });
    const original = cursor.snapshot()!;
    expect(cursor.accept(mutate(base, { viewer: { ...base.viewer, userId: 'other-user' } }))).toEqual({ updated: false, gameChanged: false });
    expect(cursor.accept(mutate(base, { roomId: 'other-room' }))).toEqual({ updated: false, gameChanged: false });
    expect(cursor.snapshot()).toEqual(original);

    const newer = mutate(base, { viewVersion: base.viewVersion + 1, serverTime: base.serverTime + 100 });
    expect(cursor.accept(newer)).toEqual({ updated: true, gameChanged: false });
    expect(cursor.remainingMs(newer.serverTime + 1_000)).toBe(1_000);
    const beforeOld = cursor.snapshot();
    expect(cursor.accept(mutate(base, { viewVersion: base.viewVersion, serverTime: base.serverTime + 10_000 }))).toEqual({ updated: false, gameChanged: false });
    expect(cursor.snapshot()).toEqual(beforeOld);
    expect(cursor.remainingMs(newer.serverTime + 1_000)).toBe(1_000);

    const nextGame = mutate(newer, { gameId: 'g_next', viewVersion: newer.viewVersion + 1, serverTime: newer.serverTime + 100 });
    expect(cursor.accept(nextGame)).toEqual({ updated: true, gameChanged: true });
    expect(cursor.snapshot()?.gameId).toBe('g_next');
    now += 5_000;
    expect(cursor.remainingMs(nextGame.serverTime + 1_000)).toBe(0);
  });

  it('uses newer serverTime at the same viewVersion only for clock calibration and clamps countdown at zero', async () => {
    const h = await makeHarness();
    const base = await snapshotFixture(h);
    let now = 100;
    const cursor = new SnapshotCursor(base.viewer.userId, base.roomId, () => now);
    cursor.accept({ ...base, serverTime: 10_000 });
    expect(cursor.remainingMs(12_000)).toBe(2_000);
    const sameVersion = { ...base, serverTime: 11_000 };
    expect(cursor.accept(sameVersion)).toEqual({ updated: false, gameChanged: false });
    expect(cursor.snapshot()?.serverTime).toBe(10_000);
    expect(cursor.remainingMs(12_000)).toBe(1_000);
    now = 1_200;
    expect(cursor.remainingMs(12_000)).toBe(0);
  });

  it('clear removes the private snapshot and timing sample', async () => {
    const h = await makeHarness();
    const base = await snapshotFixture(h);
    const cursor = new SnapshotCursor(base.viewer.userId, base.roomId, () => 10);
    cursor.accept(base);
    cursor.clear();
    expect(cursor.snapshot()).toBeNull();
    expect(cursor.remainingMs(base.serverTime + 1_000)).toBeNull();
  });

  it('acceptProfile keeps only the active account and non-decreasing profile version', () => {
    const old: Profile = { userId: 'u1', uid: '10000001', nickname: 'old', avatarUrl: null, profileVersion: 2 };
    const stale: Profile = { ...old, nickname: 'stale', profileVersion: 1 };
    const fresh: Profile = { ...old, nickname: 'fresh', profileVersion: 3 };
    const other: Profile = { userId: 'u2', uid: '10000002', nickname: 'other', avatarUrl: null, profileVersion: 99 };
    expect(acceptProfile(old, stale, 'u1')).toEqual(old);
    expect(acceptProfile(old, fresh, 'u1')).toEqual(fresh);
    expect(acceptProfile(old, other, 'u1')).toEqual(old);
    expect(acceptProfile(null, other, 'u1')).toBeNull();
    expect(acceptProfile(old, other, 'u2')).toEqual(other);
  });

  it('postJson includes credentials, preserves intent, distinguishes HTTP failure, and preserves network errors', async () => {
    const seen: Array<{ path: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      seen.push({ path: String(input), init: init! });
      return { ok: true, status: 200, json: async () => ({ accepted: true }) } as Response;
    };
    const intent = { requestId: 'same-id', gameId: 'g1', action: 'END_SPEECH' };
    await expect(postJson('/rooms/R/command', intent, fetcher)).resolves.toEqual({ accepted: true });
    await expect(postJson('/rooms/R/command', intent, fetcher)).resolves.toEqual({ accepted: true });
    expect(seen).toHaveLength(2);
    expect(seen.every((entry) => entry.init.credentials === 'include')).toBe(true);
    expect(seen.every((entry) => entry.init.body === JSON.stringify(intent))).toBe(true);
    expect(intent).toEqual({ requestId: 'same-id', gameId: 'g1', action: 'END_SPEECH' });

    const rejectedFetcher = async () => ({ ok: false, status: 409, json: async () => ({ error: { code: 'request_id_reused' } }) } as Response);
    await expect(postJson('/rooms/R/command', intent, rejectedFetcher)).rejects.toMatchObject({ status: 409, code: 'request_id_reused' } satisfies Partial<HttpFailure>);
    const unknownFetcher = async () => ({ ok: false, status: 500, json: async () => ({}) } as Response);
    await expect(postJson('/rooms/R/command', intent, unknownFetcher)).rejects.toMatchObject({ status: 500, code: 'unknown_error' });
    const networkError = new Error('offline');
    const networkFetcher = async () => { throw networkError; };
    await expect(postJson('/rooms/R/command', intent, networkFetcher)).rejects.toBe(networkError);
  });
});
