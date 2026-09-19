import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The development/test Compose environment must not leak into the release bundle.
process.env.NODE_ENV = 'production';
const project = fileURLToPath(new URL('../', import.meta.url));
process.chdir(project);
const { build, resolveConfig } = await import('vite');
const options = { configFile: resolve(project, 'vite.v2.config.ts'), mode: 'production' };
const configuration = await resolveConfig(options, 'build');
if (!configuration.isProduction) throw new Error('Refusing a non-production frontend build');
await build(options);
const output = resolve(configuration.root, configuration.build.outDir);
const entry = readFileSync(resolve(output, 'index.html'), 'utf8');
if (entry.includes('/@vite/client') || entry.includes('/@fs/') || existsSync(resolve(output, 'game-test.html'))) {
  throw new Error('Development entry detected in the frontend artifact');
}
console.info('Verified production frontend entry.');
