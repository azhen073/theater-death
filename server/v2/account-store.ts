import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ApiError } from './errors.ts';
import type { Profile } from '../../contracts/v2.ts';

const token = () => randomBytes(32).toString('base64url');
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
const WEEK = 7 * 86400_000, FIRST_UID = 10_000_001;
export const ACCOUNT_SCHEMA_VERSION = 4;
export interface Account { id: string; uid: string; nickname: string; passwordHash: string; disabledAt: number | null }
export interface AccountSession { id: string; userId: string; expiresAt: number }

export function normalizeNickname(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_nickname');
  const nickname = value.normalize('NFC'), points = [...nickname];
  if (points.length < 2 || points.length > 32 || !/^[_\p{L}\p{M}]+$/u.test(nickname) || !/\p{L}/u.test(nickname)) throw new ApiError(400, 'invalid_nickname');
  return nickname;
}

export class AccountStore {
  readonly db: DatabaseSync; readonly now: () => number;
  private readonly profiles = new Map<string, Profile>();
  constructor(path: string, now: () => number = Date.now) {
    this.now = now; this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
    const version = Number(this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version ?? 0);
    if (version > ACCOUNT_SCHEMA_VERSION) { this.db.close(); throw new Error('Unsupported account schema version'); }
    if (version === 0) this.transaction(() => this.db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE TABLE invitations (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('register','reset')), user_id TEXT REFERENCES accounts(id), expires_at INTEGER NOT NULL, used_at INTEGER); CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL); CREATE INDEX sessions_user ON sessions(user_id); INSERT INTO schema_migrations VALUES(1);`));
    if (version < 2) this.transaction(() => this.db.exec(`CREATE TABLE avatar_assets (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, unreferenced_at INTEGER); ALTER TABLE accounts ADD COLUMN avatar_id TEXT REFERENCES avatar_assets(id); ALTER TABLE accounts ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 0; INSERT INTO schema_migrations VALUES(2);`));
    if (version < 3) this.transaction(() => this.db.exec(`ALTER TABLE accounts ADD COLUMN disabled_at INTEGER; ALTER TABLE invitations ADD COLUMN created_at INTEGER; ALTER TABLE invitations ADD COLUMN revoked_at INTEGER; UPDATE invitations SET created_at=expires_at-CASE purpose WHEN 'register' THEN ${WEEK} ELSE 1800000 END WHERE created_at IS NULL; CREATE TABLE admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,target_type TEXT NOT NULL CHECK(target_type IN ('account','invitation','auth')),target_id TEXT,at INTEGER NOT NULL,details_json TEXT NOT NULL); INSERT INTO schema_migrations VALUES(3);`));
    if (version < 4) this.transaction(() => {
      this.db.exec(`ALTER TABLE accounts ADD COLUMN uid TEXT; ALTER TABLE accounts ADD COLUMN nickname TEXT; CREATE TABLE account_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO account_settings VALUES('registration_enabled','true'); CREATE TABLE registration_requests (request_id TEXT PRIMARY KEY,user_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,uid TEXT NOT NULL,nickname TEXT NOT NULL,created_at INTEGER NOT NULL);`);
      let next = FIRST_UID; const update = this.db.prepare('UPDATE accounts SET uid=?,nickname=?,username=? WHERE id=?');
      for (const row of this.db.prepare('SELECT id,username FROM accounts ORDER BY created_at,id').all()) { const uid = String(next++); update.run(uid, String(row.username), `legacy:${row.id}`, String(row.id)); }
      this.db.exec('CREATE UNIQUE INDEX accounts_uid ON accounts(uid)'); this.db.prepare("INSERT INTO account_settings VALUES('next_uid',?)").run(String(next));
      this.db.exec('DROP TABLE invitations; INSERT INTO schema_migrations VALUES(4)');
    });
  }
  transaction<T>(action: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = action(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  registrationEnabled() { return this.db.prepare("SELECT value FROM account_settings WHERE key='registration_enabled'").get()?.value === 'true'; }
  setRegistrationEnabled(enabled: boolean) { this.db.prepare("UPDATE account_settings SET value=? WHERE key='registration_enabled'").run(enabled ? 'true' : 'false'); }
  private account(row: Record<string, unknown> | undefined): Account | null { return row ? { id: String(row.id), uid: String(row.uid), nickname: String(row.nickname), passwordHash: String(row.password_hash), disabledAt: row.disabled_at === null ? null : Number(row.disabled_at) } : null; }
  byUid(uid: string) { return this.account(this.db.prepare('SELECT id,uid,nickname,password_hash,disabled_at FROM accounts WHERE uid=?').get(uid)); }
  byId(userId: string) { return this.account(this.db.prepare('SELECT id,uid,nickname,password_hash,disabled_at FROM accounts WHERE id=?').get(userId)); }
  registrationRequest(requestId: string) {
    const row = this.db.prepare('SELECT request_id,user_id,uid,nickname FROM registration_requests WHERE request_id=?').get(requestId);
    return row ? { requestId: String(row.request_id), userId: row.user_id === null ? null : String(row.user_id), uid: String(row.uid), nickname: String(row.nickname) } : null;
  }
  register(requestId: string, input: unknown, passwordHash: string): { account: Account; replayed: boolean } {
    const nickname = normalizeNickname(input);
    return this.transaction(() => {
      const prior = this.registrationRequest(requestId);
      if (prior) { if (prior.nickname !== nickname) throw new ApiError(409, 'request_id_reused'); if (!prior.userId) throw new ApiError(409, 'account_deleted'); const account = this.byId(prior.userId); if (!account) throw new ApiError(409, 'account_deleted'); return { account, replayed: true }; }
      if (!this.registrationEnabled()) throw new ApiError(403, 'registration_closed');
      const uidNumber = Number(this.db.prepare("SELECT value FROM account_settings WHERE key='next_uid'").get()?.value); if (!Number.isSafeInteger(uidNumber) || uidNumber < FIRST_UID) throw new Error('invalid_uid_sequence');
      const uid = String(uidNumber), id = token(); this.db.prepare("UPDATE account_settings SET value=? WHERE key='next_uid'").run(String(uidNumber + 1));
      this.db.prepare('INSERT INTO accounts(id,username,uid,nickname,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id, uid, uid, nickname, passwordHash, this.now());
      this.db.prepare('INSERT INTO registration_requests VALUES(?,?,?,?,?)').run(requestId, id, uid, nickname, this.now());
      return { account: { id, uid, nickname, passwordHash, disabledAt: null }, replayed: false };
    });
  }
  profile(userId: string): Profile { const cached = this.profiles.get(userId); if (cached) return { ...cached }; const result = this.readProfile(userId); this.rememberProfile(result); return result; }
  profileOrNull(userId: string): Profile | null { try { return this.profile(userId); } catch (error) { if (error instanceof ApiError && error.code === 'account_not_found') return null; throw error; } }
  private rememberProfile(profile: Profile) { this.profiles.delete(profile.userId); if (this.profiles.size >= 2048) this.profiles.delete(this.profiles.keys().next().value!); this.profiles.set(profile.userId, { ...profile }); }
  private readProfile(userId: string): Profile { const row = this.db.prepare('SELECT uid,nickname,avatar_id,profile_version FROM accounts WHERE id=?').get(userId); if (!row) throw new ApiError(404, 'account_not_found'); return { userId, uid: String(row.uid), nickname: String(row.nickname), avatarUrl: row.avatar_id === null ? null : `/api/v2/avatars/${row.avatar_id}`, profileVersion: Number(row.profile_version) }; }
  replaceAvatar(userId: string, assetId: string): Profile { const profile = this.transaction(() => { const old = this.db.prepare('SELECT avatar_id FROM accounts WHERE id=?').get(userId); if (!old) throw new ApiError(404, 'account_not_found'); this.db.prepare('INSERT INTO avatar_assets(id,created_at,unreferenced_at) VALUES(?,?,NULL)').run(assetId, this.now()); this.db.prepare('UPDATE accounts SET avatar_id=?,profile_version=profile_version+1 WHERE id=?').run(assetId, userId); if (old.avatar_id !== null) this.db.prepare('UPDATE avatar_assets SET unreferenced_at=? WHERE id=?').run(this.now(), old.avatar_id); return this.readProfile(userId); }); this.rememberProfile(profile); return profile; }
  clearAvatar(userId: string): Profile { const profile = this.transaction(() => { const old = this.db.prepare('SELECT avatar_id FROM accounts WHERE id=?').get(userId); if (!old) throw new ApiError(404, 'account_not_found'); this.db.prepare('UPDATE accounts SET avatar_id=NULL,profile_version=profile_version+1 WHERE id=?').run(userId); if (old.avatar_id !== null) this.db.prepare('UPDATE avatar_assets SET unreferenced_at=? WHERE id=?').run(this.now(), old.avatar_id); return this.readProfile(userId); }); this.rememberProfile(profile); return profile; }
  rename(userId: string, input: unknown): Profile { const nickname = normalizeNickname(input); const profile = this.transaction(() => { if (!this.byId(userId)) throw new ApiError(404, 'account_not_found'); this.db.prepare('UPDATE accounts SET nickname=?,profile_version=profile_version+1 WHERE id=?').run(nickname, userId); return this.readProfile(userId); }); this.rememberProfile(profile); return profile; }
  disable(userId: string): number { const at = this.now(); this.transaction(() => { const result = this.db.prepare('UPDATE accounts SET disabled_at=? WHERE id=? AND disabled_at IS NULL').run(at, userId); if (!Number(result.changes)) { if (!this.byId(userId)) throw new ApiError(404, 'account_not_found'); throw new ApiError(409, 'account_already_disabled'); } this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); }); return at; }
  enable(userId: string) { const result = this.db.prepare('UPDATE accounts SET disabled_at=NULL WHERE id=? AND disabled_at IS NOT NULL').run(userId); if (!Number(result.changes)) { if (!this.byId(userId)) throw new ApiError(404, 'account_not_found'); throw new ApiError(409, 'account_already_enabled'); } }
  revokeSessions(userId: string) { if (!this.byId(userId)) throw new ApiError(404, 'account_not_found'); return Number(this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId).changes); }
  changePassword(userId: string, hash: string) { this.transaction(() => { if (!this.byId(userId)) throw new ApiError(404, 'account_not_found'); this.db.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(hash, userId); this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); }); }
  deleteAccount(userId: string) { const account = this.byId(userId); if (!account) throw new ApiError(404, 'account_not_found'); this.transaction(() => { const row = this.db.prepare('SELECT avatar_id FROM accounts WHERE id=?').get(userId); if (row && row.avatar_id !== null) this.db.prepare('UPDATE avatar_assets SET unreferenced_at=? WHERE id=?').run(this.now(), row.avatar_id); this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); this.db.prepare('DELETE FROM accounts WHERE id=?').run(userId); }); this.profiles.delete(userId); return { uid: account.uid, nickname: account.nickname }; }
  createSession(userId: string) { if (!this.db.prepare('SELECT id FROM accounts WHERE id=? AND disabled_at IS NULL').get(userId)) throw new ApiError(403, 'account_disabled'); const raw = token(), session = { id: digest(raw), userId, expiresAt: this.now() + WEEK }; this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(session.id, userId, session.expiresAt); return { token: raw, session }; }
  session(raw: string): AccountSession | null { const row = this.db.prepare('SELECT s.* FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.id=? AND s.expires_at>? AND a.disabled_at IS NULL').get(digest(raw), this.now()); return row ? { id: String(row.id), userId: String(row.user_id), expiresAt: Number(row.expires_at) } : null; }
  sessionActive(id: string) { return this.db.prepare('SELECT s.id FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.id=? AND s.expires_at>? AND a.disabled_at IS NULL').get(id, this.now()) !== undefined; }
  recordAdminAction(action: string, targetType: 'account' | 'invitation' | 'auth', targetId: string | null, details: Record<string, string | number | boolean | null> = {}) { this.db.prepare('INSERT INTO admin_actions(action,target_type,target_id,at,details_json) VALUES(?,?,?,?,?)').run(action, targetType, targetId, this.now(), JSON.stringify(details)); }
  logout(id: string) { this.db.prepare('DELETE FROM sessions WHERE id=?').run(id); }
  collectExpired() { this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(this.now()); }
  close() { this.profiles.clear(); this.db.close(); }
}
