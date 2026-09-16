import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../engine/events.ts';
import { resolveMorning } from '../engine/morning.ts';
import { descenderCheckIssue, resolveDescenderCheck, startNight } from '../engine/night.ts';
import { createGame } from '../engine/setup.ts';
import type { GameState } from '../engine/types.ts';
import { THEATER_DEATH_13 } from '../rulesets/theater-death-13.ts';
import { overrideLife, playerIdAt, runNight, scenario } from './helpers.ts';

function createDefaultGame(seed = 3) {
  return createGame({
    gameId: 'g_info',
    ruleset: THEATER_DEATH_13,
    players: Array.from({ length: 13 }, (_, index) => ({
      playerId: `p_${index + 1}`,
      nickname: `玩家${index + 1}`,
    })),
    seed,
  });
}

function visibleTo(events: readonly GameEvent[], playerId: string): GameEvent[] {
  return events.filter(
    (event) =>
      event.visibility.kind === 'public' ||
      (event.visibility.kind === 'players' && event.visibility.playerIds.includes(playerId)),
  );
}

describe('开局身份知识（R-27、R-30、R-31 / T-30）', () => {
  it('T-30：魂灵名单只发给魂灵、死神与丧亲者，不含身份细节', () => {
    const { state, events } = createDefaultGame();
    const spirits = state.players.filter((player) => player.roleId === 'spirit');
    const death = state.players.find((player) => player.roleId === 'death');
    const mourner = state.players.find((player) => player.roleId === 'mourner');
    expect(death).toBeDefined();
    expect(mourner).toBeDefined();

    const knowledge = events.find((event) => event.type === 'spirit_knowledge');
    expect(knowledge).toBeDefined();
    const payload = knowledge?.payload as { seats: readonly number[] };
    const spiritSeats = spirits.map((player) => player.seat).sort((left, right) => left - right);
    expect(payload.seats).toEqual(spiritSeats);
    expect(payload.seats).not.toContain(death?.seat);
    expect(payload.seats).not.toContain(mourner?.seat);

    expect(knowledge?.visibility.kind).toBe('players');
    if (knowledge?.visibility.kind === 'players') {
      expect(new Set(knowledge.visibility.playerIds)).toEqual(
        new Set([...spirits.map((player) => player.playerId), death?.playerId, mourner?.playerId]),
      );
    }
  });

  it('T-30：死神与丧亲者互不知晓；平民没有额外知识', () => {
    const { state, events } = createDefaultGame();
    const death = state.players.find((player) => player.roleId === 'death');
    const mourner = state.players.find((player) => player.roleId === 'mourner');
    const civilian = state.players.find((player) => player.roleId === 'civilian');
    if (death === undefined || mourner === undefined || civilian === undefined) {
      throw new Error('默认板缺少角色');
    }

    const deathTypes = new Set(visibleTo(events, death.playerId).map((event) => event.type));
    expect(deathTypes).toEqual(new Set(['game_started', 'role_assigned', 'spirit_knowledge']));

    const mournerTypes = new Set(visibleTo(events, mourner.playerId).map((event) => event.type));
    expect(mournerTypes).toEqual(new Set(['game_started', 'role_assigned', 'spirit_knowledge']));

    const civilianTypes = new Set(visibleTo(events, civilian.playerId).map((event) => event.type));
    expect(civilianTypes).toEqual(new Set(['game_started', 'role_assigned']));

    const deathRoleEvents = visibleTo(events, death.playerId).filter(
      (event) => event.type === 'role_assigned',
    );
    expect(deathRoleEvents).toHaveLength(1);
  });
});

