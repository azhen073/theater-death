import type { Clock } from './clock.ts';

/** Timer effects and requests share the room queue. Cancellation still works after a timer has fired but before its queued effect runs. */
export function queuedClock(clock: Clock, enqueue: (callback: () => void) => Promise<unknown>): Clock {
  const active = new Set<number>();
  return {
    now: () => clock.now(),
    schedule(delay, callback) {
      const handle = clock.schedule(delay, () => {
        void enqueue(() => {
          if (active.delete(handle.id)) callback();
        }).catch((error: unknown) => { console.error('room_timer_failed', error); });
      });
      active.add(handle.id);
      return handle;
    },
    cancel(handle) { active.delete(handle.id); clock.cancel(handle); },
  };
}
