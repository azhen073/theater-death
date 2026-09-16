import { ENV } from './env.ts';

export interface HttpResponse {
  status: number;
  json: Record<string, unknown>;
  cookie: string | null;
}

export interface Client {
  readonly playerId: string;
  readonly cookie: string;
  readonly nickname: string;
}

let requestSeq = 0;

async function request(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<HttpResponse> {
  const { method = 'GET', body, cookie } = options;
  const response = await fetch(ENV.baseUrl + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookieList =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const rawSetCookie = setCookieList[0] ?? response.headers.get('set-cookie');
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    // 非 JSON 响应保持空对象
  }
  return { status: response.status, json, cookie: rawSetCookie?.split(';')[0] ?? null };
}

export const api = {
  get: (path: string, cookie?: string) => request(path, { cookie }),
  post: (path: string, body: unknown, cookie?: string) =>
    request(path, { method: 'POST', body, cookie }),
};

export async function createRoom(options: {
  nickname: string;
  ruleset?: unknown;
}): Promise<{ roomCode: string; client: Client }> {
  const response = await api.post('/api/rooms', {
    nickname: options.nickname,
    ...(options.ruleset !== undefined ? { ruleset: options.ruleset } : {}),
  });
  if (response.status !== 201) {
    throw new Error(`建局失败 ${response.status}: ${JSON.stringify(response.json)}`);
  }
  return {
    roomCode: response.json.roomCode as string,
    client: {
      playerId: response.json.playerId as string,
      cookie: response.cookie ?? '',
      nickname: options.nickname,
    },
  };
}

export async function joinRoom(roomCode: string, nickname: string): Promise<Client> {
  const response = await api.post(`/api/rooms/${roomCode}/join`, { nickname });
  if (response.status !== 201) {
    throw new Error(`加入失败 ${response.status}: ${JSON.stringify(response.json)}`);
  }
  return { playerId: response.json.playerId as string, cookie: response.cookie ?? '', nickname };
}

export async function setReady(roomCode: string, client: Client, ready = true): Promise<void> {
  const response = await api.post(`/api/rooms/${roomCode}/ready`, { ready }, client.cookie);
  if (response.status !== 200) {
    throw new Error(`准备失败 ${response.status}: ${JSON.stringify(response.json)}`);
  }
}

export async function startGame(roomCode: string, host: Client): Promise<void> {
  const response = await api.post(`/api/rooms/${roomCode}/start`, {}, host.cookie);
  if (response.status !== 200) {
    throw new Error(`开局失败 ${response.status}: ${JSON.stringify(response.json)}`);
  }
}

export async function getView(client: Client): Promise<Record<string, unknown>> {
  const response = await api.get('/api/view', client.cookie);
  if (response.status !== 200) {
    throw new Error(`视图失败 ${response.status}: ${JSON.stringify(response.json)}`);
  }
  return response.json;
}

export async function command(
  client: Client,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  requestSeq += 1;
  const requestId = `e2e-${Date.now()}-${requestSeq}`;
  const response = await api.post('/api/command', { requestId, action, ...extra }, client.cookie);
  return { status: response.status, json: response.json };
}

export async function chat(
  client: Client,
  channel: 'public' | 'faction',
  text: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await api.post('/api/chat', { channel, text }, client.cookie);
  return { status: response.status, json: response.json };
}

export interface LobbySetup {
  roomCode: string;
  gameId: string;
  clients: Client[];
  host: Client;
}

/** 建立 13 人满员大厅（1 房主 + 12 玩家），可选实验板。 */
export async function setupLobby(options: {
  ruleset?: unknown;
  prefix?: string;
  size?: number;
} = {}): Promise<LobbySetup> {
  const { ruleset, prefix = '玩家', size = 13 } = options;
  const created = await createRoom({ nickname: `${prefix}1`, ...(ruleset !== undefined ? { ruleset } : {}) });
  const clients: Client[] = [created.client];
  for (let index = 2; index <= size; index += 1) {
    clients.push(await joinRoom(created.roomCode, `${prefix}${index}`));
  }
  // gameId 仅在大厅视图（对局开始后由 gameId 命名的媒体房延续）
  const lobbyView = await getView(created.client);
  return {
    roomCode: created.roomCode,
    gameId: lobbyView.gameId as string,
    clients,
    host: created.client,
  };
}

/** 建立并开始 13 人满员对局。 */
export async function setupStartedGame(options: { ruleset?: unknown } = {}): Promise<LobbySetup> {
  const lobby = await setupLobby(options);
  for (const client of lobby.clients) {
    await setReady(lobby.roomCode, client);
  }
  await startGame(lobby.roomCode, lobby.host);
  return lobby;
}
