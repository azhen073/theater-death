import agoraToken from 'agora-token';

// agora-token 为 CommonJS 包：Node 原生 ESM 不提供命名导出，需 default 导入后解构
const { RtcRole, RtcTokenBuilder } = agoraToken;

/** 浏览器端加入语音所需的凭证（可加入、可订阅；发布权由服务端按 R-43 动态授予） */
export interface VoiceCredentials {
  readonly appId: string;
  readonly channel: string;
  readonly uid: number;
  readonly token: string;
}

/** 短时效发布授权（含音频发布权限，过期即自动收回） */
export interface PublishGrant {
  readonly token: string;
  /** 发流权限过期的 Unix 毫秒时间戳 */
  readonly expiresAt: number;
}

/** 频道内用户查询结果（D 组对账用） */
export interface ChannelUserQuery {
  /** 频道是否存在（官方字段名 `channel_exist` 仍待官方站确认，缺失时退化为「有用户即在」） */
  readonly channelExist: boolean;
  /** 频道场景：1 = COMMUNICATION，2 = LIVE_BROADCASTING；未知为 null */
  readonly mode: number | null;
  /** 频道内用户 uid 列表 */
  readonly users: readonly number[];
}

export interface VoiceService {
  /** 签发加入凭证（不含发布权限） */
  issueCredentials(input: { roomName: string; uid: number }): VoiceCredentials;
  /** 签发发布授权（R-43 授予开麦） */
  issuePublishGrant(input: { roomName: string; uid: number }): PublishGrant;
  /** 签发订阅凭证（前端 renewToken 后立即降权，用于权限收回） */
  issueSubscriberGrant(input: { roomName: string; uid: number }): { token: string };
  /** 对局结束：把频道内所有用户一次性踢出（等价关闭语音房） */
  closeRoom(roomName: string): Promise<void>;
  /** 移除在线参与者（踢人 = 清位，不拉黑：一次性踢出，可立即重进） */
  removeParticipant(roomName: string, uid: number): Promise<void>;
  /** 服务端事实：查询频道内用户（D 组轮询对账）。可选能力：未实现的适配器省略后对账会跳过。 */
  queryChannelUsers?(roomName: string): Promise<ChannelUserQuery>;
}

