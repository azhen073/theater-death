import { DEITY_ROLE_IDS } from './roles.ts';
import { THEATER_DEATH_13 } from './theater-death-13.ts';
import { THEATER_DEATH_13_V2 } from './theater-death-13-v2.ts';
import { ROLE_IDS, type RoleId } from './types.ts';

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

export function validateRuleset(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string): void => {
    issues.push({ code, message });
  };

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ code: 'not_an_object', message: `配置必须是对象，收到 ${typeof input}` }],
    };
  }

  if (typeof input.rulesetId !== 'string' || input.rulesetId.length === 0) {
    add('invalid_ruleset_id', '缺少 rulesetId');
  }
  if (typeof input.version !== 'string' || input.version.length === 0) {
    add('invalid_version', '缺少 version');
  }
  if (input.mode !== 'formal' && input.mode !== 'experimental') {
    add('invalid_mode', `mode 必须是 formal 或 experimental，收到 ${String(input.mode)}`);
  }

  const roles = input.roles;
  if (!isRecord(roles)) {
    add('missing_roles', '缺少 roles 角色配置表');
  } else {
    for (const key of Object.keys(roles)) {
      if (!(ROLE_IDS as readonly string[]).includes(key)) {
        add('unknown_role', `未知角色 "${key}"：当前版本未定义该身份`);
      }
    }
    for (const roleId of ROLE_IDS) {
      if (!Object.hasOwn(roles, roleId)) {
        add('missing_role_entry', `角色 "${roleId}" 未定义；数量为 0 也必须显式写出`);
        continue;
      }
      if (!isNonNegativeInteger(roles[roleId])) {
        add('invalid_role_count', `角色 "${roleId}" 数量必须为非负整数，收到 ${String(roles[roleId])}`);
      }
    }
  }

  const countOf = (roleId: RoleId): number | null => {
    if (!isRecord(roles)) return null;
    const count = roles[roleId];
    return isNonNegativeInteger(count) ? count : null;
  };

  const sumOf = (ids: readonly RoleId[]): number | null => {
    let sum = 0;
    for (const id of ids) {
      const count = countOf(id);
      if (count === null) return null;
      sum += count;
    }
    return sum;
  };

  if (sumOf(DEITY_ROLE_IDS) === 0) {
    add('empty_deity_group', '神职数量为 0：屠边条件「所有神职死亡」会恒成立，禁止空神职开局');
  }
  if (countOf('civilian') === 0) {
    add('empty_civilian_group', '平民数量为 0：屠边条件「所有平民死亡」会恒成立，禁止空平民开局');
  }
  if (countOf('spirit') === 0) {
    add('zero_spirits', '魂灵数量为 0：一阶段触发条件「所有魂灵死亡」在开局即成立');
  }
  if (countOf('death') === 0) {
    add('missing_death_role', '死神数量为 0：默认板保底角色缺失，且胜利条件失去前提');
  }
  if (countOf('researcher') === 0) {
    add('researcher_condition_without_researcher', '没有科研员但保留其死亡胜利前置；当前版本没有无科研员的替代规则');
  }

  for (const roleId of ROLE_IDS) {
    const count = countOf(roleId);
    if (count !== null && count > 1 && roleId !== 'spirit' && roleId !== 'civilian') {
      add('duplicate_unsupported_role', `特殊角色 "${roleId}" 出现 ${count} 次；当前版本仅允许魂灵与平民重复`);
    }
  }

  const timers = input.timersSeconds;
  const TIMER_KEYS = ['faction', 'ability', 'vote', 'speech', 'election', 'handover', 'lastWords', 'tieSpeech'] as const;
  if (!isRecord(timers)) {
    add('missing_timers', '缺少 timersSeconds 时限配置');
  } else {
    for (const key of TIMER_KEYS) {
      if (!isPositiveNumber(timers[key])) {
        add('invalid_timer', `时限 "${key}" 必须为正数，收到 ${String(timers[key])}`);
      }
    }
    for (const key of ['speechPrepare', 'speechOrder']) if (timers[key] !== undefined && !isPositiveNumber(timers[key])) add('invalid_timer', `时限 ${key} 必须为正数`);
  }

  const sheriff = input.sheriff;
  if (!isRecord(sheriff)) {
    add('missing_sheriff', '缺少 sheriff 天理配置');
  } else {
    if (typeof sheriff.enabled !== 'boolean') {
      add('invalid_policy_value', `sheriff.enabled 必须为布尔值，收到 ${String(sheriff.enabled)}`);
    }
    if (!isPositiveNumber(sheriff.voteWeight)) {
      add('invalid_policy_value', `sheriff.voteWeight 必须为正数，收到 ${String(sheriff.voteWeight)}`);
    }
    if (sheriff.handover !== 'designate_or_destroy') {
      add('invalid_policy_value', `sheriff.handover 值非法：${String(sheriff.handover)}`);
    }
  }

  const lastWords = input.lastWords;
  if (!isRecord(lastWords)) {
    add('missing_last_words', '缺少 lastWords 遗言配置');
  } else {
    for (const key of ['firstNight', 'dayEliminated', 'otherNights'] as const) {
      if (typeof lastWords[key] !== 'boolean') {
        add('invalid_policy_value', `lastWords.${key} 必须为布尔值，收到 ${String(lastWords[key])}`);
      }
    }
  }

  const announcement = input.researcherAnnouncement;
  if (!isRecord(announcement)) {
    add('missing_researcher_announcement', '缺少 researcherAnnouncement 科研员公告配置');
  } else {
    if (announcement.count !== 'alive_at_announcement' && announcement.count !== 'initial_total') {
      add('invalid_policy_value', `researcherAnnouncement.count 值非法：${String(announcement.count)}`);
    }
    if (typeof announcement.includesMourner !== 'boolean') {
      add('invalid_policy_value', `researcherAnnouncement.includesMourner 必须为布尔值`);
    }
  }

  const policies: ReadonlyArray<readonly [unknown, readonly unknown[], string]> = [
    [input.teamConfirm, ['unanimous_by_revision', 'unanimous_or_latest'], 'teamConfirm'],
    [input.duplicateTargetPolicy, ['allow', 'forbid'], 'duplicateTargetPolicy'],
    [input.attackOrder, ['seat_asc_then_source_priority'], 'attackOrder'],
    [input.stageTriggerSnapshot, ['death_event', 'final_state'], 'stageTriggerSnapshot'],
    [input.replayDisclosure, ['all_chat_and_action_log', 'identities_only'], 'replayDisclosure'],
    [input.stage1SpiritQuota, ['eligibleLivingSpiritCount'], 'stage1SpiritQuota'],
    [input.stage1OverkillThreshold, ['initialSpiritCount'], 'stage1OverkillThreshold'],
    [input.simultaneousWinPriority, ['death_faction', 'human'], 'simultaneousWinPriority'],
    [input.researcherCondition, ['currently_dead'], 'researcherCondition'],
  ];
  for (const [value, allowed, name] of policies) {
    if (!allowed.includes(value)) {
      add('invalid_policy_value', `策略 "${name}" 值非法：${String(value)}`);
    }
  }

  const numericPolicies: ReadonlyArray<readonly [unknown, string, number]> = [
    [input.stage1DeathQuota, 'stage1DeathQuota', 0],
    [input.stage2JointQuota, 'stage2JointQuota', 0],
    [input.guardTargets, 'guardTargets', 1],
    [input.guardBlocksPerTarget, 'guardBlocksPerTarget', 1],
  ];
  for (const [value, name, min] of numericPolicies) {
    if (!isNonNegativeInteger(value) || value < min) {
      add('invalid_numeric_policy', `策略 "${name}" 必须为 >= ${min} 的整数，收到 ${String(value)}`);
    }
  }

  if (input.mode === 'formal' && !deepEqual(input, input.version === '2.0' ? THEATER_DEATH_13_V2 : THEATER_DEATH_13)) {
    add(
      'formal_preset_mismatch',
      '正式模式仅允许默认 13 人命名预设（R-54）；变体配置请使用实验模式并在大厅醒目提示',
    );
  }

  return { ok: issues.length === 0, issues };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && deepEqual(aRecord[key], bRecord[key]));
}
