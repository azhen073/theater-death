import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { post } from '../../transport/http.ts';
import { newRequestId } from '../../transport/ids.ts';
import { CHAT_MAX_LENGTH, ChatTracker, canPost, chatMessages, chatScope, chatTextIssue } from './model.ts';
import type { ChatAcknowledgement, ChatChannel, OutgoingMessage } from './model.ts';

export function ChatChannelView({ view, channel, online, active, refresh, onUnread }: {
  view: RoomSnapshot; channel: ChatChannel; online: boolean; active: boolean; refresh: () => Promise<void>; onUnread: (count: number) => void;
}) {
  const latest = useRef({ view, refresh }); latest.current = { view, refresh };
  const tracker = useRef<ChatTracker | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const [draft, setDraft] = useState('');
  const composing = useRef(false), atBottom = useRef(true), scrollPosition = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const [unread, setUnread] = useState(0), [start, setStart] = useState(() => Math.max(0, view.chat[channel].length - 80));
  const notifyUnread = useRef(onUnread); notifyUnread.current = onUnread;
  useEffect(() => { notifyUnread.current(unread); }, [unread]);
  const scope = chatScope(view);
  useEffect(() => {
    const base = latest.current.view;
    const controller = new ChatTracker(base, () => latest.current.view, async intent => {
      const result = await post<ChatAcknowledgement>(`/rooms/${base.room.code}/chat`, intent);
      if (chatScope(latest.current.view) === chatScope(base)) void latest.current.refresh();
      return result;
    }, setOutgoing);
    tracker.current = controller; setOutgoing([]); setDraft(''); setStart(Math.max(0, base.chat[channel].length - 80)); setUnread(0);
    atBottom.current = true; scrollPosition.current = 0;
    return () => { controller.dispose(); if (tracker.current === controller) tracker.current = null; };
  }, [scope]);
  useEffect(() => { tracker.current?.reconcile(); }, [view.chat, scope]);
  const messages = chatMessages([...view.chat[channel], ...outgoing.filter(record => record.intent.channel === channel && record.message).map(record => record.message!)]);
  const lastCursor = messages.at(-1)?.cursor ?? 0;
  const seenCursor = useRef(lastCursor);
  useEffect(() => { seenCursor.current = latest.current.view.chat[channel].at(-1)?.cursor ?? 0; }, [scope, channel]);
  useEffect(() => {
    const element = scroll.current;
    if (!element || !active) return;
    if (atBottom.current) {
      element.scrollTop = element.scrollHeight; seenCursor.current = lastCursor; setUnread(0);
    } else element.scrollTop = scrollPosition.current;
  }, [active, lastCursor, outgoing.length]);
  useEffect(() => { if (!active || !atBottom.current) setUnread(messages.filter(message => message.cursor > seenCursor.current).length); }, [active, lastCursor]);
  const pending = outgoing.filter(record => record.intent.channel === channel && record.status !== 'accepted');
  const blocked = pending.some(record => ['sending', 'unknown'].includes(record.status));
  const writable = online && canPost(view, channel);
  const label = channel === 'public' ? '公屏' : '阵营';
  const send = () => {
    if (!writable || blocked || chatTextIssue(draft) || composing.current) return;
    const text = draft, owner = tracker.current;
    if (!owner) return;
    // Retain the text in the outgoing record while allowing a fresh composer draft.
    setDraft(''); void owner.submit(channel, text, newRequestId());
  };
  return <section className="chat-channel" aria-label={`${label}交流`}>
    <div className="chat-history" ref={scroll} tabIndex={0} aria-label={`${label}历史`} onScroll={event => {
      if (!active) return;
      const element = event.currentTarget; scrollPosition.current = element.scrollTop;
      atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      if (active && atBottom.current) { seenCursor.current = lastCursor; setUnread(0); }
    }}>
      {start > 0 && <button className="text-button" onClick={() => {
        const element = scroll.current; const height = element?.scrollHeight ?? 0, top = element?.scrollTop ?? 0;
        setStart(value => Math.max(0, value - 80));
        requestAnimationFrame(() => { if (element) { element.scrollTop = top + element.scrollHeight - height; scrollPosition.current = element.scrollTop; } });
      }}>显示更早的本局记录</button>}
      {messages.slice(start).map(message => {
        const sender = view.public?.seats.find(seat => seat.playerId === message.senderId);
        return <div className="chat-message" key={message.messageId} data-message-id={message.messageId}><strong>{sender ? `${sender.seat}号 · ${sender.nickname}` : '玩家'}</strong><p>{message.text}</p></div>;
      })}
      {!messages.length && <p className="muted">暂时没有{label}消息。</p>}
    </div>
    {unread > 0 && <button className="button button--wide" onClick={() => {
      atBottom.current = true; seenCursor.current = lastCursor; setUnread(0);
      if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    }}>{unread} 条新消息 · 回到最新</button>}
    {pending.map(record => <div className="chat-outgoing" key={record.intent.clientMessageId}><p>{record.intent.text}</p><span role="status">{record.status === 'sending' ? '正在发送…' : record.status === 'unknown' ? '尚未确认送达，请同步或用原消息重试。' : '未能发送，原文已保留。'}</span>
      {record.status !== 'sending' && <div className="button-row"><button className="text-button" disabled={!online} onClick={() => void refresh()}>同步消息</button><button className="text-button" disabled={!writable} onClick={() => void tracker.current?.retry(record.intent.clientMessageId)}>重试原消息</button></div>}
    </div>)}
    {!view.viewer.readOnly && view.viewer.kind === 'formal' && <form className="chat-composer" onSubmit={event => { event.preventDefault(); send(); }}>
      <label>{label}消息<textarea aria-label={`${label}消息`} value={draft} maxLength={CHAT_MAX_LENGTH} rows={3} disabled={!writable} onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !composing.current) { event.preventDefault(); send(); }
      }}/></label>
      <div className="button-row"><small>{draft.length} / {CHAT_MAX_LENGTH} · Shift+Enter 换行</small><button className="button" type="submit" disabled={!writable || blocked || !!chatTextIssue(draft)}>发送{label}消息</button></div>
    </form>}
    {!writable && <p className="muted">{!online ? '连接恢复后可继续发送，草稿已保留。' : '当前频道仅可阅读，发送权限以当前阶段授权为准。'}</p>}
  </section>;
}