export interface AgoraVoiceOptions {
  readonly appId: string;
  readonly appCertificate: string;
  /** 频道管理 REST（踢人/关房）的客户 ID；在控制台「设置 → RESTful API」生成，与 App 证书不同 */
  readonly customerKey?: string;
  /** 频道管理 REST 的客户密钥 */
  readonly customerSecret?: string;
  /** Token 与加入频道权限的有效期（秒），默认 1800 */
  readonly tokenTtlSeconds?: number;
  /** 发布授权有效期（秒），默认 150：覆盖最长发言窗口（规则 2.0 发言轮 120 秒）并留 30 秒缓冲 */
  readonly publishTtlSeconds?: number;
  /** 频道管理 REST 基地址；中国区账号为 api.sd-rtn.com */
  readonly restBaseUrl?: string;
  /** 频道管理 REST 单次请求超时（毫秒），默认 15000；官方建议不低于 5 秒、不高于 20 余秒 */
  readonly restTimeoutMs?: number;
  /** 频道管理 REST 失败后的重试次数（仅 5xx / 超时 / 网络错误），默认 2（即最多 3 次尝试） */
  readonly restRetries?: number;
  /** 重试的基础退避（毫秒），默认 250，按 4 倍递增；测试可调小 */
  readonly restRetryDelayMs?: number;
  /** 测试注入；缺省用全局 fetch */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_REST_BASE_URL = 'https://api.sd-rtn.com';
const DEFAULT_REST_TIMEOUT_MS = 15_000;
const DEFAULT_REST_RETRIES = 2;
const DEFAULT_REST_RETRY_DELAY_MS = 250;
/**
 * 发布授权（开麦权）有效期上限：声网没有"服务端实时改权限"API，权限收回靠前端 `renewToken` 换订阅凭证，
 * 客户端不配合时只能等发布凭证自然过期。因此把它压到「最长发言窗口 + 30 秒」＝150 秒，
 * 作为"被改客户端在窗口外继续发麦"的最坏时长上限（原默认 600 秒）。
 */
const DEFAULT_PUBLISH_TTL_SECONDS = 150;
/**
 * 关房补踢：官方「不带 uid = 踢出频道内所有用户」在真实项目上会返回 `{"status":"success","id":0}` 却一个人都不踢
 * （2026-09-23 实测复现），因此关房后按频道实况逐个补踢，避免终局/解散后玩家留在语音里。
 */
const CLOSE_ROOM_KICK_LIMIT = 50;
const CLOSE_ROOM_SWEEP_DELAY_MS = 500;

/** 频道管理 REST 的失败：带状态码，供重试判定（4xx 视为永久失败，5xx 可重试）。 */
class AgoraRestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AgoraRestError';
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** 只有可恢复故障才重试：5xx、请求超时（AbortSignal.timeout）与网络错误（fetch 抛出的无状态码错误）。 */
function isRetryable(error: unknown): boolean {
  // 4xx 是配置/鉴权类永久失败，重试无意义
  if (error instanceof AgoraRestError) return error.status >= 500;
  return true;
}

function describeRestFailure(error: unknown, timeoutMs: number, attempts: number): Error {
  if (error instanceof AgoraRestError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  return new Error(
    timeout
      ? `声网频道管理失败：请求超时（${timeoutMs}ms，已尝试 ${attempts} 次）`
      : `声网频道管理失败：${detail}（已尝试 ${attempts} 次）`,
  );
}

export function createAgoraVoiceService(options: AgoraVoiceOptions): VoiceService {
  const { appId, appCertificate } = options;
  const customerKey = options.customerKey ?? '';
  const customerSecret = options.customerSecret ?? '';
  const tokenTtl = options.tokenTtlSeconds ?? 1800;
  const publishTtl = options.publishTtlSeconds ?? DEFAULT_PUBLISH_TTL_SECONDS;
  // 空串/空白视为「未配置」：.env 与 compose 里的 `AGORA_REST_BASE_URL=` 会传成空串，
  // 若直接用它拼 URL 会得到相对路径（Node 的 fetch 会抛 Failed to parse URL），
  // 于是踢人/关房/频道对账全部失败且看起来像"凭据有问题"。
  const restBaseUrl = (options.restBaseUrl ?? '').trim().replace(/\/+$/, '') || DEFAULT_REST_BASE_URL;
  const restTimeoutMs = options.restTimeoutMs ?? DEFAULT_REST_TIMEOUT_MS;
  const restRetries = Math.max(0, Math.trunc(options.restRetries ?? DEFAULT_REST_RETRIES));
  const restRetryDelayMs = Math.max(0, options.restRetryDelayMs ?? DEFAULT_REST_RETRY_DELAY_MS);
  const doFetch: typeof fetch = options.fetchImpl ?? fetch;

  function subscriberToken(roomName: string, uid: number): string {
    // 订阅角色：开启连麦鉴权后，订阅者无法发布音视频流
    return RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      roomName,
      uid,
      RtcRole.SUBSCRIBER,
      tokenTtl,
      tokenTtl,
    );
  }

  /**
   * 频道管理 REST 的统一调用：Basic 认证（客户 ID + 客户密钥）、单次超时、5xx/超时/网络错误退避重试。
   * 4xx 视为配置/鉴权类永久失败，不重试（官方最佳实践：客户端超时建议 ≥20 秒，最低不低于 5 秒）。
   */
  async function restWithRetry(pathname: string, init: { method: 'GET' | 'POST'; body?: string }): Promise<Response> {
    const attempts = restRetries + 1;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) await sleep(restRetryDelayMs * 4 ** (attempt - 2));
      try {
        const response = await doFetch(`${restBaseUrl}${pathname}`, {
          method: init.method,
          headers: {
            'Content-Type': 'application/json',
            // 频道管理 REST 使用「客户 ID + 客户密钥」基本认证（不是 App ID/证书）
            Authorization: `Basic ${Buffer.from(`${customerKey}:${customerSecret}`).toString('base64')}`,
          },
          ...(init.body === undefined ? {} : { body: init.body }),
          signal: AbortSignal.timeout(restTimeoutMs),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new AgoraRestError(`声网频道管理失败：HTTP ${response.status} ${detail}`, response.status);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetryable(error)) break;
      }
    }
    throw describeRestFailure(lastError, restTimeoutMs, attempts);
  }

  /**
   * 频道管理 REST：创建封禁规则。
   * `time: 0` + `join_channel` 表示一次性踢出、可立即重进：
   * - 带 uid：踢出指定用户（踢人 = 清位，不拉黑）
   * - 不带 uid：踢出频道内所有用户（等价关闭语音房）
   *
   * 官方说明一次性踢出在「SDK 当时与边缘节点断开」时会失败、需要再次调用，且建议超时 ≥5 秒、
   * 5xx/超时按递增间隔重试，因此这里带单次超时与退避重试；4xx（配置/鉴权错误）视为永久失败，不重试。
   */
  async function kickFromChannel(input: { cname: string; uid?: number }): Promise<void> {
    const body = JSON.stringify({
      appid: appId,
      cname: input.cname,
      ...(input.uid === undefined ? {} : { uid: input.uid }),
      time: 0,
      privileges: ['join_channel'],
    });
    await restWithRetry('/dev/v1/kicking-rule', { method: 'POST', body });
  }

