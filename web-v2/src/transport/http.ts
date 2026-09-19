export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code); this.name = 'ApiFailure'; this.status = status; this.code = code;
  }
}

/** A lost response never becomes a business rejection. Retain the original intent. */
export class UnknownResult extends Error {
  constructor() { super('尚未收到服务器确认'); this.name = 'UnknownResult'; }
}

export async function request<T>(path: string, options: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const external = options.signal;
  if (external?.aborted) throw external.reason;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(external?.reason);
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(external?.aborted ? external.reason : new UnknownResult());
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  external?.addEventListener('abort', forwardAbort, { once: true });
  // One deadline includes both response headers and the complete response body.
  const deadline = setTimeout(() => controller.abort(), 20_000);
  try {
    let response: Response;
    try {
      response = await Promise.race([fetcher(`/api/v2${path}`, { ...options, signal: controller.signal, credentials: 'include', cache: 'no-store' }), aborted]);
    } catch {
      if (external?.aborted) throw external.reason;
      throw new UnknownResult();
    }
    let body: unknown;
    try { body = response.status === 204 ? null : await Promise.race([response.json(), aborted]); }
    catch {
      if (external?.aborted) throw external.reason;
      throw new UnknownResult();
    }
    if (!response.ok) {
      const envelope = body as { error?: { code?: unknown; message?: unknown } } | null;
      throw new ApiFailure(response.status, typeof envelope?.error?.code === 'string' ? envelope.error.code : 'unknown_error',
        typeof envelope?.error?.message === 'string' ? envelope.error.message : undefined);
    }
    return body as T;
  } finally {
    clearTimeout(deadline);
    external?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}

export const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal });
export const post = <T>(path: string, body: object, signal?: AbortSignal) => request<T>(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
});

const messages: Record<string, string> = {
  invalid_credentials: '账号或密码不正确，请重试。', invalid_invitation: '邀请码无效、已使用或已过期。',
  invalid_uid: 'UID格式不正确。', invalid_nickname: '昵称须为2–32个文字或下划线，不能包含数字、空格或Emoji。', invalid_password: '密码格式不符合要求。',
  registration_closed: '暂未开放新账号注册。', account_deleted: '该注册请求对应的账号已经删除。',
  unauthorized: '请先登录。', session_expired: '登录已失效，请重新登录。',
  account_disabled: '账户已停用，请联系维护者。',
  takeover_required: '此身份正在另一台设备上使用，请确认是否接管。',
  already_in_room: '你已有当前房间，请先返回或明确离开该房间。',
  room_not_found: '房间不存在或已结束。', room_full: '正式席位已满，你仍保持观战身份。',
  stale_game: '已经进入新的对局，旧操作已失效。', stale_window: '行动阶段已变化，请查看当前任务。',
  window_closed: '本次行动时间已结束，正在同步。', request_id_reused: '这次请求的内容已改变，请核对原操作结果。',
  action_forbidden: '当前不能执行此行动。', chat_forbidden: '当前频道暂不可发送消息。',
  not_host: '你的房主管理权限已变化。', seat_control_required: '此设备已没有操作权限。',
  room_access_required: '请重新确认当前房间身份。', lobby_required: '此操作只能在大厅进行。', review_required: '当前不在复盘阶段。',
  invalid_ruleset: '角色组合不符合规则，请检查配置。', player_count_mismatch: '人数与角色数量不一致。',
  invalid_screen_invitation: '第二屏邀请无效、已使用或已过期。', second_screen_unavailable: '当前无法建立第二屏。',
  player_cannot_spectate: '本局玩家只能恢复自己的身份。', invalid_avatar: '请选择符合要求的静态图片。',
  avatar_too_large: '图片过大，请裁剪或压缩后重试。', avatar_busy: '头像处理繁忙，请稍后重试。',
  avatar_storage_unavailable: '头像暂时无法保存，原头像已保留。', rate_limited: '操作过于频繁，请稍后再试。',
  origin_forbidden: '当前访问地址与服务设置不一致，请使用正确入口。',
  voice_disabled: '此房间未启用语音。', voice_unavailable: '语音暂时不可用，文字交流不受影响。',
};
export function errorMessage(error: unknown): string {
  if (error instanceof ApiFailure) return messages[error.code] ?? '暂时无法完成操作，请刷新状态后重试。';
  if (error instanceof UnknownResult) return '连接中断，尚未确认结果。请先同步状态，避免重复操作。';
  return '连接暂时不可用，请稍后重试。';
}
