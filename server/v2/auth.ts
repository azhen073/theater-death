import { Router, type Request, type Response } from 'express';
import { AccountStore, type AccountSession, type Account } from './account-store.ts';
import { ApiError } from './errors.ts';
import { hashPassword, validatePassword, verifyPassword } from './passwords.ts';
import { RateLimits } from './rate-limit.ts';

export const COOKIE = 'td_account_v2';
export function accountSession(store: AccountStore, cookie: string, cookieName = COOKIE): AccountSession | null {
  const raw = cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return raw ? store.session(raw) : null;
}
export function requireAccount(store: AccountStore, req: Request, cookieName = COOKIE): AccountSession {
  const session = accountSession(store, req.headers.cookie ?? '', cookieName);
  if (!session) throw new ApiError(401, 'unauthorized');
  return session;
}
export function textField(value: unknown, name: string, min = 1, max = 128): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new ApiError(400, `invalid_${name}`);
  return value;
}
export interface AccountRevocation { reason: 'logout' | 'credentials_changed'; sessionId?: string }
// Callback results are ignored; await also supports asynchronous revocation cleanup.
export function authRouter(store: AccountStore, secure: boolean, onRevoked: (userId: string, event: AccountRevocation) => unknown, cookieName = COOKIE) {
  const router = Router();
  const limits = new RateLimits(store.now);
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict' as const, path: '/api/v2', maxAge: 7 * 86400_000 };
  const loginResponse = (res: Response, account: Account) => {
    const { token, session } = store.transaction(() => {
      if (store.byId(account.id)?.passwordHash !== account.passwordHash) throw new ApiError(401, 'invalid_credentials');
      return store.createSession(account.id);
    });
    res.cookie(cookieName, token, cookieOptions).json({ ...store.profile(account.id), expiresAt: session.expiresAt });
  };
  router.post('/register', async (req, res) => {
    if (!limits.allow(`register:${req.ip}`, 10, 60_000)) throw new ApiError(429, 'rate_limited');
    const requestId = textField(req.body?.requestId, 'request_id', 1, 80);
    const nickname = req.body?.nickname;
    const password = req.body?.password; validatePassword(password);
    const prior = store.registrationRequest(requestId);
    if (prior) {
      if (prior.nickname !== (typeof nickname === 'string' ? nickname.normalize('NFC') : nickname) || !prior.userId) throw new ApiError(409, 'request_id_reused');
      const account = store.byId(prior.userId);
      if (!account || !await verifyPassword(password, account.passwordHash)) throw new ApiError(409, 'request_id_reused');
      res.status(200); loginResponse(res, account); return;
    }
    if (!store.registrationEnabled()) throw new ApiError(403, 'registration_closed');
    const result = store.register(requestId, nickname, await hashPassword(password));
    if (result.replayed && !await verifyPassword(password, result.account.passwordHash)) throw new ApiError(409, 'request_id_reused');
    const account = result.account;
    res.status(201); loginResponse(res, account);
  });
  router.post('/login', async (req, res) => {
    const uid = textField(req.body?.uid, 'uid', 8, 20);
    if (!/^\d{8,20}$/.test(uid)) throw new ApiError(400, 'invalid_uid');
    const password = textField(req.body?.password, 'password', 1, 128);
    if (!limits.allow(`login-ip:${req.ip}`, 30, 60_000) || !limits.allow(`login-user:${uid}`, 10, 60_000)) throw new ApiError(429, 'rate_limited');
    const account = store.byUid(uid);
    if (!await verifyPassword(password, account?.passwordHash ?? null) || !account) throw new ApiError(401, 'invalid_credentials');
    if (account.disabledAt !== null) throw new ApiError(403, 'account_disabled');
    loginResponse(res, account);
  });
  router.get('/me', (req, res) => {
    const session = requireAccount(store, req, cookieName);
    res.json({ ...store.profile(session.userId), expiresAt: session.expiresAt });
  });
  router.post('/logout', async (req, res) => {
    const session = requireAccount(store, req, cookieName);
    store.logout(session.id); await onRevoked(session.userId, { reason: 'logout', sessionId: session.id });
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined }).json({ loggedOut: true });
  });
  router.post('/change-password', async (req, res) => {
    const session = requireAccount(store, req, cookieName);
    if (!limits.allow(`password:${session.userId}`, 5, 60_000)) throw new ApiError(429, 'rate_limited');
    const oldPassword = textField(req.body?.currentPassword, 'current_password');
    const password = req.body?.password; validatePassword(password);
    const row = store.db.prepare('SELECT password_hash FROM accounts WHERE id=?').get(session.userId);
    if (!row || !await verifyPassword(oldPassword, String(row.password_hash))) throw new ApiError(401, 'invalid_credentials');
    const hash = await hashPassword(password);
    // An async password calculation must not revive a concurrently revoked session.
    requireAccount(store, req, cookieName);
    store.changePassword(session.userId, hash); await onRevoked(session.userId, { reason: 'credentials_changed' });
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined }).json({ changed: true });
  });
  return router;
}
