import { requestFingerprint } from '../receipts.ts';
import { ApiError } from './errors.ts';

export interface OperationResponse { status: number; body: unknown }
interface Entry { fingerprint: string; promise: Promise<OperationResponse> }

/** Account + room-code scope remains available after leave/dissolve, without retaining a room. */
export class OperationReceipts {
  private readonly entries = new Map<string, Entry>();
  reserve(userId: string, scope: string, requestId: string, payload: unknown) {
    const key = JSON.stringify([userId, scope, requestId]);
    const fingerprint = requestFingerprint(payload);
    const previous = this.entries.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ApiError(409, 'request_id_reused');
      return { owner: false, promise: previous.promise, finish: (_response: OperationResponse) => undefined };
    }
    if (this.entries.size >= 50_000) throw new ApiError(429, 'receipt_limit');
    let complete!: (result: OperationResponse) => void;
    const promise = new Promise<OperationResponse>((resolve) => { complete = resolve; });
    const entry = { fingerprint, promise };
    this.entries.set(key, entry);
    let finished = false;
    return {
      owner: true, promise,
      finish: (response: OperationResponse) => {
        if (finished) return;
        const stored = structuredClone(response);
        finished = true;
        // Admission failures have not performed a mutation; the same intent may retry later.
        if (stored.status === 429 || stored.status === 503) this.entries.delete(key);
        complete(stored);
      },
    };
  }
}
