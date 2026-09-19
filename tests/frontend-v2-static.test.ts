import express from 'express';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFrontendApp } from '../server/v2/frontend-app.ts';

const resources: Array<{ server?: Server; directory: string }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    if (resource.server) await new Promise<void>(resolve => resource.server!.close(() => resolve()));
    await rm(resource.directory, { recursive: true, force: true });
  }
});

async function makeRoot(withIndex = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'frontend-v2-static-'));
  await mkdir(join(root, 'assets'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'assets', 'hash-abcdefgh.js'), 'console.log("asset");');
  await writeFile(join(root, 'assets', 'plain.png'), 'not-an-image');
  await writeFile(join(root, 'game-test.html'), 'SECRET_GAME_TEST_ENTRY');
  await writeFile(join(root, 'src', 'secret.ts'), 'SECRET_SOURCE');
  await writeFile(join(root, '.env'), 'SECRET_DOTENV');
  if (withIndex) await writeFile(join(root, 'index.html'), '<!doctype html><title>frontend</title>');
  return root;
}

async function start(root: string): Promise<{ base: string; server: Server }> {
  const api = express();
  api.get('/api/v2/ping', (_req, res) => res.json({ ok: true }));
  api.use('/api/v2', (_req, res) => res.status(404).json({ error: { code: 'not_found' } }));
  const server = createServer(createFrontendApp(api, root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  resources.push({ server, directory: root });
  return { base: `http://127.0.0.1:${address.port}`, server };
}

async function rawGet(base: string, path: string): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(base);
    const request = httpRequest({ hostname: url.hostname, port: url.port, method: 'GET', path }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: response.headers }));
    });
    request.on('error', reject); request.end();
  });
}

describe('v2 frontend static delivery', () => {
  it('serves root/index with no-store/nosniff and assets with immutable or no-cache policy', async () => {
    const root = await makeRoot(); const { base } = await start(root);
    const home = await fetch(base + '/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('<title>frontend</title>');
    expect(home.headers.get('cache-control')).toBe('no-store');
    expect(home.headers.get('x-content-type-options')).toBe('nosniff');
    const index = await fetch(base + '/index.html');
    expect(index.status).toBe(200);
    expect(index.headers.get('cache-control')).toBe('no-store');
    for (const path of ['admin', 'admin/']) {
      const admin = await fetch(base + '/' + path);
      expect(admin.status).toBe(200);
      expect(await admin.text()).toContain('<title>frontend</title>');
      expect(admin.headers.get('cache-control')).toBe('no-store');
      expect(admin.headers.get('x-content-type-options')).toBe('nosniff');
    }
    const hashed = await fetch(base + '/assets/hash-abcdefgh.js');
    expect(hashed.status).toBe(200);
    expect(hashed.headers.get('cache-control')).toContain('immutable');
    expect(hashed.headers.get('x-content-type-options')).toBe('nosniff');
    const plain = await fetch(base + '/assets/plain.png');
    expect(plain.status).toBe(200);
    expect(plain.headers.get('cache-control')).toBe('no-cache');
  });

  it('passes API responses unchanged and keeps unknown API paths JSON 404', async () => {
    const root = await makeRoot(); const { base } = await start(root);
    const ping = await fetch(base + '/api/v2/ping');
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ ok: true });
    const missing = await fetch(base + '/api/v2/not-found');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
    expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } });
    const unknownPage = await fetch(base + '/admin/unknown');
    expect(unknownPage.status).toBe(404);
  });

  it('does not expose game-test/source/dotenv paths or traversal paths', async () => {
    const root = await makeRoot(); const { base } = await start(root);
    for (const path of ['/game-test.html', '/src/secret.ts', '/.env']) {
      const result = await rawGet(base, path);
      expect([403, 404]).toContain(result.status);
      expect(result.body).not.toContain('SECRET_');
    }
    for (const path of ['/../.env', '/%2e%2e/.env', '/src/../.env', '/assets/%2e%2e/.env', '/assets/%2e%2e%2f.env', '/@fs/app/tests/frontend-v2-game-harness.tsx']) {
      const result = await rawGet(base, path);
      expect([403, 404]).toContain(result.status);
      expect(result.body).not.toContain('SECRET_');
      expect(result.body).not.toContain('GameHarness');
    }
  });

  it('fails construction when the build index is missing', async () => {
    const root = await makeRoot(false);
    const api = express();
    expect(() => createFrontendApp(api, root)).toThrow('Frontend build is missing index.html');
    await rm(root, { recursive: true, force: true });
    const resource = resources.find(item => item.directory === root);
    if (resource) resources.splice(resources.indexOf(resource), 1);
  });
});
