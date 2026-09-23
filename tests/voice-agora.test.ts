import { describe, expect, it, vi } from 'vitest';
import { createAgoraVoiceService } from '../voice/agora.ts';

const APP_ID = 'a'.repeat(32);
const APP_CERTIFICATE = 'b'.repeat(32);
const CUSTOMER_KEY = 'c'.repeat(32);
const CUSTOMER_SECRET = 'd'.repeat(32);

describe('声网 VoiceAdapter', () => {
  it('加入凭证：携带 appId/频道/uid 与 AccessToken2 订阅凭证', () => {
    const service = createAgoraVoiceService({ appId: APP_ID, appCertificate: APP_CERTIFICATE });
    const credentials = service.issueCredentials({ roomName: 'g_test', uid: 7 });
    expect(credentials.appId).toBe(APP_ID);
    expect(credentials.channel).toBe('g_test');
    expect(credentials.uid).toBe(7);
    expect(credentials.token.startsWith('007e')).toBe(true);
  });

  it('发布授权：返回 AccessToken2，expiresAt 按发布 TTL 计算', () => {
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      publishTtlSeconds: 120,
    });
    const before = Date.now();
    const grant = service.issuePublishGrant({ roomName: 'g_test', uid: 7 });
    expect(grant.token.startsWith('007e')).toBe(true);
    expect(grant.expiresAt - before).toBeGreaterThan(119_000);
    expect(grant.expiresAt - before).toBeLessThanOrEqual(121_000);
  });

  it('发布授权默认 TTL 为 150 秒：覆盖最长发言窗口 120 秒且不超过上限', () => {
    // 用假时钟：TTL 由 Date.now() + 150_000 计算，真实时钟跨毫秒边界会得到 150_001（与实现无关的抖动）
    vi.useFakeTimers({ now: 1_000 });
    try {
      const service = createAgoraVoiceService({ appId: APP_ID, appCertificate: APP_CERTIFICATE });
      const before = Date.now();
      const grant = service.issuePublishGrant({ roomName: 'g_test', uid: 7 });
      const ttl = grant.expiresAt - before;
      // 规则 2.0 最长发言窗口 = 120 秒（rulesets/theater-death-13-v2.ts 的 timersSeconds.speech）
      expect(ttl).toBe(150_000);
      // 服务端无法实时降权，故默认不得放宽到 150 秒以上
      expect(ttl).toBeLessThanOrEqual(150_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('订阅凭证与发布凭证：均为合法 AccessToken2 且互不相同（用于即时降权）', () => {
    const service = createAgoraVoiceService({ appId: APP_ID, appCertificate: APP_CERTIFICATE });
    const subscriber = service.issueSubscriberGrant({ roomName: 'g_test', uid: 7 }).token;
    const publisher = service.issuePublishGrant({ roomName: 'g_test', uid: 7 }).token;
    expect(subscriber.startsWith('007e')).toBe(true);
    expect(publisher.startsWith('007e')).toBe(true);
    expect(subscriber).not.toBe(publisher);
  });

  it('踢人：调用频道管理 REST，客户密钥 Basic 鉴权 + 一次性踢出（time=0）', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response('{"status":"success"}', { status: 200 });
      }) as typeof fetch,
    });
    await service.removeParticipant('g_test', 1000);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://rest.test/dev/v1/kicking-rule');
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      appid: APP_ID,
      cname: 'g_test',
      uid: 1000,
      time: 0,
      privileges: ['join_channel'],
    });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from(`${CUSTOMER_KEY}:${CUSTOMER_SECRET}`).toString('base64')}`,
    );
  });

  it('关闭语音房：不带 uid 的一次性踢出（踢出频道内所有人）', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'GET') return new Response(JSON.stringify({ success: true, data: { channel_exist: false, users: [] } }), { status: 200 });
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });
    await service.closeRoom('g_test');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ cname: 'g_test', time: 0, privileges: ['join_channel'] });
    expect('uid' in (bodies[0] ?? {})).toBe(false);
  });

  it('关闭语音房：官方"踢出所有人"实测是空操作，因此按频道实况逐个补踢', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let usersSeen = 0;
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      restRetryDelayMs: 1,
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'GET') {
          usersSeen += 1;
          // 第一次查询：频道里还有两个人（官方"踢所有人"没生效）；补踢后再查：已空
          const users = usersSeen === 1 ? [11, 12] : [];
          return new Response(JSON.stringify({ success: true, data: { channel_exist: true, mode: 1, users } }), { status: 200 });
        }
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response('{"status":"success","id":0}', { status: 200 });
      }) as typeof fetch,
    });
    await service.closeRoom('g_test');
    expect(bodies.map((body) => body.uid)).toEqual([undefined, 11, 12]);
    expect(bodies.every((body) => body.cname === 'g_test' && body.time === 0)).toBe(true);
  });

  it('关闭语音房：频道查询失败时只留官方那一次调用，不阻塞关房', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      restRetryDelayMs: 1,
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'GET') return new Response('nope', { status: 401 });
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response('{"status":"success","id":0}', { status: 200 });
      }) as typeof fetch,
    });
    await expect(service.closeRoom('g_test')).resolves.toBeUndefined();
    expect(bodies).toHaveLength(1);
  });

  it('REST 失败：非 2xx 响应抛出错误', async () => {
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      restRetryDelayMs: 1,
      fetchImpl: (async () => new Response('server error', { status: 500 })) as typeof fetch,
    });
    await expect(service.removeParticipant('g_test', 1000)).rejects.toThrow('HTTP 500');
    await expect(service.closeRoom('g_test')).rejects.toThrow('HTTP 500');
  });

  it('REST 5xx 按退避重试，恢复后成功', async () => {
    let calls = 0;
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      restRetryDelayMs: 1,
      fetchImpl: (async () => {
        calls += 1;
        return calls === 1 ? new Response('try later', { status: 503 }) : new Response('{"status":"success"}', { status: 200 });
      }) as typeof fetch,
    });
    await expect(service.removeParticipant('g_test', 1000)).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('REST 4xx 视为永久失败，不重试', async () => {
    let calls = 0;
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      restRetryDelayMs: 1,
      fetchImpl: (async () => {
        calls += 1;
        return new Response('bad credentials', { status: 401 });
      }) as typeof fetch,
    });
    await expect(service.removeParticipant('g_test', 1000)).rejects.toThrow('HTTP 401');
    expect(calls).toBe(1);
  });

  it('REST 超时：每次尝试都带 AbortSignal，耗尽重试后抛出超时错误', async () => {
    const signals: Array<unknown> = [];
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      restTimeoutMs: 25,
      restRetries: 2,
      restRetryDelayMs: 1,
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        signals.push(init?.signal);
        // AbortSignal.timeout 触发时 fetch 以 TimeoutError 拒绝
        throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      }) as typeof fetch,
    });
    await expect(service.removeParticipant('g_test', 1000)).rejects.toThrow('请求超时');
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  it('对账查询：GET 频道用户列表，返回 uid 集合（客户密钥 Basic 鉴权）', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ success: true, data: { channel_exist: true, mode: 1, total: 2, users: [1, 'x', 2, null] } }), { status: 200 });
      }) as typeof fetch,
    });
    const result = await service.queryChannelUsers?.('g_test');
    expect(result).toEqual({ channelExist: true, mode: 1, users: [1, 2] });
    expect(calls[0]?.url).toBe(`https://rest.test/dev/v1/channel/user/${APP_ID}/g_test`);
    expect(calls[0]?.init.method).toBe('GET');
    expect(String((calls[0]?.init.headers as Record<string, string>)?.Authorization)).toMatch(/^Basic /);
  });

  it('空/空白的 REST 基地址退回默认中国区域名（.env 里的 `AGORA_REST_BASE_URL=` 会传成空串）', async () => {
    for (const configured of ['', '   ', undefined, 'https://rest.test/']) {
      const calls: string[] = [];
      const service = createAgoraVoiceService({
        appId: APP_ID,
        appCertificate: APP_CERTIFICATE,
        customerKey: CUSTOMER_KEY,
        customerSecret: CUSTOMER_SECRET,
        ...(configured === undefined ? {} : { restBaseUrl: configured }),
        fetchImpl: (async (url: string | URL | Request) => {
          calls.push(String(url));
          return new Response(JSON.stringify({ success: true, data: { channel_exist: false, users: [] } }), { status: 200 });
        }) as typeof fetch,
      });
      await service.queryChannelUsers?.('g_test');
      // 尾随斜杠也不能拼出双斜杠（`https://rest.test//dev/...`）
      expect(calls[0]).toBe(configured === 'https://rest.test/' ? `https://rest.test/dev/v1/channel/user/${APP_ID}/g_test` : `https://api.sd-rtn.com/dev/v1/channel/user/${APP_ID}/g_test`);
    }
  });

  it('对账查询：字段缺失时容错（channel_exist 缺失按"有用户即在"，users 缺失回落直播场景字段）', async () => {
    const make = (payload: unknown) => createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      fetchImpl: (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch,
    });
    await expect(make({ success: true, data: { mode: 1, users: [3] } }).queryChannelUsers?.('g')).resolves.toMatchObject({ channelExist: true, users: [3] });
    await expect(make({ success: true, data: { channel_exist: false } }).queryChannelUsers?.('g')).resolves.toMatchObject({ channelExist: false, users: [] });
    await expect(make({ success: true, data: { mode: 2, broadcasters: [7], audience: [8, 9] } }).queryChannelUsers?.('g')).resolves.toMatchObject({ channelExist: true, mode: 2, users: [7, 8, 9] });
    await expect(make({ success: false }).queryChannelUsers?.('g')).rejects.toThrow('响应不可解析');
  });

  it('对账查询：5xx 重试、4xx 不重试（与踢人共用同一套 REST 策略）', async () => {
    let attempts = 0;
    const service = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      restRetries: 2,
      restRetryDelayMs: 1,
      fetchImpl: (async () => { attempts += 1; return new Response('boom', { status: 500 }); }) as typeof fetch,
    });
    await expect(service.queryChannelUsers?.('g_test')).rejects.toThrow('HTTP 500');
    expect(attempts).toBe(3);

    attempts = 0;
    const denied = createAgoraVoiceService({
      appId: APP_ID,
      appCertificate: APP_CERTIFICATE,
      customerKey: CUSTOMER_KEY,
      customerSecret: CUSTOMER_SECRET,
      restBaseUrl: 'https://rest.test',
      restRetries: 2,
      restRetryDelayMs: 1,
      fetchImpl: (async () => { attempts += 1; return new Response('no', { status: 401 }); }) as typeof fetch,
    });
    await expect(denied.queryChannelUsers?.('g_test')).rejects.toThrow('HTTP 401');
    expect(attempts).toBe(1);
  });
});
