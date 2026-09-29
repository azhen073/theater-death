import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { usePreferences } from '../../state/preferences.ts';
import { claimVoteTally, latestVoteTally, type VoteTally } from '../../presentation/vote-tally.ts';
import '../../styles/vote-tally.css';

export const VOTE_TALLY_MS = 7000;
/** 行动任务/弹窗占用时的推迟窗口；超过即降级为记录页文字（不再自动弹出）。 */
export const VOTE_TALLY_DEFER_MS = 10_000;

const unitsText = (units: number) => `${units / 2}票`;

export function voteTallyOutcome(tally: VoteTally): string {
  if (tally.tiedSeats.length) return `平票：${tally.tiedSeats.map(seat => `${seat}号`).join('、')}`;
  if (tally.kind === 'election') return tally.winnerSeat !== null ? `${tally.winnerSeat}号当选天理` : '本轮未产生当选者';
  return tally.eliminatedSeat !== null ? `${tally.eliminatedSeat}号被放逐` : '本轮无人被放逐';
}

/** 投票进行中的聚合计数进度条；公开快照只有 votedCount/eligibleCount，不做任何 per-seat 标记（防泄露）。 */
export function VoteProgress({ label, voted, eligible }: { label: string; voted: number; eligible: number }) {
  const percent = eligible > 0 ? Math.min(100, Math.round((voted / eligible) * 100)) : 0;
  return <div className="vote-progress" role="status" aria-label={`${label}进度：已投 ${voted} / ${eligible}。结算后公开票型。`}>
    <span className="vote-progress__label">{label} · 已投 {voted} / {eligible}</span>
    <span className="vote-progress__track" aria-hidden="true">
      <span className="vote-progress__fill" style={{ width: `${percent}%` }} />
    </span>
    <span className="vote-progress__hint">结算后公开票型</span>
  </div>;
}

/** 纯展示：记录页弹层与中央开票卡共用同一份内容。 */
export function VoteTallyCard({ tally }: { tally: VoteTally }) {
  const maxUnits = Math.max(1, ...tally.tally.map(row => row.units));
  return <div className="vote-tally__content">
    <span className="eyebrow">第 {tally.dayNumber} 轮 · {tally.kind === 'election' ? '天理竞选' : '放逐投票'}</span>
    <h3>开票结果</h3>
    <div className="vote-tally__bars" role="list" aria-label="得票统计">
      {tally.tally.map(row => <div
        key={row.seat}
        role="listitem"
        className={`vote-tally__row ${tally.tiedSeats.includes(row.seat) ? 'vote-tally__row--tied' : ''}`}
      >
        <span className="vote-tally__seat">{row.seat}号 · {unitsText(row.units)}</span>
        <span className="vote-tally__track" aria-hidden="true">
          <span className="vote-tally__fill" style={{ width: `${Math.max(2, (row.units / maxUnits) * 100)}%` }} />
        </span>
      </div>)}
      {!tally.tally.length && <p className="muted">本轮没有有效得票。</p>}
    </div>
    {tally.votes.length > 0 && <p className="vote-tally__votes" aria-label="逐人投票">
      {tally.votes.map(vote => `${vote.voterSeat}号 → ${vote.targetSeat === null ? '弃票' : `${vote.targetSeat}号`}`).join('　')}
    </p>}
    <p className="vote-tally__outcome">{voteTallyOutcome(tally)}</p>
  </div>;
}

/** 公开票型事件的中央开票卡；只读公共事件流，被压制时降级为记录页文字与「查看票型」。 */
export function VoteTallyLive({ view, enabled, occupied, hasTask }: {
  view: RoomSnapshot; enabled: boolean; occupied: boolean; hasTask: boolean;
}) {
  const { reducedMotion } = usePreferences();
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [shown, setShown] = useState<VoteTally | null>(null);
  const events = view.public?.events ?? [];
  const cursor = Math.max(0, ...events.map(event => event.cursor));
  const scope = JSON.stringify([view.viewer.userId, view.roomId, view.gameId, view.viewer.kind, view.viewer.subjectPlayerId]);
  const baseline = useRef<{ scope: string; cursor: number } | null>(null);
  const pending = useRef<{ tally: VoteTally; until: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = !enabled || !visible || occupied || hasTask || reducedMotion;

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  useEffect(() => {
    const show = (tally: VoteTally) => {
      pending.current = null;
      if (timer.current !== null) clearTimeout(timer.current);
      setShown(tally);
      timer.current = setTimeout(() => { setShown(null); timer.current = null; }, VOTE_TALLY_MS);
    };
    const base = baseline.current;
    // 首次快照只建立游标基线：历史票型不补播；视角/房间/局切换同样只重建基线。
    if (!base || base.scope !== scope) {
      baseline.current = { scope, cursor };
      pending.current = null;
      if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
      setShown(null);
      return;
    }
    if (cursor > base.cursor) {
      baseline.current = { scope, cursor };
      const tally = latestVoteTally(events, base.cursor);
      if (tally) {
        let fresh = false;
        try { fresh = claimVoteTally(window.sessionStorage, scope, tally.cursor); } catch { /* disabled storage */ }
        if (fresh) {
          if (blocked) pending.current = { tally, until: Date.now() + VOTE_TALLY_DEFER_MS };
          else show(tally);
        }
      }
    }
    if (blocked && shown) {
      if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
      setShown(null);
    }
    const deferred = pending.current;
    if (deferred && !blocked) {
      if (Date.now() < deferred.until) show(deferred.tally);
      else pending.current = null;
    }
  }, [cursor, scope, blocked, events, shown]);

  if (!shown || blocked) return null;
  return <div className="vote-tally" role="status" aria-live="polite" aria-atomic="true">
    <div className="vote-tally__card">
      <button type="button" className="icon-button vote-tally__close" aria-label="关闭票型" onClick={() => {
        if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
        setShown(null);
      }}>×</button>
      <VoteTallyCard tally={shown} />
    </div>
  </div>;
}
