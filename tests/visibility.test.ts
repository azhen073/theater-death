import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../engine/events.ts';
import { resolveMorning } from '../engine/morning.ts';
import {
  rescueSelectionIssue,
  resolveAttackPhase,
  resolveDescenderCheck,
  resolveNightEnd,
  resolveRescue,
  startNight,
} from '../engine/night.ts';
import { createGame } from '../engine/setup.ts';
import type { GameState } from '../engine/types.ts';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import {
  buildPlayerView,
  canPostPublic,
  canReadRoomMessage,
  isVisibleTo,
  roomMembership,
  toClientError,
  viewerContext,
} from '../visibility/index.ts';
import { overrideLife, runNight, scenario } from './helpers.ts';

function playedNight(): { state: GameState; events: GameEvent[] } {
  const first = startNight(scenario());
  const attack = resolveAttackPhase(first.state, {
    guardTargetIds: ['p_6'],
    stage1DeathTargetIds: ['p_5'],
    stage1SpiritTargetIds: ['p_6'],
    stage2JointTargetIds: [],
    laikeTargetId: null,
  });
  const check = resolveDescenderCheck(attack.state, 'p_4', 'p_11');
  const rescue = resolveRescue(check.state, null);
  const nightEnd = resolveNightEnd(rescue.state);
  return {
    state: nightEnd.state,
    events: [
      ...first.events,
      ...attack.events,
      ...check.events,
      ...rescue.events,
      ...nightEnd.events,
    ],
  };
}

describe('事件投递（需求 §07）', () => {
  it('服务端事件永不投递；定向事件只投给名单内玩家', () => {
    const { state, events } = playedNight();
    const civilian = viewerContext(state, 'p_6');
    const descender = viewerContext(state, 'p_4');
    const water = viewerContext(state, 'p_3');
    if (civilian === null || descender === null || water === null) {
      throw new Error('视角玩家不存在');
    }

    const attackEvents = events.find((event) => event.type === 'attack_events');
    const dyingList = events.find((event) => event.type === 'dying_list');
    const checkResult = events.find((event) => event.type === 'descender_check_result');
    if (attackEvents === undefined || dyingList === undefined || checkResult === undefined) {
      throw new Error('测试场景事件缺失');
    }

    expect(isVisibleTo(attackEvents, civilian)).toBe(false);
    expect(isVisibleTo(attackEvents, descender)).toBe(false);

    expect(isVisibleTo(dyingList, civilian)).toBe(false);
    expect(isVisibleTo(dyingList, descender)).toBe(true);
    expect(isVisibleTo(dyingList, water)).toBe(true);

    expect(isVisibleTo(checkResult, descender)).toBe(true);
    expect(isVisibleTo(checkResult, civilian)).toBe(false);
  });

  it('死者保留生前获得的个人知识，不因死亡被过滤', () => {
    const { state, events } = playedNight();
    const checkResult = events.find((event) => event.type === 'descender_check_result');
    if (checkResult === undefined) {
      throw new Error('测试场景事件缺失');
    }
    const descenderDead = overrideLife(state, 'p_4', 'dead');
    const viewer = viewerContext(descenderDead, 'p_4');
    if (viewer === null) {
      throw new Error('视角玩家不存在');
    }
    expect(isVisibleTo(checkResult, viewer)).toBe(true);

    const view = buildPlayerView({ state: descenderDead, events, playerId: 'p_4' });
    expect(view.personalEvents.map((event) => event.type)).toContain('descender_check_result');
  });
});

describe('对外事件流游标（需求 §07 侧信道）', () => {
  it('公共流与个人流各自连续编号，不携带全局事件序号', () => {
    const { state, events } = playedNight();
    const view = buildPlayerView({ state, events, playerId: 'p_4' });

    view.publicEvents.forEach((event, index) => expect(event.cursor).toBe(index + 1));
    expect(view.publicEvents.map((event) => event.type)).toEqual(['night_started']);
    expect(Object.keys(view.publicEvents[0]).sort()).toEqual([
      'cursor',
      'dayNumber',
      'payload',
      'stage',
      'type',
    ]);

    view.personalEvents.forEach((event, index) => expect(event.cursor).toBe(index + 1));
    const personalTypes = view.personalEvents.map((event) => event.type);
    expect(personalTypes).toContain('dying_list');
    expect(personalTypes).toContain('descender_check_result');
    expect(personalTypes).not.toContain('attack_events');
    expect(personalTypes).not.toContain('night_deaths_confirmed');
  });
});

