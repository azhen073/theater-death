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
  /** 测试注入；缺省用全局 fetch */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_REST_BASE_URL = 'https://api.sd-rtn.com';

export function createAgoraVoiceService(options: AgoraVoiceOptions): VoiceService {
  const { appId, appCertificate } = options;
  const customerKey = options.customerKey ?? '';
  const customerSecret = options.customerSecret ?? '';
  const tokenTtl = options.tokenTtlSeconds ?? 1800;
  const publishTtl = options.publishTtlSeconds ?? 600;
  const restBaseUrl = options.restBaseUrl ?? DEFAULT_REST_BASE_URL;
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
   */
  async function kickFromChannel(input: { cname: string; uid?: number }): Promise<void> {
    const response = await doFetch(`${restBaseUrl}/dev/v1/kicking-rule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 频道管理 REST 使用「客户 ID + 客户密钥」基本认证（不是 App ID/证书）
        Authorization: `Basic ${Buffer.from(`${customerKey}:${customerSecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        appid: appId,
        cname: input.cname,
        ...(input.uid === undefined ? {} : { uid: input.uid }),
        time: 0,
        privileges: ['join_channel'],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`声网频道管理失败：HTTP ${response.status} ${detail}`);
    }
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
