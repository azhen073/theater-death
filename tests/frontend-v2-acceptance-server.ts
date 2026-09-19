import { createServer, type Server } from 'node:http';
import { createServer as createNetServer, type Socket } from 'node:net';
import { existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createFakeClock } from '../server/clock.ts';
import { createLogStore } from '../server/log-store.ts';
import { AccountStore } from '../server/v2/account-store.ts';
import { createV2App } from '../server/v2/app.ts';
import { AvatarStore } from '../server/v2/avatars.ts';
import { createLiveKitVoiceService } from '../voice/livekit.ts';

const dataDir = process.env.DATA_DIR;
const clockPath = '/clock-control/clock.sock';
if (process.env.CLOCK_SOCKET !== undefined && process.env.CLOCK_SOCKET !== clockPath) throw new Error('acceptance server requires fixed clock socket');
if (!dataDir || resolve(dataDir) !== '/app/data-frontend-v2') throw new Error('acceptance server requires isolated DATA_DIR');
mkdirSync(dataDir, { recursive: true });
mkdirSync(join(dataDir, 'avatars'), { recursive: true });
mkdirSync(join(clockPath, '..'), { recursive: true });
if (existsSync(clockPath)) { if (!lstatSync(clockPath).isSocket()) throw new Error('clock socket path is not a socket'); unlinkSync(clockPath); }

const clock = createFakeClock(Number(process.env.CLOCK_START_MS ?? Date.now()));
const accounts = new AccountStore(join(dataDir, 'accounts.sqlite'), () => clock.now());
const logStore = createLogStore(join(dataDir, 'audit.sqlite'));
const avatars = new AvatarStore(accounts, join(dataDir, 'avatars'));
const voice = process.env.VOICE_ENABLED === 'true' ? createLiveKitVoiceService({
  adminUrl: process.env.VOICE_ADMIN_URL!, publicUrl: process.env.VOICE_SERVICE_URL!, apiKey: process.env.LIVEKIT_API_KEY!, apiSecret: process.env.LIVEKIT_API_SECRET!, tokenTtlSeconds: 30, removeUnknownParticipants: true,
}) : null;
const backend = createV2App({ accounts, clock, logStore, avatars, origin: 'http://localhost:5173', cookieName: process.env.ACCOUNT_COOKIE_NAME ?? 'td_account_frontend_acceptance', secureCookies: false, voice });
const server: Server = createServer(backend.app);
backend.hub.attachV2(server);
const control = createNetServer(socket => handleControl(socket));
let advanceQueue: Promise<void> = Promise.resolve();

async function handleControl(socket: Socket): Promise<void> {
  let pending = '';
  socket.on('data', data => {
    pending += data.toString('utf8');
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      try {
        const body = JSON.parse(line) as { advanceMs?: unknown };
        const advanceMs = body.advanceMs;
        if (typeof advanceMs !== 'number' || !Number.isFinite(advanceMs) || advanceMs < 0) throw new Error('invalid advanceMs');
        if (advanceMs > 300_000) throw new Error('advance_too_large');
        const run = advanceQueue.then(async () => { clock.advance(advanceMs); await backend.drain(); socket.write(JSON.stringify({ now: clock.now(), pending: clock.pendingCount() }) + '\n'); });
        advanceQueue = run.then(() => undefined, () => undefined);
        void run.catch(() => socket.write(JSON.stringify({ error: 'clock_advance_failed' }) + '\n'));
      } catch { socket.write(JSON.stringify({ error: 'invalid_clock_command' }) + '\n'); }
    }
  });
}

async function close(): Promise<void> {
  backend.close(); control.close();
  await backend.drain();
  await new Promise<void>(resolveClose => { server.close(() => resolveClose()); server.closeAllConnections(); });
  accounts.close(); logStore.close();
  if (existsSync(clockPath)) unlinkSync(clockPath);
}

const port = Number(process.env.PORT ?? 3000);
await new Promise<void>(resolveListen => server.listen(port, '0.0.0.0', resolveListen));
await new Promise<void>(resolveListen => control.listen(clockPath, resolveListen));
backend.maintenance.start();
console.log('frontend acceptance server listening');
process.once('SIGTERM', () => { void close().finally(() => process.exit(0)); });
process.once('SIGINT', () => { void close().finally(() => process.exit(0)); });
