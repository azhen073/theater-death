import { useEffect, useState } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomMemberDTO, RoomSnapshot } from '../../../../contracts/v2.ts';
import { Avatar, Modal, Notice } from '../../components/ui.tsx';
import { ApiFailure } from '../../transport/http.ts';
import { useIntent } from '../../transport/intent.ts';
import { actionLabels, formatCountdown, presenceLabels, publicPhaseLabel, roomPermissionReasons } from '../../presentation/labels.ts';
import { RulesBook } from '../rules/book.tsx';
import { canManageMember, memberLabel, roomExitMessage, roomExitPresentation } from './policy.ts';

type Confirmation = { action: 'kick' | 'transfer-host'; memberId: string; name: string } | { action: 'leave' | 'dissolve' };
export function Lobby({ view, catalog, online, active = true, remaining, refresh, onExit, onExpired }: {
  view: RoomSnapshot; catalog: CatalogDTO; online: boolean; remaining: (deadline: number) => number | null;
  refresh: () => Promise<void>; onExit: (message: string) => void; onExpired: () => void; active?: boolean;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [rules, setRules] = useState(false);
  useEffect(() => { if (!active) { setRules(false); setConfirmation(null); } }, [active]);
  const [, tick] = useState(0);
  useEffect(() => { if (view.room.emptyDeadline === null) return; const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer); }, [view.room.emptyDeadline]);
  const caps = view.capabilities.room;
  const exit = roomExitPresentation(view);
  const operation = useIntent<Record<string, unknown>>(`${view.viewer.userId}/${view.roomId}/${view.gameId ?? 'lobby'}/${view.viewer.memberId}/${view.viewer.isHost}`, async result => {
    setConfirmation(null);
    if (result.dissolved) onExit('房间已解散。');
    else if (result.left) onExit(roomExitMessage(view, result.seatRetained === true));
    else await refresh();
  }, error => { setConfirmation(null); if (error instanceof ApiFailure && error.code === 'unauthorized') onExpired(); else void refresh(); });
  const locked = !online || operation.busy || operation.unresolved;
  const run = (action: string, body: Record<string, unknown> = {}) => { if (!locked) void operation.run(`/rooms/${view.room.code}/${action}`, body); };
  const confirmationValid = confirmation === null || ('memberId' in confirmation ? canManageMember(view, confirmation.action, confirmation.memberId) : caps[confirmation.action].allowed);
  useEffect(() => { if (!confirmationValid) setConfirmation(null); }, [confirmationValid]);
  const confirm = () => {
    if (!confirmation || !confirmationValid || locked) return;
    run(confirmation.action, 'memberId' in confirmation ? { memberId: confirmation.memberId } : {});
  };
  const mine = view.room.formalMembers.find(member => member.memberId === view.viewer.memberId);
  const readyCount = view.room.formalMembers.filter(member => member.ready).length;
  const isLobby = view.room.phase === 'lobby';
  const target = (member: RoomMemberDTO) => <div className="member-card" key={member.memberId} data-member-id={member.memberId}>
    <Avatar url={member.avatarUrl} name={member.nickname}/><div className="member-card__info"><strong title={`${member.nickname} · UID ${member.uid}`}>{memberLabel(member, view.viewer.userId)}</strong><div className="member-status"><span className={`presence presence--${member.presence}`}>{presenceLabels[member.presence]}</span>{member.kind === 'formal' && isLobby && <span className={member.ready ? 'badge badge--ready' : 'badge'}>{member.ready ? '已准备' : '未准备'}</span>}{member.kind !== 'formal' && <span className="badge">{member.kind === 'private_spectator' ? '私人第二屏' : '公开观众'}</span>}</div></div>
    {(canManageMember(view, 'kick', member.memberId) || canManageMember(view, 'transfer-host', member.memberId)) && <div className="member-tools">
      {canManageMember(view, 'transfer-host', member.memberId) && <button className="text-button" disabled={locked} onClick={() => setConfirmation({ action: 'transfer-host', memberId: member.memberId, name: member.nickname })}>转移房主</button>}
      {canManageMember(view, 'kick', member.memberId) && <button className="text-button danger-text" disabled={locked} onClick={() => setConfirmation({ action: 'kick', memberId: member.memberId, name: member.nickname })}>移出</button>}
    </div>}
  </div>;
  return <>
    <header className="room-heading"><div><span className="eyebrow">{isLobby ? 'BEFORE THE CURTAIN' : 'THE PERFORMANCE'}</span><h1>{isLobby ? '房间大厅' : publicPhaseLabel(view)}</h1></div><div className="room-code"><small>房间码</small><strong>{view.room.code}</strong></div></header>
    {view.viewer.readOnly && <Notice>正在观战 · {view.viewer.kind === 'private_spectator' ? '私人第二屏' : '公开视角'}。你不占正式名额，也不参与准备或行动。</Notice>}
    {view.room.config.mode === 'experimental' && <Notice>实验模式 · 本房间使用自定义角色组成，规则配置已冻结。</Notice>}
    {view.room.emptyDeadline !== null && <Notice>当前无正式玩家，房间将自动解散。剩余 {formatCountdown(remaining(view.room.emptyDeadline))}</Notice>}
    {!view.room.hostMemberId && <Notice>当前暂无房主。在线正式成员的房主归属由服务端同步。</Notice>}
    {operation.intent?.error && <Notice error>{operation.intent.error}{operation.unresolved && <div className="button-row"><button className="button" onClick={() => void refresh()}>读取最新状态</button><button className="button" disabled={!online || operation.busy} onClick={() => void operation.retry()}>确认原操作结果</button></div>}</Notice>}
    {!isLobby && view.public && <section className="panel"><h2>第 {view.public.dayNumber} 轮 · {view.public.phase === 'night' ? '夜晚' : '白天'}</h2><p>公开存活 {view.public.seats.filter(seat => seat.alive).length} 人 · 共 {view.public.seats.length} 个席位</p>{view.tasks.map(task => <p key={`${task.action}/${task.windowInstanceId}`}>当前任务：{actionLabels[task.action]}</p>)}</section>}
    <div className="lobby-grid"><div><section className="panel"><div className="section-title"><h2>正式玩家</h2><span>{view.room.formalMembers.length} / {view.room.requiredPlayers} 人</span></div>{isLobby && <p className="muted">已准备 {readyCount} / {view.room.requiredPlayers}。开局后重新随机座位与角色。</p>}<div className="members-list">{view.room.formalMembers.map(target)}</div></section>
      <section className="panel"><div className="section-title"><h2>观战者</h2><span>{view.room.spectators.length} 人</span></div>{view.room.spectators.length ? <div className="members-list">{view.room.spectators.map(target)}</div> : <p className="muted">暂时没有观众。</p>}
        {view.viewer.readOnly && isLobby && <><button className="button" disabled={locked || !caps.promote.allowed} onClick={() => run('promote')}>加入对局</button>{!caps.promote.allowed && <p className="muted">{roomPermissionReasons[caps.promote.reason ?? ''] ?? '当前无法转为正式玩家。'}</p>}</>}
      </section></div>
      <aside className="panel room-rules"><span className="eyebrow">THIS PERFORMANCE</span><h2>本局规则</h2><p>{view.room.requiredPlayers} 人 · {view.room.config.mode === 'formal' ? '正式模式' : '实验模式'}</p><dl>{catalog.roles.filter(role => view.room.config.roles[role.roleId] > 0).map(role => <div key={role.roleId}><dt>{role.name}</dt><dd>{view.room.config.roles[role.roleId]} 人</dd></div>)}</dl><p className="muted">配置已冻结，下一局也保持不变。</p><button className="button button--wide" onClick={() => setRules(true)}>查看完整规则</button></aside>
    </div>
    <footer className="room-actions"><div><button className="text-button" disabled={locked || !caps.leave.allowed} onClick={() => setConfirmation({ action: 'leave' })}>{exit.label}</button>{caps.dissolve.allowed && <button className="text-button danger-text" disabled={locked} onClick={() => setConfirmation({ action: 'dissolve' })}>解散房间</button>}</div><div className="button-row">
      {caps.ready.allowed && <button className="button" disabled={locked} onClick={() => run('ready', { ready: !mine?.ready })}>{mine?.ready ? '取消准备' : '准备'}</button>}
      {view.viewer.isHost && isLobby && <div className="start-control"><button className="button button--primary" disabled={locked || !caps.start.allowed} onClick={() => run('start')}>{operation.busy ? '正在确认…' : '开始游戏'}</button>{!caps.start.allowed && <span>{roomPermissionReasons[caps.start.reason ?? ''] ?? '暂时不能开局。'}</span>}</div>}
    </div></footer>
    {active && rules && <RulesBook catalog={catalog} onClose={() => setRules(false)}/>}
    {active && confirmation && confirmationValid && <Modal title={confirmation.action === 'kick' ? '移出成员？' : confirmation.action === 'transfer-host' ? '转移房主？' : confirmation.action === 'dissolve' ? '解散房间？' : exit.title} onClose={() => setConfirmation(null)} dismissible={!operation.busy}>
      <p>{confirmation.action === 'kick' ? `将 ${confirmation.name} 移出当前房间。这不是封禁，对方仍可重新加入。` : confirmation.action === 'transfer-host' ? `将房主管理权交给 ${confirmation.name}，准备状态保持不变。` : confirmation.action === 'dissolve' ? '所有成员将退出，房间码立即失效。' : exit.description}</p>
      <div className="button-row"><button className="button" disabled={operation.busy} onClick={() => setConfirmation(null)}>取消</button><button className="button button--primary" disabled={locked || !confirmationValid} onClick={confirm}>{operation.busy ? '正在确认…' : '确认操作'}</button></div>
    </Modal>}
  </>;
}
