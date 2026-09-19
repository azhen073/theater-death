export function configuration(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = env.PUBLIC_BASE_URL ?? 'http://localhost:3001';
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('PUBLIC_BASE_URL must be an origin without path');
  if (production && url.protocol !== 'https:') throw new Error('Production requires an HTTPS PUBLIC_BASE_URL');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  // v2 uses opaque database-backed sessions, not the v1 default HMAC secret.
  if (production && env.SESSION_SECRET && ['change-me', 'dev-secret-change-me', 'test-secret'].includes(env.SESSION_SECRET)) throw new Error('Refusing placeholder SESSION_SECRET');
  const voiceEnabled = env.VOICE_ENABLED === 'true';
  if (voiceEnabled) {
    if (!env.VOICE_SERVICE_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) throw new Error('Voice configuration incomplete');
    const protocol = new URL(env.VOICE_SERVICE_URL).protocol;
    if (production ? protocol !== 'wss:' : !['ws:', 'wss:'].includes(protocol)) throw new Error('Invalid voice WebSocket URL');
    if (production && (/^(devkey|change-me)$/i.test(env.LIVEKIT_API_KEY) || env.LIVEKIT_API_SECRET.length < 32 || /^(devsecret|change-me)/i.test(env.LIVEKIT_API_SECRET))) throw new Error('Refusing development LiveKit credentials');
  }
  const cookieName = env.ACCOUNT_COOKIE_NAME ?? 'td_account_v2';
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(cookieName)) throw new Error('Invalid ACCOUNT_COOKIE_NAME');
  const adminPassword = env.ADMIN_PASSWORD || null;
  if (adminPassword !== null && (adminPassword.length < 16 || adminPassword.length > 256)) throw new Error('ADMIN_PASSWORD must contain 16 to 256 characters');
  if (adminPassword !== null && ['replace-with-a-long-unique-admin-password', 'change-me-admin-password'].includes(adminPassword.toLowerCase())) throw new Error('Refusing placeholder ADMIN_PASSWORD');
  const adminCookieName = env.ADMIN_COOKIE_NAME ?? 'td_admin_v2';
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(adminCookieName) || adminCookieName === cookieName) throw new Error('Invalid ADMIN_COOKIE_NAME');
  return { production, origin, port, cookieName, adminCookieName, secureCookies: url.protocol === 'https:', dataDir: env.DATA_DIR ?? './data-v2', voiceEnabled, adminPassword };
}
