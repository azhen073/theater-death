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
    expect(selected('docs/openapi-v2.1.json')).toEqual(['tests/contract-openapi.test.ts']);
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

  it('deduplicates multiple mappings and selects runtime dependencies for package changes', () => {
    expect(selected('docs/openapi-v2.1.json', 'docs/openapi-v2.1.json', 'contracts/catalog.ts')).toEqual([
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
