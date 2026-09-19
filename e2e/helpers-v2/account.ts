import { readFileSync } from 'node:fs';

export interface LoginAccount {
  uid: string;
  nickname: string;
  /** Compatibility label for room assertions; auth always uses uid. */
  username?: string;
  password: string;
}

export interface RegistrationAccount extends LoginAccount {
  requestId?: string;
  invitation?: string;
}

export interface ResetAccount extends LoginAccount {
  token?: string;
}

export interface RoomAccount extends LoginAccount {
  userId: string;
}

export type FullGameAccount = RoomAccount;

export interface AccountCase extends RegistrationAccount {
  lost: RegistrationAccount;
  reset: ResetAccount;
  rooms?: RoomAccount[];
  fullGame?: FullGameAccount[];
}

export function loadAccountCase(projectName: string): AccountCase {
  if (projectName !== 'chromium' && projectName !== 'webkit') throw new Error(`unsupported browser project: ${projectName}`);
  const all = JSON.parse(readFileSync('/test-access/accounts.json', 'utf8')) as Record<string, AccountCase | undefined>;
  const account = all[projectName];
  if (!account) throw new Error(`missing disposable account case for ${projectName}`);
  return { ...account, username: account.username ?? account.nickname };
}

export function newPasswordFor(_uid: string): string {
  return 'changed8888';
}

export function staticPng(): Buffer {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

export function invalidSvg(): Buffer {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
}

export function corruptPng(): Buffer {
  return Buffer.from('\x89PNG\r\n\x1a\nthis is not a decodable PNG', 'binary');
}
