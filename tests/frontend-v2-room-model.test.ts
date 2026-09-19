import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CatalogDTO } from '../contracts/catalog.ts';
import type { DayDTO, Permission, RoomMemberDTO, RoomSnapshot, RoomAction } from '../contracts/v2.ts';
import type { RoleId } from '../rulesets/types.ts';
import { boardIssues, roleTotal } from '../web-v2/src/features/room/configuration.ts';
import { canManageMember, memberLabel } from '../web-v2/src/features/room/policy.ts';
import { formatCountdown, publicPhaseLabel } from '../web-v2/src/presentation/labels.ts';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/contract-2.1/${name}`, import.meta.url), 'utf8')) as T;
}

const catalog = fixture<CatalogDTO>('catalog-full.json');
const lobby = fixture<RoomSnapshot>('lobby-formal-full.json');
const night = fixture<RoomSnapshot>('night-door-full.json');
const day = fixture<RoomSnapshot>('day-election-full.json');

function copy<T>(value: T): T {
  return structuredClone(value);
}

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`fixture item ${index} missing`);
  return item;
}

function hasIssue(roles: Record<RoleId, number>, text: string): void {
  expect(boardIssues(roles, catalog).some(issue => issue.includes(text))).toBe(true);
}

function permission(allowed: boolean, reason: string | null = null): Permission {
  return { allowed, reason };
}

function setRoomPermission(view: RoomSnapshot, action: RoomAction, value: Permission): void {
  view.capabilities.room[action] = value;
}

function dayView(): RoomSnapshot {
  const view = copy(day);
  view.room.phase = 'playing';
  view.public!.phase = 'day';
  return view;
}

function setDay(view: RoomSnapshot, changes: Partial<DayDTO>): void {
  view.public!.day = { ...view.public!.day!, ...changes };
}

describe('v2 room board configuration', () => {
  it('accepts the complete formal 13 role board and a valid experimental five-player board', () => {
    const formal = copy(lobby.room.config.roles);
    expect(roleTotal(formal)).toBe(13);
    expect(boardIssues(formal, catalog)).toEqual([]);

    const experimental = Object.fromEntries(catalog.roles.map(role => [role.roleId, 0])) as Record<RoleId, number>;
    experimental.civilian = 1;
    experimental.researcher = 1;
    experimental.death = 1;
    experimental.spirit = 1;
    experimental.door = 1;
    expect(roleTotal(experimental)).toBe(5);
    expect(boardIssues(experimental, catalog)).toEqual([]);
  });

  it('rejects malformed counts, unknown roles, required-role gaps, no神职, and more than 64 players', () => {
    const formal = copy(lobby.room.config.roles);
    hasIssue({ ...formal, civilian: 1.5 }, '须为非负整数');
    hasIssue({ ...formal, civilian: -1 }, '须为非负整数');

    const missingCivilian = { ...formal } as Partial<Record<RoleId, number>>;
    delete missingCivilian.civilian;
    hasIssue(missingCivilian as Record<RoleId, number>, '平民人数须为非负整数');
    hasIssue({ ...formal, mystery: 1 } as Record<RoleId, number>, '未知角色');
    hasIssue({ ...formal, researcher: 2 }, '最多一名');
    hasIssue({ ...formal, death: 0 }, '至少需要一名死神');
    hasIssue({ ...formal, laike: 0, door: 0, water: 0, descender: 0 }, '至少包含一种神职');
    hasIssue({ ...formal, civilian: 61 }, '玩家总数须在 5–64 人之间');
  });

  it('computes role totals from the supplied role map', () => {
    expect(roleTotal({ civilian: 2, spirit: 2, death: 1 } as Record<RoleId, number>)).toBe(5);
    expect(roleTotal({} as Record<RoleId, number>)).toBe(0);
  });
});

describe('v2 room member policy', () => {
  it('prevents self-management and requires an online formal target plus transfer capability', () => {
    const view = copy(lobby);
    const self = view.viewer.memberId;
    const formalTarget = at(view.room.formalMembers, 1);
    view.room.formalMembers[1] = { ...formalTarget, presence: 'online' };

    expect(canManageMember(view, 'kick', self)).toBe(false);
    expect(canManageMember(view, 'transfer-host', self)).toBe(false);
    expect(canManageMember(view, 'transfer-host', formalTarget.memberId)).toBe(true);

    view.room.formalMembers[1] = { ...formalTarget, presence: 'offline' };
    expect(canManageMember(view, 'transfer-host', formalTarget.memberId)).toBe(false);
    setRoomPermission(view, 'transferHost', permission(false, 'not_host'));
    view.room.formalMembers[1] = { ...formalTarget, presence: 'online' };
    expect(canManageMember(view, 'transfer-host', formalTarget.memberId)).toBe(false);
    expect(canManageMember(view, 'transfer-host', 'missing-member')).toBe(false);
  });

  it('uses formal and spectator kick capabilities independently of the host flag', () => {
    const view = copy(lobby);
    view.viewer.isHost = false;
    const formalTarget = at(view.room.formalMembers, 1);
    view.room.formalMembers[1] = { ...formalTarget, presence: 'offline' };
    const spectator: RoomMemberDTO = { ...formalTarget, userId: 'spectator-user', uid: '10000020', nickname: '观众', memberId: 'spectator-member', kind: 'public_spectator', playerId: null, ready: null, presence: 'online', isHost: false };
    view.room.spectators = [spectator];

    setRoomPermission(view, 'kickFormal', permission(true));
    setRoomPermission(view, 'kickSpectator', permission(false, 'not_host'));
    expect(canManageMember(view, 'kick', formalTarget.memberId)).toBe(true);
    expect(canManageMember(view, 'kick', spectator.memberId)).toBe(false);

    setRoomPermission(view, 'kickFormal', permission(false, 'not_host'));
    setRoomPermission(view, 'kickSpectator', permission(true));
    expect(canManageMember(view, 'kick', formalTarget.memberId)).toBe(false);
    expect(canManageMember(view, 'kick', spectator.memberId)).toBe(true);
  });

  it('labels self and host identity without inferring management permission', () => {
    const self = at(lobby.room.formalMembers, 0);
    const otherHost: RoomMemberDTO = { ...self, userId: 'other-host-user', uid: '10000021', memberId: 'other-host-member', nickname: '房主二号', isHost: true };
    const ordinary: RoomMemberDTO = { ...self, userId: 'ordinary-user', uid: '10000022', memberId: 'ordinary-member', nickname: '普通玩家', isHost: false };
    expect(memberLabel(self, lobby.viewer.userId)).toBe('httpusera（你） · 房主');
    expect(memberLabel(otherHost, lobby.viewer.userId)).toBe('房主二号 · 房主');
    expect(memberLabel(ordinary, lobby.viewer.userId)).toBe('普通玩家');
  });
});

describe('v2 public room labels and countdowns', () => {
  it('keeps the night title public despite private role and window/task changes', () => {
    const view = copy(night);
    expect(publicPhaseLabel(view)).toBe('夜幕降临');
    view.private = null;
    view.windows = [];
    view.tasks = [];
    expect(publicPhaseLabel(view)).toBe('夜幕降临');
    view.private = copy(night.private);
    view.private!.self.roleId = 'death';
    view.tasks = copy(night.tasks);
    expect(publicPhaseLabel(view)).toBe('夜幕降临');
  });

  it('labels lobby and every public day step, including preparation, ties, and revote', () => {
    expect(publicPhaseLabel(copy(lobby))).toBe('等待开场');
    const playing = dayView();
    expect(publicPhaseLabel(playing)).toBe('天理竞选 · 报名');

    setDay(playing, { election: { ...playing.public!.day!.election!, phase: 'speech' }, speechPreparing: true });
    expect(publicPhaseLabel(playing)).toBe('竞选发言 · 准备');
    setDay(playing, { speechPreparing: false });
    expect(publicPhaseLabel(playing)).toBe('天理竞选 · 发言');
    setDay(playing, { election: { ...playing.public!.day!.election!, phase: 'vote' } });
    expect(publicPhaseLabel(playing)).toBe('天理竞选 · 投票');
    setDay(playing, { election: { ...playing.public!.day!.election!, phase: 'revote' } });
    expect(publicPhaseLabel(playing)).toBe('天理竞选 · 投票');
    setDay(playing, { election: { ...playing.public!.day!.election!, phase: 'done' } });
    expect(publicPhaseLabel(playing)).toBe('天理竞选');

    for (const [step, expected] of [
      ['morning_announcement', '晨间公告'], ['first_night_last_words', '首夜遗言'],
      ['elimination_last_words', '放逐遗言'], ['handover', '天理移交'], ['settle', '等待结算'],
    ] as const) {
      setDay(playing, { step });
      expect(publicPhaseLabel(playing)).toBe(expected);
    }

    setDay(playing, { step: 'speech_round', speechPreparing: true });
    expect(publicPhaseLabel(playing)).toBe('发言准备');
    setDay(playing, { speechPreparing: false });
    expect(publicPhaseLabel(playing)).toBe('白天讨论');

    const ballot = { phase: 'vote' as const, round: 1 as const, votedCount: 0, eligibleCount: 13, tiedIds: [], eliminatedId: null };
    setDay(playing, { step: 'vote', ballot });
    expect(publicPhaseLabel(playing)).toBe('放逐投票');
    setDay(playing, { ballot: { ...ballot, phase: 'tie_speech' } });
    expect(publicPhaseLabel(playing)).toBe('平票发言');
    setDay(playing, { ballot: { ...ballot, phase: 'revote' } });
    expect(publicPhaseLabel(playing)).toBe('放逐重投');
  });

  it('rounds positive countdowns upward and uses settlement text at zero', () => {
    expect(formatCountdown(null)).toBe('同步中');
    expect(formatCountdown(-1)).toBe('等待结算');
    expect(formatCountdown(0)).toBe('等待结算');
    expect(formatCountdown(1)).toBe('00:01');
    expect(formatCountdown(999)).toBe('00:01');
    expect(formatCountdown(1_000)).toBe('00:01');
    expect(formatCountdown(1_001)).toBe('00:02');
    expect(formatCountdown(60_000)).toBe('01:00');
    expect(formatCountdown(3_661_001)).toBe('61:02');
  });
});
