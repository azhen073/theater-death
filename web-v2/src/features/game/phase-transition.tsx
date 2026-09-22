import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { usePreferences } from '../../state/preferences.ts';
import { publicDeathSeats } from '../../presentation/death-events.ts';
import { claimPublicPhase, phaseTransitionTitle, publicPhaseStamp, type PublicPhaseStamp } from './phase-transition-model.ts';
import '../../styles/phase-transition.css';

export function PhaseTransition({ view, enabled, urgent, occupied }: {
  view: RoomSnapshot; enabled: boolean; urgent: boolean; occupied: boolean;
}) {
  const { reducedMotion } = usePreferences();
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [announcement, setAnnouncement] = useState<{ title: string; key: string } | null>(null);
  const previous = useRef<{ stamp: PublicPhaseStamp | null; ready: boolean; cursor: number } | null>(null);
  const deathUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stamp = publicPhaseStamp(view);
  const key = JSON.stringify(stamp);
  const ready = enabled && visible;
  const events = view.public?.events ?? [];
  const cursor = Math.max(0, ...events.map(event => event.cursor));

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    const last = previous.current;
    previous.current = { stamp, ready, cursor };
    if (last?.stamp?.scope !== stamp?.scope) deathUntil.current = 0;
    else if (last?.ready && ready && publicDeathSeats(events, last.cursor).length) deathUntil.current = Date.now() + 2200;
    const deathActive = Date.now() < deathUntil.current;
    const clear = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setAnnouncement(null);
    };
    // Also cancel a running effect when a task approaches its deadline or a dialog opens.
    if (!ready || urgent || occupied || reducedMotion || deathActive) clear();
    if (!stamp || key === JSON.stringify(last?.stamp)) return;
    clear();
    let fresh = false;
    try { fresh = claimPublicPhase(window.sessionStorage, stamp); } catch { /* disabled storage */ }
    const title = phaseTransitionTitle(last?.stamp ?? null, stamp);
    if (!fresh || !title || !last?.ready || !ready || urgent || occupied || reducedMotion || deathActive) return;
    setAnnouncement({ title, key });
    timer.current = setTimeout(() => { setAnnouncement(null); timer.current = null; }, 2200);
  }, [key, cursor, ready, urgent, occupied, reducedMotion]);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  if (!announcement || !ready || urgent || occupied || reducedMotion) return null;
  return <div className="phase-transition" key={announcement.key} role="status" aria-live="polite" aria-atomic="true">
    <div className="phase-transition__art" aria-hidden="true">
      <svg className="phase-transition__curtain" viewBox="10 110 660 340"><image href="/assets/ui-phase/curtain-atlas.png" width="1024" height="1024"/></svg>
      <svg className="phase-transition__curtain phase-transition__curtain--right" viewBox="10 110 660 340"><image href="/assets/ui-phase/curtain-atlas.png" width="1024" height="1024"/></svg>
      <svg className="phase-transition__clock" viewBox="24 359 640 624"><image href="/assets/ui-phase/clock-atlas.png" width="1024" height="1024"/></svg>
    </div>
    <p><span>第 {stamp?.day} 轮 · 第 {stamp?.stage} 阶段</span><strong>{announcement.title}</strong></p>
  </div>;
}
