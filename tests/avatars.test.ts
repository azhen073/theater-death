import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../server/v2/account-store.ts';
import { ApiError } from '../server/v2/errors.ts';
import { AvatarStore, AvatarWorkQueue, normalizeAvatar } from '../server/v2/avatars.ts';
import { AVATAR_LIMITS } from '../server/v2/catalog.ts';

const resources: Array<{ close(): void | Promise<void> }> = [];
afterEach(async () => { for (const resource of resources.splice(0).reverse()) await resource.close(); });

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'theater-avatar-'));
  resources.push({ close: () => rm(directory, { recursive: true, force: true }) });
  return directory;
}

async function image(format: 'jpeg' | 'png' | 'webp', width = 64, height = width): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 31, g: 91, b: 220, alpha: 1 } } })[format]().toBuffer();
}

function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  return expect(promise).rejects.toMatchObject({ status, code });
}

function withPngChunk(input: Buffer, type: string, data = Buffer.alloc(0)): Buffer {
  const offset = input.lastIndexOf(Buffer.from('IEND')) - 4;
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); chunk.write(type, 4, 4, 'ascii'); data.copy(chunk, 8);
  return Buffer.concat([input.subarray(0, offset), chunk, input.subarray(offset)]);
}

function fakeAnimatedWebp(kind: 'ANIM' | 'ANMF' | 'VP8X'): Buffer {
  if (kind === 'VP8X') {
    const chunk = Buffer.alloc(30);
    chunk.write('RIFF', 0, 4, 'ascii'); chunk.writeUInt32LE(22, 4); chunk.write('WEBP', 8, 4, 'ascii');
    chunk.write('VP8X', 12, 4, 'ascii'); chunk.writeUInt32LE(10, 16); chunk[20] = 2;
    return chunk;
  }
  const chunk = Buffer.alloc(20);
  chunk.write('RIFF', 0, 4, 'ascii'); chunk.writeUInt32LE(12, 4); chunk.write('WEBP', 8, 4, 'ascii');
  chunk.write(kind, 12, 4, 'ascii'); chunk.writeUInt32LE(0, 16);
  return chunk;
}

function u24(value: number): Buffer {
  const result = Buffer.alloc(3); result[0] = value & 0xff; result[1] = (value >>> 8) & 0xff; result[2] = (value >>> 16) & 0xff; return result;
}

function webpChunk(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8); header.write(type, 0, 4, 'ascii'); header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

async function realAnimatedWebp(): Promise<Buffer> {
  const frames = [await image('webp'), await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 220, g: 61, b: 31, alpha: 1 } } }).webp().toBuffer()];
  const encodedFrames = frames.map((frame) => {
    let offset = 12;
    while (offset + 8 <= frame.length) {
      const type = frame.toString('ascii', offset, offset + 4); const size = frame.readUInt32LE(offset + 4);
      if (type === 'VP8 ' || type === 'VP8L') return { type, payload: frame.subarray(offset + 8, offset + 8 + size) };
      offset += 8 + size + (size % 2);
    }
    throw new Error('static WebP frame payload missing');
  });
  const canvas = Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(63), u24(63)]);
  const anim = Buffer.alloc(6);
  const frameChunks = encodedFrames.map(({ type, payload }) => {
    const header = Buffer.concat([u24(0), u24(0), u24(63), u24(63), u24(100), Buffer.from([0])]);
    return webpChunk('ANMF', Buffer.concat([header, webpChunk(type, payload)]));
  });
  const body = Buffer.concat([webpChunk('VP8X', canvas), webpChunk('ANIM', anim), ...frameChunks]);
  const riff = Buffer.alloc(8); riff.write('RIFF', 0, 4, 'ascii'); riff.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([riff, Buffer.from('WEBP', 'ascii'), body]);
}

