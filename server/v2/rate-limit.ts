/** Bounded, expiring token buckets. Keys are internal and never returned to clients. */
export class RateLimits {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  allow(key: string, burst: number, periodMs: number): boolean {
    const now = this.now();
    if (this.buckets.size >= 10000) {
      for (const [id, b] of this.buckets) if (now - b.at > 3600_000) this.buckets.delete(id);
      if (this.buckets.size >= 10000 && !this.buckets.has(key)) return false;
    }
    const b = this.buckets.get(key) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + Math.max(0, now - b.at) * burst / periodMs);
    b.at = Math.max(b.at, now);
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    return ok;
  }
}
