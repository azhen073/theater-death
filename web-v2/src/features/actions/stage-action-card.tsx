import type { ReactNode } from 'react';
import type { RoomSnapshot, TaskDTO } from '../../../../contracts/v2.ts';
import { actionLabels } from '../../presentation/labels.ts';
import { targetSummary } from '../../presentation/targets.ts';
import { Notice } from '../../components/ui.tsx';
import type { ActionDraft } from './model.ts';
import { speechPreview, targetActions, taskKey } from './model.ts';
import type { ActionPresentation } from './presentation.ts';

export interface StageActionCardProps {
  view: RoomSnapshot;
  presentation: ActionPresentation;
  task: TaskDTO | null;
  draft: ActionDraft;
  availableTasks: TaskDTO[];
  countdown?: string;
  targetChanged?: boolean;
  children?: ReactNode;
  onSelectTask: (key: string) => void;
  onDraftChange: (draft: ActionDraft) => void;
  onSubmit: () => void;
  onSubmitEmpty: () => void;
  onRetry: (requestId: string) => void;
  onQuery: (requestId: string) => void;
  onRefresh: () => void;
}

export function StageActionCard({
  view,
  presentation,
  task,
  draft,
  availableTasks,
  countdown,
  targetChanged,
  children,
  onSelectTask,
  onDraftChange,
  onSubmit,
  onSubmitEmpty,
  onRetry,
  onQuery,
  onRefresh,
}: StageActionCardProps) {
  const isReadOnly = presentation.mode === 'readonly';
  const ariaLabel = isReadOnly ? '观察玩家当前行动' : '舞台行动';
  const locked =
    presentation.status === 'offline' ||
    presentation.status === 'expired' ||
    presentation.status === 'sending' ||
    presentation.status === 'recovering';

  return (
    <section className={`stage-action-card ${isReadOnly ? 'stage-action-card--readonly' : ''}`} aria-label={ariaLabel}>
      <div className="stage-action-card__head">
        <span className="eyebrow">{isReadOnly ? 'SPECTATOR VIEW' : 'YOUR NEXT MOVE'}</span>
        {countdown && <strong className="action-clock" aria-label="任务剩余时间">{countdown}</strong>}
      </div>

      {availableTasks.length > 1 && (
        <div className="task-switch" role="group" aria-label="可用任务">
          {availableTasks.map(item => (
            <button
              type="button"
              key={taskKey(item)}
              aria-pressed={!!task && taskKey(task) === taskKey(item)}
              onClick={() => onSelectTask(taskKey(item))}
            >
              {actionLabels[item.action]}
            </button>
          ))}
        </div>
      )}

      <h2>{presentation.title}</h2>

      {children}

      {!task && (
        <p className="muted">{presentation.summary}</p>
      )}

      {task && (
        <>
          {targetActions.has(task.action) && task.targets && (
            <>
              <p className="selection-summary">
                {draft.targets.length ? targetSummary(view, draft.targets) : '尚未选择目标'}
                <span> · {draft.targets.length} / {task.targets.maxTargets}</span>
              </p>
              <p className="muted">
                点击舞台上的可选玩家，仅改变选择；确认后才提交。
                {task.targets.allowRepeated ? '同一目标可重复选择，使用加减调整次数。' : ''}
              </p>
            </>
          )}

          {task.action === 'DESIGNATE_SPEECH' && (
            <label className="select-field">
              发言方向
              <select
                aria-label="发言方向"
                disabled={locked}
                value={draft.direction}
                onChange={event => onDraftChange({ ...draft, direction: event.target.value as 'asc' | 'desc' })}
              >
                <option value="asc">座位号递增</option>
                <option value="desc">座位号递减</option>
              </select>
            </label>
          )}

          {task.action === 'DESIGNATE_SPEECH' && draft.targets.length === 1 && (
            <p className="speech-preview" aria-label="发言顺序预览">
              顺序预览：{speechPreview(view, task, draft).map(seat => `${seat.seat}号`).join(' → ')}。最终顺序以服务端结果为准。
            </p>
          )}

          {task.action === 'CONFIRM_PROPOSAL' && (
            <p>
              {(view.private?.proposal?.revision ?? 0) > 0
                ? `确认最新草稿 v${view.private!.proposal!.revision}。版本变化后需要重新确认。`
                : '目前还没有可确认的草稿。'}
            </p>
          )}

          {presentation.serverSummary && (
            <p className="accepted-summary">{presentation.serverSummary}</p>
          )}

          <div className="feedback" role="status" aria-label="行动反馈" aria-live="polite">
            {targetChanged && (
              <Notice>
                可选目标已更新，不再允许的选择已移除。请核对当前目标后再确认。
              </Notice>
            )}
            {presentation.disabledReason && (
              <Notice error={presentation.status === 'rejected'}>
                {presentation.disabledReason}
              </Notice>
            )}
            {presentation.statusText && !presentation.disabledReason && (
              <p className={presentation.status === 'accepted' ? 'accepted-summary' : 'muted'}>
                {presentation.statusText}
              </p>
            )}
          </div>

          {(presentation.queryRequestId || presentation.retryRequestId) && (
            <div className="button-row recovery-row">
              {presentation.queryRequestId && (
                <button
                  type="button"
                  className="button"
                  disabled={presentation.status === 'offline' || presentation.queryDisabled}
                  onClick={() => onQuery(presentation.queryRequestId!)}
                >
                  查询结果
                </button>
              )}
              {presentation.retryRequestId && (
                <button
                  type="button"
                  className="button"
                  disabled={presentation.status === 'offline' || presentation.status === 'expired' || presentation.queryDisabled}
                  onClick={() => onRetry(presentation.retryRequestId!)}
                >
                  用原目标与请求重试
                </button>
              )}
            </div>
          )}

          {presentation.canRefreshRecord && (
            <button type="button" className="text-button" onClick={onRefresh}>
              刷新记录
            </button>
          )}

          <div className="button-row">
            {presentation.clearAction && (
              <button
                type="button"
                className="button"
                disabled={presentation.clearAction.disabled}
                onClick={() => onDraftChange({ ...draft, targets: [] })}
              >
                {presentation.clearAction.label}
              </button>
            )}
            {task.targets?.canSkip && draft.targets.length === 0 ? (
              presentation.emptyAction && (
                <button
                  type="button"
                  className="button button--primary"
                  data-testid="stage-submit"
                  disabled={presentation.emptyAction.disabled}
                  onClick={onSubmitEmpty}
                >
                  {presentation.emptyAction.label}
                </button>
              )
            ) : (
              <>
                {presentation.emptyAction && (
                  <button
                    type="button"
                    className="button"
                    data-testid="stage-skip"
                    disabled={presentation.emptyAction.disabled}
                    onClick={onSubmitEmpty}
                  >
                    {presentation.emptyAction.label}
                  </button>
                )}
                {presentation.primary && (
                  <button
                    type="button"
                    className="button button--primary"
                    data-testid="stage-submit"
                    disabled={presentation.primary.disabled}
                    onClick={onSubmit}
                  >
                    {presentation.primary.label}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {presentation.recoveryItems.map(item => (
        <Notice key={item.requestId}>
          上一窗口的「{actionLabels[item.action]}」
          {item.status === 'sending' ? '正在发送' : '结果仍在确认'}，不会向新窗口重发。
          {item.status !== 'sending' && (
            <button
              type="button"
              className="text-button"
              disabled={!item.canQuery}
              onClick={() => onQuery(item.requestId)}
            >
              {item.checking ? '正在查询…' : '查询原结果'}
            </button>
          )}
        </Notice>
      ))}

      {presentation.recentOutcome && (
        <p role="status" className="accepted-summary">{presentation.recentOutcome}</p>
      )}
    </section>
  );
}