describe('降临者查验（R-24 / T-29）', () => {
  it('T-29：一阶段问「是否魂灵」不混用角色与阵营', () => {
    const started = startNight(scenario()).state;
    const descenderId = playerIdAt(started, 4);
    const mournerId = playerIdAt(started, 13);
    const result = resolveDescenderCheck(started, descenderId, mournerId);
    const event = result.events[0];
    expect(event.type).toBe('descender_check_result');
    expect(event.visibility).toEqual({ kind: 'players', playerIds: [descenderId] });
    expect(event.payload).toEqual({
      nightNumber: 1,
      targetPlayerId: mournerId,
      targetSeat: 13,
      kind: 'is_spirit',
      answer: false,
    });
    expect(JSON.stringify(event.payload)).not.toContain('mourner');

    const spiritCheck = resolveDescenderCheck(
      startNight(scenario()).state,
      descenderId,
      playerIdAt(started, 11),
    );
    expect(spiritCheck.events[0].payload).toMatchObject({ kind: 'is_spirit', answer: true });
  });

  it('T-29：二阶段问「是否死神阵营」，丧亲者属于阵营但不是死神', () => {
    const stage2State: GameState = { ...scenario(), stage: 2, nightStage: 2 };
    const started = startNight(stage2State).state;
    const descenderId = playerIdAt(started, 4);

    const mournerCheck = resolveDescenderCheck(started, descenderId, playerIdAt(started, 13));
    expect(mournerCheck.events[0].payload).toMatchObject({
      kind: 'in_death_faction',
      answer: true,
    });

    const civilianCheck = resolveDescenderCheck(
      startNight(stage2State).state,
      descenderId,
      playerIdAt(started, 6),
    );
    expect(civilianCheck.events[0].payload).toMatchObject({
      kind: 'in_death_faction',
      answer: false,
    });
  });

  it('查验资格校验：非降临者、已死降临者、死者目标、重复查验', () => {
    const started = startNight(scenario()).state;
    const descenderId = playerIdAt(started, 4);
    expect(descenderCheckIssue(started, playerIdAt(started, 1), 'p_13')?.code).toBe('not_descender');
    expect(descenderCheckIssue(started, 'nope', 'p_13')?.code).toBe('not_descender');

    const deadDescender = overrideLife(started, descenderId, 'dead');
    expect(descenderCheckIssue(deadDescender, descenderId, 'p_13')?.code).toBe(
      'descender_unavailable',
    );

    const deadTarget = overrideLife(started, 'p_6', 'dead');
    expect(descenderCheckIssue(deadTarget, descenderId, 'p_6')?.code).toBe('target_dead');
    expect(descenderCheckIssue(started, descenderId, 'nope')?.code).toBe('unknown_target');

    const checked = resolveDescenderCheck(started, descenderId, 'p_13').state;
    expect(descenderCheckIssue(checked, descenderId, 'p_11')?.code).toBe('check_already_done');
  });

  it('濒死降临者仍可查验；查验次数每夜刷新', () => {
    const started = startNight(scenario()).state;
    const descenderId = playerIdAt(started, 4);
    const dying = overrideLife(started, descenderId, 'dying');
    expect(descenderCheckIssue(dying, descenderId, 'p_11')).toBeNull();

    const checked = resolveDescenderCheck(started, descenderId, 'p_13').state;
    const night2 = startNight({ ...checked, dayNumber: 2 }).state;
    expect(descenderCheckIssue(night2, descenderId, 'p_11')).toBeNull();
  });
});

describe('阵营房与死神加入（R-34、R-52 / T-47）', () => {
  it('开局建立阵营房，成员为魂灵且仅魂灵收到事件', () => {
    const { state, events } = createDefaultGame();
    const spirits = state.players.filter((player) => player.roleId === 'spirit');
    const created = events.find((event) => event.type === 'faction_room_created');
    expect(created).toBeDefined();
    expect(created?.payload).toEqual({
      roomId: 'faction_room',
      memberSeats: spirits.map((player) => player.seat).sort((left, right) => left - right),
    });
    if (created?.visibility.kind === 'players') {
      expect(new Set(created.visibility.playerIds)).toEqual(
        new Set(spirits.map((player) => player.playerId)),
      );
    }
    expect(state.factionRoom).toEqual({
      roomId: 'faction_room',
      deathJoinDecided: false,
      deathJoined: false,
      deathReadOnly: false,
      deathJoinedEventSeq: null,
    });
  });

  it('T-47：转二阶段且魂灵存活时，存活死神以可写成员加入', () => {
    const morning = runNight(scenario(), { stage1DeathTargetIds: ['p_5'] });
    const result = resolveMorning(morning);
    expect(result.state.stage).toBe(2);
    expect(result.state.factionRoom.deathJoinDecided).toBe(true);
    expect(result.state.factionRoom.deathJoined).toBe(true);
    expect(result.state.factionRoom.deathReadOnly).toBe(false);

    const joined = result.events.find((event) => event.type === 'faction_room_joined');
    expect(joined).toBeDefined();
    expect(joined?.visibility).toEqual({ kind: 'players', playerIds: ['p_10'] });
    expect(joined?.payload).toEqual({ roomId: 'faction_room', readOnly: false });
    expect(result.state.factionRoom.deathJoinedEventSeq).toBe(joined?.seq);
  });

  it('T-47：转二阶段时死神已死，则以只读成员加入', () => {
    const base = overrideLife(scenario(), 'p_10', 'dead');
    const morning = runNight(base, { stage1SpiritTargetIds: ['p_5'] });
    const result = resolveMorning(morning);
    expect(result.state.stage).toBe(2);
    expect(result.state.factionRoom.deathJoined).toBe(true);
    expect(result.state.factionRoom.deathReadOnly).toBe(true);
    expect(result.events.find((event) => event.type === 'faction_room_joined')?.payload).toEqual({
      roomId: 'faction_room',
      readOnly: true,
    });
  });

  it('T-47：魂灵全灭触发转换时不加入，此后不补拉', () => {
    const morning = runNight(scenario(), { stage1DeathTargetIds: ['p_11', 'p_12'] });
    const result = resolveMorning(morning);
    expect(result.state.stage).toBe(2);
    expect(result.state.factionRoom.deathJoinDecided).toBe(true);
    expect(result.state.factionRoom.deathJoined).toBe(false);
    expect(result.state.factionRoom.deathJoinedEventSeq).toBeNull();
    expect(result.events.find((event) => event.type === 'faction_room_joined')).toBeUndefined();
  });
});
