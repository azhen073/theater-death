import type { RoomSnapshot } from '../../../../contracts/v2.ts';

export interface FreeSpeechNoteText {
  title: string;
  summary: string;
}

const CAN_SPEAK: FreeSpeechNoteText = {
  title: '自由发言时间',
  summary: '点击上方语音条开麦发言；倒计时结束自动进入放逐投票。',
};

const LISTEN_ONLY: FreeSpeechNoteText = {
  title: '你已出局',
  summary: '自由发言阶段只能旁听，倒计时结束进入放逐投票。',
};

/**
 * 白天「自由发言」阶段（Q-11）给本人的行动卡文案；不适用时返回 null（沿用通用「本阶段无需操作」）。
 *
 * 为什么要单独覆盖：本阶段服务端**不下发任何行动任务**——`server/capabilities.ts` 的白天分支
 * 没有任何 `allow()` 命中 `free_speech` 窗口，`server/v2/snapshots.ts` 的 `tasks` 又只由
 * `allowedCommands` 派生，于是任务为空、行动卡落到通用 idle 分支。但本阶段唯一的动作是**开麦**，
 * 通用文案「等待其他玩家或服务端推进阶段」与本阶段语义相反（主动方是玩家自己）。
 *
 * 只读推导，无副作用、不读时间。
 *
 * 隐私边界：只用本人的私有字段 `private.self.life` 区分「可开麦 / 只能旁听」，
 * 只渲染在本人行动卡上；只读视角（公开观众 / 第二屏）返回 null，继续走只读文案。
 * 缺少本人私有视图时也返回 null——宁可退回通用文案，也不猜生死（猜错就会把出局者写成可开麦）。
 */
export function freeSpeechNoteText(view: RoomSnapshot): FreeSpeechNoteText | null {
  if (view.public?.day?.step !== 'free_speech') return null;
  if (view.viewer.readOnly || view.viewer.kind !== 'formal') return null;
  if (!view.viewer.subjectPlayerId) return null;
  const self = view.private?.self ?? null;
  if (self === null) return null;
  return self.life === 'dead' ? LISTEN_ONLY : CAN_SPEAK;
}
