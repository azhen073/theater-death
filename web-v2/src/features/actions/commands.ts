import type { CommandIntent, CommandReceipt, ReceiptLookup, RoomSnapshot } from '../../../../contracts/v2.ts';
import { ApiFailure } from '../../transport/http.ts';
import { currentTask, taskKey } from './model.ts';

export type CommandStatus = 'sending' | 'unknown' | 'pending' | 'not_seen' | 'accepted' | 'rejected';
export interface TrackedCommand { intent: CommandIntent; status: CommandStatus; code: string | null; checking: boolean }
interface Transport { send: (intent: CommandIntent) => Promise<CommandReceipt>; lookup: (intent: CommandIntent) => Promise<ReceiptLookup> }
const unresolved = (status: CommandStatus) => !['accepted', 'rejected'].includes(status);

/** One instance per authorized game perspective. A query is never a resend. */
export class CommandTracker {
  private records = new Map<string, TrackedCommand>();
  private disposed = false;
  private readonly identity: string;
  private readonly readView: () => RoomSnapshot | null;
  private readonly transport: Transport;
  private readonly changed: (records: TrackedCommand[]) => void;
  private readonly failed: (error: unknown) => void;
  constructor(view: RoomSnapshot, readView: () => RoomSnapshot | null, transport: Transport, changed: (records: TrackedCommand[]) => void, failed: (error: unknown) => void = () => {}) {
    this.identity = this.scope(view); this.readView = readView; this.transport = transport; this.changed = changed; this.failed = failed;
  }
  private scope(view: RoomSnapshot) { return JSON.stringify([view.viewer.userId, view.roomId, view.gameId, view.viewer.memberId, view.viewer.subjectPlayerId, view.viewer.readOnly]); }
  private authorized(): RoomSnapshot | null {
    const view = this.readView(); return !this.disposed && view && !view.viewer.readOnly && this.scope(view) === this.identity ? view : null;
  }
  list(): TrackedCommand[] { return structuredClone([...this.records.values()]); }
  private emit() { if (!this.disposed) this.changed(this.list()); }
  reconcile(): void {
    const view = this.authorized(); if (!view) return;
    let changed = false;
    for (const record of this.records.values()) {
      if (unresolved(record.status) && view.submissionState.some(item => item.requestId === record.intent.requestId && taskKey(item) === taskKey(record.intent))) {
        record.status = 'accepted'; record.code = null; changed = true;
      }
    }
    if (changed) this.emit();
  }
  pendingFor(intent: Pick<CommandIntent, 'action' | 'windowInstanceId'>): TrackedCommand | null {
    return this.list().find(record => taskKey(record.intent) === taskKey(intent) && unresolved(record.status)) ?? null;
  }
  async submit(intent: CommandIntent): Promise<void> {
    const view = this.authorized();
    if (!view || intent.gameId !== view.gameId || !currentTask(view, intent)) return;
    if (this.pendingFor(intent) || this.records.has(intent.requestId)) return;
    this.records.set(intent.requestId, { intent: structuredClone(intent), status: 'sending', code: null, checking: false });
    this.emit(); await this.send(intent.requestId);
  }
  private async send(id: string): Promise<void> {
    const record = this.records.get(id); if (!record || !this.authorized()) return;
    record.status = 'sending'; record.code = null; this.emit();
    try {
      const receipt = await this.transport.send(structuredClone(record.intent));
      if (!this.authorized() || this.records.get(id)?.status === 'accepted') return;
      if (receipt.requestId === id && ['accepted', 'rejected'].includes(receipt.status)) { record.status = receipt.status; record.code = receipt.code; }
      else record.status = 'unknown';
    } catch (error) {
      if (!this.authorized() || this.records.get(id)?.status === 'accepted') return;
      record.status = error instanceof ApiFailure && error.status < 500 && ![408, 429].includes(error.status) ? 'rejected' : 'unknown';
      record.code = error instanceof ApiFailure ? error.code : null;
      this.failed(error);
    }
    if (this.authorized()) this.emit();
  }
  async query(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record || !this.authorized() || record.checking || record.status === 'sending' || !unresolved(record.status)) return;
    record.checking = true; this.emit();
    try {
      const receipt = await this.transport.lookup(structuredClone(record.intent));
      if (!this.authorized() || !unresolved(record.status)) return;
      if (receipt.requestId === id && ['accepted', 'rejected', 'pending', 'not_seen'].includes(receipt.status)) {
        record.status = receipt.status; record.code = 'code' in receipt ? receipt.code : null;
      }
    } catch (error) { if (this.authorized()) this.failed(error); }
    finally { if (this.authorized()) { record.checking = false; this.emit(); } }
  }
  async retry(id: string): Promise<void> {
    const record = this.records.get(id), view = this.authorized();
    if (!record || !view || record.checking || !['unknown', 'not_seen'].includes(record.status) || !currentTask(view, record.intent)) return;
    await this.send(id);
  }
  dispose(): void { this.disposed = true; this.records.clear(); }
}
