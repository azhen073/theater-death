import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  advanceToNextWindow,
  authorizedViews,
  createSpecialRoomViaPage,
  loadSpecialAccounts,
  loginAndEnterSpecial,
  playerIdForRole,
  roleUsers,
  specialRoleBoard,
  submitAuthorized,
  submitTargetInBrowser,
  targetFor,
  taskFor,
} from '../helpers-v2/special-actions.ts';

type Session = { context: BrowserContext; page: Page };
type ActionRecord = Record<string, unknown> & { action: string; role: string; viaBrowser?: boolean };

function roleForUser(roles: Map<string, keyof typeof specialRoleBoard>, userId: string): keyof typeof specialRoleBoard {
  const role = roles.get(userId);
  if (!role) throw new Error(`missing role for ${userId}`);
  return role;
}

function userIdForRole(roles: Map<string, { index: number; userId: string; playerId: string }>, role: keyof typeof specialRoleBoard): string {
  const user = roles.get(role);
  if (!user) throw new Error(`missing ${role} role`);
  return user.userId;
}

function playerSeat(view: Record<string, any>, playerId: string): Record<string, any> {
  const seat = view.public?.seats?.find((item: Record<string, any>) => item.playerId === playerId);
  if (!seat) throw new Error(`player ${playerId} is absent from public seats`);
  return seat;
}

function recordAccepted(records: ActionRecord[], role: string, body: Record<string, unknown>, receipt: Record<string, any>, viaBrowser = false): void {
  expect(receipt.status).toBe('accepted');
  expect(receipt.requestId).toBe(body.requestId);
  records.push({ role, action: String(body.action), gameId: body.gameId, windowInstanceId: body.windowInstanceId, requestId: receipt.requestId, targets: body.targets ?? [], viaBrowser });
}

function roleMapFromViews(views: Array<Record<string, any>>): Map<string, string> {
  return new Map(views.map(view => [view.viewer.userId, String(view.private?.self?.roleId)]));
}

