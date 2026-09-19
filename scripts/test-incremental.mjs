import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const files = process.argv.slice(2);
if (!files.length || files.some((file) => !/^tests\/[\w/-]+\.test\.ts$/.test(file))) {
  throw new Error('Specify explicit tests/*.test.ts files; unrestricted test runs are not allowed.');
}
const hash = (path) => createHash('sha256').update(JSON.stringify(JSON.parse(readFileSync(path, 'utf8')))).digest('hex');
if (hash('/source-lock.json') !== hash('package-lock.json')) {
  throw new Error('Dependency lock changed: refresh the dependency image before testing.');
}
console.log(JSON.stringify({ tests: files, source: 'bind-mounted working tree', lockfile: hash('/source-lock.json') }));
const result = spawnSync('node_modules/.bin/vitest', ['run', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
