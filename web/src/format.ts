import type { RoleId } from './types.ts';

export const ROLE_NAMES: Record<RoleId, string> = {
  laike: '莱莱可',
  door: '门先生',
  water: '水妖',
  descender: '降临者',
  researcher: '科研员',
  civilian: '平民',
  death: '死神',
  spirit: '魂灵',
  mourner: '丧亲者',
};

export const ROLE_FACTIONS: Record<RoleId, 'human' | 'death_faction'> = {
  laike: 'human',
  door: 'human',
  water: 'human',
  descender: 'human',
  researcher: 'human',
  civilian: 'human',
  death: 'death_faction',
  spirit: 'death_faction',
  mourner: 'death_faction',
};

export const FACTION_NAMES: Record<string, string> = {
  human: '人类阵营',
  death_faction: '死神阵营',
};

export const ROLE_HINTS: Record<RoleId, string> = {
  laike: '阶段一：夜间窗口可刺杀一人；行动后翻牌、票权冻结。',
  door: '夜间窗口守护至多两名玩家（不可连续两夜同一人）。',
  water: '窗口开放时使用还魂曲（阶段一）或深海召回（阶段二）。',
  descender: '夜间窗口查验一人：阶段一验魂灵，阶段二验死神阵营。',
  researcher: '被公开时公告死神阵营存活人数。',
  civilian: '在白天讨论与投票中找出死神阵营。',
  death: '阵营协商确认方案后执行夜袭；与魂灵共享阶段二的行动。',
  spirit: '与死神协商夜袭方案。',
  mourner: '隐藏身份，协助死神阵营。',
};

export const WINDOW_LABELS: Record<string, string> = {
  guard: '守护',
  faction: '阵营协商',
  laike: '刺杀',
  check: '查验',
  rescue: '还魂曲',
  revive: '深海召回',
  last_words: '遗言',
  election_signup: '竞选报名',
  election_speech: '竞选发言',
  election_vote: '竞选投票',
  speech_order: '指定发言顺序',
  speech_round: '发言轮',
  vote: '放逐投票',
  tie_speech: '平票发言',
  handover: '天理移交',
};

export interface EventLabels {
  seat(seat: number): string;
  seats(seats: readonly number[]): string;
  player(playerId: string): string;
  players(playerIds: readonly string[]): string;
}