describe('avatar normalization and static media validation', () => {
  it('re-encodes real JPEG/PNG/WebP inputs to metadata-free 256px WebP', async () => {
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'red' } })
      .withMetadata({ exif: { IFD0: { ImageDescription: 'secret-exif' } }, density: 144 })
      .jpeg().toBuffer();
    for (const [input, mime] of [[jpeg, 'image/jpeg'], [await image('png'), 'image/png'], [await image('webp'), 'image/webp']] as const) {
      const output = await normalizeAvatar(input, mime);
      const metadata = await sharp(output).metadata();
      expect(metadata).toMatchObject({ format: 'webp', width: 256, height: 256 });
      expect(metadata.pages ?? 1).toBe(1);
      expect(metadata.exif ?? null).toBeNull();
      expect(metadata.xmp ?? null).toBeNull();
      expect(metadata.icc ?? null).toBeNull();
    }
  });

  it('rejects MIME spoofing, SVG, non-square, empty, oversized, oversized dimensions, animation markers, and corruption', async () => {
    const jpeg = await image('jpeg');
    await expectApiError(normalizeAvatar(jpeg, 'image/png'), 400, 'invalid_avatar');
    await expectApiError(normalizeAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'), 400, 'invalid_avatar');
    await expectApiError(normalizeAvatar(await image('jpeg', 64, 32), 'image/jpeg'), 400, 'invalid_avatar');
    await expectApiError(normalizeAvatar(Buffer.alloc(0), 'image/jpeg'), 400, 'invalid_avatar');
    await expectApiError(normalizeAvatar(Buffer.alloc(AVATAR_LIMITS.maxBytes + 1), 'image/jpeg'), 413, 'avatar_too_large');
    await expectApiError(normalizeAvatar(await image('png', 4097), 'image/png'), 400, 'invalid_avatar');
    const png = await image('png');
    for (const type of ['acTL', 'fcTL', 'fdAT']) await expectApiError(normalizeAvatar(withPngChunk(png, type), 'image/png'), 400, 'invalid_avatar');
    for (const type of ['ANIM', 'ANMF', 'VP8X']) await expectApiError(normalizeAvatar(fakeAnimatedWebp(type as 'ANIM' | 'ANMF' | 'VP8X'), 'image/webp'), 400, 'invalid_avatar');
    const animatedWebp = await realAnimatedWebp();
    const animatedMetadata = await sharp(animatedWebp, { animated: true }).metadata();
    expect(animatedMetadata.pages ?? 0).toBeGreaterThanOrEqual(2);
    await expectApiError(normalizeAvatar(animatedWebp, 'image/webp'), 400, 'invalid_avatar');
    await expectApiError(normalizeAvatar(jpeg.subarray(0, jpeg.length - 8), 'image/jpeg'), 400, 'invalid_avatar');
    // The animation fixtures above intentionally exercise static chunk/flag rejection;
    // they are not claims that the hand-built animated container is decoder-valid video.
  });
});

describe('avatar work queue', () => {
  it('runs two active jobs, queues eight, rejects the eleventh, and releases slots after errors', async () => {
    const queue = new AvatarWorkQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started: number[] = [];
    const jobs = Array.from({ length: 10 }, (_, index) => queue.run(async () => { started.push(index); if (index < 2) await gate; return index; }));
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    await expect(queue.run(async () => 99)).rejects.toMatchObject({ status: 429, code: 'avatar_busy' });
    release();
    await expect(Promise.all(jobs)).resolves.toHaveLength(10);
    await expect(queue.run(async () => { throw new Error('job-failed'); })).rejects.toThrow('job-failed');
    await expect(queue.run(async () => 42)).resolves.toBe(42);
  });
});

