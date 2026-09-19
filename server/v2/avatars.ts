import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, readFile, unlink, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { AccountStore } from './account-store.ts';
import { ApiError } from './errors.ts';
import { AVATAR_LIMITS } from './catalog.ts';

sharp.concurrency(1);
sharp.cache(false);
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WEEK = 7 * 86400_000;
const invalid = () => new ApiError(400, 'invalid_avatar');
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

export class AvatarWorkQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < 2) this.active++;
    else {
      if (this.waiting.length >= 8) throw new ApiError(429, 'avatar_busy');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try { return await work(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
}
const jobs = new AvatarWorkQueue();

function staticFormat(input: Buffer): 'jpeg' | 'png' | 'webp' {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return 'jpeg';
  if (input.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    let offset = 8;
    while (offset + 12 <= input.length) {
      const size = input.readUInt32BE(offset), type = input.toString('ascii', offset + 4, offset + 8);
      if (size > input.length - offset - 12 || ['acTL', 'fcTL', 'fdAT'].includes(type)) throw invalid();
      offset += size + 12;
      if (type === 'IEND') { if (offset !== input.length) throw invalid(); return 'png'; }
    }
    throw invalid();
  }
  if (input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP') {
    if (input.readUInt32LE(4) + 8 !== input.length) throw invalid();
    let offset = 12;
    while (offset + 8 <= input.length) {
      const type = input.toString('ascii', offset, offset + 4), size = input.readUInt32LE(offset + 4);
      if (size > input.length - offset - 8 || type === 'ANIM' || type === 'ANMF') throw invalid();
      if (type === 'VP8X' && (size !== 10 || (input[offset + 8]! & 2) !== 0)) throw invalid();
      offset += 8 + size + (size % 2);
    }
    if (offset !== input.length) throw invalid();
    return 'webp';
  }
  throw invalid();
}

export async function normalizeAvatar(input: Buffer, mime: string): Promise<Buffer> {
  if (!Buffer.isBuffer(input) || input.length === 0) throw invalid();
  if (input.length > AVATAR_LIMITS.maxBytes) throw new ApiError(413, 'avatar_too_large');
  const format = staticFormat(input);
  if (mime !== `image/${format}`) throw invalid();
  try {
    const image = sharp(input, { failOn: 'warning', limitInputPixels: AVATAR_LIMITS.maxDimension ** 2, limitInputChannels: 4, unlimited: false });
    const meta = await image.metadata();
    if (meta.format !== format || !meta.width || !meta.height || meta.width !== meta.height || meta.width > AVATAR_LIMITS.maxDimension || (meta.pages ?? 1) !== 1) throw invalid();
    return await image.autoOrient().resize(AVATAR_LIMITS.outputSize, AVATAR_LIMITS.outputSize).webp({ quality: 85 }).toBuffer();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalid();
  }
}

export class AvatarStore {
  readonly accounts: AccountStore;
  readonly directory: string;
  constructor(accounts: AccountStore, directory: string) { this.accounts = accounts; this.directory = directory; }
  async put(userId: string, input: Buffer, mime: string, authorize: () => void = () => undefined) {
    return jobs.run(async () => {
      authorize();
      const output = await normalizeAvatar(input, mime);
      const id = randomUUID(), finalPath = join(this.directory, id + '.webp'), temporary = finalPath + '.tmp';
      let committed = false;
      try {
        await mkdir(this.directory, { recursive: true });
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(output); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, finalPath);
        authorize(); // A revoked session cannot finish an upload after asynchronous decoding/I/O.
        const profile = this.accounts.replaceAvatar(userId, id);
        committed = true;
        return profile;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, 'avatar_storage_unavailable');
      } finally {
        if (!committed) for (const path of [temporary, finalPath]) {
          try { await unlink(path); } catch (error) { if (!missing(error)) console.warn('avatar_orphan_cleanup_failed'); }
        }
      }
    });
  }
  async read(id: string): Promise<Buffer> {
    if (!ASSET_ID.test(id) || !this.accounts.db.prepare('SELECT id FROM avatar_assets WHERE id=?').get(id)) throw new ApiError(404, 'avatar_not_found');
    try { return await readFile(join(this.directory, id + '.webp')); }
    catch (error) { if (missing(error)) throw new ApiError(404, 'avatar_not_found'); throw error; }
  }
  async collect(): Promise<number> {
    const cutoff = this.accounts.now() - WEEK;
    const candidates = new Set<string>();
    try { for (const name of await readdir(this.directory)) candidates.add(name); }
    catch (error) { if (!missing(error)) throw error; }
    for (const row of this.accounts.db.prepare('SELECT id FROM avatar_assets WHERE COALESCE(unreferenced_at,created_at)<=?').all(cutoff)) candidates.add(String(row.id) + '.webp');
    let removed = 0;
    for (const name of candidates) {
      const temp = name.endsWith('.webp.tmp'), suffix = temp ? '.webp.tmp' : '.webp';
      if (!name.endsWith(suffix)) continue;
      const id = name.slice(0, -suffix.length);
      if (!ASSET_ID.test(id)) continue;
      if (this.accounts.db.prepare('SELECT id FROM accounts WHERE avatar_id=?').get(id)) continue;
      const row = this.accounts.db.prepare('SELECT created_at,unreferenced_at FROM avatar_assets WHERE id=?').get(id);
      let info;
      try { info = await lstat(join(this.directory, name)); }
      catch (error) { if (!missing(error)) throw error; }
      if (info && !info.isFile()) continue; // Never follow links or recursively remove unknown directories.
      const since = row ? Number(row.unreferenced_at ?? row.created_at) : info?.mtimeMs;
      if (since === undefined || since > cutoff) continue;
      try { await unlink(join(this.directory, name)); } catch (error) { if (!missing(error)) throw error; }
      if (!temp) this.accounts.db.prepare('DELETE FROM avatar_assets WHERE id=? AND NOT EXISTS(SELECT 1 FROM accounts WHERE avatar_id=?)').run(id, id);
      removed++;
    }
    return removed;
  }
}
