import type { CSSProperties } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import { Avatar } from '../../components/ui.tsx';
import { factionKey } from '../../presentation/faction.ts';
import type { ReviewPlayer } from './model.ts';

/**
 * 谢幕座位图：复盘只读环形总览（复盘身份已全部公开，不含任何额外授权信息）。
 * 座位号用补零「01」并与昵称分开放置——避免与既有界面的「N号 昵称」连排文本撞车。
 * ≤900px 由 CSS 退化为网格（position: static），无需 JS 参与。
 */
export function ReviewSeatingChart({ players, catalog, selfPlayerId }: {
  players: ReviewPlayer[];
  catalog: CatalogDTO;
  selfPlayerId: string | null;
}) {
  const seats = [...players].sort((a, b) => a.seat - b.seat);
  if (!seats.length) return null;
  return <section className="review-seating" aria-label="谢幕座位图">
    <div className="review-seating__stage">
      {seats.map((player, index) => {
        const angle = -Math.PI / 2 + (index / seats.length) * Math.PI * 2;
        const role = catalog.roles.find(item => item.roleId === player.roleId);
        const faction = factionKey(role?.faction);
        const self = selfPlayerId !== null && player.playerId === selfPlayerId;
        return <div
          key={player.playerId}
          className={`review-seat ${player.life === 'dead' ? 'review-seat--dead' : ''}`}
          style={{ '--seat-x': `${50 + Math.cos(angle) * 43}%`, '--seat-y': `${50 + Math.sin(angle) * 41}%` } as CSSProperties}
          aria-label={`${player.seat}号 ${player.nickname}，${role?.name ?? '未提供身份'}，${player.life === 'alive' ? '最终存活' : '最终死亡'}${self ? '，我' : ''}`}
        >
          <span className="review-seat__no" aria-hidden="true">{String(player.seat).padStart(2, '0')}</span>
          <Avatar url={player.avatarUrl} name={player.nickname} />
          {role && <span className={`review-seat__role${faction ? ` review-seat__role--${faction}` : ''}`}>{role.name}</span>}
          <span className="review-seat__name">{player.nickname}</span>
          {self && <span className="review-seat__me" role="img" aria-label="我">★</span>}
        </div>;
      })}
    </div>
    <p className="review-seating__caption muted">谢幕座位 · 身份已全部公开</p>
  </section>;
}
