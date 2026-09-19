import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { targetSummary } from '../../presentation/targets.ts';

export function Proposal({ view }: { view: RoomSnapshot }) {
  const proposal = view.viewer.kind !== 'public_spectator' && view.private?.self.playerId === view.viewer.subjectPlayerId ? view.private.proposal : null;
  if (!proposal) return null;
  return <section className="team-proposal" aria-label="团队方案"><h3>{proposal.pool === 'joint' ? '联合攻击方案' : proposal.pool === 'spirit' ? '魂灵团队方案' : '死神攻击方案'}</h3>
    <p>最新草稿 <strong>v{proposal.revision}</strong>：{proposal.revision > 0 ? targetSummary(view, proposal.targetPlayerIds) : '尚无草稿'}</p>
    <p>最新草稿确认：{proposal.confirmedBy.length} / {proposal.activeMemberIds.length}</p><ul className="proposal-confirmations">{proposal.activeMemberIds.map(id => <li key={id}>{targetSummary(view, [id])} · {proposal.confirmedBy.includes(id) ? '已确认' : '待确认'}</li>)}</ul>
    {proposal.locked && <p className="muted">已有全员确认的候选版本，不代表最新草稿已全员确认。</p>}
    <div className="effective-proposal"><strong>此刻截止会执行</strong><p>{proposal.effective.revision === null ? '无可用方案 · 空刀' : `v${proposal.effective.revision} · ${targetSummary(view, proposal.effective.targetPlayerIds)}`}</p><small>{proposal.effective.basis === 'unanimous' ? '依据：全员确认方案' : proposal.effective.basis === 'latest_legal' ? '依据：最后合法草稿' : '依据：没有可用提交'}</small></div>
  </section>;
}
