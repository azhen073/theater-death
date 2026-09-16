import { AccessToken, RoomServiceClient, type ParticipantInfo } from 'livekit-server-sdk';

/** 浏览器端加入语音所需的短期凭证（发布权由服务端动态授予，token 本身不含发布权） */
export interface VoiceCredentials {
  readonly url: string;
  readonly token: string;
  readonly roomName: string;
}

export interface VoiceService {
  /** 当前房间的期望发布许可（经服务端策略计算，按 playerId） */
  issueCredentials(input: { roomName: string; playerId: string }): Promise<VoiceCredentials>;
  /** 把期望发布许可同步到媒体服务；房间不存在视为无事可做 */
  syncRoom(input: {
    roomName: string;
    permissions: ReadonlyMap<string, boolean>;
  }): Promise<void>;
  /** 对局结束 / 房间销毁时关闭媒体房间 */
  closeRoom(roomName: string): Promise<void>;
}

type RoomClient = {
  listParticipants(room: string): Promise<ParticipantInfo[]>;
  updateParticipant(
    room: string,
    identity: string,
    options: {
      permission?: { canPublish?: boolean; canSubscribe?: boolean; canPublishData?: boolean };
    },
  ): Promise<unknown>;
  deleteRoom(room: string): Promise<void>;
};

export interface LiveKitVoiceOptions {
  /** 服务端访问 LiveKit 的地址（容器内 http://livekit:7880；Cloud 为 https://*.livekit.cloud） */
  readonly adminUrl: string;
  /** 浏览器访问的 WebSocket 地址（wss://...） */
  readonly publicUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  /** 凭证有效期（秒），默认 30 分钟 */
  readonly tokenTtlSeconds?: number;
  /** 测试注入用；缺省创建真实 RoomServiceClient */
  readonly roomClient?: RoomClient;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /not.?found/i.test(code)) {
    return true;
  }
  return /not.?found|404/i.test(String(error));
}

export function createLiveKitVoiceService(options: LiveKitVoiceOptions): VoiceService {
  const roomClient: RoomClient =
    options.roomClient ??
    new RoomServiceClient(options.adminUrl, options.apiKey, options.apiSecret);
  const ttlSeconds = options.tokenTtlSeconds ?? 1800;

  return {
    async issueCredentials({ roomName, playerId }) {
      const token = new AccessToken(options.apiKey, options.apiSecret, {
        identity: playerId,
        ttl: ttlSeconds,
      });
      token.addGrant({
        roomJoin: true,
        room: roomName,
        canSubscribe: true,
        canPublish: false,
        canPublishData: false,
      });
      return { url: options.publicUrl, token: await token.toJwt(), roomName };
    },

    async syncRoom({ roomName, permissions }) {
      let participants: ParticipantInfo[];
      try {
        participants = await roomClient.listParticipants(roomName);
      } catch (error) {
        if (isNotFound(error)) {
          return;
        }
        throw error;
      }
      for (const participant of participants) {
        const desired = permissions.get(participant.identity) ?? false;
        const current = participant.permission?.canPublish ?? false;
        if (current === desired) {
          continue;
        }
        await roomClient.updateParticipant(roomName, participant.identity, {
          permission: { canPublish: desired, canSubscribe: true, canPublishData: false },
        });
      }
    },

    async closeRoom(roomName) {
      try {
        await roomClient.deleteRoom(roomName);
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    },
  };
}
