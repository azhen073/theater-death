export type RoleId =
  | 'laike'
  | 'door'
  | 'water'
  | 'descender'
  | 'researcher'
  | 'civilian'
  | 'death'
  | 'spirit'
  | 'mourner';

export const ROLE_IDS: readonly RoleId[] = [
  'laike',
  'door',
  'water',
  'descender',
  'researcher',
  'civilian',
  'death',
  'spirit',
  'mourner',
];

export type FactionId = 'human' | 'death_faction';

export type EliminationGroup = 'deity' | 'civilian' | 'researcher' | 'none';

export type RulesetMode = 'formal' | 'experimental';

export interface TimersSeconds {
  readonly speechPrepare?: number;
  readonly speechOrder?: number;
  readonly faction: number;
  readonly ability: number;
  readonly vote: number;
  readonly speech: number;
  readonly election: number;
  readonly handover: number;
  readonly lastWords: number;
  readonly tieSpeech: number;
}

export interface SheriffConfig {
  readonly enabled: boolean;
  readonly voteWeight: number;
  readonly handover: 'designate_or_destroy';
}

export interface LastWordsConfig {
  readonly firstNight: boolean;
  readonly dayEliminated: boolean;
  readonly otherNights: boolean;
}

export interface ResearcherAnnouncementConfig {
  readonly count: 'alive_at_announcement' | 'initial_total';
  readonly includesMourner: boolean;
}

export interface RulesetConfig {
  readonly rulesetId: string;
  readonly version: string;
  readonly mode: RulesetMode;
  readonly roles: Readonly<Record<RoleId, number>>;
  readonly timersSeconds: TimersSeconds;
  readonly sheriff: SheriffConfig;
  readonly lastWords: LastWordsConfig;
  readonly teamConfirm: 'unanimous_by_revision' | 'unanimous_or_latest';
  readonly duplicateTargetPolicy: 'allow' | 'forbid';
  readonly attackOrder: 'seat_asc_then_source_priority';
  readonly researcherAnnouncement: ResearcherAnnouncementConfig;
  readonly stageTriggerSnapshot: 'death_event' | 'final_state';
  readonly replayDisclosure: 'all_chat_and_action_log' | 'identities_only';
  readonly stage1SpiritQuota: 'eligibleLivingSpiritCount';
  readonly stage1DeathQuota: number;
  readonly stage1OverkillThreshold: 'initialSpiritCount';
  readonly stage2JointQuota: number;
  readonly guardTargets: number;
  readonly guardBlocksPerTarget: number;
  readonly simultaneousWinPriority: 'death_faction' | 'human';
  readonly researcherCondition: 'currently_dead';
}