function record(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStrings(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

function asNumbers(value: unknown): number[] {
  return asArray(value).filter((item): item is number => typeof item === 'number');
}

function reasonText(reason: string | null): string {
  switch (reason) {
    case 'elected':
      return '已产生天理';
    case 'tie_again':
      return '再次平票';
    case 'no_votes':
      return '无人得票';
    case 'no_candidates':
      return '无人报名';
    case 'all_spirits_dead':
      return '魂灵全灭';
    case 'researcher_dead':
      return '科研员出局';
    default:
      return reason ?? '';
  }
}

function tallyText(value: unknown, labels: EventLabels): string {
  return asArray(value)
    .map((item) => {
      const entry = record(item);
      const seat = asNumber(entry.seat);
      const units = asNumber(entry.units) ?? 0;
      return seat === null ? null : `${labels.seat(seat)} ${units}票`;
    })
    .filter((text): text is string => text !== null)
    .join('，');
}

function votesText(value: unknown, labels: EventLabels): string {
  return asArray(value)
    .map((item) => {
      const entry = record(item);
      const voter = asNumber(entry.voterSeat);
      if (voter === null) {
        return null;
      }
      const target = asNumber(entry.targetSeat);
      const units = asNumber(entry.units) ?? 0;
      return `${labels.seat(voter)}→${target === null ? '弃权' : labels.seat(target)}(${units})`;
    })
    .filter((text): text is string => text !== null)
    .join('，');
}

/** 引擎事件 → 中文公告文本（未知事件保留类型名，复盘时间线同样使用） */
export function describeEvent(
  event: { type: string; payload: unknown },
  labels: EventLabels,
): string {
  const p = record(event.payload);
  switch (event.type) {
    case 'game_started':
      return `游戏开始（共 ${asArray(p.seats).length} 名玩家）`;
    case 'role_assigned': {
      const roleId = asString(p.roleId) as RoleId | null;
      const playerId = asString(p.playerId);
      const who = playerId === null ? '你' : labels.player(playerId);
      return `${who} 的身份：${roleId === null ? '未知' : (ROLE_NAMES[roleId] ?? roleId)}`;
    }
    case 'spirit_knowledge': {
      const seats = asNumbers(p.seats);
      return `魂灵同伴座位：${seats.length === 0 ? '无' : labels.seats(seats)}`;
    }
    case 'night_started':
      return `第 ${asNumber(p.nightNumber) ?? '?'} 夜开始（阶段 ${asNumber(p.stage) ?? '?'}）`;
    case 'attack_events': {
      const attacks = asArray(p.attacks)
        .map((item) => {
          const attack = record(item);
          const sourceRole = asString(attack.sourceRoleId);
          const target = asString(attack.targetPlayerId);
          const blocked = attack.blocked === true;
          return `${sourceRole === null ? '?' : (ROLE_NAMES[sourceRole as RoleId] ?? sourceRole)}→${
            target === null ? '?' : labels.player(target)
          }${blocked ? '（被挡）' : ''}`;
        })
        .join('，');
      return `夜袭明细：${attacks}`;
    }
    case 'guard_sacrifice':
      return `门先生为守护目标牺牲（守护：${labels.players(asStrings(p.targets))}）`;
    case 'dying_list':
      return `本夜濒死名单：${labels.seats(asNumbers(p.seats))}`;
    case 'descender_check_result': {
      const target = asString(p.targetPlayerId);
      const kind = asString(p.kind);
      return `查验 ${target === null ? '?' : labels.player(target)}：${
        kind === 'is_spirit' ? '是否为魂灵' : '是否属于死神阵营'
      } → ${p.answer === true ? '是' : '否'}`;
    }
    case 'rescue_applied': {
      const target = asString(p.targetPlayerId);
      return `还魂曲生效：${target === null ? '?' : labels.player(target)} 免于死亡`;
    }
    case 'rescue_declined':
      return '水妖未使用还魂曲';
    case 'revive_selected': {
      const target = asString(p.targetPlayerId);
      return `深海召回目标：${target === null ? '?' : labels.player(target)}`;
    }
    case 'revive_announced': {
      const bySeat = asNumber(p.byWaterSeat);
      const targetSeat = asNumber(p.targetSeat);
      return `深海召回：${bySeat === null ? '水妖' : labels.seat(bySeat)} 召回 ${
        targetSeat === null ? '?' : labels.seat(targetSeat)
      }`;
    }
    case 'night_deaths_confirmed': {
      const seats = asArray(p.deaths)
        .map((item) => asNumber(record(item).seat))
        .filter((seat): seat is number => seat !== null);
      return `夜间死亡确认：${seats.length === 0 ? '无人死亡' : labels.seats(seats)}`;
    }
    case 'stage1_attack_disabled':
      return `一阶段袭击已关闭（本夜重叠死亡 ${asNumber(p.overlap) ?? '?'}，上限 ${asNumber(p.threshold) ?? '?'}）`;
    case 'deaths_announced':
      return `昨夜死亡：${labels.seats(asNumbers(p.seats))}`;
    case 'reveal_announced': {
      const reveals = asArray(p.reveals)
        .map((item) => {
          const entry = record(item);
          const playerId = asString(entry.playerId);
          const seat = asNumber(entry.seat);
          const roleId = asString(entry.roleId) as RoleId | null;
          const who =
            seat !== null ? labels.seat(seat) : playerId !== null ? labels.player(playerId) : '?';
          return `${who} 是 ${roleId === null ? '?' : (ROLE_NAMES[roleId] ?? roleId)}`;
        })
        .join('，');
      return `身份公开：${reveals}`;
    }
    case 'researcher_announcement':
      return `科研员公告：当前死神阵营存活 ${asNumber(p.count) ?? '?'} 人`;
    case 'stage_changed':
      return `舞台进入第二阶段（${reasonText(asString(p.reason))}）`;
    case 'door_returned': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '门先生' : labels.seat(seat)} 门先生回归`;
    }
    case 'faction_room_created': {
      const seats = asNumbers(p.memberSeats);
      return `阵营房建立（成员座位：${seats.length === 0 ? '无' : labels.seats(seats)}）`;
    }
    case 'faction_room_joined':
      return `你加入了阵营房${p.readOnly === true ? '（只读）' : ''}`;
    case 'last_words_started': {
      const seat = asNumber(p.seat);
      const scope = asString(p.scope);
      return `${seat === null ? '?' : labels.seat(seat)} 开始${scope === 'first_night' ? '首夜' : ''}遗言`;
    }
    case 'last_words_finished': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 遗言结束`;
    }
    case 'election_started':
      return '天理竞选开始：报名阶段';
    case 'candidacy_registered': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 报名竞选天理`;
    }
    case 'candidacy_withdrawn': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 退出竞选`;
    }
    case 'candidate_speech_started': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 竞选发言开始`;
    }
    case 'candidate_speech_finished': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 竞选发言结束`;
    }
    case 'election_vote_started':
      return `竞选投票开始（第 ${asNumber(p.round) ?? 1} 轮）`;
    case 'election_vote_progress':
      return `竞选投票进度：${asNumber(p.votedCount) ?? '?'}/${asNumber(p.eligibleCount) ?? '?'}`;
    case 'election_result': {
      const round = asNumber(p.round) ?? 1;
      const tally = tallyText(p.tally, labels);
      const votes = votesText(p.votes, labels);
      const winnerSeat = asNumber(p.winnerSeat);
      const tied = asNumbers(p.tiedSeats);
      const outcome =
        winnerSeat !== null
          ? `；${labels.seat(winnerSeat)} 当选`
          : tied.length > 0
            ? '；平票'
            : '；无人得票';
      return `竞选计票（第 ${round} 轮）：${tally.length === 0 ? '无有效票' : tally}${
        votes.length === 0 ? '' : `｜${votes}`
      }${outcome}`;
    }
    case 'election_revote_started':
      return `竞选平票重投：候选 ${labels.seats(asNumbers(p.seats))}`;
    case 'election_finished': {
      const winnerSeat = asNumber(p.winnerSeat);
      return winnerSeat !== null
        ? `竞选结束：${labels.seat(winnerSeat)} 当选天理`
        : `竞选结束：未产生天理（${reasonText(asString(p.reason))}）`;
    }
    case 'sheriff_elected': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 当选天理`;
    }
    case 'speech_order_pending': {
      const sheriffSeat = asNumber(p.sheriffSeat);
      return `等待天理指定发言顺序${sheriffSeat === null ? '' : `（天理：${labels.seat(sheriffSeat)}）`}`;
    }
    case 'speech_round_started': {
      const seat = asNumber(p.startSeat);
      return `发言开始：从 ${seat === null ? '?' : labels.seat(seat)} ${p.direction === 'asc' ? '升序' : '降序'}`;
    }
    case 'speech_turn_started': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 发言开始`;
    }
    case 'speech_turn_finished': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 发言结束`;
    }
    case 'day_vote_started':
      return `放逐投票开始（第 ${asNumber(p.round) ?? 1} 轮）`;
    case 'vote_progress':
      return `放逐投票进度：${asNumber(p.votedCount) ?? '?'}/${asNumber(p.eligibleCount) ?? '?'}`;
    case 'vote_result': {
      const round = asNumber(p.round) ?? 1;
      const tally = tallyText(p.tally, labels);
      const votes = votesText(p.votes, labels);
      const eliminatedSeat = asNumber(p.eliminatedSeat);
      const tied = asNumbers(p.tiedSeats);
      const outcome =
        eliminatedSeat !== null
          ? `；${labels.seat(eliminatedSeat)} 被放逐`
          : tied.length > 0
            ? '；平票进入发言'
            : '；无人出局';
      return `放逐计票（第 ${round} 轮）：${tally.length === 0 ? '无有效票' : tally}${
        votes.length === 0 ? '' : `｜${votes}`
      }${outcome}`;
    }
    case 'tie_speech_started':
      return `平票发言：${labels.seats(asNumbers(p.seats))}`;
    case 'tie_speech_turn_started': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 平票发言开始`;
    }
    case 'tie_speech_turn_finished': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 平票发言结束`;
    }
    case 'revote_started':
      return `平票重投：候选 ${labels.seats(asNumbers(p.seats))}`;
    case 'elimination_announced': {
      const seat = asNumber(p.seat);
      return `${seat === null ? '?' : labels.seat(seat)} 被放逐出局`;
    }
    case 'sheriff_handover_started': {
      const seat = asNumber(p.fromSeat);
      return `天理移交开始（卸任天理：${seat === null ? '?' : labels.seat(seat)}）`;
    }
    case 'sheriff_handover': {
      const fromSeat = asNumber(p.fromSeat);
      const heirSeat = asNumber(p.heirSeat);
      return `天理移交：${fromSeat === null ? '?' : labels.seat(fromSeat)} → ${
        heirSeat === null ? '销毁' : labels.seat(heirSeat)
      }`;
    }
    case 'day_ended':
      return `第 ${asNumber(p.dayNumber) ?? '?'} 天结束，入夜`;
    case 'game_ended': {
      const winner = asString(p.winner);
      return `游戏结束：${FACTION_NAMES[winner ?? ''] ?? winner ?? '?'}胜利——${asString(p.reason) ?? ''}`;
    }
    default:
      return `［${event.type}］`;
  }
}

export function formatClock(at: number): string {
  const date = new Date(at);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatRemain(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function phaseLabel(phase: string, dayNumber: number, stage: number): string {
  switch (phase) {
    case 'night':
      return `第 ${dayNumber} 夜 · 阶段${stage}`;
    case 'morning':
      return `第 ${dayNumber} 天 · 拂晓`;
    case 'day':
      return `第 ${dayNumber} 天 · 阶段${stage}`;
    case 'ended':
      return '对局结束';
    default:
      return phase;
  }
}
