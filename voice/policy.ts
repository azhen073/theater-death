import {
  currentElectionSpeaker,
  currentLastWordsSpeaker,
  currentSpeechRoundSpeaker,
  currentTieSpeechSpeaker,
} from '../engine/day.ts';
import type { GameState } from '../engine/types.ts';

/**
 * 语音许可原因（供界面显示；不包含任何隐藏信息）。
 * - speaker：当前时段获得发言许可
 * - dead_listener：已死亡，仅可公共旁听（遗言时段除外）
 * - night_silence：夜间（含晨间结算）全体静音
 * - vote_silence：投票期间全体禁麦
 * - not_your_turn：白天非发言时段或不是当前发言人
 * - spectator：观战者，只可旁听
 * - game_not_started / game_ended：流程外
 */
export type VoicePermissionReason =
  | 'speaker'
  | 'dead_listener'
  | 'night_silence'
  | 'vote_silence'
  | 'not_your_turn'
  | 'spectator'
  | 'game_not_started'
  | 'game_ended';

export interface VoicePermission {
  readonly canPublish: boolean;
  readonly reason: VoicePermissionReason;
}

/** 推送给单个玩家的语音许可载荷：权限发生变化时附带新 token（获得=发布凭证，失去=订阅凭证） */
export interface VoicePermissionPush {
  readonly permission: VoicePermission;
  readonly token?: string;
}

/** 观战者固定许可：只听不说（不进入玩家动态授权策略） */
export const SPECTATOR_PERMISSION: VoicePermission = { canPublish: false, reason: 'spectator' };

function denied(reason: VoicePermissionReason): VoicePermission {
  return { canPublish: false, reason };
}

function granted(): VoicePermission {
  return { canPublish: true, reason: 'speaker' };
}

/**
 * 按 R-43（S3 裁定，2026-09-16 追加平票者发言开麦）计算某玩家此刻的语音发布许可。
 * 开麦时段穷举：遗言（仅当前遗言者，R-45 死者可发）、竞选候选发言轮（仅当前候选）、
 * 发言轮（仅当前发言者）、平票发言（仅当前平票发言者）；投票期间与夜间全体禁麦；
 * 其余白天窗口（竞选报名、天理指定与移交、结算）不开麦。
 */
export function voicePermission(state: GameState, playerId: string): VoicePermission {
  if (state.win !== null) {
    return denied('game_ended');
  }
  if (state.phase === 'night' || state.phase === 'morning') {
    return denied('night_silence');
  }
  if (state.phase === 'day' && state.day === null) {
    // 晨间公告 / 回归结算阶段：属于夜晚的延续，全体静音
    return denied('night_silence');
  }
  if (state.phase !== 'day') {
    return denied('game_not_started');
  }
  const day = state.day;
  if (day === null) {
    return denied('game_not_started');
  }

  const player = state.players.find((item) => item.playerId === playerId);
  if (player === undefined) {
    return denied('game_not_started');
  }

  switch (day.step) {
    case 'first_night_last_words':
    case 'elimination_last_words': {
      if (currentLastWordsSpeaker(state) === playerId) {
        return granted();
      }
      return denied(player.life === 'dead' ? 'dead_listener' : 'not_your_turn');
    }
    case 'election': {
      const election = day.election;
      if (election !== null && election.phase === 'speech') {
        if (currentElectionSpeaker(state) === playerId) {
          return granted();
        }
        return denied(player.life === 'dead' ? 'dead_listener' : 'not_your_turn');
      }
      if (player.life === 'dead') {
        return denied('dead_listener');
      }
      if (election !== null && (election.phase === 'vote' || election.phase === 'revote')) {
        return denied('vote_silence');
      }
      return denied('not_your_turn');
    }
    case 'speech_round': {
      if (day.speechRound !== null && currentSpeechRoundSpeaker(state) === playerId) {
        return granted();
      }
      return denied(player.life === 'dead' ? 'dead_listener' : 'not_your_turn');
    }
    case 'vote': {
      const ballot = day.ballot;
      if (ballot !== null && ballot.phase === 'tie_speech') {
        if (currentTieSpeechSpeaker(state) === playerId) {
          return granted();
        }
        return denied(player.life === 'dead' ? 'dead_listener' : 'not_your_turn');
      }
      if (player.life === 'dead') {
        return denied('dead_listener');
      }
      if (ballot !== null && (ballot.phase === 'vote' || ballot.phase === 'revote')) {
        return denied('vote_silence');
      }
      return denied('not_your_turn');
    }
    case 'handover':
    case 'settle':
    default:
      return denied(player.life === 'dead' ? 'dead_listener' : 'not_your_turn');
  }
}
