import type { ChatMessageDTO } from '../../contracts/v2.ts';
import { requestFingerprint } from '../receipts.ts';
import { ApiError } from './errors.ts';

export interface ChatAcknowledgement { gameId: string; channel: 'public' | 'faction'; message: ChatMessageDTO }
/** Invoked inside the room queue, after checking the current controlling session. */
export class ChatReceipts {
  private readonly entries = new Map<string, { fingerprint: string; result: ChatAcknowledgement }>();
  execute(gameId: string, playerId: string, clientMessageId: string, payload: unknown, send: () => ChatAcknowledgement): ChatAcknowledgement {
    const key = JSON.stringify([gameId, playerId, clientMessageId]);
    const fingerprint = requestFingerprint(payload);
    const old = this.entries.get(key);
    if (old) {
      if (old.fingerprint !== fingerprint) throw new ApiError(409, 'request_id_reused');
      return structuredClone(old.result);
    }
    if (this.entries.size >= 10_000) throw new ApiError(429, 'receipt_limit');
    const result = send();
    this.entries.set(key, { fingerprint, result: structuredClone(result) });
    return result;
  }
}
