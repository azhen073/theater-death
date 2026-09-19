import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, json, makeHarness, MockVoice, post, request } from './contract-http-utils.ts';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, DISCONNECT_GRACE_MS } from '../server/v2/presence.ts';
import { ROLE_DEFINITIONS } from '../rulesets/roles.ts';
import { ROLE_IDS } from '../rulesets/types.ts';

afterEach(closeHarnesses);

function expectError(body: Record<string, any>, code: string) {
  expect(body.error).toMatchObject({ code });
}

function expectInvalidRuleset(body: Record<string, any>, issue: string) {
  expectError(body, 'invalid_ruleset');
  expect(body.error.message).toContain(issue);
}

function roles(overrides: Record<string, number> = {}): Record<string, number> {
  return Object.fromEntries(ROLE_IDS.map((roleId) => [roleId, overrides[roleId] ?? 0]));
}

async function create(h: Awaited<ReturnType<typeof makeHarness>>, userIndex: number, body: Record<string, unknown>) {
  const response = await request(h, '/api/v2/rooms', post(body), h.users[userIndex]);
  return { response, body: await json(response) };
}

describe('v2 client bootstrap and catalog contract', () => {
  it('allows anonymous bootstrap/catalog access and exposes current feature, auth, socket, role, preset, and rulebook metadata', async () => {
    const h = await makeHarness();
    const bootstrapResponse = await request(h, '/api/v2/bootstrap');
    const catalogResponse = await request(h, '/api/v2/catalog');
    expect(bootstrapResponse.status).toBe(200);
    expect(catalogResponse.status).toBe(200);
    const bootstrap = await json(bootstrapResponse);
    const catalog = await json(catalogResponse);
    expect(bootstrap).toMatchObject({ contractVersion: '2.2', rulesVersion: '2.0' });
    expect(bootstrap.auth).toMatchObject({ registration: 'open', nickname: { minLength: 2, maxLength: 32 }, password: { minLength: 8, maxLength: 16 }, sessionMaxAgeSeconds: 604800 });
    expect(bootstrap.features).toMatchObject({ voice: false, avatars: false, customBoards: true, secondScreens: true, persistentAccounts: true, gameRecovery: false });
    expect(bootstrap.socket).toEqual({ path: '/api/v2/socket.io', pingIntervalMs: HEARTBEAT_INTERVAL_MS, pingTimeoutMs: HEARTBEAT_TIMEOUT_MS, disconnectGraceMs: DISCONNECT_GRACE_MS });
    expect(catalog.rulesVersion).toBe('2.0');
    expect(catalog.roles).toHaveLength(9);
    expect(catalog.roles.map((role: any) => role.roleId)).toEqual([...ROLE_IDS]);
    for (const role of catalog.roles as Array<{ roleId: keyof typeof ROLE_DEFINITIONS; faction: string; description: string }>) {
      expect(role.faction).toBe(ROLE_DEFINITIONS[role.roleId].factionId);
      expect(role.description).toContain('R-');
    }
    expect(catalog.presets).toHaveLength(1);
    expect(catalog.presets[0]).toMatchObject({ presetId: 'default-13', playerCount: 13, config: { mode: 'formal', version: '2.0' } });
    expect(catalog.constraints).toMatchObject({ minPlayers: 5, maxPlayers: 64, repeatableRoleIds: ['spirit', 'civilian'], requiredRoleIds: ['civilian', 'researcher', 'death', 'spirit'] });
    expect(catalog.constraints.requiresAnyOf).toEqual(['laike', 'door', 'water', 'descender']);
    expect(catalog.rulebook).toMatchObject({ version: '2.0', title: '《剧院死神》玩家规则书' });
    expect(catalog.rulebook.chapters).toHaveLength(10);
    const rulebook = catalog.rulebook.chapters.map((chapter: any) => chapter.markdown).join('\n');
    for (let index = 1; index <= 54; index += 1) expect(rulebook).toContain(`R-${String(index).padStart(2, '0')}｜`);
    expect(rulebook).toContain('60 秒');
    expect(rulebook).toContain('120秒');
    expect(rulebook).toContain('首夜结束先按入夜存活名单进行首日竞选');
    expect(rulebook).toContain('从未全员确认时执行服务端最后接受的合法草稿');
    expect(rulebook).toContain('最多15秒准备');
    expect(rulebook).toContain('个人夜间技能及回归选择30秒');
    expect(rulebook).toContain('发言顺序指定45秒');
    expect(rulebook).toContain('竞选报名30秒');
    expect(rulebook).toContain('R-42');
    expect(rulebook).toContain('R-47');
    expect(rulebook).toContain('全员确认');
    expect(rulebook).toContain('主动空刀');
  });

  it('reflects the actual voice toggle and returns fresh non-shared catalog/bootstrap objects', async () => {
    const disabled = await makeHarness();
    expect((await json(await request(disabled, '/api/v2/bootstrap'))).features.voice).toBe(false);
    const enabled = await makeHarness(20, new MockVoice());
    expect((await json(await request(enabled, '/api/v2/bootstrap'))).features.voice).toBe(true);
    const first = await json(await request(enabled, '/api/v2/catalog'));
    first.roles[0].name = 'mutated';
    first.presets[0].config.roles.civilian = 999;
    const second = await json(await request(enabled, '/api/v2/catalog'));
    expect(second.roles[0].name).not.toBe('mutated');
    expect(second.presets[0].config.roles.civilian).not.toBe(999);
    const b1 = await json(await request(enabled, '/api/v2/bootstrap'));
    b1.features.voice = false;
    expect((await json(await request(enabled, '/api/v2/bootstrap'))).features.voice).toBe(true);
  });

  it('accepts valid five-player and maximum-64 experimental role catalogs, while rejecting catalog constraint violations', async () => {
    const h = await makeHarness();
    const five = roles({ laike: 1, researcher: 1, death: 1, spirit: 1, civilian: 1 });
    const validFive = await create(h, 0, { requestId: 'valid-five', roles: five, playerCount: 5 });
    expect(validFive.response.status).toBe(201);
    expect(h.app.directory.byId.get(validFive.body.roomId)?.ruleset.mode).toBe('experimental');
    const max = roles({ laike: 1, door: 1, water: 1, descender: 1, researcher: 1, death: 1, spirit: 1, mourner: 1, civilian: 56 });
    const validMax = await create(h, 1, { requestId: 'valid-max', roles: max, playerCount: 64 });
    expect(validMax.response.status).toBe(201);
    const over = await create(h, 2, { requestId: 'over-max', roles: { ...max, civilian: 57 }, playerCount: 65 });
    expect(over.response.status).toBe(400);
    expectError(over.body, 'player_limit');

    const missing = roles({ laike: 1, researcher: 1, death: 1, spirit: 1 });
    const missingRequired = await create(h, 3, { requestId: 'missing-required', roles: missing, playerCount: 4 });
    expect(missingRequired.response.status).toBe(400);
    expectInvalidRuleset(missingRequired.body, 'empty_civilian_group');
    const noDeity = roles({ researcher: 1, death: 1, spirit: 1, civilian: 2 });
    const emptyDeity = await create(h, 4, { requestId: 'empty-deity', roles: noDeity, playerCount: 5 });
    expect(emptyDeity.response.status).toBe(400);
    expectInvalidRuleset(emptyDeity.body, 'empty_deity_group');
    const duplicate = await create(h, 5, { requestId: 'duplicate-special', roles: roles({ laike: 2, researcher: 1, death: 1, spirit: 1, civilian: 1 }), playerCount: 6 });
    expect(duplicate.response.status).toBe(400);
    expectInvalidRuleset(duplicate.body, 'duplicate_unsupported_role');
    const unknown = await create(h, 6, { requestId: 'unknown-role', roles: { ...five, oracle: 1 }, playerCount: 6 });
    expect(unknown.response.status).toBe(400);
    expectInvalidRuleset(unknown.body, 'unknown_role');
    const mismatch = await create(h, 7, { requestId: 'count-mismatch', roles: five, playerCount: 6 });
    expect(mismatch.response.status).toBe(400);
    expectError(mismatch.body, 'player_count_mismatch');
  });

  it('keeps the default preset formal and marks supplied roles experimental even when equal to default', async () => {
    const h = await makeHarness();
    const normal = await create(h, 0, { requestId: 'formal-default' });
    expect(normal.response.status).toBe(201);
    const normalRoom = h.app.directory.byId.get(normal.body.roomId)!;
    expect(normalRoom.ruleset).toMatchObject({ mode: 'formal', version: '2.0' });
    expect(normalRoom.requiredPlayers()).toBe(13);
    const equalRoles = structuredClone(normalRoom.ruleset.roles);
    const supplied = await create(h, 1, { requestId: 'equal-supplied', roles: equalRoles, playerCount: 13 });
    expect(supplied.response.status).toBe(201);
    expect(h.app.directory.byId.get(supplied.body.roomId)?.ruleset).toMatchObject({ mode: 'experimental', version: '2.0', roles: equalRoles });
  });
});
