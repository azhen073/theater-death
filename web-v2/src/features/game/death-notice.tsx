import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { usePreferences } from '../../state/preferences.ts';
import { publicDeathSeats } from '../../presentation/death-events.ts';

export function DeathNotice({ view, online }: { view: RoomSnapshot; online: boolean }) {
  const { preferences, reducedMotion } = usePreferences();
  const [seats, setSeats] = useState<number[]>([]);
  const [effectKey, setEffectKey] = useState(0);
  const baseline = useRef<{ scope: string; cursor: number; online: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const events = view.public?.events ?? [];
  const cursor = Math.max(0, ...events.map(event => event.cursor));
  const scope = JSON.stringify([view.viewer.userId, view.roomId, view.gameId, view.viewer.memberId, view.viewer.kind, view.viewer.subjectPlayerId]);
  useEffect(() => {
    const previous = baseline.current;
    baseline.current = { scope, cursor, online };
    const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setSeats([]); };
    if (!previous || previous.scope !== scope || !previous.online || !online || !preferences.deathEffects || reducedMotion || view.room.phase !== 'playing') { clear(); return; }
    const newlyDead = publicDeathSeats(events, previous.cursor);
    if (!newlyDead.length) return;
    clear(); setEffectKey(cursor); setSeats(newlyDead);
    timer.current = setTimeout(() => { setSeats([]); timer.current = null; }, 1800);
  }, [scope, cursor, online, preferences.deathEffects, reducedMotion, view.room.phase]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!seats.length || reducedMotion || !preferences.deathEffects) return null;
  return <div className="death-notice" key={effectKey} aria-hidden="true"><img src="/assets/death-overlay.png" alt=""/><span>{seats.map(seat => `${seat}号`).join('、')}已出局</span></div>;
}
