import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { CatalogDTO } from '../../contracts/catalog.ts';
import type { CommandAction, JsonValue, RoomSnapshot, TaskDTO } from '../../contracts/v2.ts';
export type { CommandAction, RoomSnapshot, TaskDTO } from '../../contracts/v2.ts';

export interface GameHarnessFixture { view: RoomSnapshot; catalog: CatalogDTO; online: boolean; voice?: Record<string, unknown> }
export interface ReviewEnvelope {
  review: {
    gameId: string; winner: 'human' | 'death_faction'; reason: string; endedAtDay: number;
    players: Array<{ playerId: string; seat: number; roleId: string; life: 'alive' | 'dead'; revealed: boolean; nickname: string; uid: string; avatarUrl: string | null }>;
    timeline: Array<{ dayNumber: number; stage: 1 | 2; type: string; payload: JsonValue }>;
    chat: { public: Array<{ id: number; messageId?: string; senderId: string; senderSeat: number | null; text: string; at: number }>; faction: Array<{ id: number; messageId?: string; senderId: string; senderSeat: number | null; text: string; at: number }> };
    startedAt: number; endedAt: number; durationMs: number;
  };
}

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync('/contract-fixtures/' + name, 'utf8')) as T;
}

export function loadGameFixture(viewName = 'night-door-full.json'): GameHarnessFixture {
  return { view: readFixture<RoomSnapshot>(viewName), catalog: readFixture<CatalogDTO>('catalog-full.json'), online: true };
}

/** Compose the constructed replay response with a complete RoomSnapshot. The replay fixture is intentionally not a real game chain. */
export function loadReviewFixture(options: { host?: boolean; base?: string } = {}): GameHarnessFixture {
  const review = loadReviewDocument().review;
  const view = structuredClone(readFixture<RoomSnapshot>(options.base ?? 'night-spirit-full.json'));
  view.gameId = review.gameId;
  view.room.phase = 'review';
  view.public = view.public ? { ...view.public, phase: 'ended', result: { winner: review.winner, dayNumber: review.endedAtDay, reason: review.reason }, endedAt: review.endedAt } : null;
  view.private = null;
  view.tasks = [];
  view.windows = [];
  view.submissionState = [];
  view.viewer = { ...view.viewer, subjectPlayerId: view.room.formalMembers[0]?.playerId ?? null };
  view.room.hostMemberId = view.room.formalMembers[0]?.memberId ?? view.room.hostMemberId;
  view.viewer.userId = view.room.formalMembers[0]?.userId ?? view.viewer.userId;
  view.viewer.memberId = view.room.formalMembers[0]?.memberId ?? view.viewer.memberId;
  view.viewer.isHost = options.host !== false;
  view.capabilities.room.endReview = { allowed: options.host !== false, reason: options.host === false ? 'not_host' : null };
  return { view, catalog: readFixture<CatalogDTO>('catalog-full.json'), online: true };
}

export function loadReviewDocument(): ReviewEnvelope {
  return readFixture<ReviewEnvelope>('review-constructed-full.json');
}

/** Build an authorized private-screen view with one current window and one stale submission. */
export function loadObservedActionsFixture(): GameHarnessFixture {
  const fixture = { view: readFixture<RoomSnapshot>('private-second-screen-full.json'), catalog: readFixture<CatalogDTO>('catalog-full.json'), online: true };
  const windowInstanceId = fixture.view.gameId + ':night:1:guard';
  fixture.view.windows = [{ id: 'guard', type: 'guard', instanceId: windowInstanceId, closesAt: fixture.view.serverTime + 60_000 }];
  fixture.view.submissionState = [{ action: 'SUBMIT_GUARD', windowInstanceId, requestId: 'request-private-hidden', acceptedAt: fixture.view.serverTime, targets: [fixture.view.public!.seats[0]!.playerId], revision: null, direction: null }, { action: 'SUBMIT_GUARD', windowInstanceId: 'old-window', requestId: 'request-stale-hidden', acceptedAt: fixture.view.serverTime, targets: [fixture.view.public!.seats[1]!.playerId], revision: null, direction: null }];
  return fixture;
}

export function taskFixture(view: RoomSnapshot, action: CommandAction, targets: TaskDTO['targets'] = null, windowInstanceId = 'fixture:' + action): GameHarnessFixture {
  const next = structuredClone(view);
  const windowTypes: Partial<Record<CommandAction, string>> = { SUBMIT_GUARD: 'guard', SUBMIT_LAIKE: 'laike', EDIT_PROPOSAL: 'faction', CONFIRM_PROPOSAL: 'faction', SUBMIT_CHECK: 'check', SUBMIT_RESCUE: 'rescue', SUBMIT_REVIVE: 'revive' };
  next.serverTime += 10_000;
  next.room.phase = 'playing';
  next.tasks = [{ action, windowInstanceId, closesAt: next.serverTime + 60_000, targets }];
  next.windows = [{ id: action, type: windowTypes[action] ?? 'public', instanceId: windowInstanceId, closesAt: next.serverTime + 60_000 }];
  next.capabilities.allowedCommands = [action];
  return { view: next, catalog: readFixture<CatalogDTO>('catalog-full.json'), online: true };
}

export async function pushFixture(page: Page, fixture: GameHarnessFixture): Promise<void> {
  await page.evaluate((next: any) => window.dispatchEvent(new CustomEvent('v2-game-fixture-update', { detail: next })), fixture as any);
}

export async function fixtureRoute(page: Page, fixture: GameHarnessFixture): Promise<{ set: (next: GameHarnessFixture) => void }> {
  let current = fixture;
  await page.route('**/__game-fixture', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
  });
  return { set: next => { current = next; } };
}

export function alivePlayers(view: RoomSnapshot): string[] {
  return (view.public?.seats ?? []).filter((seat: any) => seat.alive).map((seat: any) => seat.playerId);
}

export function resizeSeats(view: RoomSnapshot, count: number): RoomSnapshot {
  const next = structuredClone(view);
  const source = next.public!.seats;
  next.public!.seats = Array.from({ length: count }, (_, index) => {
    const base = source[index % source.length]!;
    return { ...base, playerId: 'fixture-player-' + (index + 1), seat: index + 1, nickname: '座位' + (index + 1), uid: String(10000001 + index), memberId: 'fixture-member-' + (index + 1) };
  });
  next.room.requiredPlayers = count;
  next.room.formalMembers = next.room.formalMembers.map((member, index) => ({ ...member, userId: 'fixture-user-' + (index + 1), uid: String(10000001 + index), memberId: 'fixture-member-' + (index + 1), playerId: next.public!.seats[index % count]!.playerId, nickname: '座位' + (index + 1) }));
  const publicGame = next.public!;
  next.viewer.subjectPlayerId = publicGame.seats[0]?.playerId ?? null;
  if (publicGame.seats[0]) { next.viewer.userId = 'fixture-user-1'; next.viewer.memberId = 'fixture-member-1'; if (next.private) { next.private.self.playerId = publicGame.seats[0].playerId; next.private.self.seat = 1; next.private.self.nickname = publicGame.seats[0].nickname; } }
  return next;
}
