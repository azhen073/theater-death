import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AccountStore } from './account-store.ts';

const dir = process.env.DATA_DIR ?? './data-v2'; mkdirSync(dir, { recursive: true });
const store = new AccountStore(join(dir, 'accounts.sqlite'));
try {
  const [command, value] = process.argv.slice(2);
  if (command !== 'registration' || !['on', 'off', 'status'].includes(value ?? '')) throw new Error('Usage: admin.ts registration on | off | status');
  if (value !== 'status') store.setRegistrationEnabled(value === 'on');
  console.log(JSON.stringify({ registrationEnabled: store.registrationEnabled() }));
} finally { store.close(); }
