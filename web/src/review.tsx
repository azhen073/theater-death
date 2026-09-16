import { useMemo, useState } from 'react';
import { describeEvent, FACTION_NAMES, ROLE_NAMES, type EventLabels } from './format.ts';
import type { ReviewView } from './types.ts';

const PAGE_SIZE = 200;

export function ReviewScreen({ review, onClose }: { review: ReviewView; onClose(): void }) {
  const [tab, setTab] = useState<'timeline' | 'chat'>('timeline');

  const labels = useMemo<EventLabels>(() => {
    const bySeat = new Map(review.players.map((player) => [player.playerId, player.seat]));
    return {
      seat: (seat) => `${seat}号`,
      seats: (list) => list.map((seat) => `${seat}号`).join('、'),
      player: (playerId) => `${bySeat.get(playerId) ?? '?'}号`,
      players: (ids) => ids.map((id) => `${bySeat.get(id) ?? '?'}号`).join('、'),
    };
  }, [review.players]);

  const [shown, setShown] = useState(PAGE_SIZE);
  const timeline = review.timeline.slice(-shown);

  const nameById = useMemo(
    () => new Map(review.players.map((player) => [player.playerId, player.nickname])),
    [review.players],
  );

  return (
    <div className="overlay">
      <div className="review card">
        <header className="review-head">
          <h2>
            复盘 · {FACTION_NAMES[review.winner] ?? review.winner}胜利
          </h2>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <p className="muted">
          第 {review.endedAtDay} 天终局：{review.reason}
        </p>

        <table className="roles">
          <thead>
            <tr>
              <th>座位</th>
              <th>昵称</th>
              <th>身份</th>
              <th>结局</th>
            </tr>
          </thead>
          <tbody>
            {review.players
              .slice()
              .sort((left, right) => left.seat - right.seat)
              .map((player) => (
                <tr key={player.playerId} className={player.life === 'dead' ? 'dead' : ''}>
                  <td>{player.seat}</td>
                  <td>{player.nickname}</td>
                  <td>{ROLE_NAMES[player.roleId]}</td>
                  <td>{player.life === 'dead' ? '出局' : '存活'}</td>
                </tr>
              ))}
          </tbody>
        </table>

        <div className="tabs">
          <button
            type="button"
            className={tab === 'timeline' ? 'tab on' : 'tab'}
            onClick={() => setTab('timeline')}
          >
            时间线
          </button>
          <button
            type="button"
            className={tab === 'chat' ? 'tab on' : 'tab'}
            onClick={() => setTab('chat')}
          >
            全部交流
          </button>
        </div>

        {tab === 'timeline' ? (
          <div className="review-list">
            {shown < review.timeline.length && (
              <button type="button" onClick={() => setShown((value) => value + PAGE_SIZE)}>
                加载更早（剩余 {review.timeline.length - shown} 条）
              </button>
            )}
            {timeline.map((entry, index) => (
              <p key={`${entry.dayNumber}-${entry.type}-${index}`} className="ev">
                <span className="ev-day">D{entry.dayNumber}</span>
                {describeEvent(entry, labels)}
              </p>
            ))}
          </div>
        ) : (
          <div className="review-chat">
            <div>
              <h4>公屏</h4>
              {review.chat.public.map((message) => (
                <p key={message.id} className="msg">
                  <span className="msg-from">
                    {message.senderSeat === null ? '?' : `${message.senderSeat}号`}{' '}
                    {nameById.get(message.senderId) ?? ''}
                  </span>
                  <span className="msg-text">{message.text}</span>
                </p>
              ))}
            </div>
            <div>
              <h4>阵营房（含死神加入前历史）</h4>
              {review.chat.faction.map((message) => (
                <p key={`f-${message.id}`} className="msg">
                  <span className="msg-from">
                    {message.senderSeat === null ? '?' : `${message.senderSeat}号`}{' '}
                    {nameById.get(message.senderId) ?? ''}
                  </span>
                  <span className="msg-text">{message.text}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
