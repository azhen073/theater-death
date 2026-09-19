export const ENV = {
  baseUrl: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  agoraAppId: process.env.E2E_AGORA_APP_ID ?? '',
  agoraAppCertificate: process.env.E2E_AGORA_APP_CERTIFICATE ?? '',
  agoraCustomerKey: process.env.E2E_AGORA_CUSTOMER_KEY ?? '',
  agoraCustomerSecret: process.env.E2E_AGORA_CUSTOMER_SECRET ?? '',
  agoraRestBaseUrl: process.env.E2E_AGORA_REST_BASE_URL ?? 'https://api.sd-rtn.com',
} as const;

/**
 * 声网管理凭据（频道管理 REST 用，从项目根 .env 的 AGORA_* 继承）。
 * 注意：RESTful API 使用控制台「设置 → RESTful API」生成的「客户 ID + 客户密钥」，
 * 不是 App ID / App Certificate。
 */
export function requireAgoraAdmin(): {
  appId: string;
  customerKey: string;
  customerSecret: string;
  restBaseUrl: string;
} {
  if (ENV.agoraAppId === '' || ENV.agoraCustomerKey === '' || ENV.agoraCustomerSecret === '') {
    throw new Error(
      '缺少 E2E_AGORA_APP_ID / E2E_AGORA_CUSTOMER_KEY / E2E_AGORA_CUSTOMER_SECRET（控制台 RESTful API 凭据）',
    );
  }
  return {
    appId: ENV.agoraAppId,
    customerKey: ENV.agoraCustomerKey,
    customerSecret: ENV.agoraCustomerSecret,
    restBaseUrl: ENV.agoraRestBaseUrl,
  };
}