describe('AvatarStore persistence and garbage collection', () => {
  async function accountFixture() {
    let now = 10_000;
    const accounts = new AccountStore(':memory:', () => now);
    const row = accounts.register('avatar-store-user', 'avatarstoreuser', 'hash').account;
    const directory = await tempDirectory();
    resources.push(accounts);
    return { accounts, userId: row.id, directory, now: () => now, advance: (ms: number) => { now += ms; } };
  }

  it('writes before replacing the DB reference, increments profile versions, and cleans failed commits', async () => {
    const fixture = await accountFixture();
    const store = new AvatarStore(fixture.accounts, fixture.directory);
    const input = await image('png');
    const originalReplace = fixture.accounts.replaceAvatar.bind(fixture.accounts);
    let committedPath = '';
    fixture.accounts.replaceAvatar = ((userId: string, assetId: string) => {
      committedPath = join(fixture.directory, assetId + '.webp');
      expect(existsSync(committedPath)).toBe(true);
      return originalReplace(userId, assetId);
    }) as typeof fixture.accounts.replaceAvatar;
    const first = await store.put(fixture.userId, input, 'image/png');
    expect(existsSync(committedPath)).toBe(true);
    const firstId = first.avatarUrl!.split('/').at(-1)!;
    const second = await store.put(fixture.userId, input, 'image/png');
    const secondId = second.avatarUrl!.split('/').at(-1)!;
    expect(first.profileVersion).toBe(1);
    expect(second.profileVersion).toBe(2);
    expect(await readFile(join(fixture.directory, firstId + '.webp'))).toBeInstanceOf(Buffer);
    expect(await readFile(join(fixture.directory, secondId + '.webp'))).toBeInstanceOf(Buffer);

    const original = fixture.accounts.profile(fixture.userId);
    const replace = fixture.accounts.replaceAvatar;
    fixture.accounts.replaceAvatar = (() => { throw new Error('db-failure'); }) as typeof replace;
    await expectApiError(store.put(fixture.userId, input, 'image/png'), 503, 'avatar_storage_unavailable');
    expect(fixture.accounts.profile(fixture.userId)).toEqual(original);
    expect((await readdir(fixture.directory)).sort()).toEqual([firstId + '.webp', secondId + '.webp'].sort());

    const ioPath = join(fixture.directory, 'not-a-directory');
    await writeFile(ioPath, 'occupied');
    const ioStore = new AvatarStore(fixture.accounts, ioPath);
    await expectApiError(ioStore.put(fixture.userId, input, 'image/png'), 503, 'avatar_storage_unavailable');
    expect(fixture.accounts.profile(fixture.userId)).toEqual(original);
  });

  it('keeps current and fresh assets, removes expired old/orphan/temp files, and ignores unknown directories and links', async () => {
    const fixture = await accountFixture();
    const store = new AvatarStore(fixture.accounts, fixture.directory);
    const current = await store.put(fixture.userId, await image('jpeg'), 'image/jpeg');
    const currentId = current.avatarUrl!.split('/').at(-1)!;
    const oldId = '11111111-1111-4111-8111-111111111111';
    const freshId = '22222222-2222-4222-8222-222222222222';
    const orphanId = '33333333-3333-4333-8333-333333333333';
    const tempId = '44444444-4444-4444-8444-444444444444';
    const old = fixture.now() - 7 * 86400_000 - 1;
    const fresh = fixture.now() - 7 * 86400_000 + 1;
    fixture.accounts.db.prepare('UPDATE avatar_assets SET created_at=?,unreferenced_at=NULL WHERE id=?').run(old, currentId);
    fixture.accounts.db.prepare('INSERT INTO avatar_assets VALUES(?,?,?)').run(oldId, old, old);
    fixture.accounts.db.prepare('INSERT INTO avatar_assets VALUES(?,?,?)').run(freshId, fresh, fresh);
    await writeFile(join(fixture.directory, oldId + '.webp'), 'old');
    await writeFile(join(fixture.directory, freshId + '.webp'), 'fresh');
    await writeFile(join(fixture.directory, orphanId + '.webp'), 'orphan');
    await writeFile(join(fixture.directory, tempId + '.webp.tmp'), 'temp');
    await utimes(join(fixture.directory, orphanId + '.webp'), new Date(old), new Date(old));
    await utimes(join(fixture.directory, tempId + '.webp.tmp'), new Date(old), new Date(old));
    await writeFile(join(fixture.directory, 'unknown.txt'), 'unknown');
    const ignoredDirectory = join(fixture.directory, '55555555-5555-4555-8555-555555555555.webp');
    await mkdir(ignoredDirectory);
    const link = join(fixture.directory, '66666666-6666-4666-8666-666666666666.webp');
    await symlink(join(fixture.directory, 'unknown.txt'), link);
    expect(await store.collect()).toBe(3);
    expect(await readFile(join(fixture.directory, currentId + '.webp'))).toBeInstanceOf(Buffer);
    expect(await readFile(join(fixture.directory, freshId + '.webp'))).toBeInstanceOf(Buffer);
    await expect(readFile(join(fixture.directory, oldId + '.webp'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(fixture.directory, orphanId + '.webp'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(fixture.directory, tempId + '.webp.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(fixture.directory, 'unknown.txt'))).toBeInstanceOf(Buffer);
    expect((await readdir(ignoredDirectory)).length).toBe(0);
    expect(await readFile(link)).toBeInstanceOf(Buffer);
    fixture.advance(1);
    expect(await store.collect()).toBe(1);
    await expect(readFile(join(fixture.directory, freshId + '.webp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
