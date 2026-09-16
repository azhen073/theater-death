import type { EliminationGroup, FactionId, RoleId } from './types.ts';

export interface RoleDefinition {
  readonly roleId: RoleId;
  readonly displayName: string;
  readonly factionId: FactionId;
  readonly eliminationGroup: EliminationGroup;
  readonly countsForHumanWin: boolean;
}

export const ROLE_DEFINITIONS = {
  laike: {
    roleId: 'laike',
    displayName: '莱莱可',
    factionId: 'human',
    eliminationGroup: 'deity',
    countsForHumanWin: false,
  },
  door: {
    roleId: 'door',
    displayName: '门先生',
    factionId: 'human',
    eliminationGroup: 'deity',
    countsForHumanWin: false,
  },
  water: {
    roleId: 'water',
    displayName: '水妖',
    factionId: 'human',
    eliminationGroup: 'deity',
    countsForHumanWin: false,
  },
  descender: {
    roleId: 'descender',
    displayName: '降临者',
    factionId: 'human',
    eliminationGroup: 'deity',
    countsForHumanWin: false,
  },
  researcher: {
    roleId: 'researcher',
    displayName: '科研员',
    factionId: 'human',
    eliminationGroup: 'researcher',
    countsForHumanWin: false,
  },
  civilian: {
    roleId: 'civilian',
    displayName: '平民',
    factionId: 'human',
    eliminationGroup: 'civilian',
    countsForHumanWin: false,
  },
  death: {
    roleId: 'death',
    displayName: '死神',
    factionId: 'death_faction',
    eliminationGroup: 'none',
    countsForHumanWin: true,
  },
  spirit: {
    roleId: 'spirit',
    displayName: '魂灵',
    factionId: 'death_faction',
    eliminationGroup: 'none',
    countsForHumanWin: true,
  },
  mourner: {
    roleId: 'mourner',
    displayName: '丧亲者',
    factionId: 'death_faction',
    eliminationGroup: 'none',
    countsForHumanWin: false,
  },
} as const satisfies Record<RoleId, RoleDefinition>;

export const DEITY_ROLE_IDS: readonly RoleId[] = ['laike', 'door', 'water', 'descender'];
