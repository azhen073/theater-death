import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { targetSummary } from '../../presentation/targets.ts';

export function Proposal({ view }: { view: RoomSnapshot }) {
  const proposal = view.viewer.kind !== 'public_spectator' && view.private?.self.playerId === view.viewer.subjectPlayerId ? view.private.proposal : null;
  if (!proposal) return null;
  const effective = proposal.effective;
  // 「空的一版」是真状态（最后合法草稿可以是空刀，见 tests/v2-proposal.test.ts），必须与"没有生效版本"分开说。
  const effectiveText = effective.revision === null
    ? '当前无草稿（空刀）'
    : effective.targetPlayerIds.length === 0
      ? `v${effective.revision} · 空刀（今晚不出刀）`
      : `v${effective.revision} · ${targetSummary(view, effective.targetPlayerIds)}`;
  // 最新草稿本身可以是空目标（引擎允许，见 tests/v2-proposal.test.ts:39-47）→ 与生效行同口径说"空刀"，不能说成"空选择"。
  const draftText = proposal.revision === 0
    ? '尚无草稿'
    : proposal.targetPlayerIds.length === 0
      ? '空刀'
      : targetSummary(view, proposal.targetPlayerIds);
  const basisText = effective.basis === 'unanimous'
    ? '全队已确认这一版'
    : effective.basis === 'latest_legal'
      ? '没有全票版本，采用最后一份由在场成员提交的草稿'
      : '没有可采用的草稿，按空刀处理（今晚不出刀）';
  return <section className="team-proposal" aria-label="团队方案"><h3>{proposal.pool === 'joint' ? '联合攻击方案' : proposal.pool === 'spirit' ? '魂灵团队方案' : '死神攻击方案'}</h3>
    <p>最新草稿 <strong>v{proposal.revision}</strong>：{draftText}</p>
    <p>最新草稿确认：{proposal.confirmedBy.length} / {proposal.activeMemberIds.length}</p><ul className="proposal-confirmations">{proposal.activeMemberIds.map(id => <li key={id}>{targetSummary(view, [id])} · {proposal.confirmedBy.includes(id) ? '已确认' : '待确认'}</li>)}</ul>
    {proposal.locked && <p className="muted">已有全员确认的候选版本，不代表最新草稿已全员确认。</p>}
    <div className="effective-proposal" title="结算时按此方案出刀；最终以服务端结算为准"><strong>窗口截止将采用</strong><p>{effectiveText}</p><small>{basisText}</small></div>
    <p className="proposal-legend"><span className="proposal-legend__mine">我的选择</span><span className="proposal-legend__draft">当前草稿目标</span></p>
  </section>;
}
