import { describe, expect, it } from 'vitest';
import { configuration } from '../server/v2/config.ts';
import { RateLimits } from '../server/v2/rate-limit.ts';

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://game.example.test',
    PORT: '3000',
    SESSION_SECRET: 'a-production-session-secret',
    ...overrides,
  };
}

describe('v2 configuration validation', () => {
  it('defaults the account cookie name and accepts only safe custom names', () => {
    expect(configuration(env()).cookieName).toBe('td_account_v2');
    expect(configuration(env({ ACCOUNT_COOKIE_NAME: 'theater_session_2' })).cookieName).toBe('theater_session_2');
    for (const cookieName of ['', 'has-dash', 'has space', 'a.b', 'x'.repeat(65)]) {
      expect(() => configuration(env({ ACCOUNT_COOKIE_NAME: cookieName }))).toThrow('Invalid ACCOUNT_COOKIE_NAME');
    }
  });

  it('生产环境拒绝 HTTP origin，且拒绝带 path 的 origin', () => {
    expect(() => configuration(env({ PUBLIC_BASE_URL: 'http://game.example.test' }))).toThrow(/HTTPS/);
    expect(() => configuration(env({ PUBLIC_BASE_URL: 'https://game.example.test/path' }))).toThrow(/origin/);
  });

  it('拒绝非法 PORT 与生产 placeholder SESSION_SECRET', () => {
    for (const port of ['0', '65536', 'not-a-port', '1.5']) {
      expect(() => configuration(env({ PORT: port }))).toThrow('Invalid PORT');
    }
    for (const secret of ['change-me', 'dev-secret-change-me', 'test-secret']) {
      expect(() => configuration(env({ SESSION_SECRET: secret }))).toThrow(/placeholder/);
    }
  });

  it('VOICE_ENABLED=true 但缺凭据时降级为文字测试模式（不再拒绝启动）', () => {
    const missingBoth = configuration(env({ VOICE_ENABLED: 'true' }));
    expect(missingBoth).toMatchObject({ voiceRequested: true, voiceEnabled: false, voiceDegraded: true, voiceAdmin: false });
    const missingCertificate = configuration(env({ VOICE_ENABLED: 'true', AGORA_APP_ID: 'a'.repeat(32) }));
    expect(missingCertificate).toMatchObject({ voiceEnabled: false, voiceDegraded: true });
    expect(configuration(env()).voiceDegraded).toBe(false);
  });

  it('VOICE_ENABLED=true 且凭据存在但格式非法时仍拒绝启动', () => {
    expect(() => configuration(env({
      VOICE_ENABLED: 'true',
      AGORA_APP_ID: 'not-hex-value',
      AGORA_APP_CERTIFICATE: 'b'.repeat(32),
    }))).toThrow(/development/);
    expect(() => configuration(env({
      VOICE_ENABLED: 'true',
      AGORA_APP_ID: 'a'.repeat(32),
      AGORA_APP_CERTIFICATE: 'short',
    }))).toThrow(/development/);
  });

  it('客户 ID/密钥齐备才算频道管理可用（踢人 / 关房 / 对账）', () => {
    const base = { VOICE_ENABLED: 'true', AGORA_APP_ID: 'a'.repeat(32), AGORA_APP_CERTIFICATE: 'b'.repeat(32) };
    expect(configuration(env(base)).voiceAdmin).toBe(false);
    expect(configuration(env({ ...base, AGORA_CUSTOMER_KEY: 'customer' })).voiceAdmin).toBe(false);
    expect(configuration(env({ ...base, AGORA_CUSTOMER_KEY: 'customer', AGORA_CUSTOMER_SECRET: 'secret' })).voiceAdmin).toBe(true);
    expect(configuration(env({ ...base, AGORA_CUSTOMER_KEY: '', AGORA_CUSTOMER_SECRET: 'secret' })).voiceAdmin).toBe(false);
  });

  it('合法生产配置通过且返回值不包含测试 secret', () => {
    const secret = 'a-secret-that-must-not-be-returned';
    const result = configuration(env({
      SESSION_SECRET: secret,
      VOICE_ENABLED: 'true',
      AGORA_APP_ID: 'a'.repeat(32),
      AGORA_APP_CERTIFICATE: 'b'.repeat(32),
    }));

    expect(result).toMatchObject({
      production: true,
      origin: 'https://game.example.test',
      port: 3000,
      secureCookies: true,
      voiceEnabled: true,
      voiceDegraded: false,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('b'.repeat(32));
  });

  it('defaults and validates the independent admin cookie name', () => {
    expect(configuration(env()).adminCookieName).toBe('td_admin_v2');
    expect(configuration(env({ ADMIN_COOKIE_NAME: 'theater_admin_2' })).adminCookieName).toBe('theater_admin_2');
    for (const cookieName of ['', 'has-dash', 'has space', 'a.b', 'x'.repeat(65)]) {
      expect(() => configuration(env({ ADMIN_COOKIE_NAME: cookieName }))).toThrow('Invalid ADMIN_COOKIE_NAME');
    }
    expect(() => configuration(env({ ACCOUNT_COOKIE_NAME: 'shared_cookie', ADMIN_COOKIE_NAME: 'shared_cookie' }))).toThrow('Invalid ADMIN_COOKIE_NAME');
  });

  it('validates optional ADMIN_PASSWORD for server initialization; public responses must omit it', () => {
    expect(configuration(env()).adminPassword).toBeNull();
    expect(() => configuration(env({ ADMIN_PASSWORD: 'x'.repeat(15) }))).toThrow(/ADMIN_PASSWORD/);
    for (const example of ['replace-with-a-long-unique-admin-password', 'change-me-admin-password']) {
      expect(() => configuration(env({ ADMIN_PASSWORD: example }))).toThrow(/ADMIN_PASSWORD/);
    }
    const password = 'a-valid-admin-password-16';
    const result = configuration(env({ ADMIN_PASSWORD: password }));
    expect(result.adminPassword).toBe(password);
    expect(JSON.stringify(result)).toContain(password);
  });
});

describe('v2 RateLimits', () => {
  it('额度耗尽后按时间恢复，不同 key 隔离，时间倒退不补 token', () => {
    let now = 0;
    const limits = new RateLimits(() => now);

    expect(limits.allow('a', 2, 1000)).toBe(true);
    expect(limits.allow('a', 2, 1000)).toBe(true);
    expect(limits.allow('a', 2, 1000)).toBe(false);
    expect(limits.allow('b', 2, 1000)).toBe(true);

    now = -1000;
    expect(limits.allow('a', 2, 1000)).toBe(false);
    now = 1000;
    expect(limits.allow('a', 2, 1000)).toBe(true);
  });
});
