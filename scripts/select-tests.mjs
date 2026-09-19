import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const selection = new Set();
const mappings = [
  [/^docs\/openapi-v\d+\.\d+\.json$|^tests\/(fixtures\/contract-2\.1\/|contract-schema-utils\.ts$)/, ['contract-openapi']],
  [/^docs\/examples\/contract-client\.ts$/, ['contract-client-example']],
  [/^docs\/rules-v2-full\.md$|^contracts\/catalog\.ts$/, ['client-catalog', 'contract-openapi']],
  [/^tests\/contract-http-utils\.ts$/, ['client-catalog', 'chat-receipts-api', 'room-operation-api', 'contract-http-lifecycle', 'command-receipts-api', 'contract-knowledge-api', 'v2-api', 'contract-openapi', 'contract-client-example', 'contract-release-flow']],
  [/^tests\/server-test-utils\.ts$/, ['server-api', 'realtime', 'spectator', 'review', 'voice-api']],
  [/^tests\/helpers\.ts$/, ['capabilities', 'engine-night', 'engine-morning', 'engine-info', 'engine-day', 'contract-snapshots', 'deadline-queue', 'night-driver', 'knowledge', 'day-driver', 'v2-first-election', 'targets', 'v2-handover', 'v2-media', 'v2-proposal', 'v2-realtime', 'v2-timers', 'v2-victory', 'visibility', 'window-instances', 'voice-policy']],
  [/^scripts\/select-tests\.mjs$/, ['test-selection']],
  [/^scripts\/check-contract-migration\.mjs$/, ['account-profile', 'audit-migration']],
  [/^package(-lock)?\.json$|^deploy\/Dockerfile.dependencies$/, ['runtime-dependencies', 'smoke']],
  [/^server\/v2\/avatars\.ts$/, ['avatars', 'avatars-api', 'account-profile', 'v2-maintenance']],
  [/^server\/v2\/catalog\.ts$/, ['client-catalog', 'rulesets', 'v2-api']],
  [/^server\/v2\/account-store\.ts$/, ['account-store', 'account-profile', 'account-profile-cache', 'avatars-api', 'auth-v2', 'auth-race', 'v2-api']],
  [/^server\/v2\/chat-receipts\.ts$/, ['chat-receipts-api', 'v2-api', 'room-rounds']],
  [/^server\/v2\/operation-receipts\.ts$/, ['operation-receipts', 'room-operation-api', 'v2-api']],
  [/^server\/receipts\.ts$/, ['receipts', 'command-receipts-api', 'v2-api']],
  [/^server\/v2\/room-realtime\.ts$/, ['room-realtime', 'contract-snapshots', 'member-presence']],
  [/^server\/v2\/snapshots\.ts$/, ['contract-snapshots', 'knowledge', 'room-rounds']],
  [/^server\/v2\/rounds\.ts$/, ['room-rounds', 'screen-grants', 'stable-room']],
  [/^server\/v2\/screen-grants\.ts$/, ['screen-grants', 'room-membership', 'access-v2']],
  [/^server\/v2\/empty-rooms\.ts$/, ['empty-rooms', 'room-membership']],
  [/^server\/v2\/governance\.ts$/, ['room-governance', 'member-presence']],
  [/^server\/v2\/presence\.ts$/, ['member-presence', 'v2-realtime']],
  [/^server\/v2\/room-directory\.ts$/, ['room-membership', 'v2-maintenance', 'v2-api']],
  [/^server\/v2\/stable-room\.ts$/, ['stable-room', 'day-driver']],
  [/^contracts\//, ['contract-foundation', 'contract-snapshots', 'room-realtime', 'contract-openapi', 'contract-client-example']],
  [/^engine\/(day|morning|stage|victory|types)\.ts$/, ['engine-day', 'engine-morning', 'day-driver', 'v2-handover', 'v2-victory', 'v2-first-election', 'v2-timers', 'knowledge']],
  [/^engine\/(night|proposal|targets)\.ts$/, ['engine-night', 'engine-proposal', 'night-driver', 'targets', 'v2-proposal', 'v2-first-election']],
  [/^engine\/(setup|random|events|emit|index)\.ts$/, ['engine-setup', 'engine-info', 'visibility']],
  [/^rulesets\//, ['rulesets', 'engine-setup', 'v2-proposal', 'v2-first-election', 'v2-timers']],
  [/^visibility\//, ['visibility', 'knowledge', 'review', 'v2-spectators-api']],
  [/^server\/(clock|queued-clock|windows|commands|day-driver|night-driver)\.ts$/, ['day-driver', 'night-driver', 'window-instances', 'deadline-queue', 'v2-api', 'v2-timers']],
  [/^server\/(rooms|realtime|app|session|log-store|index|health|capabilities|receipts)\.ts$/, ['server-api', 'realtime', 'spectator', 'capabilities', 'receipts', 'v2-api', 'v2-maintenance']],
  [/^server\/v2\/(account-store|auth|passwords|errors|admin)\.ts$/, ['account-store', 'auth-v2', 'auth-race', 'passwords', 'v2-api']],
  [/^server\/v2\/(access|spectators|second-screen|view|realtime)\.ts$/, ['access-v2', 'knowledge', 'v2-realtime', 'v2-spectators-api', 'v2-api']],
  [/^server\/v2\/(config|maintenance|diagnostics|media|rate-limit)\.ts$/, ['v2-config', 'v2-maintenance', 'v2-media', 'voice-agora']],
  [/^server\/v2\/(app|index|parse-command)\.ts$/, ['auth-v2', 'v2-api', 'contract-http-lifecycle', 'contract-knowledge-api', 'v2-spectators-api', 'v2-media', 'v2-maintenance', 'room-operation-api', 'command-receipts-api', 'chat-receipts-api', 'avatars-api', 'client-catalog', 'contract-openapi']],
  [/^voice\//, ['voice-policy', 'voice-api', 'voice-agora', 'v2-media']],
  [/^(deploy\/|scripts\/|\.github\/|package.*json$|tsconfig.json$|vitest.config.ts$)/, ['smoke']],
];
const files = process.argv.slice(2);
const listOnly = files[0] === '--list';
if (listOnly) files.shift();
for (const path of files) {
  if (/^tests\/.+\.test\.ts$/.test(path)) { if (existsSync(path)) selection.add(path); continue; }
  const match = mappings.find(([pattern]) => pattern.test(path));
  if (!match && /^tests\//.test(path)) throw new Error('Shared test helpers changed: explicitly select the affected suites for review.');
  if (!match && (/\.(md|txt)$/.test(path) || path.startsWith('docs/') || path.startsWith('e2e/') || path.startsWith('web/') || path.startsWith('.'))) continue;
  if (!match) throw new Error(`No incremental mapping for ${path}; add a reviewed mapping.`);
  for (const name of match[1]) selection.add(`tests/${name}.test.ts`);
}
if (!selection.size) { console.log('No backend runtime change; no tests selected.'); process.exit(0); }
console.log(JSON.stringify({ selected: [...selection] }));
if (listOnly) process.exit(0);
let result = spawnSync('node', ['scripts/test-incremental.mjs', ...selection], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
result = spawnSync('node_modules/.bin/tsc', ['--noEmit'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
