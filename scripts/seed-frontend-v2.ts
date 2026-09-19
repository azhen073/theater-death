/** Disposable test access only. Never point this helper at an existing deployment. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { AccountStore } from '../server/v2/account-store.ts';
import { hashPassword } from '../server/v2/passwords.ts';

const dir = process.env.DATA_DIR;
if (!dir || resolve(dir) !== '/app/data-frontend-v2') throw new Error('This seed helper requires the isolated frontend database.');
mkdirSync(dir, { recursive: true }); mkdirSync('/test-access', { recursive: true });
const store = new AccountStore(join(dir, 'accounts.sqlite'));
const password = () => randomBytes(9).toString('base64url');
const numerals = [...'一二三四五六七八九十天地玄黄宇宙洪荒'];
try {
  const run = randomBytes(5).toString('hex'), accounts: Record<string, unknown> = {};
  for (const browser of ['chromium', 'webkit']) {
    let sequence = 0;
    const make = async (prefix: string) => { const nickname = `${prefix}_${browser === 'chromium' ? '甲' : '乙'}_${numerals[sequence++ % numerals.length]}`, secret = password(); const { account } = store.register(`seed-${run}-${browser}-${sequence}`, nickname, await hashPassword(secret)); return { uid: account.uid, nickname, password: secret, userId: account.id }; };
    const primary = await make('界面');
    const rooms = await Promise.all(Array.from({ length: 7 }, () => make('房间')));
    const fullGame = await Promise.all(Array.from({ length: 13 }, () => make('全局')));
    accounts[browser] = { ...primary, lost: await make('遗失'), rooms, fullGame };
  }
  writeFileSync('/test-access/accounts.json', JSON.stringify(accounts), { mode: 0o600 });
  console.log('Prepared disposable frontend account cases; access is in the private test volume.');
} finally { store.close(); }
