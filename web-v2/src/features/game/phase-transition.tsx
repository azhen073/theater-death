import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { usePreferences } from '../../state/preferences.ts';
import { publicDeathSeats } from '../../presentation/death-events.ts';
import { claimPublicPhase, phaseTransitionTitle, publicPhaseStamp, type PublicPhaseStamp } from './phase-transition-model.ts';
import '../../styles/phase-transition.css';

// Covers the 3.2s public death treatment in the separate death-effects PR as well
// as main's shorter notice, without depending on that unmerged implementation.
const DEATH_PRIORITY_MS = 3200;
const TRANSITION_MS = 3000;

type Tone = 'night' | 'dawn' | 'stage';

interface Announcement { title: string; subtitle: string | null; tone: Tone; key: string }

export function PhaseTransition({ view, enabled, urgent, occupied }: {
  view: RoomSnapshot; enabled: boolean; urgent: boolean; occupied: boolean;
}) {
  const { reducedMotion } = usePreferences();
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const previous = useRef<{ stamp: PublicPhaseStamp | null; ready: boolean; cursor: number } | null>(null);
  const deathUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Announcement | null>(null);
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
    const newDeath = last?.stamp?.scope === stamp?.scope && last?.ready && ready && publicDeathSeats(events, last.cursor).length > 0;
    if (last?.stamp?.scope !== stamp?.scope) deathUntil.current = 0;
    else if (newDeath) deathUntil.current = Date.now() + DEATH_PRIORITY_MS;
    const clear = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      setAnnouncement(null);
    };
    const schedule = (item: Announcement) => {
      const show = () => {
        pending.current = null;
        setAnnouncement(item);
        timer.current = setTimeout(() => { setAnnouncement(null); timer.current = null; }, TRANSITION_MS);
      };
      const delay = Math.max(0, deathUntil.current - Date.now());
      // Live sequencing only: refresh/reconnect never restores this in-memory pending cue.
      if (delay > 0) { pending.current = item; timer.current = setTimeout(show, delay); }
      else show();
    };
    // Also cancel a running effect when a task approaches its deadline or a dialog opens.
    const blocked = !ready || urgent || occupied || reducedMotion;
    if (blocked || !stamp) clear();
    if (!stamp || key === JSON.stringify(last?.stamp)) {
      if (newDeath) {
        const queued = pending.current;
        clear();
        if (queued && !blocked) schedule(queued);
      }
      return;
    }
    clear();
    let fresh = false;
    try { fresh = claimPublicPhase(window.sessionStorage, stamp); } catch { /* disabled storage */ }
    const title = phaseTransitionTitle(last?.stamp ?? null, stamp);
    if (!fresh || !title || !last?.ready || blocked) return;
    // 天亮副行只读本批公开死讯：有死亡报名单，无死亡报平安夜。
    const tone: Tone = title === '夜幕降临' ? 'night' : title === '天亮了' ? 'dawn' : 'stage';
    const dawnDeaths = tone === 'dawn' ? publicDeathSeats(events, last.cursor).sort((a, b) => a - b) : [];
    const subtitle = tone === 'dawn'
      ? dawnDeaths.length ? `${dawnDeaths.map(seat => `${seat}号`).join('、')} 死亡` : '平安夜'
      : null;
    schedule({ title, subtitle, tone, key });
  }, [key, cursor, ready, urgent, occupied, reducedMotion]);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  if (!announcement || !ready || urgent || occupied || reducedMotion) return null;
  return <div className={`phase-transition phase-transition--${announcement.tone}`} key={announcement.key} role="status" aria-live="polite" aria-atomic="true">
    <div className="phase-transition__art" aria-hidden="true">
      <svg className="phase-transition__curtain" viewBox="10 110 660 340"><image href="/assets/ui-phase/curtain-atlas.png" width="1024" height="1024"/></svg>
      <svg className="phase-transition__curtain phase-transition__curtain--right" viewBox="10 110 660 340"><image href="/assets/ui-phase/curtain-atlas.png" width="1024" height="1024"/></svg>
      <svg className="phase-transition__clock" viewBox="24 359 640 624"><image href="/assets/ui-phase/clock-atlas.png" width="1024" height="1024"/></svg>
    </div>
    <p>
      <span>第 {stamp?.day} 轮 · 第 {stamp?.stage} 阶段</span>
      <strong>{announcement.title}</strong>
      {announcement.subtitle && <em>{announcement.subtitle}</em>}
    </p>
  </div>;
}
