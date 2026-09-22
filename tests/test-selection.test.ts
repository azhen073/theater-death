import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

function select(...paths: string[]) {
  return spawnSync(process.execPath, ['scripts/select-tests.mjs', '--list', ...paths], { encoding: 'utf8' });
}

function selected(...paths: string[]): string[] {
  const result = select(...paths);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout).selected as string[];
}

describe('incremental test selector', () => {
  it('maps OpenAPI, client example, and full rules documents to their reviewed suites', () => {
    expect(selected('docs/openapi-v2.2.json')).toEqual(['tests/contract-openapi.test.ts']);
    expect(selected('docs/examples/contract-client.ts')).toEqual(['tests/contract-client-example.test.ts']);
    expect(selected('docs/rules-v2-full.md')).toEqual(['tests/client-catalog.test.ts', 'tests/contract-openapi.test.ts']);
  });

  it('maps each known shared helper to its direct consumers', () => {
    expect(selected('tests/contract-http-utils.ts')).toEqual([
      'tests/client-catalog.test.ts', 'tests/chat-receipts-api.test.ts', 'tests/room-operation-api.test.ts',
      'tests/contract-http-lifecycle.test.ts', 'tests/command-receipts-api.test.ts', 'tests/contract-knowledge-api.test.ts',
      'tests/v2-api.test.ts', 'tests/contract-openapi.test.ts', 'tests/contract-client-example.test.ts', 'tests/contract-release-flow.test.ts',
    ]);
    expect(selected('tests/server-test-utils.ts')).toEqual([
      'tests/server-api.test.ts', 'tests/realtime.test.ts', 'tests/spectator.test.ts', 'tests/review.test.ts', 'tests/voice-api.test.ts',
    ]);
    expect(selected('tests/helpers.ts')).toContain('tests/contract-snapshots.test.ts');
    expect(selected('tests/helpers.ts')).toContain('tests/visibility.test.ts');
  });

  it('maps the legacy v1 entry and web-v2 sources to their reviewed suites', () => {
    expect(selected('server/legacy-index.ts')).toEqual([
      'tests/server-api.test.ts', 'tests/realtime.test.ts', 'tests/spectator.test.ts', 'tests/capabilities.test.ts',
      'tests/receipts.test.ts', 'tests/v2-api.test.ts', 'tests/v2-maintenance.test.ts',
    ]);
    const frontend = selected('web-v2/src/features/room/policy.ts');
    expect(frontend).toContain('tests/frontend-v2-room-model.test.ts');
    expect(frontend).toContain('tests/frontend-v2-voice-session.test.ts');
  });

  it('selects action presentation and stage geometry regression suites', () => {
    for (const path of [
      'web-v2/src/features/actions/presentation.ts',
      'web-v2/src/features/actions/stage-action-card.tsx',
      'web-v2/src/features/game/stage-layout.ts',
    ]) {
      const suites = selected(path);
      expect(suites).toContain('tests/frontend-v2-action-presentation.test.ts');
      expect(suites).toContain('tests/frontend-v2-stage-layout.test.ts');
      expect(suites).toContain('tests/frontend-v2-actions.test.ts');
      expect(suites).toContain('tests/frontend-v2-avatar.test.ts');
      expect(suites).toContain('tests/frontend-v2-voice-session.test.ts');
    }
  });

  it('selects the entry identity reveal suite for its focused modules', () => {
    expect(selected('web-v2/src/features/game/identity-entry-reveal.tsx')).toEqual(['tests/frontend-v2-identity-reveal.test.ts']);
    expect(selected('web-v2/src/features/game/identity-reveal-model.ts')).toEqual(['tests/frontend-v2-identity-reveal.test.ts']);
  });

  it('maps remaining entry, admin, and infra files to their reviewed suites', () => {
    expect(selected('server/v2/frontend-app.ts')).toEqual(['tests/frontend-v2-static.test.ts']);
    expect(selected('server/v2/admin-router.ts')).toEqual(['tests/admin-api.test.ts']);
    expect(selected('tests/admin-test-helper.ts')).toEqual(['tests/admin-api.test.ts']);
    expect(selected('tests/frontend-v2-acceptance-server.ts')).toEqual(['tests/smoke.test.ts']);
    expect(selected('tests/frontend-v2-game-harness.tsx')).toEqual(['tests/smoke.test.ts']);
    expect(selected('tests/deploy-frontend-local.tests.ps1')).toEqual(['tests/smoke.test.ts']);
    expect(selected('vite.config.ts')).toEqual(['tests/smoke.test.ts']);
    expect(selected('vite.v2.config.ts')).toEqual(['tests/smoke.test.ts']);
  });

  it('selects the atomic proposal API suite for its contract and command sources', () => {
    for (const path of ['contracts/v2.ts', 'server/commands.ts', 'server/night-driver.ts', 'server/v2/parse-command.ts', 'server/v2/app.ts', 'server/v2/snapshots.ts']) {
      expect(selected(path)).toContain('tests/proposal-combined-api.test.ts');
    }
  });

  it('deduplicates multiple mappings and selects runtime dependencies for package changes', () => {
    expect(selected('docs/openapi-v2.2.json', 'docs/openapi-v2.2.json', 'contracts/catalog.ts')).toEqual([
      'tests/contract-openapi.test.ts', 'tests/client-catalog.test.ts',
    ]);
    expect(selected('package.json')).toEqual(['tests/runtime-dependencies.test.ts', 'tests/smoke.test.ts']);
  });

  it('passes an explicit test file through unchanged and does not run Vitest in list mode', () => {
    const result = select('tests/room-rounds.test.ts');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ selected: ['tests/room-rounds.test.ts'] });
    expect(result.stdout).not.toContain('RUN');
  });

  it('fails unknown helpers and unknown runtime files with actionable errors', () => {
    const helper = select('tests/unknown-shared-helper.ts');
    expect(helper.status).not.toBe(0);
    expect(`${helper.stdout}\n${helper.stderr}`).toContain('Shared test helpers changed');
    const runtime = select('server/v2/unknown-runtime.ts');
    expect(runtime.status).not.toBe(0);
    expect(`${runtime.stdout}\n${runtime.stderr}`).toContain('No incremental mapping');
  });

  it('prints the ordinary no-selection message for ordinary documentation', () => {
    const result = select('docs/client-contract-2.1.md');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('No backend runtime change; no tests selected.');
    expect(() => JSON.parse(result.stdout)).toThrow();
  });
});
