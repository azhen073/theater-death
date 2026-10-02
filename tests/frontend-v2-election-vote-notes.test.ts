import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoomSnapshot, SubmissionDTO } from '../contracts/v2.ts';
import { deriveActionPresentation } from '../web-v2/src/features/actions/presentation.ts';
import { emptyDraft } from '../web-v2/src/features/actions/model.ts';
import { electionVoteNote, electionVoteNoteText } from '../web-v2/src/features/game/election-vote-notes.ts';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/contract-2.1/${name}`, import.meta.url), 'utf8')) as T;
}

const base = fixture<RoomSnapshot>('day-election-full.json');
const VOTE_WINDOW = 'g_fixture:day:1:election_vote';
const OTHER_WINDOW = 'g_fixture:day:1:election_vote:other';

/** 竞选投票阶段的标准夹具：窗口存在、尚未提交、候选为空。 */
function votingView(): RoomSnapshot {
  const view = structuredClone(base);
  view.windows = [{ id: 'election_vote', type: 'election_vote', instanceId: VOTE_WINDOW, closesAt: 241_000 }];
  view.submissionState = [];
  const election = view.public!.day!.election!;
  election.phase = 'vote';
  election.candidates = [];
  election.withdrawn = [];
  election.tiedIds = [];
  return view;
}

function selfId(view: RoomSnapshot): string {
  const id = view.viewer.subjectPlayerId;
  if (!id) throw new Error('夹具缺少 subjectPlayerId');
  return id;
}

function otherPlayerId(view: RoomSnapshot): string {
  const seat = view.public!.seats.find(item => item.playerId !== selfId(view));
  if (!seat) throw new Error('夹具缺少其他座位');
  return seat.playerId;
}

function seatOf(view: RoomSnapshot, playerId: string) {
  const seat = view.public!.seats.find(item => item.playerId === playerId);
  if (!seat) throw new Error('夹具缺少该座位');
  return seat;
}

function receipt(windowInstanceId: string, targets: string[]): SubmissionDTO {
  return { action: 'SUBMIT_ELECTION_VOTE', windowInstanceId, requestId: 'req-1', acceptedAt: 1, targets, revision: null, direction: null };
}

describe('竞选投票阶段本人提示：推导', () => {
  it('未投票且有资格时不提示，沿用通用文案', () => {
    expect(electionVoteNote(votingView())).toBeNull();
  });

  it('候选人本人提示候选人不得投票（R-42）', () => {
    const view = votingView();
    view.public!.day!.election!.candidates = [selfId(view)];
    expect(electionVoteNote(view)).toEqual({ kind: 'blocked', reason: 'candidate' });
    expect(electionVoteNoteText({ kind: 'blocked', reason: 'candidate' })).toEqual({
      title: '你是候选人',
      summary: '本轮不参与投票，等待其他玩家与结算。',
    });
  });

  it('投票开始前已退选的候选人不提示（退选恢复投票权）', () => {
    const view = votingView();
    view.public!.day!.election!.candidates = [selfId(view)];
    view.public!.day!.election!.withdrawn = [selfId(view)];
    expect(electionVoteNote(view)).toBeNull();
  });

  it('重投平票者提示平票者不得投票，且优先于候选人说明', () => {
    const view = votingView();
    const election = view.public!.day!.election!;
    election.phase = 'revote';
    election.candidates = [selfId(view), otherPlayerId(view)];
    election.tiedIds = [selfId(view)];
    expect(electionVoteNote(view)).toEqual({ kind: 'blocked', reason: 'tied' });
    expect(electionVoteNoteText({ kind: 'blocked', reason: 'tied' })).toEqual({
      title: '你是平票者',
      summary: '重投轮不参与投票，等待结算。',
    });
  });

  it('重投时未进入平票的候选人仍按候选人提示', () => {
    const view = votingView();
    const election = view.public!.day!.election!;
    election.phase = 'revote';
    election.candidates = [selfId(view), otherPlayerId(view)];
    election.tiedIds = [otherPlayerId(view)];
    expect(electionVoteNote(view)).toEqual({ kind: 'blocked', reason: 'candidate' });
  });

  it('死亡优先于票权冻结', () => {
    const view = votingView();
    view.private!.self.life = 'dead';
    view.private!.self.voteFrozen = true;
    expect(electionVoteNote(view)).toEqual({ kind: 'blocked', reason: 'dead' });
    expect(electionVoteNoteText({ kind: 'blocked', reason: 'dead' }).title).toBe('你已死亡');
  });

  it('莱莱可翻牌禁投期间提示票权已冻结', () => {
    const view = votingView();
    view.private!.self.voteFrozen = true;
    expect(electionVoteNote(view)).toEqual({ kind: 'blocked', reason: 'vote_frozen' });
    expect(electionVoteNoteText({ kind: 'blocked', reason: 'vote_frozen' })).toEqual({
      title: '票权已冻结',
      summary: '本轮不参与投票，等待结算。',
    });
  });
});

describe('竞选投票阶段本人提示：回执', () => {
  it('已投票显示投给谁（座位号 + 昵称）', () => {
    const view = votingView();
    const target = seatOf(view, otherPlayerId(view));
    view.submissionState = [receipt(VOTE_WINDOW, [target.playerId])];
    expect(electionVoteNote(view)).toEqual({ kind: 'receipt', skipped: false, seat: target.seat, nickname: target.nickname });
    expect(electionVoteNoteText({ kind: 'receipt', skipped: false, seat: target.seat, nickname: target.nickname })).toEqual({
      title: `已投给 ${target.seat}号 ${target.nickname}`,
      summary: '不可更改，结算后公开票型。',
    });
  });

  it('已弃票（targets 为空）显示已弃票', () => {
    const view = votingView();
    view.submissionState = [receipt(VOTE_WINDOW, [])];
    expect(electionVoteNote(view)).toEqual({ kind: 'receipt', skipped: true, seat: null, nickname: null });
    expect(electionVoteNoteText({ kind: 'receipt', skipped: true, seat: null, nickname: null }).title).toBe('已弃票');
  });

  it('只认当前投票窗口：其它窗口实例的提交不出回执', () => {
    const view = votingView();
    view.submissionState = [receipt(OTHER_WINDOW, [otherPlayerId(view)])];
    expect(electionVoteNote(view)).toBeNull();
  });

  it('目标座位查不到时退化为「已投票」，不编造昵称', () => {
    const view = votingView();
    view.submissionState = [receipt(VOTE_WINDOW, ['p_missing'])];
    expect(electionVoteNote(view)).toEqual({ kind: 'receipt', skipped: false, seat: null, nickname: null });
    expect(electionVoteNoteText({ kind: 'receipt', skipped: false, seat: null, nickname: null }).title).toBe('已投票');
  });

  it('回执优先于禁投说明（候选人投过票时不显示候选人提示）', () => {
    const view = votingView();
    view.public!.day!.election!.candidates = [selfId(view)];
    view.submissionState = [receipt(VOTE_WINDOW, [otherPlayerId(view)])];
    expect(electionVoteNote(view)?.kind).toBe('receipt');
  });
});

describe('竞选投票阶段本人提示：边界', () => {
  it('非投票阶段（报名 / 发言 / 结束）不出提示', () => {
    for (const phase of ['signup', 'speech', 'done'] as const) {
      const view = votingView();
      view.public!.day!.election!.phase = phase;
      expect(electionVoteNote(view)).toBeNull();
    }
  });

  it('没有竞选上下文（election 为 null）不出提示', () => {
    const view = votingView();
    view.public!.day!.election = null;
    expect(electionVoteNote(view)).toBeNull();
  });

  it('只读视角（公开观众 / 第二屏）不出提示，只读文案不受影响', () => {
    const spectator = votingView();
    spectator.viewer.readOnly = true;
    spectator.viewer.kind = 'public_spectator';
    expect(electionVoteNote(spectator)).toBeNull();
    const secondScreen = votingView();
    secondScreen.viewer.readOnly = true;
    secondScreen.viewer.kind = 'private_spectator';
    expect(electionVoteNote(secondScreen)).toBeNull();
  });

  it('没有本人身份（subjectPlayerId 为空）不出提示', () => {
    const view = votingView();
    view.viewer.subjectPlayerId = null;
    expect(electionVoteNote(view)).toBeNull();
  });
});

describe('竞选投票阶段本人提示：接入行动卡', () => {
  function idlePresentation(view: RoomSnapshot) {
    return deriveActionPresentation({ view, task: null, draft: emptyDraft(), records: [], online: true, remainingMs: null });
  }

  it('候选人本人：行动卡标题与正文替换为候选人说明', () => {
    const view = votingView();
    view.public!.day!.election!.candidates = [selfId(view)];
    const presentation = idlePresentation(view);
    expect(presentation.mode).toBe('idle');
    expect(presentation.title).toBe('你是候选人');
    expect(presentation.summary).toBe('本轮不参与投票，等待其他玩家与结算。');
  });

  it('已投票：行动卡显示回执，而不是「本阶段无需操作」', () => {
    const view = votingView();
    const target = seatOf(view, otherPlayerId(view));
    view.submissionState = [receipt(VOTE_WINDOW, [target.playerId])];
    const presentation = idlePresentation(view);
    expect(presentation.title).toBe(`已投给 ${target.seat}号 ${target.nickname}`);
    expect(presentation.summary).toBe('不可更改，结算后公开票型。');
  });

  it('有资格的未投票玩家与其它阶段逐字保持通用文案', () => {
    expect(idlePresentation(votingView())).toMatchObject({
      title: '本阶段无需操作',
      summary: '等待其他玩家或服务端推进阶段。',
    });
    const speech = votingView();
    speech.public!.day!.election!.phase = 'speech';
    speech.public!.day!.election!.candidates = [selfId(speech)];
    expect(idlePresentation(speech)).toMatchObject({
      title: '本阶段无需操作',
      summary: '等待其他玩家或服务端推进阶段。',
    });
  });

  it('只读观战仍走只读文案，不被竞选提示覆盖', () => {
    const view = votingView();
    view.viewer.readOnly = true;
    view.viewer.kind = 'public_spectator';
    expect(idlePresentation(view).title).toBe('你正在只读观战');
  });
});
