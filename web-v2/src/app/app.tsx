import { useEffect, useRef, useState } from 'react';
import type { AuthMe, Profile } from '../../../contracts/v2.ts';
import type { BootstrapDTO, CatalogDTO } from '../../../contracts/catalog.ts';
import { Emblem, Notice } from '../components/ui.tsx';
import { AuthPage } from '../features/auth/auth.tsx';
import { acceptProfile } from '../state/snapshot.ts';
import { ApiFailure, errorMessage, get } from '../transport/http.ts';
import { navigate } from './navigation.ts';
import { AuthenticatedShell } from './shell.tsx';
import { useDisplayPreferences } from '../state/preferences.ts';
import { useKeyboardViewport } from '../state/keyboard-viewport.ts';
import '../styles/main.css';
import '../styles/preferences.css';

type Boot = { bootstrap: BootstrapDTO; catalog: CatalogDTO; profile: AuthMe | null };
export function App() {
  useDisplayPreferences();
  useKeyboardViewport();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  const initialRoomLink = useRef(/^#\/room\/[a-z2-9]{6}$/i.test(window.location.hash) ? window.location.hash.slice(1) : null);
  useEffect(() => {
    const abort = new AbortController(); setFailure('');
    void Promise.all([
      get<BootstrapDTO>('/bootstrap', abort.signal), get<CatalogDTO>('/catalog', abort.signal),
      get<AuthMe>('/auth/me', abort.signal).catch(error => { if (error instanceof ApiFailure && error.code === 'unauthorized') return null; throw error; }),
    ]).then(([bootstrap, catalog, profile]) => {
      if (abort.signal.aborted) return;
      if (bootstrap.contractVersion !== '2.2' || bootstrap.rulesVersion !== '2.0' || catalog.rulesVersion !== '2.0') { setFailure('当前服务版本与页面不匹配，请使用配套入口。'); return; }
      setBoot({ bootstrap, catalog, profile });
    }).catch(error => { if (!abort.signal.aborted) setFailure(errorMessage(error)); });
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => {
    const userId = boot?.profile?.userId;
    if (!userId) return;
    const abort = new AbortController(); let revision = 0;
    const verify = async () => {
      if (document.visibilityState !== 'visible') return;
      const ticket = ++revision;
      try {
        const incoming = await get<AuthMe>('/auth/me', abort.signal);
        if (abort.signal.aborted || ticket !== revision) return;
        setBoot(current => {
          if (!current?.profile || current.profile.userId !== userId) return current;
          if (incoming.userId !== userId) return { ...current, profile: incoming };
          const accepted = acceptProfile(current.profile, incoming, userId);
          return { ...current, profile: accepted ? { ...accepted, expiresAt: incoming.expiresAt } : current.profile };
        });
      } catch (error) {
        if (!abort.signal.aborted && ticket === revision && error instanceof ApiFailure && error.code === 'unauthorized') setBoot(current => current?.profile?.userId === userId ? { ...current, profile: null } : current);
      }
    };
    window.addEventListener('focus', verify); document.addEventListener('visibilitychange', verify);
    return () => { abort.abort(); window.removeEventListener('focus', verify); document.removeEventListener('visibilitychange', verify); };
  }, [boot?.profile?.userId]);
  if (!boot) return <main className="splash"><Emblem/><h1>剧院死神</h1>{failure ? <><Notice error>{failure}</Notice><button className="button" onClick={() => setAttempt(attempt + 1)}>重新连接</button></> : <p role="status">正在点亮剧院…</p>}</main>;
  if (!boot.profile) return <AuthPage bootstrap={boot.bootstrap} onLogin={profile => { navigate(initialRoomLink.current ?? '/'); initialRoomLink.current = null; setBoot({ ...boot, profile }); }}/>;
  const replaceProfile = (incoming: Profile) => setBoot(current => {
    if (!current?.profile) return current;
    const profile = acceptProfile(current.profile, incoming, current.profile.userId);
    return profile ? { ...current, profile: { ...profile, expiresAt: current.profile.expiresAt } } : current;
  });
  const ownerId = boot.profile.userId;
  const logout = () => setBoot(current => {
    if (current?.profile?.userId !== ownerId) return current;
    initialRoomLink.current = null;
    return { ...current, profile: null };
  });
  return <AuthenticatedShell key={boot.profile.userId} profile={boot.profile} bootstrap={boot.bootstrap} catalog={boot.catalog} onProfile={replaceProfile} onLogout={logout}/>;
}
