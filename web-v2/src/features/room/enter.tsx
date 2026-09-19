import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Field, Modal, Notice, PageHeading } from '../../components/ui.tsx';
import { ApiFailure } from '../../transport/http.ts';
import { useIntent } from '../../transport/intent.ts';
import type { RoomEntry } from '../../transport/types.ts';

export function EnterRoom({ userId, initialCode = '', blocked, loading, onEntered, onExpired, onBack }: {
  userId: string; initialCode?: string; blocked: boolean; loading: boolean; onEntered: (entry: RoomEntry) => void; onExpired: () => void; onBack: () => void;
}) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [takeover, setTakeover] = useState(false);
  useEffect(() => { setCode(initialCode.toUpperCase()); setTakeover(false); }, [initialCode]);
  const operation = useIntent<RoomEntry>(`${userId}/${code}`, onEntered, error => {
    if (error instanceof ApiFailure && error.code === 'unauthorized') onExpired();
    if (error instanceof ApiFailure && error.code === 'takeover_required') setTakeover(true);
  });
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (loading || blocked || operation.busy || operation.unresolved) return;
    void operation.run(`/rooms/${encodeURIComponent(code.trim().toUpperCase())}/enter`);
  };
  return <><PageHeading eyebrow="TAKE YOUR SEAT" title="加入房间">使用同伴分享的六位房间码，回到同一场演出。</PageHeading>
    <section className="panel compact-panel"><form onSubmit={submit}><Field label="房间码" value={code} onChange={event => setCode(event.target.value.trim().toUpperCase())} required minLength={6} maxLength={6} pattern="[A-Z2-9]{6}" autoComplete="off" spellCheck={false} disabled={loading || operation.busy || operation.unresolved || blocked} hint="房间码用于入房，不是注册邀请码。"/>
      <p className="muted">正式席位已满或演出已经开始时，新成员以观众身份入场。本局原玩家返回会恢复自己的身份。</p>
      {blocked && <Notice>请先返回或明确离开当前房间，再进入其他房间。</Notice>}
      {loading && <Notice>正在确认你的当前房间状态…</Notice>}
      {operation.intent?.error && !takeover && <Notice error>{operation.intent.error}</Notice>}
      {operation.unresolved && <button type="button" className="button" onClick={() => void operation.retry()}>以原请求确认入房结果</button>}
      <div className="button-row"><button type="button" className="button" onClick={onBack}>返回首页</button><button className="button button--primary" disabled={loading || blocked || operation.busy || operation.unresolved} type="submit">{operation.busy ? '正在进入…' : '进入房间'}</button></div>
    </form></section>
    {takeover && <Modal title="接管当前身份？" onClose={() => setTakeover(false)} dismissible={!operation.busy}><p>这个房间身份正在另一台设备上使用。接管后，旧设备将失去读取和操作权限。</p><div className="button-row"><button className="button" disabled={operation.busy} onClick={() => setTakeover(false)}>取消</button><button className="button button--primary" disabled={operation.busy} onClick={() => { void operation.run(`/rooms/${encodeURIComponent(code)}/takeover`); setTakeover(false); }}>确认接管</button></div></Modal>}
  </>;
}
