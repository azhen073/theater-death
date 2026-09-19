import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessageDTO, RoomSnapshot } from '../contracts/v2.ts';
import { ApiFailure } from '../web-v2/src/transport/http.ts';
import { CHAT_MAX_LENGTH, ChatTracker, canPost, chatMessages, chatTextIssue } from '../web-v2/src/features/chat/model.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/contract-2.1/night-door-full.json', import.meta.url), 'utf8')) as RoomSnapshot;

function viewCopy(): RoomSnapshot {
  const view = structuredClone(fixture);
  view.room.phase = 'playing';
  view.viewer.kind = 'formal';
  view.viewer.readOnly = false;
  view.viewer.subjectPlayerId = view.private!.self.playerId;
  view.capabilities.canPostPublic = true;
  view.capabilities.canPostFaction = true;
  return view;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function message(overrides: Partial<ChatMessageDTO> = {}): ChatMessageDTO {
  return { messageId: 'm1', clientMessageId: 'c1', cursor: 1, senderId: fixture.private!.self.playerId, text: 'hello', at: 100, ...overrides };
}

function ack(view: RoomSnapshot, overrides: Partial<ChatMessageDTO> = {}) {
  return { gameId: view.gameId!, channel: 'public' as const, message: message({ ...overrides, senderId: view.viewer.subjectPlayerId! }) };
}

function harness() {
  const view = viewCopy();
  let current: RoomSnapshot | null = view;
  const changed = vi.fn<(records: unknown[]) => void>();
  const sent: Array<Record<string, unknown>> = [];
  const send = vi.fn(async (intent: any) => { sent.push(structuredClone(intent)); return ack(view, { clientMessageId: intent.clientMessageId, text: intent.text }); });
  const tracker = new ChatTracker(view, () => current, send, changed);
  return { view, setView: (next: RoomSnapshot | null) => { current = next; }, tracker, send, sent, changed };
}

describe('v2 chat model', () => {
  it('authorizes only capability-backed formal views, including authorized dead players', () => {
    const view = viewCopy();
    expect(canPost(view, 'public')).toBe(true);
    expect(canPost(view, 'faction')).toBe(true);
    view.private!.self.life = 'dead';
    expect(canPost(view, 'public')).toBe(true);
    view.viewer.readOnly = true;
    expect(canPost(view, 'public')).toBe(false);
    view.viewer.readOnly = false; view.viewer.kind = 'public_spectator';
    expect(canPost(view, 'public')).toBe(false);
    view.viewer.kind = 'formal'; view.capabilities.canPostPublic = false;
    expect(canPost(view, 'public')).toBe(false);
    view.room.phase = 'lobby'; view.capabilities.canPostPublic = true;
    expect(canPost(view, 'public')).toBe(false);
  });

  it('enforces empty/whitespace and UTF-16 length limits', () => {
    expect(chatTextIssue('')).toContain('请输入');
    expect(chatTextIssue(' \n\t ')).toContain('请输入');
    expect(chatTextIssue('😀'.repeat(250))).toBeNull();
    expect(chatTextIssue('😀'.repeat(251))).toContain(String(CHAT_MAX_LENGTH));
    expect(chatTextIssue('a'.repeat(CHAT_MAX_LENGTH))).toBeNull();
  });

  it('deduplicates by messageId and sorts the final messages by cursor', () => {
    const result = chatMessages([message({ messageId: 'm2', cursor: 3, text: 'later' }), message({ messageId: 'm1', cursor: 2, text: 'newer duplicate' }), message({ messageId: 'm1', cursor: 1, text: 'old duplicate' })]);
    expect(result.map(item => [item.messageId, item.cursor, item.text])).toEqual([['m1', 1, 'old duplicate'], ['m2', 3, 'later']]);
  });

  it('prevents duplicate sends only within one channel and preserves the full original retry payload', async () => {
    const h = harness();
    const pending = deferred<ReturnType<typeof ack>>();
    h.send.mockImplementationOnce(async intent => { h.sent.push(structuredClone(intent)); return pending.promise; });
    const first = h.tracker.submit('public', ' hello ', 'client-1');
    await Promise.resolve();
    expect(await h.tracker.submit('public', 'second', 'client-2')).toBe(false);
    expect(await h.tracker.submit('faction', 'faction message', 'client-3')).toBe(true);
    expect(h.send).toHaveBeenCalledTimes(2);
    pending.resolve(ack(h.view, { clientMessageId: 'client-1', text: ' hello ' }));
    await first;

    const retry = harness();
    const failure = new ApiFailure(503, 'temporary');
    retry.send.mockRejectedValueOnce(failure);
    await retry.tracker.submit('public', 'payload', 'retry-id');
    expect(retry.tracker.list()[0]?.status).toBe('unknown');
    await retry.tracker.retry('retry-id');
    expect(retry.send.mock.calls[0]?.[0]).toEqual({ gameId: retry.view.gameId, clientMessageId: 'retry-id', channel: 'public', text: 'payload' });
    expect(retry.send.mock.calls[1]?.[0]).toEqual(retry.send.mock.calls[0]?.[0]);
  });

  it('accepts only a matching game/channel/sender/client acknowledgement', async () => {
    for (const bad of [
      { gameId: 'other-game' },
      { channel: 'faction' as const },
      { message: message({ senderId: 'other-sender', clientMessageId: 'client-1' }) },
      { message: message({ senderId: fixture.private!.self.playerId, clientMessageId: 'other-client' }) },
      { message: message({ senderId: fixture.private!.self.playerId, clientMessageId: 'client-1', messageId: '' }) },
    ]) {
      const h = harness();
      h.send.mockResolvedValueOnce({ ...ack(h.view, { clientMessageId: 'client-1' }), ...bad } as any);
      await h.tracker.submit('public', 'hello', 'client-1');
      expect(h.tracker.list()[0]?.status).toBe('unknown');
    }
  });

  it('classifies 4xx as failed and 429/5xx as unknown, retaining error code for retry', async () => {
    for (const error of [new ApiFailure(400, 'chat_forbidden'), new ApiFailure(408, 'timeout'), new ApiFailure(429, 'rate_limited'), new ApiFailure(500, 'internal_error'), new ApiFailure(502, 'bad_gateway'), new ApiFailure(503, 'temporary'), new ApiFailure(504, 'gateway_timeout'), new Error('network lost')]) {
      const h = harness(); h.send.mockRejectedValueOnce(error);
      const id = error instanceof ApiFailure ? String(error.status) : 'network';
      await h.tracker.submit('public', 'hello', 'client-' + id);
      expect(h.tracker.list()[0]?.status).toBe(error instanceof ApiFailure && error.status < 500 && ![408, 429].includes(error.status) ? 'failed' : 'unknown');
      expect(h.tracker.list()[0]?.code).toBe(error instanceof ApiFailure ? error.code : null);
      if (error instanceof ApiFailure && [408, 429, 500, 502, 503, 504].includes(error.status)) {
        await h.tracker.retry('client-' + id);
        expect(h.send.mock.calls[1]?.[0]).toEqual(h.send.mock.calls[0]?.[0]);
      }
    }
  });

  it('reconciles accepted snapshot messages and never downgrades after a late HTTP failure', async () => {
    const h = harness();
    const pending = deferred<ReturnType<typeof ack>>();
    h.send.mockImplementationOnce(async () => pending.promise);
    const sending = h.tracker.submit('public', 'hello', 'client-race');
    await Promise.resolve();
    h.view.chat.public = [message({ clientMessageId: 'client-race', messageId: 'server-message', text: 'hello' })];
    h.tracker.reconcile();
    pending.reject(new Error('late network failure'));
    await sending;
    expect(h.tracker.list()[0]?.status).toBe('accepted');
    expect(h.tracker.list()[0]?.message?.messageId).toBe('server-message');

    const wrongChannel = harness();
    wrongChannel.send.mockRejectedValueOnce(new Error('unknown'));
    await wrongChannel.tracker.submit('public', 'hello', 'same-client');
    wrongChannel.view.chat.faction = [message({ clientMessageId: 'same-client', senderId: wrongChannel.view.viewer.subjectPlayerId!, messageId: 'wrong-channel' })];
    wrongChannel.tracker.reconcile();
    expect(wrongChannel.tracker.list()[0]?.status).toBe('unknown');

    const wrongSender = harness();
    wrongSender.send.mockRejectedValueOnce(new Error('unknown'));
    await wrongSender.tracker.submit('public', 'hello', 'same-client');
    wrongSender.view.chat.public = [message({ clientMessageId: 'same-client', senderId: 'another-sender', messageId: 'wrong-sender' })];
    wrongSender.tracker.reconcile();
    expect(wrongSender.tracker.list()[0]?.status).toBe('unknown');
  });

  it('does not emit late results, and dispose clears records', async () => {
    for (const change of [
      (view: RoomSnapshot) => { view.gameId = 'other-game'; },
      (view: RoomSnapshot) => { view.viewer.userId = 'other-user'; },
      (view: RoomSnapshot) => { view.viewer.memberId = 'other-member'; },
      (view: RoomSnapshot) => { view.viewer.subjectPlayerId = 'other-player'; },
      (view: RoomSnapshot) => { view.viewer.readOnly = true; },
    ]) {
      const h = harness(); const pending = deferred<ReturnType<typeof ack>>();
      h.send.mockImplementationOnce(async () => pending.promise);
      const submission = h.tracker.submit('public', 'hello', 'scope-id');
      await Promise.resolve(); const emissions = h.changed.mock.calls.length;
      const next = viewCopy(); change(next); h.setView(next); pending.resolve(ack(h.view, { clientMessageId: 'scope-id' }));
      await submission;
      expect(h.changed.mock.calls.length).toBe(emissions);
    }
    const disposed = harness(); const pending = deferred<ReturnType<typeof ack>>();
    disposed.send.mockImplementationOnce(async () => pending.promise);
    const submission = disposed.tracker.submit('public', 'hello', 'dispose-id');
    await Promise.resolve(); const emissions = disposed.changed.mock.calls.length;
    disposed.tracker.dispose(); pending.resolve(ack(disposed.view, { clientMessageId: 'dispose-id' })); await submission;
    expect(disposed.tracker.list()).toEqual([]);
    expect(disposed.changed.mock.calls.length).toBe(emissions);
  });
});
