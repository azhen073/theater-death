import { useState } from 'react';
import { ROLE_DEFINITIONS } from '../../rulesets/roles.ts';
import { THEATER_DEATH_13 } from '../../rulesets/theater-death-13.ts';
import type { RoleId, RulesetConfig } from '../../rulesets/types.ts';
import { validateRuleset } from '../../rulesets/validate.ts';

/** 最多 1 个的角色（与校验器一致：仅魂灵与平民允许重复） */
const SINGLE_ROLE_IDS: readonly RoleId[] = [
  'laike',
  'door',
  'water',
  'descender',
  'researcher',
  'death',
  'mourner',
];

const ROLE_GROUPS: readonly { readonly label: string; readonly roles: readonly RoleId[] }[] = [
  { label: '神职（人类）', roles: ['laike', 'door', 'water', 'descender'] },
  { label: '其他人类', roles: ['civilian', 'researcher'] },
  { label: '死神阵营', roles: ['death', 'spirit', 'mourner'] },
];

/**
 * 实验模式板子编辑器：只允许调整各角色数量，其余参数固定为默认 13 人板值。
 * 校验直接复用服务端同一份 validateRuleset，保证界面提示与创建时的校验一致。
 */
export function BoardEditor({
  initialNickname,
  busy,
  error,
  onCancel,
  onCreate,
}: {
  initialNickname: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onCreate: (nickname: string, ruleset: RulesetConfig) => void;
}) {
  const [nickname, setNickname] = useState(initialNickname);
  const [counts, setCounts] = useState<Record<RoleId, number>>(() => ({
    ...THEATER_DEATH_13.roles,
  }));

  const ruleset: RulesetConfig = {
    ...THEATER_DEATH_13,
    version: 'custom',
    mode: 'experimental',
    roles: counts,
  };
  const validation = validateRuleset(ruleset);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const trimmed = nickname.trim();

  const adjust = (roleId: RoleId, delta: number): void => {
    setCounts((previous) => ({
      ...previous,
      [roleId]: Math.max(0, previous[roleId] + delta),
    }));
  };

  return (
    <div className="card entry board-editor">
      <h1>自定义板子</h1>
      <p className="banner-experimental">
        实验模式：本板使用非默认配置，未经完整验证，仅供测试，不代表正式功能；并非任意人数 /
        组合都经过验证。
      </p>
      <label className="field">
        昵称
        <input
          value={nickname}
          maxLength={12}
          placeholder="1-12 个字符"
          onChange={(event) => setNickname(event.target.value)}
        />
      </label>
      <ul className="board-roles">
        {ROLE_GROUPS.map((group) => {
          const subtotal = group.roles.reduce((sum, roleId) => sum + counts[roleId], 0);
          return (
            <li className="board-group" key={group.label}>
              <span className="board-group-label">
                {group.label}（{subtotal}）
              </span>
              <ul>
                {group.roles.map((roleId) => {
                  const displayName = ROLE_DEFINITIONS[roleId].displayName;
                  const count = counts[roleId];
                  const atMax = SINGLE_ROLE_IDS.includes(roleId) && count >= 1;
                  return (
                    <li className="board-role" key={roleId}>
                      <span className="board-role-name">{displayName}</span>
                      <span className="board-counter">
                        <button
                          type="button"
                          aria-label={`减少${displayName}`}
                          disabled={count === 0}
                          onClick={() => adjust(roleId, -1)}
                        >
                          −
                        </button>
                        <span className="board-count">{count}</span>
                        <button
                          type="button"
                          aria-label={`增加${displayName}`}
                          disabled={atMax}
                          onClick={() => adjust(roleId, 1)}
                        >
                          ＋
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <p className="muted">
        共 {total} 人 —— 开局需要 {total} 名玩家全部加入并准备；对局人数与板子人数一致。
      </p>
      {!validation.ok && (
        <ul className="board-issues">
          {validation.issues.map((issue) => (
            <li key={`${issue.code}:${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      )}
      {error !== null && <p className="error">{error}</p>}
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={busy || trimmed.length === 0 || !validation.ok}
          onClick={() => onCreate(trimmed, ruleset)}
        >
          用此板创建房间
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setCounts({ ...THEATER_DEATH_13.roles })}
        >
          恢复默认
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          返回
        </button>
      </div>
    </div>
  );
}
