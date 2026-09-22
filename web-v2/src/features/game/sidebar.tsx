import { useState } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { EventDTO, RoomSnapshot } from '../../../../contracts/v2.ts';
import { authorizedPrivate } from './identity.tsx';
import { PhaseAbility } from './phase-ability.tsx';
import { ChatChannelView } from '../chat/channel.tsx';
import { EventHistory } from './event-history.tsx';
import { navigateTabs } from '../../components/tab-navigation.ts';

export function GameSidebar({ view, catalog, online, readingPaused, refresh, onIdentity, onRules, onEvent }: { view: RoomSnapshot; catalog: CatalogDTO; online: boolean; readingPaused: boolean; refresh: () => Promise<void>; onIdentity: () => void; onRules: () => void; onEvent: (event: EventDTO) => void }) {
  const [tab, setTab] = useState<'public' | 'intel' | 'records' | 'rules'>('public');
  const [unread, setUnread] = useState({ public: 0, faction: 0, intel: 0, records: 0 });
  const privateView = authorizedPrivate(view);
  const counts = { public: unread.public, intel: unread.intel + unread.faction, records: unread.records };
  const markUnread = (key: keyof typeof unread, count: number) => setUnread(old => old[key] === count ? old : { ...old, [key]: count });
  return <aside className="game-sidebar" aria-label="信息侧栏"><div className="info-tabs" role="tablist" aria-label="对局信息">{([['public', '公屏'], ['intel', '情报'], ['records', '记录'], ['rules', '规则']] as const).map(([key, label]) => <button role="tab" type="button" key={key} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onKeyDown={navigateTabs} aria-controls={`panel-${key}`} id={`tab-${key}`} onClick={() => setTab(key)}>{label}{key !== 'rules' && counts[key] > 0 && <span className="unread-dot" aria-label="有新内容"/>}</button>)}</div>
    <div className="info-panel" id="panel-public" role="tabpanel" aria-labelledby="tab-public" hidden={tab !== 'public'}><h2>公屏记录</h2><ChatChannelView view={view} channel="public" online={online} active={tab === 'public' && !readingPaused} refresh={refresh} onUnread={count => markUnread('public', count)}/></div>
    <div className="info-panel" id="panel-intel" role="tabpanel" aria-labelledby="tab-intel" hidden={tab !== 'intel'}><h2>当前视角情报</h2>{privateView ? <><button className="button button--wide" onClick={onIdentity}>{view.viewer.readOnly ? '查看观察身份' : '查看我的身份'}</button>
      {view.public && <PhaseAbility roleId={privateView.self.roleId} stage={view.public.stage} catalog={catalog} readOnly={view.viewer.readOnly} />}
      <EventHistory events={privateView.events} view={view} catalog={catalog} onDetail={onEvent} label="私人事件" active={tab === 'intel' && !readingPaused} onUnread={count => markUnread('intel', count)}/>
      {privateView.factionRoom && <section><h3>阵营交流记录{privateView.factionRoom.readOnly ? ' · 只读' : ''}</h3><ChatChannelView view={view} channel="faction" online={online} active={tab === 'intel' && !readingPaused} refresh={refresh} onUnread={count => markUnread('faction', count)}/></section>}
    </> : <p className="muted">公开观众没有私人情报或个人角色。</p>}</div>
    <div className="info-panel" id="panel-records" role="tabpanel" aria-labelledby="tab-records" hidden={tab !== 'records'}><h2>公共事件</h2><EventHistory events={view.public?.events ?? []} view={view} catalog={catalog} onDetail={onEvent} label="公共事件" active={tab === 'records' && !readingPaused} onUnread={count => markUnread('records', count)}/></div>
    <div className="info-panel" id="panel-rules" role="tabpanel" aria-labelledby="tab-rules" hidden={tab !== 'rules'}><h2>规则 {catalog.rulesVersion}</h2><p className="muted">本局 {view.room.requiredPlayers} 人，{view.room.config.mode === 'formal' ? '正式模式' : '实验模式'}。以冻结配置与服务端任务为准。</p><button className="button button--wide" onClick={onRules}>打开完整规则</button>{privateView && <p>{catalog.roles.find(role => role.roleId === privateView.self.roleId)?.description}</p>}</div>
  </aside>;
}