describe('交流权限（R-35 / T-31、T-33）', () => {
  it('T-31：魂灵死亡后房间可读、写入拒绝，回归后恢复', () => {
    const base = scenario();
    expect(roomMembership(base, 'p_11')?.canWrite).toBe(true);

    const spiritDead = overrideLife(base, 'p_11', 'dead');
    const membership = roomMembership(spiritDead, 'p_11');
    expect(membership?.readOnly).toBe(true);
    expect(membership?.canWrite).toBe(false);
    expect(canReadRoomMessage(spiritDead, 'p_11', 100)).toBe(true);

    const returned = overrideLife(spiritDead, 'p_11', 'alive');
    expect(roomMembership(returned, 'p_11')?.canWrite).toBe(true);
  });

  it('T-33：活人夜间不能发公屏；白天可以；死者白天也不能发', () => {
    expect(canPostPublic(scenario(), 'p_6')).toBe(false);

    const day = { ...scenario(), phase: 'day' as const };
    expect(canPostPublic(day, 'p_6')).toBe(true);
    expect(canPostPublic(overrideLife(day, 'p_7', 'dead'), 'p_7')).toBe(false);
    expect(roomMembership(day, 'p_11')?.canWrite).toBe(true);
  });
});

describe('阵营房越权反例（R-34、R-52 / T-47）', () => {
  it('平民与一阶段死神拿不到阵营房视图', () => {
    const stage1 = scenario();
    expect(roomMembership(stage1, 'p_6')).toBeNull();
    expect(roomMembership(stage1, 'p_10')).toBeNull();
    expect(buildPlayerView({ state: stage1, events: [], playerId: 'p_6' }).room).toBeNull();
    expect(buildPlayerView({ state: stage1, events: [], playerId: 'p_10' }).room).toBeNull();
  });

  it('二阶段死神加入后可读可写，视图成员含魂灵与死神；平民仍不可见', () => {
    const morning = runNight(scenario(), { stage1DeathTargetIds: ['p_5'] });
    const result = resolveMorning(morning);

    const deathRoom = roomMembership(result.state, 'p_10');
    expect(deathRoom).not.toBeNull();
    expect(deathRoom?.canWrite).toBe(true);
    expect(deathRoom?.readOnly).toBe(false);
    expect(deathRoom?.historyFromSeq).toBe(result.state.factionRoom.deathJoinedEventSeq);

    const deathView = buildPlayerView({
      state: result.state,
      events: result.events,
      playerId: 'p_10',
    });
    expect(deathView.room?.members.map((member) => member.seat)).toEqual([10, 11, 12]);

    expect(
      buildPlayerView({ state: result.state, events: result.events, playerId: 'p_6' }).room,
    ).toBeNull();
  });

  it('T-47 历史边界：死神看不到加入前的房间消息', () => {
    expect(canReadRoomMessage(scenario(), 'p_11', 1)).toBe(true);
    expect(canReadRoomMessage(scenario(), 'p_10', 1)).toBe(false);

    const morning = runNight(scenario(), { stage1DeathTargetIds: ['p_5'] });
    const result = resolveMorning(morning);
    const joinSeq = result.state.factionRoom.deathJoinedEventSeq;
    if (joinSeq === null) {
      throw new Error('死神未加入阵营房');
    }
    expect(canReadRoomMessage(result.state, 'p_10', joinSeq)).toBe(false);
    expect(canReadRoomMessage(result.state, 'p_10', joinSeq + 1)).toBe(true);
  });

  it('只读加入的死亡死神不能写房间', () => {
    const base = overrideLife(scenario(), 'p_10', 'dead');
    const morning = runNight(base, { stage1SpiritTargetIds: ['p_5'] });
    const result = resolveMorning(morning);
    const deathRoom = roomMembership(result.state, 'p_10');
    expect(deathRoom?.readOnly).toBe(true);
    expect(deathRoom?.canWrite).toBe(false);
  });
});

describe('泄漏检查与错误文案（需求 §07）', () => {
  it('平民视图中不含任何他人未公开身份', () => {
    const game = createGame({
      gameId: 'g_leak',
      ruleset: THEATER_DEATH_13,
      players: Array.from({ length: 13 }, (_, index) => ({
        playerId: `p_${index + 1}`,
        nickname: `玩家${index + 1}`,
      })),
      seed: 3,
    });
    const civilian = game.state.players.find((player) => player.roleId === 'civilian');
    if (civilian === undefined) {
      throw new Error('默认板缺少平民');
    }
    const view = buildPlayerView({
      state: game.state,
      events: game.events,
      playerId: civilian.playerId,
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('spirit');
    expect(serialized).not.toContain('mourner');
    expect(serialized).not.toContain('death_faction');
    expect(view.self.roleId).toBe('civilian');
    expect(view.personalEvents.map((event) => event.type)).toEqual(['role_assigned']);
    expect(view.room).toBeNull();
  });

  it('错误文案只解释自身限制，不泄露被守护等原因', () => {
    const night = startNight(scenario()).state;
    const issue = rescueSelectionIssue(night, 'p_6');
    if (issue === null) {
      throw new Error('预期选择非法');
    }
    const client = toClientError(issue);
    expect(client.code).toBe('target_not_dying');
    expect(client.message).not.toContain('守护');
    expect(client.message).not.toContain('门先生');
    expect(client.message).not.toContain('被保护');
  });

  it('未知玩家没有视图上下文', () => {
    expect(viewerContext(scenario(), 'nope')).toBeNull();
    expect(() =>
      buildPlayerView({ state: scenario(), events: [], playerId: 'nope' }),
    ).toThrow();
  });
});
