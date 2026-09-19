import type { RoleId, RulesetConfig, FactionId } from '../rulesets/types.ts';

export interface BootstrapDTO {
  contractVersion: '2.2'; rulesVersion: '2.0';
  auth: { registration: 'open' | 'closed'; uid: { minLength: number; maxLength: number; pattern: string }; nickname: { minLength: number; maxLength: number }; password: { minLength: number; maxLength: number }; sessionMaxAgeSeconds: number };
  avatar: { maxBytes: number; maxDimension: number; outputSize: number; formats: string[] };
  features: { voice: boolean; avatars: boolean; customBoards: boolean; secondScreens: boolean; persistentAccounts: boolean; gameRecovery: boolean };
  socket: { path: string; pingIntervalMs: number; pingTimeoutMs: number; disconnectGraceMs: number };
}
export interface CatalogDTO {
  rulesVersion: '2.0';
  roles: { roleId: RoleId; name: string; description: string; faction: FactionId }[];
  presets: { presetId: string; name: string; playerCount: number; config: RulesetConfig }[];
  constraints: { minPlayers: number; maxPlayers: number; repeatableRoleIds: RoleId[]; requiredRoleIds: RoleId[]; requiresAnyOf: RoleId[] };
  rulebook: { version: '2.0'; title: string; chapters: { id: string; title: string; markdown: string }[] };
}
