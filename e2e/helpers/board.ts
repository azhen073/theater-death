// 实验模式测试板：角色配置与正式板一致，仅缩短各窗口时限以加速端到端用例。
// 正式板（真实时长）的完整日夜循环由 capacity.mjs 用默认板覆盖。

interface Board {
  rulesetId: string;
  version: string;
  mode: 'experimental';
  roles: Record<string, number>;
  timersSeconds: Record<string, number>;
  sheriff: { enabled: boolean; voteWeight: number; handover: string };
  lastWords: { firstNight: boolean; dayEliminated: boolean; otherNights: boolean };
  teamConfirm: string;
  duplicateTargetPolicy: string;
  attackOrder: string;
  researcherAnnouncement: { count: string; includesMourner: boolean };
  stageTriggerSnapshot: string;
  replayDisclosure: string;
  stage1SpiritQuota: string;
  stage1DeathQuota: number;
  stage1OverkillThreshold: string;
  stage2JointQuota: number;
  guardTargets: number;
  guardBlocksPerTarget: number;
  simultaneousWinPriority: string;
  researcherCondition: string;
}

const ROLES = {
  laike: 1,
  door: 1,
  water: 1,
  descender: 1,
  researcher: 1,
  civilian: 4,
  death: 1,
  spirit: 2,
  mourner: 1,
} as const;

const SHARED = {
  roles: ROLES,
  sheriff: { enabled: true, voteWeight: 1.5, handover: 'designate_or_destroy' },
  lastWords: { firstNight: true, dayEliminated: true, otherNights: false },
  teamConfirm: 'unanimous_by_revision',
  duplicateTargetPolicy: 'allow',
  attackOrder: 'seat_asc_then_source_priority',
  researcherAnnouncement: { count: 'alive_at_announcement', includesMourner: true },
  stageTriggerSnapshot: 'death_event',
  replayDisclosure: 'all_chat_and_action_log',
  stage1SpiritQuota: 'eligibleLivingSpiritCount',
  stage1DeathQuota: 2,
  stage1OverkillThreshold: 'initialSpiritCount',
  stage2JointQuota: 2,
  guardTargets: 2,
  guardBlocksPerTarget: 1,
  simultaneousWinPriority: 'death_faction',
  researcherCondition: 'currently_dead',
} as const;

function board(rulesetId: string, timers: Board['timersSeconds']): Board {
  return {
    rulesetId,
    version: '1.0',
    mode: 'experimental',
    ...SHARED,
    timersSeconds: timers,
  };
}

/** 流程类用例：所有窗口尽量短（浏览器操作余量内）。 */
export const FAST_BOARD = board('e2e-fast', {
  faction: 10,
  ability: 6,
  vote: 8,
  speech: 12,
  election: 10,
  handover: 8,
  lastWords: 8,
  tieSpeech: 8,
});

/** 语音类用例：发言/竞选窗口加长，覆盖开麦、发布重试与权限收回。 */
export const VOICE_BOARD = board('e2e-voice', {
  faction: 15,
  ability: 10,
  vote: 15,
  speech: 30,
  election: 15,
  handover: 10,
  lastWords: 15,
  tieSpeech: 12,
});
