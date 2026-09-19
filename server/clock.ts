export interface ClockHandle {
  readonly id: number;
}

export interface Clock {
  now(): number;
  schedule(delayMs: number, callback: () => void): ClockHandle;
  cancel(handle: ClockHandle): void;
}

export function createSystemClock(): Clock {
  let nextId = 1;
  const timers = new Map<number, NodeJS.Timeout>();
  return {
    now: () => Date.now(),
    schedule(delayMs, callback) {
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        timers.delete(id);
        callback();
      }, delayMs);
      timers.set(id, timer);
      return { id };
    },
    cancel(handle) {
      const timer = timers.get(handle.id);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(handle.id);
      }
    },
  };
}

export const systemClock = createSystemClock();

export interface FakeClock extends Clock {
  advance(ms: number): void;
  elapse(ms: number): void;
  flush(): void;
  pendingCount(): number;
}

export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs;
  let nextId = 1;
  let tasks: Array<{ id: number; at: number; callback: () => void }> = [];
  function valid(ms: number) { if (!Number.isFinite(ms) || ms < 0) throw new Error('Clock duration must be finite and non-negative'); }
  function advance(ms: number) {
    valid(ms);
    const target = current + ms;
    for (;;) {
      tasks.sort((left, right) => left.at - right.at || left.id - right.id);
      const next = tasks[0];
      if (!next || next.at > target) break;
      tasks = tasks.slice(1);
      current = Math.max(current, next.at);
      next.callback();
    }
    current = target;
  }
  return {
    now: () => current,
    schedule(delayMs, callback) {
      const id = nextId;
      nextId += 1;
      tasks.push({ id, at: current + delayMs, callback });
      return { id };
    },
    cancel(handle) {
      tasks = tasks.filter((task) => task.id !== handle.id);
    },
    advance,
    elapse(ms) { valid(ms); current += ms; },
    flush() { advance(0); },
    pendingCount: () => tasks.length,
  };
}
