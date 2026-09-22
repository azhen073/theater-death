import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { RuleMarkdown } from '../rules/book.tsx';
import { PhaseAbility } from './phase-ability.tsx';

export function authorizedPrivate(view: RoomSnapshot) {
  return view.viewer.kind !== 'public_spectator' && view.private?.self.playerId === view.viewer.subjectPlayerId ? view.private : null;
}

export function Identity({ view, catalog }: { view: RoomSnapshot; catalog: CatalogDTO }) {
  const privateView = authorizedPrivate(view);
  if (!privateView) return <p>当前视角没有私人身份信息。</p>;
  const self = privateView.self;
  const role = catalog.roles.find(item => item.roleId === self.roleId);
  const victory = catalog.rulebook.chapters.find(chapter => chapter.title.includes('胜利'));
  const knownSpiritSeats = privateView.knowledge?.spiritSeats ?? [];
  const knowledgeLabel = self.roleId === 'spirit' ? '魂灵同伴' : '魂灵';
  return <div className="identity-view"><p className="private-label">{view.viewer.readOnly ? `当前观察视角 · ${self.seat}号 ${self.nickname}` : '仅自己可见'}</p>
    {role && <img className="identity-card" src={`/assets/cards/${role.roleId}.png`} alt={`${role.name}身份卡`}/>}
    <h3>{role?.name ?? '身份信息'}</h3><p>{role?.faction === 'human' ? '人类阵营' : role?.faction === 'death_faction' ? '死神阵营' : ''} · {self.seat}号席位</p><p>{role?.description}</p>
    {view.public && <PhaseAbility roleId={self.roleId} stage={view.public.stage} catalog={catalog} readOnly={view.viewer.readOnly} />}
    {knownSpiritSeats.length > 0 && <p className="identity-known">已知身份 · {knowledgeLabel}：{knownSpiritSeats.map(seat => `${seat}号`).join('、')}</p>}
    <dl className="identity-state"><div><dt>身份翻牌</dt><dd>{self.revealed ? '已公开' : '未公开'}</dd></div><div><dt>票权状态</dt><dd>{self.voteFrozen ? '当前被冻结' : '按当前投票资格执行'}</dd></div>{self.roleId === 'laike' && <div><dt>刺杀使用</dt><dd>{self.abilities.laikeBladeUsed ? '已使用过' : '尚未使用'}</dd></div>}{self.roleId === 'water' && <div><dt>还魂曲</dt><dd>{self.abilities.waterRescueUsed ? '已使用' : '尚未使用'}</dd></div>}</dl>
    {self.guardHistory.length > 0 && <details><summary>你的守护历史</summary>{self.guardHistory.map(record => <p key={record.nightNumber}>第 {record.nightNumber} 夜：{record.targetPlayerIds.map(id => view.public?.seats.find(seat => seat.playerId === id)?.seat).filter(seat => seat !== undefined).map(seat => `${seat}号`).join('、') || '空守'}</p>)}</details>}
    {victory && <details><summary>配置与胜利条件</summary><RuleMarkdown markdown={victory.markdown}/></details>}
  </div>;
}
