import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { acceptProfile, SnapshotCursor, controlEffect } from '../web-v2/src/state/snapshot.ts';
import type { ControlReason, Profile, RoomSnapshot } from '../contracts/v2.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/contract-2.1/night-door-full.json', import.meta.url), 'utf8')) as RoomSnapshot;

function snapshot(): RoomSnapshot {
  return structuredClone(fixture);
}

function mutate(view: RoomSnapshot, changes: Partial<RoomSnapshot>): RoomSnapshot {
  return { ...structuredClone(view), ...changes };
}

describe('v2 frontend snapshot cursor', () => {
  it('accepts a complete 2.2/2.0 snapshot only for its account and room, and drops stale HTTP or Socket views', () => {
    const base = snapshot();
    const cursor = new SnapshotCursor(base.viewer.userId, base.roomId, () => 100);

    expect(cursor.accept(base)).toEqual({ updated: true, gameChanged: false, perspectiveChanged: false });
    const retained = cursor.snapshot();
    expect(retained).toMatchObject({
      contractVersion: '2.2', rulesVersion: '2.0', roomId: base.roomId,
      gameId: base.gameId, viewer: base.viewer, private: base.private,
    });

    const rejected = [
      mutate(base, { viewer: { ...base.viewer, userId: 'other-account' } }),
      mutate(base, { roomId: 'other-room' }),
      mutate(base, { contractVersion: '2.0' as RoomSnapshot['contractVersion'] }),
      mutate(base, { rulesVersion: '1.1' }),
      mutate(base, { viewVersion: base.viewVersion - 1 }),
    ];
    for (const view of rejected) {
      expect(cursor.accept(view)).toEqual({ updated: false, gameChanged: false, perspectiveChanged: false });
    }
    expect(cursor.snapshot()).toEqual(retained);

    const newer = mutate(base, { viewVersion: base.viewVersion + 1, serverTime: base.serverTime + 100 });
    expect(cursor.accept(newer)).toEqual({ updated: true, gameChanged: false, perspectiveChanged: false });
    const oldSocket = mutate(newer, { viewVersion: base.viewVersion, serverTime: newer.serverTime + 1_000 });
    expect(cursor.accept(oldSocket)).toEqual({ updated: false, gameChanged: false, perspectiveChanged: false });
    expect(cursor.snapshot()?.viewVersion).toBe(newer.viewVersion);
  });

  it('reports first acceptance, cross-game replacement, and perspective changes', () => {
    const base = snapshot();
    let now = 0;
    const cursor = new SnapshotCursor(base.viewer.userId, base.roomId, () => now);

    expect(cursor.accept(base)).toEqual({ updated: true, gameChanged: false, perspectiveChanged: false });
    const changed = mutate(base, {
      gameId: 'g_next',
      viewVersion: base.viewVersion + 1,
      viewer: { ...base.viewer, kind: 'private_spectator', memberId: 'm_second_screen', subjectPlayerId: null, readOnly: true },
    });
    expect(cursor.accept(changed)).toEqual({ updated: true, gameChanged: true, perspectiveChanged: true });
    expect(cursor.snapshot()).toMatchObject({ gameId: 'g_next', viewer: changed.viewer });
    now = 1_000;
  });

  it('calibrates a newer same-version server time without replacing the snapshot or extending equal samples', () => {
    const base = snapshot();
    let now = 100;
    const cursor = new SnapshotCursor(base.viewer.userId, base.roomId, () => now);

    cursor.accept(mutate(base, { serverTime: 10_000 }));
    expect(cursor.remaining(12_000)).toBe(2_000);

    now = 200;
    expect(cursor.accept(mutate(base, { serverTime: 11_000 }))).toEqual({ updated: false, gameChanged: false, perspectiveChanged: false });
    expect(cursor.snapshot()?.serverTime).toBe(10_000);
    expect(cursor.remaining(12_000)).toBe(1_000);

    now = 500;
    expect(cursor.accept(mutate(base, { serverTime: 11_000 }))).toEqual({ updated: false, gameChanged: false, perspectiveChanged: false });
    expect(cursor.remaining(12_000)).toBe(700);
    now = 2_000;
    expect(cursor.remaining(12_000)).toBe(0);
  });

  it('revokes immediately, retains the version floor, fences old tickets, and accepts a newer ticket version', () => {
    const base = snapshot();
    let now = 100;
    const cursor = new SnapshotCursor(base.viewer.userId, base.roomId, () => now);
    const oldTicket = cursor.ticket();
    cursor.accept(base, oldTicket);
    cursor.revoke();

    expect(cursor.ticket()).toBe(oldTicket + 1);
    expect(cursor.snapshot()).toBeNull();
    expect(cursor.remaining(base.serverTime + 1_000)).toBeNull();
    expect(cursor.accept(mutate(base, { viewVersion: base.viewVersion + 1 }), oldTicket)).toEqual({ updated: false, gameChanged: false, perspectiveChanged: false });
    expect(cursor.snapshot()).toBeNull();

    now = 200;
    const refreshed = mutate(base, { viewVersion: base.viewVersion + 1, serverTime: base.serverTime + 100 });
    expect(cursor.accept(refreshed, oldTicket + 1)).toEqual({ updated: true, gameChanged: false, perspectiveChanged: false });
    expect(cursor.snapshot()?.viewVersion).toBe(base.viewVersion + 1);
  });

  it('keeps accepted views and returned snapshots isolated from outside mutation', () => {
    const incoming = snapshot();
    const cursor = new SnapshotCursor(incoming.viewer.userId, incoming.roomId, () => 10);
    cursor.accept(incoming);

    incoming.room.code = 'mutated-input';
    incoming.private!.self.nickname = 'mutated-input';
    const returned = cursor.snapshot()!;
    returned.room.code = 'mutated-return';
    returned.private!.self.nickname = 'mutated-return';

    const retained = cursor.snapshot()!;
    expect(retained.room.code).toBe(fixture.room.code);
    expect(retained.private?.self.nickname).toBe(fixture.private?.self.nickname);
  });
});

