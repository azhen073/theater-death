import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '../contracts/v2.ts';
import { deriveActionPresentation } from '../web-v2/src/features/actions/presentation.ts';
import { emptyDraft } from '../web-v2/src/features/actions/model.ts';
import { freeSpeechNoteText } from '../web-v2/src/features/game/free-speech-note.ts';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/contract-2.1/${name}`, import.meta.url), 'utf8')) as T;
}

const base = fixture<RoomSnapshot>('day-election-full.json');

/** 白天「自由发言」阶段的标准夹具：阶段为 free_speech、无行动任务、无提交。 */
function freeSpeechView(): RoomSnapshot {
  const view = structuredClone(base);
  view.public!.day!.step = 'free_speech';
  view.windows = [];
  view.tasks = [];
  view.submissionState = [];
  view.viewer.readOnly = false;
  view.viewer.kind = 'formal';
  view.private!.self.life = 'alive';
  return view;
}

function idlePresentation(view: RoomSnapshot) {
  return deriveActionPresentation({ view, task: null, draft: emptyDraft(), records: [], online: true, remainingMs: null });
}

describe('自由发言阶段行动卡文案：推导', () => {
  it('存活正式玩家给出「可开麦发言」，而不是通用「本阶段无需操作」', () => {
    expect(freeSpeechNoteText(freeSpeechView())).toEqual({
      title: '自由发言时间',
      summary: '点击上方语音条开麦发言；倒计时结束自动进入放逐投票。',
    });
  });

  it('出局玩家给出「只能旁听」，不诱导开麦', () => {
    const view = freeSpeechView();
    view.private!.self.life = 'dead';
    expect(freeSpeechNoteText(view)).toEqual({
      title: '你已出局',
      summary: '自由发言阶段只能旁听，倒计时结束进入放逐投票。',
    });
  });

  it('非自由发言阶段不出提示（发言轮 / 放逐投票 / 夜晚）', () => {
    for (const step of ['speech_round', 'vote', 'elimination_last_words'] as const) {
      const view = freeSpeechView();
      view.public!.day!.step = step;
      expect(freeSpeechNoteText(view)).toBeNull();
    }
    const night = freeSpeechView();
    night.public!.phase = 'night';
    night.public!.day = null;
    expect(freeSpeechNoteText(night)).toBeNull();
  });

  it('只读视角（公开观众 / 第二屏）不出提示，只读文案不受影响', () => {
    const spectator = freeSpeechView();
    spectator.viewer.readOnly = true;
    spectator.viewer.kind = 'public_spectator';
    expect(freeSpeechNoteText(spectator)).toBeNull();
    const secondScreen = freeSpeechView();
    secondScreen.viewer.readOnly = true;
    secondScreen.viewer.kind = 'private_spectator';
    expect(freeSpeechNoteText(secondScreen)).toBeNull();
  });

  it('没有本人席位（subjectPlayerId 为空）不出提示', () => {
    const view = freeSpeechView();
    view.viewer.subjectPlayerId = null;
    expect(freeSpeechNoteText(view)).toBeNull();
  });

  it('缺少本人私有视图时退回通用文案，不猜生死', () => {
    const view = freeSpeechView();
    view.private = null;
    expect(freeSpeechNoteText(view)).toBeNull();
  });
});

describe('自由发言阶段行动卡文案：接入行动卡', () => {
  it('存活玩家：行动卡标题与正文替换为开麦提示', () => {
    const presentation = idlePresentation(freeSpeechView());
    expect(presentation.mode).toBe('idle');
    expect(presentation.title).toBe('自由发言时间');
    expect(presentation.summary).toBe('点击上方语音条开麦发言；倒计时结束自动进入放逐投票。');
  });

  it('出局玩家：行动卡说明只能旁听', () => {
    const view = freeSpeechView();
    view.private!.self.life = 'dead';
    const presentation = idlePresentation(view);
    expect(presentation.title).toBe('你已出局');
    expect(presentation.summary).toBe('自由发言阶段只能旁听，倒计时结束进入放逐投票。');
  });

  it('其它阶段仍逐字保持通用文案（不扩大覆盖范围）', () => {
    const view = freeSpeechView();
    view.public!.day!.step = 'speech_round';
    expect(idlePresentation(view)).toMatchObject({
      title: '本阶段无需操作',
      summary: '等待其他玩家或服务端推进阶段。',
    });
  });

  it('只读观战仍走只读文案，不被自由发言提示覆盖', () => {
    const view = freeSpeechView();
    view.viewer.readOnly = true;
    view.viewer.kind = 'public_spectator';
    expect(idlePresentation(view).title).toBe('你正在只读观战');
  });
});
