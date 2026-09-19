import type { CommandAction, RoomSnapshot } from '../../../contracts/v2.ts';

export const actionLabels: Record<CommandAction, string> = {
  SUBMIT_GUARD: '选择守护目标', SUBMIT_LAIKE: '选择刺杀目标', EDIT_PROPOSAL: '拟定攻击方案', CONFIRM_PROPOSAL: '确认团队方案',
  SUBMIT_CHECK: '选择查验目标', SUBMIT_RESCUE: '使用还魂曲', SUBMIT_REVIVE: '选择深海召回目标',
  REGISTER_CANDIDACY: '报名竞选天理', WITHDRAW_CANDIDACY: '退出竞选', START_SPEECH: '开始发言', END_ELECTION_SPEECH: '结束竞选发言',
  SUBMIT_ELECTION_VOTE: '选出天理', DESIGNATE_SPEECH: '指定发言顺序', END_SPEECH: '结束本次发言', SUBMIT_DAY_VOTE: '提交放逐投票',
  END_TIE_SPEECH: '结束平票发言', END_LAST_WORDS: '结束遗言', SUBMIT_HANDOVER: '移交天理',
};
export const presenceLabels = { online: '在线', reconnecting: '重连中', offline: '离线', left: '已离开' } as const;
export const roomPhaseLabels = { lobby: '等待开场', playing: '演出进行中', review: '终场复盘' } as const;
export const roomPermissionReasons: Record<string, string> = {
  not_host: '仅房主可操作', room_not_full: '正式玩家人数不足', not_ready: '还有玩家未准备',
  lobby_required: '请在大厅操作', review_required: '当前不在复盘阶段', spectator_read_only: '观众只读',
  already_formal: '你已是正式玩家', room_full: '正式席位已满', game_not_started: '对局尚未开始',
  second_screen_unavailable: '当前第二屏名额不可用', action_unavailable: '当前没有此项行动',
};

/** The shared HUD never derives its title from a private role window. */
export function publicPhaseLabel(view: RoomSnapshot): string {
  if (view.room.phase !== 'playing') return roomPhaseLabels[view.room.phase];
  const game = view.public;
  if (!game) return '正在同步';
  if (game.phase === 'night') return '夜幕降临';
  if (game.phase === 'ended') return '演出落幕';
  const day = game.day;
  if (!day) return '等待晨间公告';
  switch (day.step) {
    case 'morning_announcement': return '晨间公告';
    case 'election':
      if (day.election?.phase === 'signup') return '天理竞选 · 报名';
      if (day.election?.phase === 'speech') return day.speechPreparing ? '竞选发言 · 准备' : '天理竞选 · 发言';
      if (day.election?.phase === 'vote' || day.election?.phase === 'revote') return '天理竞选 · 投票';
      return '天理竞选';
    case 'first_night_last_words': return '首夜遗言';
    case 'speech_round': return day.speechPreparing ? '发言准备' : '白天讨论';
    case 'vote': return day.ballot?.phase === 'tie_speech' ? '平票发言' : day.ballot?.phase === 'revote' ? '放逐重投' : '放逐投票';
    case 'elimination_last_words': return '放逐遗言';
    case 'handover': return '天理移交';
    case 'settle': return '等待结算';
  }
}

export function formatCountdown(ms: number | null): string {
  if (ms === null) return '同步中';
  if (ms <= 0) return '等待结算';
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
