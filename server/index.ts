import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import { createApp } from './app.ts';
import { systemClock } from './clock.ts';
import { createLogStore } from './log-store.ts';
import { createBroadcaster } from './realtime.ts';
import { RoomRegistry } from './rooms.ts';

const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? './data';
const cookieSecure = process.env.SESSION_COOKIE_SECURE === 'true';

if (process.env.SESSION_SECRET === undefined) {
  console.warn(
    '[theater-death] SESSION_SECRET 未设置，使用开发默认值；生产部署必须通过 .env 注入随机秘密',
  );
}
const sessionSecret = process.env.SESSION_SECRET ?? 'dev-secret-change-me';

mkdirSync(dataDir, { recursive: true });
const logStore = createLogStore(join(dataDir, 'theater_death.sqlite'));
const broadcaster = createBroadcaster();
const registry = new RoomRegistry({
  clock: systemClock,
  ruleset: THEATER_DEATH_13,
  logStore,
  broadcaster,
});

const app = createApp({
  registry,
  clock: systemClock,
  sessionSecret,
  cookieSecure,
  broadcaster,
  webRoot: join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist'),
});

const server = createServer(app);
broadcaster.attach(server, { registry, sessionSecret });
server.listen(port, () => {
  console.log(`theater-death listening on port ${port}`);
});
