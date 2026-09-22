import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import '../../styles/election-chat.css';

export function ElectionRoster({ view }: { view: RoomSnapshot }) {
  const day = view.public?.day;
  const election = day?.election;
  if (view.room.phase !== 'playing' || view.public?.phase === 'night' || !election) return null;
  const withdrawn = new Set(election.withdrawn);
  const ids = new Set([...election.candidates, ...election.withdrawn]);
  // Do not filter by private life or infer eligibility from an unpublished death.
  const candidates = (view.public?.seats ?? []).filter(seat => ids.has(seat.playerId)).sort((a, b) => a.seat - b.seat);
  const active = candidates.filter(seat => !withdrawn.has(seat.playerId));
  const winner = view.public?.seats.find(seat => seat.playerId === election.winnerId);
  const done = election.phase === 'done';
  return <section className="election-roster" aria-label="公开上警名单">
    <h2>{done ? '竞选结果' : '上警名单'}<span>{done ? (winner ? `${winner.seat}号当选` : '本局无天理') : `${active.length} 人参选`}</span></h2>
    {!candidates.length ? <p>{done ? '竞选已结束。' : '暂无报名，名单随公开状态更新。'}</p> : <ul aria-label="候选与退选名单">
      {candidates.map(seat => <li key={seat.playerId} className={withdrawn.has(seat.playerId) ? 'election-roster__withdrawn' : ''}>
        <strong>{seat.seat}号</strong><span title={seat.nickname}>{seat.nickname}</span>
        <small>{withdrawn.has(seat.playerId) ? '已退选' : election.winnerId === seat.playerId ? '已当选' : election.phase === 'revote' ? election.tiedIds.includes(seat.playerId) ? '重投候选' : '未进入重投' : done ? '未当选' : '参选中'}</small>
      </li>)}
    </ul>}
  </section>;
}
