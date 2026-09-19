import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.ts';

export class PasswordWorkQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < 2) this.active += 1;
    else {
      if (this.waiting.length >= 32) throw new ApiError(429, 'authentication_busy');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try { return await work(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active -= 1; }
  }
}
const queue = new PasswordWorkQueue();
const derive = (password: string, salt: Buffer) => queue.run(() => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => { if (error) reject(error); else resolve(key); });
}));
export function validatePassword(password: unknown): asserts password is string {
  const length = typeof password === 'string' ? [...password].length : 0;
  if (typeof password !== 'string' || length < 8 || length > 16) throw new ApiError(400, 'password_length', '密码长度须为8至16个字符');
}
export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return JSON.stringify({ algorithm: 'scrypt', N: 2 ** 17, r: 8, p: 1, salt: salt.toString('hex'), hash: hash.toString('hex') });
}
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (password.length > 128) return false;
  // Unknown users still perform the same expensive derivation; login errors do not reveal membership.
  const item = stored === null ? { salt: '00'.repeat(16), hash: '00'.repeat(64) } : JSON.parse(stored) as { salt: string; hash: string };
  const expected = Buffer.from(item.hash, 'hex');
  const actual = await derive(password, Buffer.from(item.salt, 'hex'));
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}
