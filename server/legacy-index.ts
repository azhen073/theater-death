// 旧版（v1）入口：由 server/index.ts 在 ENTRY=v1 时加载（服务器回滚与旧版 E2E 用）。
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import { createAgoraVoiceService, type VoiceService } from '../voice/agora.ts';
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

function createVoice(): VoiceService | null {
  if (process.env.VOICE_ENABLED !== 'true') {
    return null;
  }
  const appId = process.env.AGORA_APP_ID ?? '';
  const appCertificate = process.env.AGORA_APP_CERTIFICATE ?? '';
  if (appId === '' || appCertificate === '') {
    console.warn(
      '[theater-death] VOICE_ENABLED=true 但语音配置不完整（需要 AGORA_APP_ID / AGORA_APP_CERTIFICATE），按「文字测试模式」运行',
    );
    return null;
  }
  const customerKey = process.env.AGORA_CUSTOMER_KEY ?? '';
  const customerSecret = process.env.AGORA_CUSTOMER_SECRET ?? '';
  if (customerKey === '' || customerSecret === '') {
    console.warn(
      '[theater-death] 未配置 AGORA_CUSTOMER_KEY / AGORA_CUSTOMER_SECRET：踢人与终局关房将不可用（语音本体不受影响）',
    );
  }
  return createAgoraVoiceService({ appId, appCertificate, customerKey, customerSecret });
}

const voice = createVoice();

mkdirSync(dataDir, { recursive: true });
const logStore = createLogStore(join(dataDir, 'theater_death.sqlite'));
const broadcaster = createBroadcaster();
const registry = new RoomRegistry({
  clock: systemClock,
  ruleset: THEATER_DEATH_13,
  logStore,
  broadcaster,
  voice,
});

const app = createApp({
  registry,
  clock: systemClock,
  sessionSecret,
  cookieSecure,
  broadcaster,
  voice,
  webRoot: join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist'),
});

const server = createServer(app);
broadcaster.attach(server, { registry, sessionSecret });
server.listen(port, () => {
  console.log(`theater-death legacy (v1) listening on port ${port}`);
});
