import type { RoomSnapshot } from '../../../../contracts/v2.ts';

/** 竞选投票阶段本人无法投票的原因（与引擎的拒绝原因一一对应）。 */
export type ElectionVoteBlockReason = 'candidate' | 'tied' | 'dead' | 'vote_frozen';

/** 竞选投票阶段给本人的提示：投票回执 / 无资格说明 / 无提示（null 表示沿用通用文案）。 */
export type ElectionVoteNote =
  | { kind: 'receipt'; skipped: boolean; seat: number | null; nickname: string | null }
  | { kind: 'blocked'; reason: ElectionVoteBlockReason };

export interface ElectionVoteNoteText {
  title: string;
  summary: string;
}

const RECEIPT_SUMMARY = '不可更改，结算后公开票型。';

/**
 * 只读推导，无副作用、不读时间。
 *
 * 判定顺序镜像 `engine/day.ts` 的 `submitElectionVoteIssue`：死者 → 票权冻结（莱莱可翻牌禁投）→
 * 重投平票者 → 未退选候选人；因此界面说明与服务端实际拒绝原因一致。已退选者按 R-42 恢复投票权，
 * 不出提示（引擎用 `activeCandidates`，即候选减去已退选）。
 *
 * 回执只认「当前这次竞选投票窗口」的提交：重投是新窗口实例，不复用首轮回执；
 * 结算后窗口消失，回执随之消失（不做跨窗口持久化，避免与票型公示口径冲突）。
 *
 * 隐私边界：只读本人的私有字段（`private.self.life` / `voteFrozen`）与公开竞选字段，
 * 只渲染在本人行动卡上；首日竞选先于晨间公告时，死者身份也只对本人可见。
 */
export function electionVoteNote(view: RoomSnapshot): ElectionVoteNote | null {
  const election = view.public?.day?.election ?? null;
  if (election === null) return null;
  if (election.phase !== 'vote' && election.phase !== 'revote') return null;
  if (view.viewer.readOnly || view.viewer.kind !== 'formal') return null;
  const selfId = view.viewer.subjectPlayerId;
  if (!selfId) return null;

  const voteWindow = view.windows.find(window => window.id === 'election_vote');
  if (voteWindow) {
    const submission = view.submissionState.find(
      item => item.action === 'SUBMIT_ELECTION_VOTE' && item.windowInstanceId === voteWindow.instanceId
    );
    if (submission) {
      const targetId = submission.targets[0];
      if (targetId === undefined) return { kind: 'receipt', skipped: true, seat: null, nickname: null };
      const seat = view.public?.seats.find(item => item.playerId === targetId) ?? null;
      return { kind: 'receipt', skipped: false, seat: seat?.seat ?? null, nickname: seat?.nickname ?? null };
    }
  }

  const self = view.private?.self ?? null;
  if (self !== null && self.life === 'dead') return { kind: 'blocked', reason: 'dead' };
  if (self !== null && self.voteFrozen) return { kind: 'blocked', reason: 'vote_frozen' };
  if (election.phase === 'revote' && election.tiedIds.includes(selfId)) return { kind: 'blocked', reason: 'tied' };
  if (election.candidates.includes(selfId) && !election.withdrawn.includes(selfId)) {
    return { kind: 'blocked', reason: 'candidate' };
  }
  return null;
}

/** 文案（极简、不带条款号；细节由界面标题承担）。 */
export function electionVoteNoteText(note: ElectionVoteNote): ElectionVoteNoteText {
  if (note.kind === 'receipt') {
    if (note.skipped) return { title: '已弃票', summary: RECEIPT_SUMMARY };
    if (note.seat === null) return { title: '已投票', summary: RECEIPT_SUMMARY };
    const nickname = note.nickname ? ` ${note.nickname}` : '';
    return { title: `已投给 ${note.seat}号${nickname}`, summary: RECEIPT_SUMMARY };
  }
  switch (note.reason) {
    case 'candidate': return { title: '你是候选人', summary: '本轮不参与投票，等待其他玩家与结算。' };
    case 'tied': return { title: '你是平票者', summary: '重投轮不参与投票，等待结算。' };
    case 'dead': return { title: '你已死亡', summary: '本轮不参与投票，等待结算。' };
    case 'vote_frozen': return { title: '票权已冻结', summary: '本轮不参与投票，等待结算。' };
  }
}
