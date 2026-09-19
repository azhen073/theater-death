import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AccountStore } from '../server/v2/account-store.ts';
import { hashPassword } from '../server/v2/passwords.ts';

/**
 * Prepare the account/session fixture for the external v2 load client.
 * Run this in the load container with DATA_DIR mounted to /app/data-v2.
 * The fixture contains test credentials by design; capacity.json never does.
 */
const dataDir = process.env.DATA_DIR ?? '/app/data-v2';
const fixturePath = process.env.FIXTURE_PATH ?? '/app/test-results-v2/load-fixture.json';
const password = process.env.LOAD_PASSWORD ?? 'Capacity2026';
const cookieName = process.env.ACCOUNT_COOKIE_NAME ?? 'td_account_v2';
const accountCount = Number(process.env.ACCOUNT_COUNT ?? 100);

if (!Number.isSafeInteger(accountCount) || accountCount < 100) throw new Error('ACCOUNT_COUNT must be at least 100');
if ([...password].length < 8 || [...password].length > 16) throw new Error('LOAD_PASSWORD must contain 8 to 16 characters');

await mkdir(dataDir, { recursive: true });
await mkdir(dirname(fixturePath), { recursive: true });
const store = new AccountStore(join(dataDir, 'accounts.sqlite'));
try {
  const existing = store.db.prepare('SELECT COUNT(*) AS count FROM accounts').get() as { count: number };
  if (Number(existing.count) !== 0) throw new Error(`refusing non-empty account store (${existing.count} accounts)`);

  // One expensive derivation is deliberately shared by the load-only accounts.
  const passwordHash = await hashPassword(password);
  const accounts = [] as Array<{ uid: string; nickname: string; userId: string; cookie: string }>;
  for (let index = 1; index <= accountCount; index += 1) {
    const nickname = `负载_${'测'.repeat(1 + index % 3)}`;
    const { account } = store.register(`capacity-${index}`, nickname, passwordHash);
    const session = store.createSession(account.id);
    accounts.push({ uid: account.uid, nickname, userId: account.id, cookie: `${cookieName}=${session.token}` });
  }
  await writeFile(fixturePath, JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: process.env.BASE_URL ?? 'http://load-app:3000', password, accounts }, null, 2));
} finally {
  store.close();
}
