import { readFileSync } from 'node:fs';
import type { BootstrapDTO, CatalogDTO } from '../../contracts/catalog.ts';
import { ROLE_DEFINITIONS, DEITY_ROLE_IDS } from '../../rulesets/roles.ts';
import { ROLE_IDS, type RoleId } from '../../rulesets/types.ts';
import { THEATER_DEATH_13_V2 } from '../../rulesets/theater-death-13-v2.ts';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, DISCONNECT_GRACE_MS } from './presence.ts';

export const AVATAR_LIMITS = { maxBytes: 2 * 1024 * 1024, maxDimension: 4096, outputSize: 256, formats: ['image/jpeg', 'image/png', 'image/webp'] };
export function bootstrap(voice: boolean, avatars: boolean, registrationEnabled = true): BootstrapDTO {
  return {
    contractVersion: '2.2', rulesVersion: '2.0',
    auth: { registration: registrationEnabled ? 'open' : 'closed', uid: { minLength: 8, maxLength: 20, pattern: '^\\d{8,20}$' }, nickname: { minLength: 2, maxLength: 32 }, password: { minLength: 8, maxLength: 16 }, sessionMaxAgeSeconds: 604800 },
    avatar: structuredClone(AVATAR_LIMITS),
    features: { voice, avatars, customBoards: true, secondScreens: true, persistentAccounts: true, gameRecovery: false },
    socket: { path: '/api/v2/socket.io', pingIntervalMs: HEARTBEAT_INTERVAL_MS, pingTimeoutMs: HEARTBEAT_TIMEOUT_MS, disconnectGraceMs: DISCONNECT_GRACE_MS },
  };
}
const roleContent: Record<RoleId, { description: string; abilities: { stage: 1 | 2; summary: string; clauses: string }[] }> = {
  laike: {
    description: '一阶段整局一次夜间刺杀，使用后晨间翻牌并冻结票权；二阶段已翻牌者恢复票权，未翻牌者可每夜刺杀。见R-15。',
    abilities: [
      { stage: 1, summary: '整局一次夜间刺杀；使用后晨间翻牌并冻结票权。', clauses: 'R-15' },
      { stage: 2, summary: '已翻牌者恢复票权；未翻牌者可每夜刺杀。两个分支不叠加。', clauses: 'R-15' },
    ],
  },
  door: {
    description: '每夜守护自己以外最多两人，每人抵挡一刀；连续目标限制、双守牺牲与阶段回归见R-16至R-19、R-49。',
    abilities: [
      { stage: 1, summary: '每夜守护自己以外最多两人，每人抵挡一刀；两名对象都守护成功时自身牺牲。连续目标限制仍适用。', clauses: 'R-16–R-19、R-49' },
      { stage: 2, summary: '保留守护与连续目标限制，取消双守成功的自我牺牲；转换时，因守护牺牲而当前死亡的门先生立即回归。', clauses: 'R-16–R-19、R-49' },
    ],
  },
  water: {
    description: '一阶段未使用还魂曲时获得濒死名单，可整局一次救自己以外一人；二阶段夜死时可选择一名已死者回归。见R-20至R-23。',
    abilities: [
      { stage: 1, summary: '尚未使用还魂曲时获得濒死名单，可整局一次救自己以外一名当夜濒死者；使用后失去名单视野。', clauses: 'R-20–R-23' },
      { stage: 2, summary: '仅在采用二阶段规则的夜晚死亡时，可选择自己以外一名已死者在紧接着的白天回归。白天出局及一阶段夜死不能补触发。', clauses: 'R-20–R-23' },
    ],
  },
  descender: {
    description: '一阶段查验是否魂灵并获得濒死名单；二阶段查验是否死神阵营，不再获得濒死名单。见R-24。',
    abilities: [
      { stage: 1, summary: '每夜查验一人是否为魂灵，并获得濒死名单。', clauses: 'R-24' },
      { stage: 2, summary: '每夜查验一人是否属于死神阵营；不再获得濒死名单，也不揭示完整身份。', clauses: 'R-24' },
    ],
  },
  researcher: {
    description: '独立于神职和平民，死亡触发阶段转换并翻牌，公告当前存活死神阵营人数，整局一次。见R-25、R-50。',
    abilities: [
      { stage: 1, summary: '死亡后翻牌并触发阶段转换，公告当前存活死神阵营人数（含丧亲者），整局一次。', clauses: 'R-25、R-50' },
      { stage: 2, summary: '回归不撤销翻牌或阶段转换，也不刷新整局一次的公告；胜负条件仍按当前生命状态判断。', clauses: 'R-25、R-50' },
    ],
  },
  civilian: {
    description: '没有特殊技能，按当前权限参加讨论与投票；是死神阵营屠边条件中的平民集合。见R-03、R-26。',
    abilities: [
      { stage: 1, summary: '没有特殊技能；按当前权限参与讨论和投票。', clauses: 'R-03、R-26' },
      { stage: 2, summary: '没有新增特殊技能；仍按当前权限参与讨论和投票。', clauses: 'R-03、R-26' },
    ],
  },
  death: {
    description: '知道魂灵；一阶段独立行动最多两刀，过量击杀可能失技；二阶段与魂灵联合最多两刀。见R-27至R-29。',
    abilities: [
      { stage: 1, summary: '知晓魂灵，独立每夜最多袭击两人；不进入魂灵私聊，过量击杀可能令后续一阶段袭击失技。', clauses: 'R-27–R-29、R-52' },
      { stage: 2, summary: '与魂灵联合每夜最多两个攻击名额，不继承一阶段失技。转阶段时仍有魂灵未淘汰才加入阵营房，已死则只读，之后不补拉。', clauses: 'R-27–R-29、R-52' },
    ],
  },
  spirit: {
    description: '魂灵互知并在阵营房协商；一阶段团队刀数等于存活魂灵数，二阶段与死神联合行动。见R-30、R-47。',
    abilities: [
      { stage: 1, summary: '魂灵互知并协商；团队当夜攻击名额上限等于存活魂灵人数，可少刀或空刀。', clauses: 'R-29、R-30、R-47' },
      { stage: 2, summary: '与死神联合每夜最多两个攻击名额，不与一阶段额度叠加；保留团队方案确认与截止兜底规则。', clauses: 'R-29、R-30、R-47' },
    ],
  },
  mourner: {
    description: '知道魂灵，不知道死神；属于死神阵营，无夜间技能，永不加入阵营房，人类获胜不要求淘汰他。见R-31。',
    abilities: [
      { stage: 1, summary: '知晓魂灵，不知晓死神；无夜间技能，永不进入阵营房。', clauses: 'R-31' },
      { stage: 2, summary: '没有新增夜间技能，仍不进入阵营房；人类获胜不要求淘汰丧亲者。', clauses: 'R-31' },
    ],
  },
};
const victory: Record<RoleId, string> = {
  laike: '消灭死神与魂灵；丧亲者存活不影响人类获胜。',
  door: '消灭死神与魂灵；丧亲者存活不影响人类获胜。',
  water: '消灭死神与魂灵；丧亲者存活不影响人类获胜。',
  descender: '消灭死神与魂灵；丧亲者存活不影响人类获胜。',
  researcher: '消灭死神与魂灵；丧亲者存活不影响人类获胜。',
  civilian: '消灭死神与魂灵；丧亲者存活不影响人类获胜。',
  death: '消灭科研员，并消灭全部神职或全部平民。',
  spirit: '消灭科研员，并消灭全部神职或全部平民。',
  mourner: '消灭科研员，并消灭全部神职或全部平民。',
};
const text = readFileSync(new URL('../../docs/rules-v2-full.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const headings = [...text.matchAll(/^## (\d{2})\s+(.+)$/gm)];
const clauses = new Set([...text.matchAll(/R-(\d{2})｜/g)].map((m) => Number(m[1])));
if (headings.length !== 10 || Array.from({ length: 54 }, (_, i) => i + 1).some((n) => !clauses.has(n))) throw new Error('Incomplete rules 2.0 catalog');
const data: CatalogDTO = {
  rulesVersion: '2.0',
  roles: ROLE_IDS.map((roleId) => ({ roleId, name: ROLE_DEFINITIONS[roleId].displayName, faction: ROLE_DEFINITIONS[roleId].factionId, ...roleContent[roleId], victory: victory[roleId] })),
  presets: [{ presetId: 'default-13', name: '剧院死神13人正式板', playerCount: 13, config: structuredClone(THEATER_DEATH_13_V2) }],
  constraints: { minPlayers: 5, maxPlayers: 64, repeatableRoleIds: ['spirit', 'civilian'], requiredRoleIds: ['civilian', 'researcher', 'death', 'spirit'], requiresAnyOf: [...DEITY_ROLE_IDS] },
  rulebook: { version: '2.0', title: '《剧院死神》玩家规则书', chapters: headings.map((h, i) => ({ id: `chapter-${h[1]}`, title: `${h[1]} ${h[2]}`, markdown: text.slice(h.index, headings[i + 1]?.index ?? text.length).trim() })) },
};
export const catalog = (): CatalogDTO => structuredClone(data);
