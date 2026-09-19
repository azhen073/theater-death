import { useEffect, useRef, useState } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { EventDTO, RoomSnapshot } from '../../../../contracts/v2.ts';
import { describeEvent } from '../../presentation/events.ts';

/** Each authorized event stream owns its cursors and reading position. */
export function EventHistory({ events, view, catalog, active, label, onDetail, onUnread }: {
  events: EventDTO[]; view: RoomSnapshot; catalog: CatalogDTO; active: boolean; label: string;
  onDetail: (event: EventDTO) => void; onUnread: (count: number) => void;
}) {
  const ordered = [...new Map(events.map(event => [event.cursor, event])).values()].sort((a, b) => a.cursor - b.cursor);
  const [start, setStart] = useState(() => Math.max(0, ordered.length - 60));
  const [unread, setUnread] = useState(0);
  const last = ordered.at(-1)?.cursor ?? 0;
  const seen = useRef(last), bottom = useRef(true), position = useRef(0);
  const scroll = useRef<HTMLDivElement>(null), notify = useRef(onUnread); notify.current = onUnread;
  useEffect(() => { notify.current(unread); }, [unread]);
  useEffect(() => {
    const element = scroll.current;
    if (element && active) {
      if (bottom.current) { element.scrollTop = element.scrollHeight; seen.current = last; setUnread(0); }
      else element.scrollTop = position.current;
    }
    if (!active || !bottom.current) setUnread(ordered.filter(event => event.cursor > seen.current).length);
  }, [active, last]);
  return <section aria-label={label}>
    <div className="event-history" ref={scroll} tabIndex={0} aria-label={`${label}历史`} onScroll={event => {
      if (!active) return;
      const element = event.currentTarget; position.current = element.scrollTop;
      bottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      if (active && bottom.current) { seen.current = last; setUnread(0); }
    }}>
      {start > 0 && <button className="text-button" onClick={() => {
        const element = scroll.current; const height = element?.scrollHeight ?? 0, top = element?.scrollTop ?? 0;
        setStart(value => Math.max(0, value - 60));
        requestAnimationFrame(() => { if (element) { element.scrollTop = top + element.scrollHeight - height; position.current = element.scrollTop; } });
      }}>显示更早的事件</button>}
      <div className="event-list">{ordered.slice(start).map(event => {
        const content = describeEvent(event, view, catalog);
        return <button className="event-row" key={event.cursor} onClick={() => onDetail(event)}><small>第 {event.dayNumber} 轮 · 阶段 {event.stage}</small><strong>{content.title}</strong><span>{content.details.slice(0, 2).join(' · ')}</span></button>;
      })}</div>
      {!ordered.length && <p className="muted">暂时没有可查看的记录。</p>}
    </div>
    {unread > 0 && <button className="button button--wide" onClick={() => {
      bottom.current = true; seen.current = last; setUnread(0);
      if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    }}>{unread} 条新事件 · 回到最新</button>}
  </section>;
}
