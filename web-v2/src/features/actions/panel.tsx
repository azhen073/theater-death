import type { ActionDraft } from './model.ts';
import { actionIssue, commandIntent, currentTask, skipLabels, speechPreview, targetActions, taskKey } from './model.ts';
import type { RoomSnapshot, TaskDTO } from '../../../../contracts/v2.ts';
import type { TrackedCommand } from './commands.ts';
import { actionLabels, formatCountdown } from '../../presentation/labels.ts';
import { Notice } from '../../components/ui.tsx';
import { ApiFailure, errorMessage } from '../../transport/http.ts';
import { targetSummary } from '../../presentation/targets.ts';
import { Proposal } from './proposal.tsx';
import { newRequestId } from '../../transport/ids.ts';
export { targetSummary } from '../../presentation/targets.ts';

export function ActionPanel({ view, task, draft, setDraft, selectTask, online, remaining, records, submit, retry, query }: {
  view: RoomSnapshot; task: TaskDTO | null; draft: ActionDraft; setDraft: (draft: ActionDraft) => void; selectTask: (key: string) => void;
  online: boolean; remaining: (deadline: number) => number | null; records: TrackedCommand[];
  submit: (intent: ReturnType<typeof commandIntent>) => void; retry: (id: string) => void; query: (id: string) => void;
}) {
  const pending = task ? records.find(record => taskKey(record.intent) === taskKey(task) && !['accepted', 'rejected'].includes(record.status)) : null;
  const visibleTasks = view.viewer.readOnly ? [] : view.tasks.filter(item => currentTask(view, item));
  const latest = task ? [...records].reverse().find(record => taskKey(record.intent) === taskKey(task)) : null;
  const prior = task ? view.submissionState.find(record => taskKey(record) === taskKey(task)) : null;
  const issue = task ? actionIssue(view, task, draft) : null;
  const latestMatches = latest && (!latest.intent.targets || JSON.stringify(latest.intent.targets) === JSON.stringify(draft.targets)) && (latest.intent.direction === undefined || latest.intent.direction === draft.direction) && (latest.intent.revision === undefined || latest.intent.revision === draft.revision);
  const expired = task ? remaining(task.closesAt) === 0 : false;
  const locked = !online || !!pending || expired;
  const send = () => { if (task && !issue && !locked) submit(commandIntent(view, task, draft, newRequestId())); };
  const unresolvedOld = records.filter(record => !['accepted', 'rejected', 'sending'].includes(record.status) && !view.tasks.some(item => taskKey(item) === taskKey(record.intent)));
  return <section className="action-dock" aria-label="当前行动"><div className="action-dock__head"><span className="eyebrow">YOUR NEXT MOVE</span>{task && <strong className="action-clock">{formatCountdown(remaining(task.closesAt))}</strong>}</div>
    {visibleTasks.length > 1 && <div className="task-switch" role="group" aria-label="可用任务">{visibleTasks.map(item => <button type="button" key={taskKey(item)} aria-pressed={!!task && taskKey(task) === taskKey(item)} onClick={() => selectTask(taskKey(item))}>{actionLabels[item.action]}</button>)}</div>}
    <h2>{task ? actionLabels[task.action] : view.viewer.readOnly ? '你正在只读观战' : '本阶段无需操作'}</h2>
    <Proposal view={view}/>
    {!task && <p className="muted">{view.viewer.readOnly ? '你可以查看当前视角授权的信息、记录和规则。' : '等待其他玩家或服务端推进阶段。'}</p>}
    {task && <>
      {targetActions.has(task.action) && task.targets && <><p className="selection-summary">{draft.targets.length ? targetSummary(view, draft.targets) : '尚未选择目标'}<span> · {draft.targets.length} / {task.targets.maxTargets}</span></p><p className="muted">点击舞台上的可选玩家，仅改变选择；确认后才提交。{task.targets.allowRepeated ? '同一目标可重复选择，使用加减调整次数。' : ''}</p></>}
      {task.action === 'DESIGNATE_SPEECH' && <label className="select-field">发言方向<select aria-label="发言方向" disabled={locked} value={draft.direction} onChange={event => setDraft({ ...draft, direction: event.target.value as 'asc' | 'desc' })}><option value="asc">座位号递增</option><option value="desc">座位号递减</option></select></label>}
      {task.action === 'DESIGNATE_SPEECH' && draft.targets.length === 1 && <p className="speech-preview" aria-label="发言顺序预览">顺序预览：{speechPreview(view, task, draft).map(seat => `${seat.seat}号`).join(' → ')}。最终顺序以服务端结果为准。</p>}
      {task.action === 'CONFIRM_PROPOSAL' && <p>{(view.private?.proposal?.revision ?? 0) > 0 ? `确认最新草稿 v${view.private!.proposal!.revision}。版本变化后需要重新确认。` : '目前还没有可确认的草稿。'}</p>}
      {prior && <p className="accepted-summary">你上次提交已确认：{targetActions.has(task.action) ? targetSummary(view, prior.targets) : actionLabels[prior.action]}{prior.revision !== null ? ` · v${prior.revision}` : ''}。再次调整选择后，须重新提交才会生效。</p>}
      {latest?.status === 'accepted' && <p role="status" className={latestMatches ? 'accepted-summary' : 'muted'}>{latestMatches ? '已确认提交。' : '选择已更改，尚未提交。'}</p>}
      {latest?.status === 'rejected' && <Notice error>{errorMessage(new ApiFailure(400, latest.code ?? 'unknown_error'))}</Notice>}
      {pending && <Notice>{pending.status === 'sending' ? '正在提交，请等待服务端确认…' : pending.status === 'pending' ? '服务器正在处理，继续确认结果…' : pending.status === 'not_seen' ? '暂未查询到记录，结果尚未确定。' : '连接中断，正在确认行动结果。'}<p className="muted">原操作：{actionLabels[pending.intent.action]}{pending.intent.targets ? ` · ${targetSummary(view, pending.intent.targets)}` : ''}{pending.intent.revision ? ` · v${pending.intent.revision}` : ''}</p>{pending.status !== 'sending' && <div className="button-row"><button className="button" disabled={pending.checking} onClick={() => query(pending.intent.requestId)}>查询结果</button>{['unknown', 'not_seen'].includes(pending.status) && <button className="button" disabled={!online || expired || pending.checking} onClick={() => retry(pending.intent.requestId)}>用原目标与请求重试</button>}</div>}</Notice>}
      {!online && <p className="field__error">连接尚未恢复，暂时不能提交。</p>}
      {expired && <p className="muted">时间已到，等待服务端结算；不会自动提交你的选择。</p>}
      {issue && !pending && <p className="muted">{issue}</p>}
      <div className="button-row">{task.targets?.canSkip && draft.targets.length > 0 && <button className="button" disabled={locked} onClick={() => setDraft({ ...draft, targets: [] })}>清空选择</button>}<button type="button" className="button button--primary" disabled={locked || !!issue} onClick={send}>{task.targets?.canSkip && !draft.targets.length ? skipLabels[task.action] ?? '确认提交' : '确认提交'}</button></div>
    </>}
    {unresolvedOld.map(record => <Notice key={record.intent.requestId}>上一窗口的「{actionLabels[record.intent.action]}」结果仍在确认，不会向新窗口重发。<button className="text-button" disabled={record.checking} onClick={() => query(record.intent.requestId)}>查询原结果</button></Notice>)}
    {!task && records.length > 0 && records[records.length - 1]!.status === 'accepted' && <p role="status" className="accepted-summary">上一次「{actionLabels[records[records.length - 1]!.intent.action]}」已确认提交。</p>}
  </section>;
}
