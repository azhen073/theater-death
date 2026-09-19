export const ENV = {
  baseUrl: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  livekitWsUrl: process.env.E2E_LIVEKIT_WS_URL ?? '',
  livekitAdminUrl: process.env.E2E_LIVEKIT_ADMIN_URL ?? '',
  livekitApiKey: process.env.E2E_LIVEKIT_API_KEY ?? '',
  livekitApiSecret: process.env.E2E_LIVEKIT_API_SECRET ?? '',
} as const;

export function requireLiveKitAdmin(): {
  url: string;
  key: string;
  secret: string;
} {
  if (ENV.livekitAdminUrl === '' || ENV.livekitApiKey === '' || ENV.livekitApiSecret === '') {
    throw new Error('缺少 E2E_LIVEKIT_ADMIN_URL / E2E_LIVEKIT_API_KEY / E2E_LIVEKIT_API_SECRET');
  }
  return {
    url: ENV.livekitAdminUrl,
    key: ENV.livekitApiKey,
    secret: ENV.livekitApiSecret,
  };
}