async function driveSpecialRound(
  requests: APIRequestContext[],
  sessions: Session[],
  code: string,
  clockSocket: string,
  roles: Map<keyof typeof specialRoleBoard, { index: number; userId: string; playerId: string }>,
  records: ActionRecord[],
): Promise<{ electionTie: boolean; electionWinner: boolean; firstRescue: boolean; ballotTie: boolean; ballotRevote: boolean; handover: boolean; revive: boolean }> {
  const roleByUser = new Map<string, keyof typeof specialRoleBoard>([...roles.entries()].map(([role, value]): [string, keyof typeof specialRoleBoard] => [value.userId, role]));
  const userFor = (role: keyof typeof specialRoleBoard) => userIdForRole(roles, role);
  const playerFor = (role: keyof typeof specialRoleBoard) => playerIdForRole(roles, role);
  const submitted = new Set<string>();
  let electionTie = false, electionWinner = false, firstRescue = false, ballotTie = false, ballotRevote = false, handover = false, revive = false;
  let dayOneRegistration = new Set<string>();
  let lastPublic: Record<string, any> | null = null;

  for (let iteration = 0; iteration < 520; iteration += 1) {
    const views = await authorizedViews(requests, code);
    const first = views[0]!;
    lastPublic = first;
    const nightCount = Number(first.public?.events?.filter((event: any) => event.type === 'night_started').length ?? 0);
    const publicEvents = first.public?.events ?? [];
    if (views.some(view => view.private?.events?.some((event: any) => event.type === 'rescue_applied'))) firstRescue = true;
    if (publicEvents.some((event: any) => event.type === 'election_revote_started')) electionTie = true;
    if (publicEvents.some((event: any) => event.type === 'tie_speech_started')) ballotTie = true;
    if (publicEvents.some((event: any) => event.type === 'vote_result' && event.payload?.round === 2)) ballotRevote = true;
    const researcherSeat = first.public?.seats?.find((seat: any) => seat.playerId === playerFor('researcher'))?.seat;
    const doorSeat = first.public?.seats?.find((seat: any) => seat.playerId === playerFor('door'))?.seat;
    if (first.public?.day?.election?.winnerId === playerFor('researcher') || first.public?.sheriff?.holderId === playerFor('researcher') || publicEvents.some((event: any) => (event.type === 'sheriff_elected' && event.payload?.seat === researcherSeat) || (event.type === 'election_finished' && event.payload?.winnerSeat === researcherSeat))) electionWinner = true;
    if ((first.public?.day?.handover?.resolved && first.public.day.handover.heirId === playerFor('door')) || publicEvents.some((event: any) => event.type === 'sheriff_handover' && event.payload?.heirSeat === doorSeat)) handover = true;
    if (publicEvents.some((event: any) => event.type === 'revive_announced')) revive = true;

    // The explicit acceptance must stop after water's second-stage revive is applied.
    if (revive) return { electionTie, electionWinner, firstRescue, ballotTie, ballotRevote, handover, revive };

    let acted = false;
    for (let index = 0; index < views.length; index += 1) {
      const view = views[index]!;
      const userId = view.viewer.userId;
      const role = roleForUser(roleByUser, userId) as keyof typeof specialRoleBoard;
      const page = sessions[index]!.page;
      const request = requests[index]!;
      const day = view.public?.day;
      const isNight = view.public?.phase === 'night';
      const actionTasks = (view.tasks ?? []).filter((task: Record<string, any>) => view.capabilities?.allowedCommands?.includes(task.action));
      for (const task of actionTasks) {
        const roundKey = `${userId}/${task.windowInstanceId}/${task.action}/${task.action === 'CONFIRM_PROPOSAL' ? (view.private?.proposal?.revision ?? 0) : task.action.includes('VOTE') ? (day?.election?.round ?? day?.ballot?.round ?? 1) : ''}`;
        if (submitted.has(roundKey)) continue;
        let targets: string[] | null = null;
        let extras: Record<string, unknown> = {};
        let shouldSubmit = false;
        let browser = false;

        if (task.action === 'SUBMIT_REVIVE' && role === 'water') {
          targets = [targetFor(view, task, playerFor('researcher'))]; shouldSubmit = true; browser = true;
        } else if (isNight) {
          if (nightCount <= 1 && task.action === 'SUBMIT_GUARD' && role === 'door') { targets = [targetFor(view, task, playerFor('laike'))]; shouldSubmit = true; }
          else if (nightCount <= 1 && task.action === 'SUBMIT_LAIKE' && role === 'laike') { targets = [targetFor(view, task, playerFor('researcher'))]; shouldSubmit = true; }
          else if (nightCount <= 1 && task.action === 'EDIT_PROPOSAL' && role === 'death') { targets = [targetFor(view, task, playerFor('civilian'))]; shouldSubmit = true; }
          else if (nightCount <= 1 && task.action === 'EDIT_PROPOSAL' && role === 'spirit') { targets = []; shouldSubmit = true; }
          else if (nightCount <= 1 && task.action === 'CONFIRM_PROPOSAL' && (role === 'death' || role === 'spirit') && Number(view.private?.proposal?.revision) > 0) { extras.revision = view.private.proposal.revision; shouldSubmit = true; }
          else if (nightCount <= 1 && task.action === 'SUBMIT_RESCUE' && role === 'water') { targets = [targetFor(view, task, playerFor('civilian'))]; shouldSubmit = true; browser = true; }
          else if (nightCount >= 2 && task.action === 'SUBMIT_GUARD' && role === 'door') { targets = [targetFor(view, task, playerFor('civilian'))]; shouldSubmit = true; }
          else if (nightCount >= 2 && task.action === 'EDIT_PROPOSAL' && (role === 'death' || role === 'spirit')) { targets = [targetFor(view, task, playerFor('water'))]; shouldSubmit = true; }
          else if (nightCount >= 2 && task.action === 'CONFIRM_PROPOSAL' && (role === 'death' || role === 'spirit') && Number(view.private?.proposal?.revision) > 0) { extras.revision = view.private.proposal.revision; shouldSubmit = true; }
        } else if (day) {
          if (task.action === 'REGISTER_CANDIDACY' && ['researcher', 'door', 'civilian'].includes(role) && !dayOneRegistration.has(userId)) {
            shouldSubmit = true; dayOneRegistration.add(userId);
          } else if (task.action === 'WITHDRAW_CANDIDACY' && role === 'civilian' && day.election?.candidates?.includes(playerFor('civilian')) && !day.election.withdrawn?.includes(playerFor('civilian'))) {
            shouldSubmit = true;
          } else if (task.action === 'START_SPEECH' || task.action === 'END_ELECTION_SPEECH' || task.action === 'END_SPEECH' || task.action === 'END_LAST_WORDS' || task.action === 'END_TIE_SPEECH') {
            shouldSubmit = true;
          } else if (task.action === 'SUBMIT_ELECTION_VOTE') {
            const researcher = playerFor('researcher'), door = playerFor('door');
            if (day.election?.round === 1) {
              const researcherVoters = new Set([userFor('laike'), userFor('death'), userFor('spirit')]);
              const doorVoters = new Set([userFor('water'), userFor('civilian'), userFor('door')]);
              if (researcherVoters.has(userId)) targets = [targetFor(view, task, researcher)];
              else if (doorVoters.has(userId)) targets = [targetFor(view, task, door)];
              else targets = [];
            } else targets = [targetFor(view, task, researcher)];
            shouldSubmit = true;
          } else if (task.action === 'SUBMIT_HANDOVER' && role === 'researcher') {
            targets = [targetFor(view, task, playerFor('door'))]; shouldSubmit = true;
          } else if (task.action === 'DESIGNATE_SPEECH' && role === 'door') {
            const alive = view.public.seats.find((seat: any) => seat.alive)?.playerId;
            if (!alive) throw new Error('speech order has no legal alive start');
            targets = [targetFor(view, task, alive)]; extras.direction = 'asc'; shouldSubmit = true;
          } else if (task.action === 'SUBMIT_DAY_VOTE') {
            if (day.ballot?.round === 1) {
              const death = playerFor('death'), spirit = playerFor('spirit');
              if (userId === userFor('water') || userId === userFor('civilian')) targets = [targetFor(view, task, death)];
              else if (userId === userFor('laike') || userId === userFor('spirit')) targets = [targetFor(view, task, spirit)];
              else targets = [];
            } else targets = [];
            shouldSubmit = true;
          }
        }
        if (!shouldSubmit) continue;
        if (browser) {
          const result = await submitTargetInBrowser(page, view, targets![0]!, task.action);
          recordAccepted(records, String(role), result.sentBody as Record<string, unknown>, result, true);
        } else {
          const result = await submitAuthorized(request, code, view, task, targets ?? [], extras);
          recordAccepted(records, String(role), result.body, result.receipt);
        }
        submitted.add(roundKey);
        acted = true;
        break;
      }
      if (acted) break;
    }
    if (acted) continue;
    const now = Math.max(...views.map(view => Number(view.serverTime)));
    const visibleDeadlines = views.flatMap(view => (view.windows ?? []).map((window: Record<string, any>) => window.closesAt))
      .filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > now);
    // A fixed private segment (notably stage-2 check without a descender) is
    // deliberately absent from every projection. Advance only the injected
    // clock and let the next authorized snapshot reveal the next task.
    if (!visibleDeadlines.length && (first.public?.phase === 'night' || first.public?.phase === 'morning')) {
      await (await import('../helpers-v2/full-game.ts')).advanceAcceptanceClock(clockSocket, 1_000);
      continue;
    }
    await advanceToNextWindow(requests, code, clockSocket);
  }
  throw new Error(`special action driver did not reach second-stage revive: ${JSON.stringify({ iteration: 520, dayNumber: lastPublic?.public?.dayNumber, stage: lastPublic?.public?.stage, accepted: records.map(record => record.action) })}`);
}

