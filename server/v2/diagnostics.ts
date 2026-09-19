import { monitorEventLoopDelay } from 'node:perf_hooks';

export function createDiagnostics() {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  return {
    snapshot() { return { rss: process.memoryUsage().rss, eventLoopP99Ms: histogram.count === 0 ? 0 : histogram.percentile(99) / 1e6 }; },
    close() { histogram.disable(); },
  };
}