describe('v2 frontend control and profile guards', () => {
  it('maps every control reason to the required client effect', () => {
    const expected: Record<ControlReason, ReturnType<typeof controlEffect>> = {
      host_changed: 'refresh', review_ended: 'clear-game', screen_revoked: 'clear-private',
      session_expired: 'login', account_disabled: 'login', kicked: 'exit', dissolved: 'exit', taken_over: 'exit', left: 'exit',
    };
    for (const [reason, effect] of Object.entries(expected) as [ControlReason, ReturnType<typeof controlEffect>][]) {
      expect(controlEffect(reason)).toBe(effect);
    }
  });

  it('accepts only the active account and a non-decreasing profile version', () => {
    const old: Profile = { userId: 'u1', uid: '10000001', nickname: 'old', avatarUrl: null, profileVersion: 2 };
    const stale: Profile = { ...old, nickname: 'stale', profileVersion: 1 };
    const sameVersion: Profile = { ...old, nickname: 'same-version', profileVersion: 2 };
    const fresh: Profile = { ...old, nickname: 'fresh', profileVersion: 3 };
    const other: Profile = { userId: 'u2', uid: '10000002', nickname: 'other', avatarUrl: null, profileVersion: 99 };

    expect(acceptProfile(old, stale, 'u1')).toEqual(old);
    expect(acceptProfile(old, sameVersion, 'u1')).toEqual(sameVersion);
    expect(acceptProfile(old, fresh, 'u1')).toEqual(fresh);
    expect(acceptProfile(old, other, 'u1')).toEqual(old);
    expect(acceptProfile(null, other, 'u1')).toBeNull();
    expect(acceptProfile(old, other, 'u2')).toEqual(other);
  });
});
