import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { Modal, Notice } from '../../components/ui.tsx';
import { formatCountdown } from '../../presentation/labels.ts';
import { useIntent } from '../../transport/intent.ts';

interface Invitation { token: string; expiresAt: number; gameId: string; subjectPlayerId: string }
interface ScreenResponse { token?: string; expiresAt?: number; gameId?: string; subjectPlayerId?: string; revoked?: boolean; kind?: string }

/** Always mounted for the current perspective; closing the dialog does not discard an unresolved intent. */
export function SecondScreenPanel({ view, online, open, onClose, refresh, remaining, context }: {
  view: RoomSnapshot; online: boolean; open: boolean; onClose: () => void; refresh: () => Promise<void>;
  remaining: (deadline: number) => number | null; context?: ReactNode;
}) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [token, setToken] = useState(''), [notice, setNotice] = useState(''), [confirmRevoke, setConfirmRevoke] = useState(false);
  const latest = useRef(view); latest.current = view;
  const [, tick] = useState(0);
  const scope = JSON.stringify([view.viewer.userId, view.roomId, view.gameId, view.viewer.memberId, view.viewer.kind, view.viewer.subjectPlayerId]);
  useEffect(() => { setInvitation(null); setToken(''); setNotice(''); setConfirmRevoke(false); }, [scope]);
  useEffect(() => { if (!open) return; const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer); }, [open]);
  const operation = useIntent<ScreenResponse>(scope, async result => {
    const current = latest.current;
    if (result.token && result.expiresAt && result.gameId === current.gameId && result.subjectPlayerId === current.viewer.subjectPlayerId) {
      setInvitation({ token: result.token, expiresAt: result.expiresAt, gameId: result.gameId, subjectPlayerId: result.subjectPlayerId });
      setNotice('邀请已生成，仅将它交给你允许查看身份的人。');
    } else if (result.revoked) { setInvitation(null); setConfirmRevoke(false); setNotice('邀请和已授权的第二屏已撤销。'); }
    else if (result.kind === 'private_spectator' && result.gameId === current.gameId) { setToken(''); setNotice('第二屏授权成功，正在同步观察视角。'); }
    await refresh();
  }, () => { void refresh(); });
  const caps = view.capabilities.room;
  const redeemable = view.room.phase === 'playing' && view.viewer.kind === 'public_spectator' && !!view.gameId;
  const locked = !online || operation.busy || operation.unresolved;
  const run = (action: string, extra: Record<string, unknown> = {}) => {
    if (!locked && view.gameId) void operation.run(`/rooms/${view.room.code}/second-screen/${action}`, { gameId: view.gameId, ...extra });
  };
  if (!open) return null;
  return <Modal title="私人第二屏" context={context} onClose={onClose} dismissible={!operation.busy}>
    <p>第二屏可以查看获准玩家的私人情报，但不能行动、投票或发言。邀请只适用于当前对局。</p>
    {notice && <Notice>{notice}</Notice>}
    {operation.intent?.error && <Notice error>{operation.intent.error}{operation.unresolved && <button className="button" disabled={!online || operation.busy} onClick={() => void operation.retry()}>确认原操作结果</button>}</Notice>}
    {caps.inviteSecondScreen.allowed && <button className="button" disabled={locked} onClick={() => run('invitations')}>{invitation ? '重新生成邀请' : '生成第二屏邀请'}</button>}
    {invitation && remaining(invitation.expiresAt) !== 0 && <section aria-label="本局第二屏邀请"><p>有效时间：{formatCountdown(remaining(invitation.expiresAt))}。重新生成后旧邀请失效。</p><label className="select-field">私人邀请码<input aria-label="私人邀请码" readOnly value={invitation.token} onFocus={event => event.target.select()}/></label><p className="muted">此码不会写入链接或浏览器存储。关闭后可在本页重新查看。</p></section>}
    {invitation && remaining(invitation.expiresAt) === 0 && <p className="muted">邀请已过期，请重新生成。</p>}
    {caps.revokeSecondScreen.allowed && <div className="button-row">{confirmRevoke ? <><span>确认撤销全部本局第二屏授权及邀请？</span><button className="button" disabled={locked} onClick={() => run('revoke')}>确认撤销</button><button className="text-button" onClick={() => setConfirmRevoke(false)}>取消</button></> : <button className="text-button danger-text" disabled={locked} onClick={() => setConfirmRevoke(true)}>撤销第二屏授权</button>}</div>}
    {redeemable && <form onSubmit={event => { event.preventDefault(); if (token.trim()) run('redeem', { token: token.trim() }); }}><label className="select-field">输入私人邀请<input aria-label="输入私人邀请" type="password" autoComplete="off" value={token} maxLength={200} onChange={event => setToken(event.target.value)}/></label><button className="button" disabled={locked || !token.trim()}>兑换第二屏邀请</button></form>}
    {view.viewer.kind === 'private_spectator' && <Notice>当前为私人第二屏，只读观察。授权撤销后将返回公开视角。</Notice>}
  </Modal>;
}
