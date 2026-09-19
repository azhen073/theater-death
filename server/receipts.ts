import { createHash } from 'node:crypto';
import type { CommandReceipt } from './rooms.ts';
import type { ReceiptLookup } from '../contracts/v2.ts';

export class RequestFingerprintError extends Error {}
function canonical(value: unknown, depth = 0): unknown {
  if (depth > 32) throw new RequestFingerprintError('invalid_request_payload');
  if (value === null) return ['null'];
  if (Array.isArray(value)) return ['array', value.map((item) => canonical(item, depth + 1))];
  if (typeof value === 'object') return ['object', Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item, depth + 1)])];
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  throw new RequestFingerprintError('invalid_request_payload');
}
export const requestFingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const reused = (requestId: string): CommandReceipt => ({ requestId, status: 'rejected', code: 'request_id_reused', message: '请求编号已用于不同内容' });
const full = (requestId: string): CommandReceipt => ({ requestId, status: 'rejected', code: 'receipt_limit', message: '本局请求记录已达上限' });

export class ReceiptStore {
  private readonly entries = new Map<string, { fingerprint: string; receipt: CommandReceipt }>();
  private readonly pending = new Map<string, { fingerprint: string; promise: Promise<CommandReceipt> }>();
  execute(gameId: string, playerId: string, requestId: string, payload: unknown, apply: () => CommandReceipt): CommandReceipt {
    const key = JSON.stringify([gameId, playerId, requestId]);
    const fingerprint = requestFingerprint(payload);
    const old = this.entries.get(key);
    if (old) return old.fingerprint === fingerprint ? old.receipt : reused(requestId);
    if (this.pending.has(key)) throw new Error('Synchronous execution cannot consume a queued receipt');
    // Reject instead of evicting live-game receipts and permitting an old request to execute again.
    if (this.entries.size + this.pending.size >= 10000) return full(requestId);
    const receipt = apply();
    this.entries.set(key, { fingerprint, receipt });
    return receipt;
  }
  executeQueued(gameId: string, playerId: string, requestId: string, payload: unknown, apply: () => Promise<CommandReceipt>): Promise<CommandReceipt> {
    const key = JSON.stringify([gameId, playerId, requestId]);
    const fingerprint = requestFingerprint(payload);
    const old = this.entries.get(key);
    if (old) return Promise.resolve(old.fingerprint === fingerprint ? old.receipt : reused(requestId));
    const queued = this.pending.get(key);
    if (queued) return queued.fingerprint === fingerprint ? queued.promise : Promise.resolve(reused(requestId));
    if (this.entries.size + this.pending.size >= 10000) return Promise.resolve(full(requestId));
    // Publish pending before queue execution, so lookup never executes/requeues an intent.
    const promise = Promise.resolve().then(apply).catch((): CommandReceipt => {
      console.warn('command_execution_failed');
      return { requestId, status: 'rejected', code: 'internal_error', message: '服务器处理失败，请刷新状态' };
    }).then((receipt) => {
      this.entries.set(key, { fingerprint, receipt }); this.pending.delete(key); return receipt;
    });
    this.pending.set(key, { fingerprint, promise });
    return promise;
  }
  lookup(gameId: string, playerId: string, requestId: string): ReceiptLookup {
    const key = JSON.stringify([gameId, playerId, requestId]);
    const done = this.entries.get(key);
    return done ? structuredClone(done.receipt) : { requestId, status: this.pending.has(key) ? 'pending' : 'not_seen' };
  }
}
