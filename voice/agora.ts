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
  /** 发布授权有效期（秒），默认 600；需覆盖最长发言窗口（90 秒）并留足缓冲 */
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
  const publishTtl = options.publishTtlSeconds ?? 600;
  const restBaseUrl = options.restBaseUrl ?? DEFAULT_REST_BASE_URL;
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
    const attempts = restRetries + 1;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) await sleep(restRetryDelayMs * 4 ** (attempt - 2));
      try {
        const response = await doFetch(`${restBaseUrl}/dev/v1/kicking-rule`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // 频道管理 REST 使用「客户 ID + 客户密钥」基本认证（不是 App ID/证书）
            Authorization: `Basic ${Buffer.from(`${customerKey}:${customerSecret}`).toString('base64')}`,
          },
          body,
          signal: AbortSignal.timeout(restTimeoutMs),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new AgoraRestError(`声网频道管理失败：HTTP ${response.status} ${detail}`, response.status);
        }
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetryable(error)) break;
      }
    }
    throw describeRestFailure(lastError, restTimeoutMs, attempts);
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

    closeRoom(roomName) {
      return kickFromChannel({ cname: roomName });
    },

    removeParticipant(roomName, uid) {
      return kickFromChannel({ cname: roomName, uid });
    },
  };
}
