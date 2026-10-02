import { useState } from 'react';
import type { FormEvent } from 'react';
import type { BootstrapDTO, CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoleId } from '../../../../rulesets/types.ts';
import type { PublicChatMode } from '../../../../contracts/v2.ts';
import type { RoomEntry } from '../../transport/types.ts';
import { Field, Notice, PageHeading } from '../../components/ui.tsx';
import { publicChatLabel } from '../../presentation/labels.ts';
import { ApiFailure } from '../../transport/http.ts';
import { useIntent } from '../../transport/intent.ts';
import { boardIssues, roleTotal } from './configuration.ts';

export function CreateRoom({ userId, catalog, bootstrap, blocked, loading, onCreated, onExpired, onBack }: {
  userId: string; catalog: CatalogDTO; bootstrap: BootstrapDTO; blocked: boolean; loading: boolean;
  onCreated: (entry: RoomEntry) => void; onExpired: () => void; onBack: () => void;
}) {
  const preset = catalog.presets.find(item => item.presetId === 'default-13') ?? catalog.presets[0];
  const [custom, setCustom] = useState(false);
  const [roles, setRoles] = useState<Record<RoleId, number>>(() => preset ? structuredClone(preset.config.roles) : Object.fromEntries(catalog.roles.map(role => [role.roleId, 0])) as Record<RoleId, number>);
  const [count, setCount] = useState(preset?.playerCount ?? 13);
  // 公屏写权限必须由房主显式选择，没有默认值：未选时不能提交。
  const [publicChat, setPublicChat] = useState<PublicChatMode | null>(null);
  // 白天「自由发言」阶段同样必须显式选择（开启/不开启），没有默认值。
  const [freeSpeech, setFreeSpeech] = useState<boolean | null>(null);
  const operation = useIntent<RoomEntry>(userId, onCreated, error => { if (error instanceof ApiFailure && error.code === 'unauthorized') onExpired(); });
  if (!preset) return <Notice error>当前没有可创建的版型，请返回首页重新连接。</Notice>;
  const issues = custom ? boardIssues(roles, catalog) : [];
  if (custom && count !== roleTotal(roles)) issues.push(`当前角色合计 ${roleTotal(roles)} 人，与设定的 ${count} 人不一致。`);
  const locked = loading || blocked || operation.busy || operation.unresolved;
  const reset = () => { setCustom(false); setRoles(structuredClone(preset.config.roles)); setCount(preset.playerCount); };
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (locked || issues.length || publicChat === null || freeSpeech === null) return;
    void operation.run('/rooms', { ...(custom ? { roles, playerCount: count } : { presetId: preset.presetId }), publicChat, freeSpeech });
  };
  return <><PageHeading eyebrow="A NEW PERFORMANCE" title="开启一场演出">先确定人数与角色组成，再邀请同伴入席。</PageHeading>
    {blocked && <Notice>你已有当前房间，请先返回该房间；需要重新创建时，请明确离开原房间。</Notice>}
    {loading && <Notice>正在确认你的当前房间状态…</Notice>}
    <form onSubmit={submit}><section className="panel"><h2>选择版型</h2><div className="preset-row"><button type="button" className={`preset-choice ${!custom ? 'selected' : ''}`} disabled={locked} onClick={reset}><strong>{preset.name}</strong><span>{preset.playerCount} 人 · 正式模式</span></button>
      {bootstrap.features.customBoards && <button type="button" className={`preset-choice ${custom ? 'selected' : ''}`} disabled={locked} onClick={() => setCustom(true)}><strong>自定义角色组成</strong><span>实验模式 · 创建后固定</span></button>}</div>
      {custom && <Field label="玩家人数" type="number" min={catalog.constraints.minPlayers} max={catalog.constraints.maxPlayers} required value={count} disabled={locked} onChange={event => setCount(Number(event.target.value))} hint={`支持 ${catalog.constraints.minPlayers}–${catalog.constraints.maxPlayers} 人，请让角色合计与人数一致。`}/>}</section>
      <section className="panel"><div className="section-title"><h2>角色组成</h2><span className="badge">合计 {roleTotal(roles)} 人</span></div><div className="role-config-grid">{catalog.roles.map(role => <label key={role.roleId} className="role-config"><span><strong>{role.name}</strong><small>{role.faction === 'human' ? '人类阵营' : '死神阵营'}</small></span><input aria-label={`${role.name}人数`} type="number" min={0} max={catalog.constraints.repeatableRoleIds.includes(role.roleId) ? catalog.constraints.maxPlayers : 1} value={roles[role.roleId]} disabled={!custom || locked} onChange={event => setRoles({ ...roles, [role.roleId]: Number(event.target.value) })}/></label>)}</div></section>
      <section className="panel"><h2>公屏权限</h2><p className="muted">对局内所有阶段（含夜间）都可发言，白天与夜间不再区别；这里只决定谁可以写，创建后不可修改。观众与第二屏始终只读。</p>
        <div className="preset-row" role="radiogroup" aria-label="公屏权限">
          <button type="button" role="radio" aria-checked={publicChat === 'alive_only'} aria-label="公屏权限：仅存活正式玩家" className={`preset-choice ${publicChat === 'alive_only' ? 'selected' : ''}`} disabled={locked} onClick={() => setPublicChat('alive_only')}><strong>仅存活正式玩家</strong><span>死者只读；本人遗言期间仍可发言</span></button>
          <button type="button" role="radio" aria-checked={publicChat === 'everyone'} aria-label="公屏权限：存活与死者全体" className={`preset-choice ${publicChat === 'everyone' ? 'selected' : ''}`} disabled={locked} onClick={() => setPublicChat('everyone')}><strong>存活与死者全体</strong><span>出局后仍可在公屏发言（含夜间）</span></button>
        </div>
        {publicChat === null && <Notice>请先选择公屏权限：这一项没有默认值，创建后不可修改。</Notice>}</section>
      <section className="panel"><h2>白天自由发言</h2><p className="muted">开启后，每个白天的「发言轮」结束、放逐投票开始之前，插入一段固定 2 分钟的自由发言：存活玩家可开麦，不会因为无人发言提前结束；死者仍只能旁听。创建后不可修改。</p>
        <div className="preset-row" role="radiogroup" aria-label="白天自由发言">
          <button type="button" role="radio" aria-checked={freeSpeech === true} aria-label="自由发言：开启" className={`preset-choice ${freeSpeech === true ? 'selected' : ''}`} disabled={locked} onClick={() => setFreeSpeech(true)}><strong>开启</strong><span>发言轮后 2 分钟 · 存活玩家可开麦</span></button>
          <button type="button" role="radio" aria-checked={freeSpeech === false} aria-label="自由发言：不开启" className={`preset-choice ${freeSpeech === false ? 'selected' : ''}`} disabled={locked} onClick={() => setFreeSpeech(false)}><strong>不开启</strong><span>保持现有白天流程</span></button>
        </div>
        {freeSpeech === null && <Notice>请先选择是否开启白天自由发言：这一项没有默认值，创建后不可修改。</Notice>}</section>
      <section className="panel"><h2>确认本局配置</h2><p>{custom ? '实验模式' : '正式模式'} · {count} 人 · 规则 {catalog.rulesVersion}</p><p>{publicChat === null ? '公屏权限：尚未选择' : `公屏权限：${publicChatLabel[publicChat]}`}</p><p>{freeSpeech === null ? '白天自由发言：尚未选择' : `白天自由发言：${freeSpeech ? '开启（2 分钟）' : '不开启'}`}</p><p className="muted">房间创建后，人数、角色组成、公屏权限与自由发言开关不可修改。再来一局也沿用这份配置；更换版型需要重新开房。</p>
        {issues.length > 0 && <Notice error><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></Notice>}
        {operation.intent?.error && <Notice error>{operation.intent.error}</Notice>}
        {operation.unresolved && <button type="button" className="button" onClick={() => void operation.retry()}>以原请求确认创建结果</button>}
        <div className="button-row"><button type="button" className="button" onClick={onBack}>返回首页</button><button type="submit" className="button button--primary" disabled={locked || issues.length > 0 || publicChat === null || freeSpeech === null}>{operation.busy ? '正在创建…' : '创建房间'}</button></div>
      </section></form></>;
}
