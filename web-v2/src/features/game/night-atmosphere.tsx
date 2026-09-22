import { useEffect, useState, type CSSProperties } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { usePreferences } from '../../state/preferences.ts';
import '../../styles/night-atmosphere.css';

/** Ambient decoration only: never observe private role windows or action progress. */
export function NightAtmosphere({ view, active }: { view: RoomSnapshot; active: boolean }) {
  const { reducedMotion } = usePreferences();
  const night = view.room.phase === 'playing' && view.public?.phase === 'night';
  const key = night ? JSON.stringify([view.roomId, view.gameId, view.public?.dayNumber]) : null;
  const [moving, setMoving] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  useEffect(() => {
    setMoving(false);
    if (!key) return;
    try {
      const storageKey = 'theater-death:night-atmosphere:v1:' + key;
      if (sessionStorage.getItem(storageKey)) return;
      sessionStorage.setItem(storageKey, 'seen');
    } catch { return; }
    if (!active || !visible || reducedMotion) return;
    setMoving(true);
    const timer = setTimeout(() => setMoving(false), 5000);
    return () => clearTimeout(timer);
  }, [key, active, visible, reducedMotion]);
  if (!night) return null;
  return <div className="night-atmosphere" aria-hidden="true">
    <div className="night-atmosphere__glow"/>
    <div className="night-atmosphere__vignette"/>
    {moving && active && visible && !reducedMotion && <div className="night-atmosphere__motion">
      <div className="night-atmosphere__fog"/>
      {Array.from({ length: 24 }, (_, index) => <i key={index} style={{
        '--dust-x': `${(index * 37 + 9) % 100}%`, '--dust-y': `${(index * 23 + 7) % 100}%`,
        '--dust-delay': `${-(index % 5) * .3}s`,
      } as CSSProperties}/>)}
    </div>}
  </div>;
}
