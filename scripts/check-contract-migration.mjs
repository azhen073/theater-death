import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { AccountStore } from '../server/v2/account-store.ts';
import { createLogStore } from '../server/log-store.ts';

// Run in Docker: source directory read-only; output is a new, disposable migration copy.
const [sourceArg, targetArg] = process.argv.slice(2);
assert(sourceArg && targetArg, 'Usage: node scripts/check-contract-migration.mjs SOURCE_DIR NEW_TARGET_DIR');
const source = resolve(sourceArg), target = resolve(targetArg);
const rel = relative(source, target);
assert(rel && (rel.startsWith('..') || isAbsolute(rel)), 'Migration copy must be outside the source directory');
await mkdir(target); // Refuse any existing target, including a previous successful copy.
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const hashRows = (rows) => createHash('sha256').update(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort())).digest('hex');
function inventory(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name").all().map(({ name }) => {
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(({ name }) => name);
    const rows = db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(name)}`).all();
    return { name, columns, count: rows.length, hash: hashRows(rows) };
  });
}
const before = new Map();
for (const file of ['accounts.sqlite', 'audit.sqlite']) {
  const db = new DatabaseSync(join(source, file), { readOnly: true });
  try { await backup(db, join(target, file)); } finally { db.close(); }
  const copy = new DatabaseSync(join(target, file), { readOnly: true });
  try { before.set(file, inventory(copy)); } finally { copy.close(); }
}
const accounts = new AccountStore(join(target, 'accounts.sqlite'));
accounts.close();
const audit = createLogStore(join(target, 'audit.sqlite'));
audit.close();
const report = [];
for (const file of ['accounts.sqlite', 'audit.sqlite']) {
  const db = new DatabaseSync(join(target, file), { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    for (const table of before.get(file)) {
      const rows = db.prepare(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)}`).all();
      assert.equal(hashRows(rows), table.hash, `Migration changed pre-existing ${file}/${table.name} values`);
    }
    report.push({ file, integrity: 'ok', originalDataUnchanged: true, originalTables: before.get(file).map(({ name, count }) => ({ name, count })), schema: file === 'accounts.sqlite' ? db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version : db.prepare('PRAGMA user_version').get().user_version });
  } finally { db.close(); }
}
// Repeat the migration on the same copy to prove the startup path is idempotent.
new AccountStore(join(target, 'accounts.sqlite')).close();
createLogStore(join(target, 'audit.sqlite')).close();
console.log(JSON.stringify({ target, repeatOpen: 'ok', databases: report }, null, 2));
