import { describe, expect, it } from 'vitest';
import {
  beginDay,
  currentLastWordsSpeaker,
} from '../engine/day.ts';
import { makeEvent } from '../engine/events.ts';
import type { GameState } from '../engine/types.ts';
import { createFakeClock } from '../server/clock.ts';
import { createDayDriver } from '../server/day-driver.ts';
import { createNightDriver, type NightStepResult } from '../server/night-driver.ts';
import { Room, type RoomMember } from '../server/rooms.ts';
import { gameView } from '../server/v2/view.ts';
import { THEATER_DEATH_13_V2 } from '../rulesets/theater-death-13-v2.ts';
import { scenario } from './helpers.ts';

function startFirstNight(deadBefore: readonly string[] = [], nightDeaths: readonly string[] = []) {
  const clock = createFakeClock();
  const steps: NightStepResult[] = [];
  const base = scenario();
  const initial: GameState = {
    ...base,
    ruleset: THEATER_DEATH_13_V2,
    players: base.players.map((player) =>
      deadBefore.includes(player.playerId) ? { ...player, life: 'dead' as const } : player,
    ),
  };
  const driver = createNightDriver({ clock, onStep: (step) => steps.push(step) });
  driver.start(initial);
  if (nightDeaths.length > 0) {
    driver.submit({ type: 'EDIT_PROPOSAL', playerId: 'p_10', targets: nightDeaths });
    driver.submit({ type: 'CONFIRM_PROPOSAL', playerId: 'p_10', revision: 1 });
  }
  clock.advance(90_000);
  clock.advance(45_000);
  const state = driver.snapshot();
  if (state === null) throw new Error('首夜未完成');
  return { clock, state, steps };
}

function electionDriver(state: GameState) {
  const clock = createFakeClock();
  const steps: Array<{ state: GameState; events: readonly ReturnType<typeof makeEvent>[] }> = [];
  const driver = createDayDriver({
    clock,
    onStep: (step) => steps.push(step),
  });
  driver.start(state);
  return { clock, driver, steps };
}

function eligibleIds(state: GameState): readonly string[] {
  return state.night?.eligibleAtStart ?? state.players.map((player) => player.playerId);
}

