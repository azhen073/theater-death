import { useEffect, useRef, useState } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { Avatar, Modal, Notice } from '../../components/ui.tsx';
import { ApiFailure, errorMessage, get } from '../../transport/http.ts';
import { useIntent } from '../../transport/intent.ts';
import { Lobby } from '../room/lobby.tsx';
import { roomExitMessage, roomExitPresentation } from '../room/policy.ts';
import { reviewEventText, reviewScope } from './model.ts';
import type { ReviewDTO } from './model.ts';
import { navigateTabs } from '../../components/tab-navigation.ts';

export function ReviewPage({ view, catalog, online, active = true, refresh, remaining, onExit, onExpired }: {
  view: RoomSnapshot; catalog: CatalogDTO; online: boolean; refresh: () => Promise<void>;
  remaining: (deadline: number) => number | null; onExit: (message: string) => void; onExpired: () => void; active?: boolean;
}) {
  const [review, setReview] = useState<ReviewDTO | null>(null), [error, setError] = useState('');
  const [retry, setRetry] = useState(0), [confirm, setConfirm] = useState(false), [manage, setManage] = useState(false);
  const [managementVisited, setManagementVisited] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [tab, setTab] = useState<'players' | 'timeline' | 'public' | 'faction'>('players');
  const [limit, setLimit] = useState(100);
  useEffect(() => { if (!active) { setConfirm(false); setLeaveConfirm(false); } }, [active]);
  const scope = reviewScope(view), latest = useRef(view); latest.current = view;
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setReview(null); setError(''); setLimit(100);
    void get<{ review: ReviewDTO }>(`/rooms/${view.room.code}/review`, controller.signal).then(result => {
      if (!active || reviewScope(latest.current) !== scope) return;
      if (result.review.gameId !== latest.current.gameId || latest.current.room.phase !== 'review') { setError('对局已变化，请同步当前房间。'); return; }
      setReview(result.review);
    }).catch(failure => { if (active && reviewScope(latest.current) === scope) setError(errorMessage(failure)); });
    return () => { active = false; controller.abort(); };
  }, [scope, retry]);
  const finish = useIntent<{ roomId: string }>(scope, async () => { setConfirm(false); setReview(null); await refresh(); }, () => { void refresh(); });
  const leave = useIntent<{ left: true; seatRetained: boolean; dissolved?: boolean }>(scope, result => {
    setLeaveConfirm(false); setReview(null);
    onExit(result.dissolved === true ? '房间已解散。' : roomExitMessage(view, result.seatRetained));
  }, failure => {
    if (failure instanceof ApiFailure && failure.code === 'unauthorized') onExpired();
    else if (failure instanceof ApiFailure && failure.code === 'room_not_found') onExit('房间已关闭，已返回首页。');
  });
  const exit = roomExitPresentation(view);
  const leaving = leave.busy || leave.unresolved;
  const canFinish = online && view.capabilities.room.endReview.allowed && !finish.busy && !leaving;
  const canLeave = online && view.capabilities.room.leave.allowed && !leave.busy && !finish.busy && !finish.unresolved;
  const leaveFeedback = leave.intent?.error && <Notice error>{leave.intent.error}{leave.unresolved && <button className="button" disabled={!canLeave} onClick={() => void leave.retry()}>确认原退出操作</button>}</Notice>;
  const result = view.public?.result;
  const winner = result?.winner ?? review?.winner;
  const messages = review && (tab === 'public' || tab === 'faction') ? review.chat[tab] : [];
  return <>{managementVisited && <div hidden={!active || !manage}><button className="button" onClick={() => setManage(false)}>返回复盘</button><Lobby active={active && manage} view={view} catalog={catalog} online={online} refresh={refresh} remaining={remaining} onExit={onExit} onExpired={onExpired}/></div>}<section className="review-page" hidden={!active || manage}>
    <header className="room-heading"><div><span className="eyebrow">AFTER THE CURTAIN</span><h1>演出落幕</h1><p>{winner === 'human' ? '人类阵营获胜' : winner === 'death_faction' ? '死神阵营获胜' : '正在同步结局'}</p></div><div className="button-row"><button className="button" disabled={leaving || finish.busy || finish.unresolved} onClick={() => { setManagementVisited(true); setManage(true); }}>房间管理</button><button className="button" disabled={!canLeave || leave.unresolved} onClick={() => setLeaveConfirm(true)}>离开房间</button></div></header>
    {!leaveConfirm && leaveFeedback}
    <p>房间 {view.room.code} · 第 {result?.dayNumber ?? review?.endedAtDay ?? '—'} 轮结束</p>
    <p>{result?.reason ?? review?.reason}</p>
    {review && <p className="muted">本局用时 {Math.floor(review.durationMs / 60_000)} 分 {Math.floor(review.durationMs / 1000) % 60} 秒 · {review.players.length} 位玩家</p>}
    {error && <Notice error>{error}<button className="button" onClick={() => setRetry(value => value + 1)}>重新读取复盘</button><button className="text-button" onClick={() => void refresh()}>同步当前房间</button></Notice>}
    {!review && !error && <p role="status">正在读取完整复盘，结局概览已保留。</p>}
    {review && <><div className="button-row" role="tablist" aria-label="复盘内容">{([['players', '全部身份'], ['timeline', '完整时间线'], ['public', '全部公屏'], ['faction', '全部阵营交流']] as const).map(([key, label]) => <button className="button" key={key} role="tab" id={`review-tab-${key}`} aria-controls="review-panel" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onKeyDown={navigateTabs} onClick={() => { setTab(key); setLimit(100); }}>{label}</button>)}</div><div role="tabpanel" id="review-panel" aria-labelledby={`review-tab-${tab}`}>
      {tab === 'players' && <div className="members-list">{[...review.players].sort((a, b) => a.seat - b.seat).map(player => <article className="member-card" key={player.playerId}><Avatar name={player.nickname} url={player.avatarUrl}/><div className="member-card__info"><strong>{player.seat}号 {player.nickname}</strong><p className="muted">UID {player.uid}</p><p>{catalog.roles.find(role => role.roleId === player.roleId)?.name ?? '未提供身份'} · {player.life === 'alive' ? '最终存活' : '最终死亡'}</p></div></article>)}</div>}
      {tab === 'timeline' && <div className="event-list">{review.timeline.slice(0, limit).map((event, index) => {
        const text = reviewEventText(event, review, view, catalog);
        return <article className="event-row" key={index}><small>第 {event.dayNumber} 轮 · 阶段 {event.stage}</small><strong>{text.title}</strong>{text.details.map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}</article>;
      })}{review.timeline.length > limit && <button className="button" onClick={() => setLimit(value => value + 100)}>显示后续事件</button>}</div>}
      {(tab === 'public' || tab === 'faction') && <section aria-label={tab === 'public' ? '完整公屏记录' : '完整阵营记录'}>{messages.slice(0, limit).map(message => <article className="chat-message" key={message.messageId ?? message.id}><strong>{message.senderSeat ?? '—'}号 {review.players.find(player => player.playerId === message.senderId)?.nickname ?? '玩家'}</strong><p>{message.text}</p></article>)}{!messages.length && <p className="muted">本频道没有消息。</p>}{messages.length > limit && <button className="button" onClick={() => setLimit(value => value + 100)}>显示后续消息</button>}</section>}
    </div></>}
    {finish.intent?.error && <Notice error>{finish.intent.error}{finish.unresolved && <button className="button" disabled={!canFinish} onClick={() => void finish.retry()}>确认原结束操作</button>}</Notice>}
    {view.capabilities.room.endReview.allowed && <button className="button button--primary" disabled={!canFinish || finish.unresolved} onClick={() => setConfirm(true)}>结束复盘，返回大厅</button>}
    {active && leaveConfirm && <Modal title={exit.title} onClose={() => setLeaveConfirm(false)} dismissible={!leave.busy}>
      <p>{exit.description}</p>{leaveFeedback}<div className="button-row"><button className="button" disabled={leave.busy} onClick={() => setLeaveConfirm(false)}>取消</button><button className="button button--primary" disabled={!canLeave || leave.unresolved} onClick={() => void leave.run(`/rooms/${view.room.code}/leave`)}>{leave.busy ? '正在确认…' : '确认操作'}</button></div>
    </Modal>}
    {active && confirm && <Modal title="结束本局复盘？" onClose={() => setConfirm(false)} dismissible={!finish.busy}><p>所有成员返回原房间大厅，正式玩家需重新准备；本局第二屏授权失效。下一局重新分配座位和身份。</p>{finish.intent?.error && <Notice error>{finish.intent.error}{finish.unresolved && <button className="button" disabled={!canFinish} onClick={() => void finish.retry()}>确认原结束操作</button>}</Notice>}<div className="button-row"><button className="button" disabled={finish.busy} onClick={() => setConfirm(false)}>取消</button><button className="button button--primary" disabled={!canFinish || finish.unresolved} onClick={() => void finish.run(`/rooms/${view.room.code}/end-review`, { gameId: view.gameId })}>确认结束复盘</button></div></Modal>}
  </section></>;
}
