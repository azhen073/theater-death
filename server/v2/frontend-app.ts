import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Production delivery exposes only the built entry and asset directory, never the workspace. */
export function createFrontendApp(api: Express, directory: string): Express {
  const root = resolve(directory), index = join(root, 'index.html');
  if (!existsSync(index)) throw new Error('Frontend build is missing index.html');
  const app = express();
  app.disable('x-powered-by');
  app.get(['/', '/index.html', '/admin', '/admin/'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(index);
  });
  app.use('/assets', express.static(join(root, 'assets'), {
    index: false, dotfiles: 'deny', fallthrough: true,
    setHeaders(res, path) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', /-[\w-]{8,}\.(?:js|css)$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  app.use(api);
  return app;
}
