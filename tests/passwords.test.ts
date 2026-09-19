import { describe, expect, it } from 'vitest';
import { ApiError } from '../server/v2/errors.ts';
import { hashPassword, validatePassword, verifyPassword, PasswordWorkQueue } from '../server/v2/passwords.ts';

describe('v2 password hashing and work queue', () => {
  it('hashes valid passwords with scrypt and verifies correct and incorrect values', async () => {
    const stored = await hashPassword('correct8888');
    const parsed = JSON.parse(stored) as { algorithm: string; N: number; r: number; p: number; salt: string; hash: string };
    expect(parsed).toMatchObject({ algorithm: 'scrypt', N: 2 ** 17, r: 8, p: 1 });
    expect(parsed.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed.hash).toMatch(/^[0-9a-f]{128}$/);
    await expect(verifyPassword('correct8888', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong88888', stored)).resolves.toBe(false);
  });

  it('uses a random salt for each hash', async () => {
    const first = JSON.parse(await hashPassword('samepass88')) as { salt: string; hash: string };
    const second = JSON.parse(await hashPassword('samepass88')) as { salt: string; hash: string };
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    await expect(verifyPassword('samepass88', JSON.stringify(first))).resolves.toBe(true);
    await expect(verifyPassword('samepass88', JSON.stringify(second))).resolves.toBe(true);
  });

  it('accepts exactly 8 to 16 characters and rejects values outside that range', async () => {
    expect(() => validatePassword('x'.repeat(7))).toThrowError(ApiError);
    expect(() => validatePassword('x'.repeat(17))).toThrowError(ApiError);
    expect(() => validatePassword(null)).toThrowError(ApiError);
    expect(() => validatePassword('x'.repeat(8))).not.toThrow();
    expect(() => validatePassword('x'.repeat(16))).not.toThrow();
    await expect(hashPassword('x'.repeat(7))).rejects.toMatchObject({ status: 400, code: 'password_length' });
    await expect(hashPassword('x'.repeat(8))).resolves.toBeTypeOf('string');
    await expect(verifyPassword('x'.repeat(17), null)).resolves.toBe(false);
  });

  it('limits work to two active tasks and releases a slot after failure', async () => {
    const queue = new PasswordWorkQueue();
    let active = 0;
    let maximum = 0;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = queue.run(() => new Promise<string>((resolve) => {
      active += 1;
      maximum = Math.max(maximum, active);
      releaseFirst = () => { active -= 1; resolve('first'); };
    }));
    const second = queue.run(() => new Promise<string>((resolve) => {
      active += 1;
      maximum = Math.max(maximum, active);
      releaseSecond = () => { active -= 1; resolve('second'); };
    }));
    let thirdStarted = false;
    const third = queue.run(async () => {
      thirdStarted = true;
      active += 1;
      maximum = Math.max(maximum, active);
      active -= 1;
      return 'third';
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(maximum).toBe(2);
    expect(thirdStarted).toBe(false);
    releaseFirst();
    await expect(first).resolves.toBe('first');
    await expect(third).resolves.toBe('third');
    releaseSecond();
    await expect(second).resolves.toBe('second');

    await expect(queue.run(async () => { throw new Error('worker failed'); })).rejects.toThrow('worker failed');
    await expect(queue.run(async () => 'after failure')).resolves.toBe('after failure');
  });
});
