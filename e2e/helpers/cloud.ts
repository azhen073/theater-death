import { requireAgoraAdmin } from './env.ts';

function authHeader(customerKey: string, customerSecret: string): string {
  return `Basic ${Buffer.from(`${customerKey}:${customerSecret}`).toString('base64')}`;
}

export interface AgoraUserStatus {
  readonly inChannel: boolean;
  readonly uid: number;
  readonly join: number | null;
  readonly role: number | null;
}

/** 查询频道内所有用户 uid（频道不存在或无人时为空数组） */
export async function listChannelUserIds(gameId: string): Promise<number[]> {
  const { appId, customerKey, customerSecret, restBaseUrl } = requireAgoraAdmin();
  const response = await fetch(
    `${restBaseUrl}/dev/v1/channel/user/${encodeURIComponent(appId)}/${encodeURIComponent(gameId)}`,
    { headers: { Accept: 'application/json', Authorization: authHeader(customerKey, customerSecret) } },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`声网查询用户列表失败：HTTP ${response.status} ${detail}`);
  }
  const payload = (await response.json()) as {
    success: boolean;
    data?: {
      channel_exist?: boolean;
      users?: number[];
      broadcasters?: number[];
      audience?: number[];
    };
  };
  if (payload.data === undefined || payload.data.channel_exist !== true) {
    return [];
  }
  return [
    ...(payload.data.users ?? []),
    ...(payload.data.broadcasters ?? []),
    ...(payload.data.audience ?? []),
  ];
}

/** 查询指定用户在频道内的状态（声网仅提供"在不在频道"，不提供发流/权限状态） */
export async function fetchUserStatus(gameId: string, uid: number): Promise<AgoraUserStatus> {
  const { appId, customerKey, customerSecret, restBaseUrl } = requireAgoraAdmin();
  const response = await fetch(
    `${restBaseUrl}/dev/v1/channel/user/property/${encodeURIComponent(appId)}/${uid}/${encodeURIComponent(gameId)}`,
    { headers: { Accept: 'application/json', Authorization: authHeader(customerKey, customerSecret) } },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`声网查询用户状态失败：HTTP ${response.status} ${detail}`);
  }
  const payload = (await response.json()) as {
    success: boolean;
    data?: { in_channel?: boolean; uid?: number; join?: number; role?: number };
  };
  return {
    inChannel: payload.data?.in_channel === true,
    uid,
    join: payload.data?.join ?? null,
    role: payload.data?.role ?? null,
  };
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined | null | false>,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const { timeoutMs = 15_000, intervalMs = 500, label = '条件' } = options;
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  for (;;) {
    last = await probe();
    if (last) {
      return last as T;
    }
    if (Date.now() > deadline) {
      throw new Error(`等待超时（${label}，${timeoutMs}ms；最后值 ${JSON.stringify(last)}）`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** 等待频道内出现语音用户；脚本玩家不加入语音，返回的 uid 通常即浏览器玩家 */
export function waitForChannelUser(
  gameId: string,
  options: { exclude?: ReadonlySet<number>; timeoutMs?: number } = {},
): Promise<number> {
  return waitFor(
    async () => {
      const uids = await listChannelUserIds(gameId);
      const candidate = uids.find((uid) => !(options.exclude?.has(uid) ?? false));
      return candidate ?? false;
    },
    {
      timeoutMs: options.timeoutMs ?? 30_000,
      intervalMs: 2000,
      label: '浏览器玩家出现在语音频道',
    },
  );
}

/** 等待指定用户进入（expected=true）或离开（expected=false）语音频道 */
export function waitForUserInChannel(
  gameId: string,
  uid: number,
  expected: boolean,
  options: { timeoutMs?: number } = {},
): Promise<boolean> {
  return waitFor(
    async () => {
      const status = await fetchUserStatus(gameId, uid);
      return status.inChannel === expected;
    },
    {
      timeoutMs: options.timeoutMs ?? 20_000,
      intervalMs: 1000,
      label: `用户 ${uid} ${expected ? '进入' : '离开'}语音频道`,
    },
  );
}
