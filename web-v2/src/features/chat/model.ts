import type { ChatMessageDTO, RoomSnapshot } from '../../../../contracts/v2.ts';
import { ApiFailure } from '../../transport/http.ts';

export type ChatChannel = 'public' | 'faction';
// Contract 2.1 POST /chat limit; bootstrap/catalog currently expose no chat limit.
export const CHAT_MAX_LENGTH = 500;
export interface ChatIntent { gameId: string; clientMessageId: string; channel: ChatChannel; text: string }
export interface ChatAcknowledgement { gameId: string; channel: ChatChannel; message: ChatMessageDTO }
export interface OutgoingMessage { intent: ChatIntent; status: 'sending' | 'unknown' | 'failed' | 'accepted'; message: ChatMessageDTO | null; code: string | null }
export const chatScope = (view: RoomSnapshot) => JSON.stringify([view.viewer.userId, view.roomId, view.gameId, view.viewer.memberId, view.viewer.kind, view.viewer.subjectPlayerId, view.viewer.readOnly]);
export function canPost(view: RoomSnapshot, channel: ChatChannel): boolean {
  return view.room.phase === 'playing' && !!view.gameId && view.viewer.kind === 'formal' && !view.viewer.readOnly
    && !!view.viewer.subjectPlayerId && (channel === 'public' ? view.capabilities.canPostPublic : view.capabilities.canPostFaction);
}
export function chatTextIssue(text: string): string | null {
  return !text.trim() ? '请输入消息。' : text.length > CHAT_MAX_LENGTH ? `消息不能超过 ${CHAT_MAX_LENGTH} 个字符。` : null;
}
export function chatMessages(messages: readonly ChatMessageDTO[]): ChatMessageDTO[] {
  return [...new Map(messages.map(message => [message.messageId, message])).values()].sort((a, b) => a.cursor - b.cursor);
}

/** Only authorized snapshots or matching acknowledgements can confirm a local send. */
export class ChatTracker {
  private readonly identity: string;
  private records = new Map<string, OutgoingMessage>();
  private disposed = false;
  private readonly read: () => RoomSnapshot | null;
  private readonly send: (intent: ChatIntent) => Promise<ChatAcknowledgement>;
  private readonly changed: (records: OutgoingMessage[]) => void;
  constructor(view: RoomSnapshot, read: () => RoomSnapshot | null, send: (intent: ChatIntent) => Promise<ChatAcknowledgement>, changed: (records: OutgoingMessage[]) => void) {
    this.identity = chatScope(view); this.read = read; this.send = send; this.changed = changed;
  }
  private current(): RoomSnapshot | null {
    const view = this.read(); return !this.disposed && view && chatScope(view) === this.identity ? view : null;
  }
  list(): OutgoingMessage[] { return structuredClone([...this.records.values()]); }
  private emit() { if (this.current()) this.changed(this.list()); }
  reconcile(): void {
    const view = this.current(); if (!view) return;
    let changed = false;
    for (const record of this.records.values()) {
      const message = view.chat[record.intent.channel].find(item => item.senderId === view.viewer.subjectPlayerId && item.clientMessageId === record.intent.clientMessageId);
      if (message && record.status !== 'accepted') {
        record.status = 'accepted'; record.message = structuredClone(message); record.code = null; changed = true;
      }
    }
    if (changed) this.emit();
  }
  async submit(channel: ChatChannel, text: string, clientMessageId: string): Promise<boolean> {
    const view = this.current();
    if (!view || !canPost(view, channel) || chatTextIssue(text) || this.records.has(clientMessageId)) return false;
    if (this.list().some(record => record.intent.channel === channel && ['sending', 'unknown'].includes(record.status))) return false;
    const record: OutgoingMessage = { intent: { gameId: view.gameId!, clientMessageId, channel, text }, status: 'sending', message: null, code: null };
    this.records.set(clientMessageId, record); this.emit(); await this.deliver(record); return true;
  }
  private async deliver(record: OutgoingMessage): Promise<void> {
    try {
      const receipt = await this.send(structuredClone(record.intent));
      const view = this.current(); if (!view || record.status === 'accepted') return;
      if (receipt.gameId === record.intent.gameId && receipt.channel === record.intent.channel && receipt.message?.clientMessageId === record.intent.clientMessageId && receipt.message.senderId === view.viewer.subjectPlayerId && receipt.message.messageId) {
        record.status = 'accepted'; record.message = structuredClone(receipt.message); record.code = null;
      } else record.status = 'unknown';
    } catch (error) {
      if (!this.current() || record.status === 'accepted') return;
      record.status = error instanceof ApiFailure && error.status < 500 && ![408, 429].includes(error.status) ? 'failed' : 'unknown';
      record.code = error instanceof ApiFailure ? error.code : null;
    }
    this.emit();
  }
  async retry(clientMessageId: string): Promise<void> {
    const view = this.current(), record = this.records.get(clientMessageId);
    if (!view || !record || !canPost(view, record.intent.channel) || !['unknown', 'failed'].includes(record.status)) return;
    record.status = 'sending'; record.code = null; this.emit(); await this.deliver(record);
  }
  dispose(): void { this.disposed = true; this.records.clear(); }
}
