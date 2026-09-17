import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'td_session';

export interface SessionPayload {
  readonly gameId: string;
  readonly playerId: string;
  readonly issuedAt: number;
  /** 缺省为普通玩家会话；spectator 时 playerId 为 spectatorId */
  readonly kind?: 'spectator';
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [body, mac] = parts;
  const expected = createHmac('sha256', secret).update(body).digest();
  const provided = Buffer.from(mac, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.gameId !== 'string' ||
      typeof record.playerId !== 'string' ||
      typeof record.issuedAt !== 'number'
    ) {
      return null;
    }
    if (record.kind !== undefined && record.kind !== 'spectator') {
      return null;
    }
    return {
      gameId: record.gameId,
      playerId: record.playerId,
      issuedAt: record.issuedAt,
      ...(record.kind === 'spectator' ? { kind: 'spectator' as const } : {}),
    };
  } catch {
    return null;
  }
}
