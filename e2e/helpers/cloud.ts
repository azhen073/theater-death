import { RoomServiceClient } from 'livekit-server-sdk';
import { requireLiveKitAdmin } from './env.ts';

export interface CloudParticipant {
  identity: string;
  canPublish: boolean;
  canSubscribe: boolean;
  tracks: Array<{ type: number; muted: boolean }>;
}

export function createAdmin(): RoomServiceClient {
  const { url, key, secret } = requireLiveKitAdmin();
  return new RoomServiceClient(url, key, secret);
}

export async function listParticipants(
  admin: RoomServiceClient,
  gameId: string,
): Promise<CloudParticipant[]> {
  const participants = await admin.listParticipants(gameId);
  return participants.map((participant) => ({
    identity: participant.identity,
    canPublish: participant.permission?.canPublish === true,
    canSubscribe: participant.permission?.canSubscribe === true,
    tracks: participant.tracks.map((track) => ({
      type: track.type ?? -1,
      muted: track.muted,
    })),
  }));
}

export async function findParticipant(
  admin: RoomServiceClient,
  gameId: string,
  playerId: string,
): Promise<CloudParticipant | undefined> {
  const participants = await listParticipants(admin, gameId);
  return participants.find((participant) => participant.identity.startsWith(playerId));
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

/** 等待某玩家在媒体服务上出现「已发布音频轨」（TrackType.AUDIO = 0）。 */
export function waitForAudioTrack(
  admin: RoomServiceClient,
  gameId: string,
  playerId: string,
  options: { timeoutMs?: number } = {},
): Promise<CloudParticipant> {
  return waitFor(
    async () => {
      const participant = await findParticipant(admin, gameId, playerId);
      if (participant && participant.tracks.some((track) => track.type === 0)) {
        return participant;
      }
      return false;
    },
    { timeoutMs: options.timeoutMs ?? 20_000, label: `${playerId} 音频轨发布` },
  );
}

/** 等待某玩家在媒体服务上的发布权变为期望值。 */
export function waitForCanPublish(
  admin: RoomServiceClient,
  gameId: string,
  playerId: string,
  expected: boolean,
  options: { timeoutMs?: number } = {},
): Promise<CloudParticipant> {
  return waitFor(
    async () => {
      const participant = await findParticipant(admin, gameId, playerId);
      if (participant && participant.canPublish === expected) {
        return participant;
      }
      return false;
    },
    {
      timeoutMs: options.timeoutMs ?? 20_000,
      label: `${playerId} canPublish=${expected}`,
    },
  );
}
