import {
  currentElectionSpeaker,
  currentLastWordsSpeaker,
  currentSpeechRoundSpeaker,
  currentTieSpeechSpeaker,
} from '../engine/day.ts';
import type { GameState } from '../engine/types.ts';

/**
 * 语音许可原因（供界面显示；不包含任何隐藏信息）。
 * - preparing_speech：发言前准备窗口（V2-03：不开麦）
 * - speaker：当前时段获得发言许可
 * - dead_listener：已死亡，仅可公共旁听（遗言时段除外）
 * - night_silence：夜间（含晨间结算）全体静音
 * - vote_silence：投票期间全体禁麦
 * - not_your_turn：白天非发言时段或不是当前发言人
 * - spectator：观战者，只可旁听
 * - lobby_speaker：进入对局前的大厅 / 复盘（Q-12，房间频道），正式成员自由开麦
 * - game_not_started / game_ended：流程外
 */
export type VoicePermissionReason =
  | 'preparing_speech'
  | 'speaker'
  | 'dead_listener'
  | 'night_silence'
  | 'vote_silence'
  | 'not_your_turn'
  | 'spectator'
  | 'lobby_speaker'
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

/**
 * 大厅 / 复盘（房间频道）的正式成员许可（Q-12）：对局前后的自由开麦。
 * 这两个相位不属于对局，R-43 的时段规则不适用，因此与 `voicePermission` 分开表达。
 */
export const LOBBY_SPEAKER_PERMISSION: VoicePermission = { canPublish: true, reason: 'lobby_speaker' };

/**
 * 房间级语音许可汇总（Q-12）：**服务端所有判定都必须走这里**，避免出现第二份口径。
 * - 大厅 / 复盘：正式成员自由开麦（观众与第二屏只听）；与对局的生死、时段无关。
 * - 对局内：逐字转交 `voicePermission(state, playerId)`（R-43 / Q-11 口径不变）。
 */
export function roomVoicePermission(input: {
  phase: 'lobby' | 'playing' | 'review';
  formal: boolean;
  state: GameState | null;
  playerId: string | null;
}): VoicePermission {
  if (input.phase !== 'playing') {
    return input.formal ? LOBBY_SPEAKER_PERMISSION : SPECTATOR_PERMISSION;
  }
  if (input.state === null || input.playerId === null) {
    return { canPublish: false, reason: 'game_not_started' };
  }
  return voicePermission(input.state, input.playerId);
}

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
  if (day?.speechPreparing) {
    return denied('preparing_speech');
  }
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
    // 白天「自由发言」（房主开启）：存活玩家可开麦；死者仍只能旁听。
    case 'free_speech': {
      if (player.life === 'dead') {
        return denied('dead_listener');
      }
      return granted();
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
