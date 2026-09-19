import { useEffect, useState } from 'react';
import { defaultPreferences, parsePreferences } from './preferences-model.ts';
import type { DisplayPreferences } from './preferences-model.ts';
export type { DisplayPreferences } from './preferences-model.ts';
const storageKey = 'theater-death-display-v1', changedEvent = 'theater-display-changed';
function readPreferences(): DisplayPreferences {
  try { return parsePreferences(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); }
  catch { return { ...defaultPreferences }; }
}
export function usePreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [saved, setSaved] = useState(true);
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mediaChanged = () => setSystemReduced(query.matches);
    const sync = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== storageKey && event.key !== null) return;
      setPreferences(event instanceof CustomEvent ? parsePreferences(event.detail) : readPreferences());
    };
    query.addEventListener('change', mediaChanged);
    window.addEventListener('storage', sync); window.addEventListener(changedEvent, sync);
    return () => { query.removeEventListener('change', mediaChanged); window.removeEventListener('storage', sync); window.removeEventListener(changedEvent, sync); };
  }, []);
  const update = (patch: Partial<DisplayPreferences>) => {
    const next = parsePreferences({ ...preferences, ...patch });
    setPreferences(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(true); }
    catch { setSaved(false); }
    window.dispatchEvent(new CustomEvent(changedEvent, { detail: next }));
  };
  return { preferences, update, saved, reducedMotion: preferences.motion === 'reduced' || preferences.motion === 'system' && systemReduced };
}

/** Mount once at the application root, including the login screen. */
export function useDisplayPreferences() {
  const { preferences, reducedMotion } = usePreferences();
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
    document.documentElement.style.setProperty('--display-scale', String(preferences.scale / 100));
    return () => { delete document.documentElement.dataset.reducedMotion; document.documentElement.style.removeProperty('--display-scale'); };
  }, [preferences.scale, reducedMotion]);
}