test('七人实验分支：守护/刺杀/救援/平票/移交/水妖复活', async ({ browser }, testInfo) => {
  test.setTimeout(900_000);
  const clockSocket = process.env.ACCEPTANCE_CLOCK_SOCKET ?? '/clock-control/clock.sock';
  // This is deliberately the first operation: a dev run fails before account or room writes.
  await (await import('../helpers-v2/full-game.ts')).advanceAcceptanceClock(clockSocket, 0);
  const accounts = loadSpecialAccounts(testInfo.project.name);
  const sessions: Session[] = [];
  const records: ActionRecord[] = [];
  let code = '';
  let primaryError: unknown = null;
  try {
    for (const account of accounts) {
      const context = await browser.newContext({ extraHTTPHeaders: { Origin: 'http://localhost:5173' } });
      const page = await context.newPage();
      sessions.push({ context, page });
      if (sessions.length === 1) {
        await (await import('../helpers-v2/rooms.ts')).loginRoomAccount(page, account);
        code = await createSpecialRoomViaPage(page);
      } else {
        await loginAndEnterSpecial(page, account, code);
      }
    }
    for (const session of sessions) {
      await session.page.getByRole('button', { name: '准备', exact: true }).click();
      await expect(session.page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
    }
    await sessions[0]!.page.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(sessions[0]!.page.getByRole('heading', { name: '夜幕降临' })).toBeVisible({ timeout: 30_000 });
    const requests = sessions.map(session => session.page.request);
    const initialViews = await authorizedViews(requests, code);
    const roles = roleUsers(initialViews);
    expect(roles.size).toBe(7);
    for (const role of ['laike', 'door', 'water', 'researcher', 'civilian', 'death', 'spirit'] as const) expect(roles.has(role)).toBe(true);
    const driven = await driveSpecialRound(requests, sessions, code, clockSocket, roles, records);
    expect(driven.firstRescue).toBe(true);
    expect(driven.electionTie).toBe(true);
    expect(driven.electionWinner).toBe(true);
    expect(driven.ballotTie).toBe(true);
    expect(driven.ballotRevote).toBe(true);
    expect(driven.handover).toBe(true);
    expect(driven.revive).toBe(true);

    const acceptedActions = new Set(records.map(record => record.action));
    for (const action of ['SUBMIT_GUARD', 'SUBMIT_LAIKE', 'EDIT_PROPOSAL', 'CONFIRM_PROPOSAL', 'SUBMIT_RESCUE', 'REGISTER_CANDIDACY', 'WITHDRAW_CANDIDACY', 'START_SPEECH', 'END_ELECTION_SPEECH', 'SUBMIT_ELECTION_VOTE', 'DESIGNATE_SPEECH', 'END_SPEECH', 'SUBMIT_HANDOVER', 'SUBMIT_DAY_VOTE', 'END_TIE_SPEECH', 'END_LAST_WORDS', 'SUBMIT_REVIVE']) expect(acceptedActions.has(action)).toBe(true);
    expect(records.some(record => record.action === 'SUBMIT_RESCUE' && record.role === 'water' && record.viaBrowser)).toBe(true);
    expect(records.some(record => record.action === 'SUBMIT_REVIVE' && record.role === 'water' && record.viaBrowser)).toBe(true);
    expect(records.some(record => record.action === 'SUBMIT_GUARD' && Array.isArray(record.targets) && (record.targets as string[]).includes(playerIdForRole(roles, 'laike')))).toBe(true);
    expect(records.some(record => record.action === 'SUBMIT_GUARD' && Array.isArray(record.targets) && (record.targets as string[]).includes(playerIdForRole(roles, 'civilian')))).toBe(true);

    const finalViews = await authorizedViews(requests, code);
    const final = finalViews[0]!;
    const researcherSeat = playerSeat(final, playerIdForRole(roles, 'researcher'));
    const waterSeat = playerSeat(final, playerIdForRole(roles, 'water'));
    expect(researcherSeat.alive).toBe(true);
    expect(waterSeat.alive).toBe(false);
    expect(finalViews.some(view => view.private?.events?.some((event: any) => event.type === 'rescue_applied'))).toBe(true);
    expect(final.public.events.some((event: any) => event.type === 'rescue_applied')).toBe(false);
    expect(final.public.events.some((event: any) => event.type === 'revive_announced' && event.payload?.targetSeat === researcherSeat.seat)).toBe(true);
    expect(final.public.events.some((event: any) => event.type === 'election_revote_started')).toBe(true);
    expect(final.public.events.some((event: any) => event.type === 'sheriff_elected' && event.payload?.seat === researcherSeat.seat)).toBe(true);
    expect(final.public.events.some((event: any) => event.type === 'election_finished' && event.payload?.winnerSeat === researcherSeat.seat)).toBe(true);
    expect(final.public.events.some((event: any) => event.type === 'sheriff_handover' && event.payload?.heirSeat === playerSeat(final, playerIdForRole(roles, 'door')).seat)).toBe(true);
    expect(final.public.events.some((event: any) => event.type === 'tie_speech_started')).toBe(true);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    for (const session of sessions) {
      try {
        if (code) {
          const response = await session.page.request.post(`/api/v2/rooms/${code}/leave`, { data: { requestId: crypto.randomUUID() } });
          if (![200, 403, 404].includes(response.status())) throw new Error(`special leave status ${response.status()}`);
        }
      } catch (error) { cleanupErrors.push(error); }
    }
    for (const session of sessions) await session.context.close();
    if (primaryError === null && cleanupErrors.length) throw new Error(`special cleanup failed for ${cleanupErrors.length} session(s)`);
  }
});
