import { useEffect, useRef, useState } from 'react';
import type { CatalogDTO } from '../contracts/catalog.ts';
import type { RoomSnapshot } from '../contracts/v2.ts';
import { useKeyboardViewport } from '../web-v2/src/state/keyboard-viewport.ts';
import { useDisplayPreferences } from '../web-v2/src/state/preferences.ts';
import { GameScene } from '../web-v2/src/features/game/scene.tsx';
import { DeathNotice } from '../web-v2/src/features/game/death-notice.tsx';
import { identityRevealKey } from '../web-v2/src/features/game/identity-reveal-model.ts';
import { VoiceBar, type VoiceSessionLike } from '../web-v2/src/features/voice/bar.tsx';
import type { VoiceState } from '../web-v2/src/features/voice/session.ts';
import { Lobby } from '../web-v2/src/features/room/lobby.tsx';
import { ReviewPage } from '../web-v2/src/features/review/page.tsx';
import '../web-v2/src/styles/main.css';
import '../web-v2/src/styles/preferences.css';

/** 只驱动界面的语音会话桩：状态来自夹具，音量调用记录到 window.__voiceCalls 供用例断言。 */
const voiceStub = (() => {
  const base: VoiceState = { connection: 'idle', requested: false, microphoneEnabled: false, audioBlocked: false, error: '', microphoneError: '', notice: '', devices: [], activeDeviceId: '', level: 0, remoteLevel: 0 };
  let state: VoiceState = base;
  const listeners = new Set<(next: VoiceState) => void>();
  const calls: string[] = [];
  const push = (patch: Partial<VoiceState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(state); };
  const session: VoiceSessionLike & { hydrate(next?: Partial<VoiceState>): void; calls: string[] } = {
    calls,
    state: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setContext: () => undefined,
    join: async () => { calls.push('join'); push({ connection: 'connected' }); },
    leave: async () => { calls.push('leave'); push({ connection: 'idle', microphoneEnabled: false, level: 0, remoteLevel: 0 }); },
    requestMicrophone: async () => { calls.push('mic'); push({ requested: false, microphoneEnabled: true }); },
    stopMicrophone: () => push({ requested: false, microphoneEnabled: false, level: 0 }),
    switchDevice: async () => undefined,
    enableAudio: async () => push({ audioBlocked: false }),
    setOutputVolume: (volume) => { calls.push(`output:${volume}`); },
    setInputVolume: (volume) => { calls.push(`input:${volume}`); },
    hydrate: (next) => { state = { ...base, ...(next ?? {}) }; for (const listener of listeners) listener(state); },
  };
  (window as unknown as { __voiceCalls?: string[] }).__voiceCalls = calls;
  return session;
})();

export interface GameHarnessFixture { view: RoomSnapshot; catalog: CatalogDTO; online: boolean; active?: boolean; voice?: Partial<VoiceState>; identityReveal?: 'enabled' | 'seen' }
const updateEvent = 'v2-game-fixture-update';

function sceneKey(view: RoomSnapshot): string {
  return [view.room.phase, view.viewer.userId, view.roomId, view.gameId, view.viewer.memberId, view.viewer.kind, view.viewer.subjectPlayerId].join('/');
}

export function GameHarness() {
  useDisplayPreferences();
  useKeyboardViewport();
  const [fixture, setFixture] = useState<GameHarnessFixture | null>(null);
  const [terminal, setTerminal] = useState('');
  const roomRoot = useRef<HTMLElement>(null);
  const sample = useRef<{ server: number; local: number } | null>(null);
  useEffect(() => {
    let active = true;
    const apply = (next: GameHarnessFixture) => {
      if (!active) return;
      const revealKey = identityRevealKey(next.view);
      if (revealKey && next.identityReveal !== 'enabled') sessionStorage.setItem(revealKey, 'test-seen');
      setFixture(next);
      const now = performance.now();
      if (!sample.current || next.view.serverTime > sample.current.server) sample.current = { server: next.view.serverTime, local: now };
    };
    void fetch('/__game-fixture').then(response => response.json() as Promise<GameHarnessFixture>).then(apply);
    const onUpdate = (event: Event) => apply((event as CustomEvent<GameHarnessFixture>).detail);
    window.addEventListener(updateEvent, onUpdate);
    return () => { active = false; window.removeEventListener(updateEvent, onUpdate); };
  }, []);
  const voiceKey = JSON.stringify(fixture?.voice ?? null);
  useEffect(() => { voiceStub.hydrate(voiceKey === 'null' ? undefined : JSON.parse(voiceKey) as Partial<VoiceState>); }, [voiceKey]);
  if (terminal) return <main className="splash"><p role="status">测试终态：{terminal}</p></main>;
  if (!fixture) return <main className="splash"><p role="status">正在加载隔离对局夹具…</p></main>;
  const { view, catalog, online } = fixture;
  const remaining = (deadline: number) => {
    if (!sample.current) return null;
    const estimated = sample.current.server + Math.max(0, performance.now() - sample.current.local);
    return Math.max(0, deadline - estimated);
  };
  const refresh = async () => {
    applyFixture(await (await fetch('/__game-fixture')).json() as GameHarnessFixture);
  };
  const props = { view, catalog, online, active: fixture.active ?? true, remaining, refresh, onExit: (message: string) => { setFixture(null); setTerminal(message); }, onExpired: () => { setFixture(null); setTerminal('登录已失效'); } };
  const content = view.room.phase === 'playing' && view.public
    ? <GameScene key={sceneKey(view)} {...props}/>
    : view.room.phase === 'review'
      ? <ReviewPage key={sceneKey(view)} {...props}/>
      : <Lobby key={sceneKey(view)} {...props}/>;
  return <main className={`home-layout ${view.room.phase === 'playing' ? 'home-layout--playing' : ''}`}><aside className="navigation" aria-hidden="true"/><section className="home-main" ref={roomRoot}>
    <DeathNotice view={view} online={online} active={fixture.active ?? true} rootRef={roomRoot}/>
    {fixture.voice && <VoiceBar enabled view={view} online={online} activePage={view.room.phase === 'playing'} session={voiceStub}/>}
    {content}
  </section></main>;
}

function applyFixture(next: GameHarnessFixture): void {
  window.dispatchEvent(new CustomEvent(updateEvent, { detail: next }));
}

export function mountGameHarness(): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('game harness root missing');
  import('react-dom/client').then(({ createRoot }) => { createRoot(root).render(<GameHarness/>); });
}

if (import.meta.env.DEV) mountGameHarness();
