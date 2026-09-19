import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { actionLabels, formatCountdown } from '../../presentation/labels.ts';
import { targetSummary } from '../../presentation/targets.ts';

export function ObservedActions({ view, remaining }: { view: RoomSnapshot; remaining: (deadline: number) => number | null }) {
  if (view.viewer.kind !== 'private_spectator' || !view.viewer.readOnly || view.private?.self.playerId !== view.viewer.subjectPlayerId) return null;
  const current = new Set(view.windows.map(window => window.instanceId));
  const labels: Record<string, string> = { guard: '守护', laike: '莱莱可刺杀', faction: '阵营方案', check: '降临者查验', rescue: '还魂曲', revive: '深海召回' };
  const submissions = view.submissionState.filter(submission => current.has(submission.windowInstanceId));
  return <section aria-label="观察玩家当前行动"><h3>观察玩家的行动状态 · 只读</h3>
    {view.windows.length ? view.windows.map(window => { const task = view.tasks.find(task => task.windowInstanceId === window.instanceId); return <p key={window.instanceId}>{task ? actionLabels[task.action] : labels[window.type] ?? '当前授权窗口'} · 剩余 {formatCountdown(remaining(window.closesAt))}</p>; }) : <p className="muted">当前没有获准查看的行动窗口。</p>}
    {submissions.map((submission, index) => <div className="accepted-summary" key={`${submission.windowInstanceId}/${submission.action}/${index}`}><strong>{actionLabels[submission.action]} · 已提交</strong><p>{submission.targets.length ? targetSummary(view, submission.targets) : '无目标'}{submission.direction ? ` · ${submission.direction === 'asc' ? '座号递增' : '座号递减'}` : ''}{submission.revision !== null ? ` · 方案 v${submission.revision}` : ''}</p></div>)}
    {!submissions.length && <p className="muted">当前窗口尚无已确认的提交记录。</p>}
  </section>;
}
