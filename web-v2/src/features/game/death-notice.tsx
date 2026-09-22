import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { usePreferences } from '../../state/preferences.ts';
import { DeathEffectsTracker, DEATH_EFFECT_MS, deathScope } from '../../presentation/death-effects.ts';
import type { DeathBurst } from '../../presentation/death-effects.ts';
import { DeathEffectsLayer } from './death-effects-layer.tsx';

/** Keep mounted across playing -> review; a newly opened review never replays history. */
export function DeathNotice({ view, online, active = true, rootRef }: {
  view: RoomSnapshot | null; online: boolean; active?: boolean; rootRef: RefObject<HTMLElement | null>;
}) {
  const { preferences, reducedMotion } = usePreferences();
  const tracker = useRef(new DeathEffectsTracker());
  const [visible, setVisible] = useState(() => !document.hidden);
  const [frame, setFrame] = useState<{ scope: string; bursts: DeathBurst[] }>({ scope: '', bursts: [] });
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [motionSince, setMotionSince] = useState(() => performance.now());
  const scope = view ? deathScope(view) : '';
  const live = online && active && visible;

  // Re-enabling decoration never starts an old announcement's particles mid-flight.
  useLayoutEffect(() => setMotionSince(performance.now()), [preferences.deathEffects, reducedMotion]);

  useEffect(() => {
    const visibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  // Parent host refs are attached after child layout effects on the first mount.
  useEffect(() => {
    setStage(live && view?.room.phase === 'playing' ? rootRef.current?.querySelector<HTMLElement>('.theater-stage') ?? null : null);
  }, [rootRef, live, scope, view?.room.phase]);
  useEffect(() => {
    setFrame({ scope, bursts: tracker.current.update(view, live, performance.now()) });
  }, [view, live, scope]);
  useEffect(() => {
    if (!frame.bursts.length) return;
    const remaining = Math.min(...frame.bursts.map(burst => burst.startedAt + DEATH_EFFECT_MS)) - performance.now();
    const timer = setTimeout(() => setFrame({ scope: frame.scope, bursts: tracker.current.expire(performance.now()) }), Math.max(1, remaining));
    return () => clearTimeout(timer);
  }, [frame]);

  // Guard during render so scope changes cannot flash an old seat's announcement.
  const bursts = live && frame.scope === scope && view?.room.phase !== 'lobby'
    ? frame.bursts.filter(burst => view?.public?.seats.some(seat => seat.seat === burst.seat && !seat.alive)) : [];
  const seats = bursts.map(burst => burst.seat).sort((a, b) => a - b);
  const animated = bursts.filter(burst => burst.startedAt >= motionSince);
  return <>
    <div className="death-announcer" role="status" aria-live="polite" aria-atomic="true">
      {!!seats.length && <div className="death-notice"><strong>死亡公告</strong><span>{seats.map(seat => `${seat}号`).join('、')}已死亡</span></div>}
    </div>
    {stage && animated.length > 0 && preferences.deathEffects && !reducedMotion &&
      createPortal(<DeathEffectsLayer stage={stage} bursts={animated} />, stage)}
  </>;
}