  /**
   * D 组轮询对账的事实来源：`GET /dev/v1/channel/user/{appid}/{channelName}`（官方 API 参考）。
   * 官方只回答「在线/角色/入频时间」，**不能**回答「是否在发流」，因此对账只用于在线与权限对齐。
   * 响应字段名（`channel_exist` / `mode` / `users`）目前来自非官方英文站，故解析保持容错：
   * 缺字段时退化（`channel_exist` 缺失 → 以「有用户」判定；`users` 缺失 → 尝试直播场景的 broadcasters/audience）。
   */
  async function queryChannelUsers(roomName: string): Promise<ChannelUserQuery> {
    const response = await restWithRetry(
      `/dev/v1/channel/user/${encodeURIComponent(appId)}/${encodeURIComponent(roomName)}`,
      { method: 'GET' },
    );
    const payload = (await response.json().catch(() => null)) as
      | { success?: boolean; data?: { channel_exist?: unknown; mode?: unknown; users?: unknown; broadcasters?: unknown; audience?: unknown } }
      | null;
    const data = payload?.data;
    if (payload?.success !== true || data === undefined || data === null) throw new Error('声网频道查询失败：响应不可解析');
    const numbers = (value: unknown): number[] => (Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : []);
    const users = numbers(data.users);
    const fallback = [...numbers(data.broadcasters), ...numbers(data.audience)];
    const resolved = users.length > 0 ? users : fallback;
    return {
      channelExist: data.channel_exist === true || resolved.length > 0,
      mode: typeof data.mode === 'number' ? data.mode : null,
      users: resolved,
    };
  }

  /**
   * 关房：先按官方语义"踢出频道内所有用户"，再按频道实况逐个补踢。
   * 实测（真实账号，2026-09-23）：不带 uid 的调用对空频道与有人频道都返回 `{"status":"success","id":0}`，
   * 但频道内用户一个都没少、踢人规则列表为空——即它是**静默空操作**。只信它会让终局/解散后玩家继续留在语音里。
   */
  async function closeRoom(roomName: string): Promise<void> {
    await kickFromChannel({ cname: roomName });
    const sweep = async (): Promise<number> => {
      const query = await queryChannelUsers(roomName).catch(() => null);
      const users = (query?.users ?? []).slice(0, CLOSE_ROOM_KICK_LIMIT);
      for (const uid of users) await kickFromChannel({ cname: roomName, uid }).catch(() => undefined);
      return users.length;
    };
    if (await sweep() === 0) return;
    await sleep(CLOSE_ROOM_SWEEP_DELAY_MS);
    const remaining = await queryChannelUsers(roomName).catch(() => null);
    if ((remaining?.users.length ?? 0) > 0) console.warn('voice_close_room_incomplete', remaining!.users.length);
  }

  return {
    issueCredentials({ roomName, uid }) {
      return { appId, channel: roomName, uid, token: subscriberToken(roomName, uid) };
    },

    issuePublishGrant({ roomName, uid }) {
      // 精细控制：加入频道权限覆盖整个 Token 有效期，发布权限短时效自动过期
      const token = RtcTokenBuilder.buildTokenWithUidAndPrivilege(
        appId,
        appCertificate,
        roomName,
        uid,
        tokenTtl,
        tokenTtl,
        publishTtl,
        publishTtl,
        publishTtl,
      );
      return { token, expiresAt: Date.now() + publishTtl * 1000 };
    },

    issueSubscriberGrant({ roomName, uid }) {
      return { token: subscriberToken(roomName, uid) };
    },

    closeRoom,

    removeParticipant(roomName, uid) {
      return kickFromChannel({ cname: roomName, uid });
    },

    // 未配置客户 ID/密钥时频道管理 REST 一律不可用（查询/踢人/关房都会 401）：
    // 不暴露查询能力，让对账按「跳过」处理（与 RUNBOOK §7 一致），
    // 而不是每 5 秒空跑一次注定失败、还会刷 `voice_reconcile_query_failed` 的请求
    ...(customerKey.trim() !== '' && customerSecret.trim() !== ''
      ? { queryChannelUsers: (roomName: string) => queryChannelUsers(roomName) }
      : {}),
  };
}
