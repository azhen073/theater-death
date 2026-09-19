import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AuthMe } from '../../../../contracts/v2.ts';
import type { BootstrapDTO } from '../../../../contracts/catalog.ts';
import { Emblem, Field, Notice } from '../../components/ui.tsx';
import { ApiFailure, UnknownResult, errorMessage, post } from '../../transport/http.ts';
import { newRequestId } from '../../transport/ids.ts';

export function AuthPage({ bootstrap, onLogin }: { bootstrap: BootstrapDTO; onLogin: (profile: AuthMe) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [uid, setUid] = useState(''), [nickname, setNickname] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [created, setCreated] = useState<AuthMe | null>(null);
  const requestId = useRef(newRequestId()), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const changeMode = (next: typeof mode) => { setMode(next); setError(''); setNotice(''); setPassword(''); setConfirmation(''); setShow(false); if (next === 'register') requestId.current = newRequestId(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setError(''); setNotice('');
    if (mode === 'register' && password !== confirmation) { setError('两次输入的密码不一致。'); return; }
    setBusy(true);
    try {
      const profile = await post<AuthMe>(`/auth/${mode}`, mode === 'login' ? { uid, password } : { requestId: requestId.current, nickname, password });
      if (!active.current) return;
      setPassword(''); setConfirmation('');
      if (mode === 'register') setCreated(profile); else onLogin(profile);
    } catch (failure) {
      if (!active.current) return;
      if (mode === 'register' && failure instanceof UnknownResult) setNotice('注册结果尚未确认。请保持本页并重试，系统会使用同一请求确认原账号，不会重复创建。');
      else setError(errorMessage(failure));
    } finally { if (active.current) setBusy(false); }
  };
  if (created) return <main className="auth-layout"><section className="auth-world" aria-label="剧院死神"><div className="auth-world__image"/></section><section className="auth-panel"><div className="auth-card"><span className="eyebrow">YOUR UID</span><h2>账号创建成功</h2><Notice>请保存数字 UID；以后使用 UID 和密码登录。</Notice><label className="field"><span className="field__label">登录 UID</span><input readOnly value={created.uid} onFocus={event => event.currentTarget.select()}/></label><p>昵称：{created.nickname}</p><div className="button-row"><button className="button" onClick={() => void navigator.clipboard.writeText(created.uid)}>复制 UID</button><button className="button button--primary" onClick={() => onLogin(created)}>进入剧院</button></div></div></section></main>;
  return <main className="auth-layout">
    <section className="auth-world" aria-label="剧院死神"><div className="auth-world__image"/><div className="auth-world__content"><span className="eyebrow">THEATER DEATH · 序幕</span><Emblem/><h1>剧院死神</h1><p className="auth-world__subtitle">一场关于谎言与灵魂的演出</p><div className="fine-rule"/><p className="auth-world__quote">灯光熄灭之后，<br/>每个人都有自己的秘密。</p></div><span className="auth-world__foot">九种身份 · 两重幕间 · 一场未知的结局</span></section>
    <section className="auth-panel"><div className="auth-panel__brand"><Emblem/><span>THEATER DEATH</span></div><div className="auth-card"><span className="eyebrow">{mode === 'login' ? 'WELCOME TO THE THEATER' : 'CREATE YOUR IDENTITY'}</span><h2>{mode === 'login' ? '欢迎入席' : '创建账号'}</h2><p className="muted">{mode === 'login' ? '使用数字 UID 和密码回到这场演出。' : '设置公开昵称和密码，系统将分配永久 UID。'}</p>
      <form onSubmit={event => void submit(event)}><fieldset disabled={busy}>
        {mode === 'login' ? <Field label="数字 UID" value={uid} onChange={event => setUid(event.target.value)} inputMode="numeric" autoComplete="username" required minLength={bootstrap.auth.uid.minLength} maxLength={bootstrap.auth.uid.maxLength} pattern="[0-9]+"/> : <Field label="昵称" value={nickname} onChange={event => setNickname(event.target.value)} autoComplete="nickname" required minLength={bootstrap.auth.nickname.minLength} maxLength={bootstrap.auth.nickname.maxLength} hint="2–32个字符，可使用各语言文字和下划线；不允许数字、空格或Emoji。"/>}
        <div className="password-label"><span>密码</span><button type="button" className="text-button" onClick={() => setShow(!show)} aria-pressed={show}>{show ? '隐藏密码' : '显示密码'}</button></div>
        <Field label={mode === 'login' ? '登录密码' : '设置密码'} className="password-input" type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required minLength={mode === 'login' ? 1 : bootstrap.auth.password.minLength} maxLength={mode === 'login' ? 128 : bootstrap.auth.password.maxLength} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} hint={mode === 'register' ? '长度为 8–16 个字符。' : undefined}/>
        {mode === 'register' && <Field label="确认密码" type={show ? 'text' : 'password'} value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={bootstrap.auth.password.minLength} maxLength={bootstrap.auth.password.maxLength} autoComplete="new-password"/>}
        {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}<button className="button button--primary button--wide" type="submit">{busy ? '正在确认…' : mode === 'login' ? '进入剧院' : '创建账号'}<span aria-hidden="true">→</span></button>
      </fieldset></form><div className="auth-switch">{mode === 'login' ? bootstrap.auth.registration === 'open' ? <><span>还没有账号？</span><button disabled={busy} className="text-button" onClick={() => changeMode('register')}>直接注册</button></> : <span>暂未开放新账号注册</span> : <button disabled={busy} className="text-button" onClick={() => changeMode('login')}>← 返回登录</button>}</div>
    </div><footer className="auth-foot">请妥善保存 UID。你的身份，只属于你的视角。</footer></section>
  </main>;
}