describe('v2 首日预公告竞选', () => {
  it('首夜实际死亡者仍可报名、被投票并当选；候选本人不得投票；竞选完成后才公告死讯，再进入遗言', () => {
    const firstNight = startFirstNight([], ['p_6']);
    const { clock, driver, steps } = electionDriver(firstNight.state);

    expect(firstNight.state.preAnnouncementElection).toBe(true);
    expect(driver.snapshot()?.day?.step).toBe('election');
    expect(driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_6' }).accepted).toBe(true);
    clock.advance(30_000);
    clock.advance(135_000);
    expect(driver.snapshot()?.day?.election?.phase).toBe('vote');
    expect(driver.submit({ type: 'SUBMIT_ELECTION_VOTE', playerId: 'p_6', targetId: 'p_6' }).code).toBe('vote_forbidden_candidate');

    for (const voterId of eligibleIds(firstNight.state)) {
      if (voterId === 'p_6') continue;
      expect(driver.submit({ type: 'SUBMIT_ELECTION_VOTE', playerId: voterId, targetId: 'p_6' }).accepted).toBe(true);
    }

    const events = steps.flatMap((step) => step.events);
    const elected = events.findIndex((event) => event.type === 'election_finished');
    const deaths = events.findIndex((event) => event.type === 'deaths_announced');
    expect(driver.snapshot()?.sheriff.holderId).toBe('p_6');
    expect(elected).toBeGreaterThanOrEqual(0);
    expect(deaths).toBeGreaterThan(elected);
    expect(currentLastWordsSpeaker(driver.snapshot() as GameState)).toBe('p_6');
  });

  it('无人报名时首日只完成一次竞选，随后公告死讯并进入遗言', () => {
    const firstNight = startFirstNight([], ['p_6']);
    const { clock, driver, steps } = electionDriver(firstNight.state);

    clock.advance(30_000);

    const events = steps.flatMap((step) => step.events);
    expect(events.filter((event) => event.type === 'election_started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'election_finished')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'deaths_announced')).toHaveLength(1);
    expect(currentLastWordsSpeaker(driver.snapshot() as GameState)).toBe('p_6');
  });

  it('首日竞选平票重投仍按入夜快照保留资格（候选除外）', () => {
    const firstNight = startFirstNight();
    const { clock, driver, steps } = electionDriver(firstNight.state);
    expect(driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_6' }).accepted).toBe(true);
    expect(driver.submit({ type: 'REGISTER_CANDIDACY', playerId: 'p_7' }).accepted).toBe(true);
    clock.advance(30_000);
    clock.advance(270_000);
    expect(driver.snapshot()?.day?.election?.phase).toBe('vote');

    const voters = eligibleIds(firstNight.state).filter((voterId) => voterId !== 'p_6' && voterId !== 'p_7');
    expect(voters).toHaveLength(11);
    for (const [index, voterId] of voters.entries()) {
      const targetId = index === 0 ? 'p_6' : index === 1 ? 'p_7' : null;
      expect(driver.submit({ type: 'SUBMIT_ELECTION_VOTE', playerId: voterId, targetId }).accepted).toBe(true);
    }

    const revote = driver.snapshot()?.day?.election;
    expect(revote?.phase).toBe('revote');
    expect(revote?.round).toBe(2);
    expect(revote?.tiedIds).toEqual(['p_6', 'p_7']);
    const revoteEvent = steps.flatMap((step) => step.events).find((event) => event.type === 'election_revote_started');
    expect(revoteEvent?.payload).toMatchObject({ seats: [6, 7], eligibleSeats: [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13] });
  });

  it('首晨已达到胜负条件时仍先完成竞选，再晨间立即终局且无遗言', () => {
    const firstNight = startFirstNight(['p_1', 'p_2', 'p_3', 'p_4', 'p_5']);
    const { clock, driver, steps } = electionDriver(firstNight.state);
    clock.advance(30_000);

    const events = steps.flatMap((step) => step.events);
    const electionFinished = events.findIndex((event) => event.type === 'election_finished');
    const ended = events.findIndex((event) => event.type === 'game_ended');
    expect(driver.snapshot()?.phase).toBe('ended');
    expect(driver.snapshot()?.day).toBeNull();
    expect(electionFinished).toBeGreaterThanOrEqual(0);
    expect(ended).toBeGreaterThan(electionFinished);
    expect(events.some((event) => event.type === 'last_words_started')).toBe(false);
  });

  it('预公告竞选的 gameView 不泄露夜死状态或竞选票型名单', () => {
    const firstNight = startFirstNight([], ['p_6']);
    const begun = beginDay(firstNight.state);
    const host: RoomMember = { playerId: 'p_1', nickname: '玩家1', ready: true, joinedAt: 0 };
    const room = new Room('FIRST01', 'g_first_view', host, THEATER_DEATH_13_V2);
    room.state = begun.state;
    room.events = [
      ...firstNight.steps.flatMap((step) => step.events),
      ...begun.events,
      makeEvent({
        seq: 999,
        dayNumber: 1,
        stage: 1,
        type: 'election_vote_progress',
        payload: { votedCount: 1, eligibleCount: 11 },
        visibility: { kind: 'public' },
      }),
    ];

    const view = gameView(room, { subjectPlayerId: null, readOnly: true }, 0);
    expect(view.public.seats?.find((seat) => seat.playerId === 'p_6')?.alive).toBe(true);
    expect(view.public.events?.some((event) => event.type === 'deaths_announced')).toBe(false);
    expect(view.public.events?.some((event) => 'votes' in (event.payload as object))).toBe(false);
  });
});
