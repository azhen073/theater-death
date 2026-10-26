import type { ElectionVoteBlockReason, RoomSnapshot } from '../../../../contracts/v2.ts';

export type { ElectionVoteBlockReason } from '../../../../contracts/v2.ts';

export type ElectionVoteNote =
  | { kind: 'receipt'; skipped: boolean; seat: number | null; nickname: string | null }
  | { kind: 'blocked'; reason: ElectionVoteBlockReason };

export interface ElectionVoteNoteText {
  title: string;
  summary: string;
}

const RECEIPT_SUMMARY = '不可更改，结算后公开票型。';

export function electionVoteNote(view: RoomSnapshot): ElectionVoteNote | null {
  const election = view.public?.day?.election ?? null;
  if (election === null) return null;
  if (election.phase !== 'vote' && election.phase !== 'revote') return null;
  if (view.viewer.readOnly || view.viewer.kind !== 'formal') return null;
  if (!view.viewer.subjectPlayerId) return null;

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

  const blockedReason = view.private?.electionVote?.blockedReason;
  return blockedReason ? { kind: 'blocked', reason: blockedReason } : null;
}

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
