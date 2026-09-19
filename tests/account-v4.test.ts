import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountStore } from '../server/v2/account-store.ts';

const directories: string[] = [];
const stores: AccountStore[] = [];
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');

afterEach(() => {
  for (const store of stores.splice(0).reverse()) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A real v3 account file, including data that must survive the v4 migration. */
function seedSchemaThree(path: string, now: number): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
    INSERT INTO schema_migrations VALUES (1), (2), (3);
    CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, avatar_id TEXT, profile_version INTEGER NOT NULL DEFAULT 0, disabled_at INTEGER);
    CREATE TABLE avatar_assets (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, unreferenced_at INTEGER);
    CREATE TABLE invitations (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('register','reset')), user_id TEXT REFERENCES accounts(id), expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER, revoked_at INTEGER);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);
    CREATE INDEX sessions_user ON sessions(user_id);
    CREATE TABLE admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, at INTEGER NOT NULL, details_json TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?,?)').run('legacy-account', 'legacy_user', 'legacy-password-hash', now, null, 7, null);
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest('legacy-session-token'), 'legacy-account', now + 86_400_000);
  db.prepare('INSERT INTO invitations VALUES (?,?,?,?,?,?,?,?)').run('legacy-invite', digest('legacy-invite-token'), 'register', null, now + 86_400_000, null, now, null);
  db.close();
}

function columns(store: AccountStore, table: string): Set<string> {
  return new Set((store.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name));
}

function accountRow(store: AccountStore, id: string): Record<string, unknown> {
  return store.db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as Record<string, unknown>;
}

function call<T>(store: AccountStore, name: string, ...args: unknown[]): T {
  const method = (store as unknown as Record<string, unknown>)[name];
  expect(typeof method, `AccountStore.${name} is required by the v4 account contract`).toBe('function');
  return (method as (...values: unknown[]) => T).apply(store, args);
}

describe('account schema v4: numeric UID and Unicode nickname', () => {
  it('migrates v3 while retaining the account id, password, profile and active session', () => {
    const directory = mkdtempSync(join(tmpdir(), 'theater-account-v4-migration-'));
    directories.push(directory);
    const path = join(directory, 'accounts.sqlite');
    seedSchemaThree(path, 10_000);

    const store = new AccountStore(path, () => 10_000);
    stores.push(store);
    expect(Number(store.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version)).toBe(4);
    const accountColumns = columns(store, 'accounts');
    expect(accountColumns.has('uid')).toBe(true);
    expect(accountColumns.has('nickname')).toBe(true);

    const row = accountRow(store, 'legacy-account');
    expect(row).toMatchObject({ id: 'legacy-account', uid: '10000001', password_hash: 'legacy-password-hash', profile_version: 7 });
    expect(row.uid).toBe('10000001');
    expect(row.nickname).toBe('legacy_user');
    expect(store.session('legacy-session-token')).toMatchObject({ userId: 'legacy-account' });
    expect(store.db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'invitations\'').get()).toBeUndefined();
  });

  it('allocates UIDs from 10000001 monotonically without reusing a removed UID', () => {
    const store = new AccountStore(':memory:', () => 20_000);
    stores.push(store);
    const first = call<{ uid: string; id: string; account?: { uid: string; id: string } }>(store, 'register', 'r1', '张三', 'hash:first').account!;
    const second = call<{ uid: string; id: string; account?: { uid: string; id: string } }>(store, 'register', 'r2', 'Élodie', 'hash:second').account!;
    expect(first.uid).toBe('10000001');
    expect(second.uid).toBe('10000002');
    call(store, 'deleteAccount', first.id);
    const third = call<{ account: { uid: string; id: string } }>(store, 'register', 'r3', '李四', 'hash:third').account;
    expect(third.uid).toBe('10000003');
    expect(store.db.prepare('SELECT uid,nickname FROM accounts ORDER BY uid').all()).toEqual([
      { uid: '10000002', nickname: 'Élodie' },
      { uid: '10000003', nickname: '李四' },
    ]);
  });

  it('enforces Unicode nickname validity while retaining the account identity', () => {
    const store = new AccountStore(':memory:', () => 30_000);
    stores.push(store);
    const account = call<{ account: { id: string; uid: string; nickname: string } }>(store, 'register', 'r1', '玩家一', 'hash:one').account;
    expect(account).toMatchObject({ uid: '10000001', nickname: '玩家一' });
    const duplicate = call<{ account: { uid: string; nickname: string } }>(store, 'register', 'r2', '玩家一', 'hash:duplicate').account;
    expect(duplicate).toMatchObject({ nickname: '玩家一', uid: '10000002' });
    for (const invalid of ['', '  玩家', '玩家  ', 'x'.repeat(33)]) expect(() => call(store, 'register', `invalid-${invalid}`, invalid, 'hash:invalid')).toThrow();
  });
});
