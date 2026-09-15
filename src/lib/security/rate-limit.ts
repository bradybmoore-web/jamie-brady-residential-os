import "server-only";

/**
 * Rate limiting.
 *
 * A fixed-window counter behind a store interface. The default store is
 * in-process, which is the right trade for a two-person deployment on a single
 * instance: no infrastructure, no new dependency, and it genuinely stops the
 * abuse cases that matter here (passcode grinding, an accidental loop against a
 * metered AI endpoint).
 *
 * It is NOT a distributed limiter. Two consequences, both documented rather
 * than hidden:
 *
 *   1. Limits are per server instance. Running N instances multiplies the
 *      effective limit by N.
 *   2. Counters reset on deploy or restart.
 *
 * `setRateLimitStore()` is the seam for fixing that later — a Postgres table or
 * Redis implementation satisfies `RateLimitStore` and nothing else changes.
 */

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Milliseconds until the window resets. */
  retryAfterMs: number;
}

export interface RateLimitStore {
  /**
   * Record a hit against `key` and return the running count plus the instant
   * the window resets. Implementations must be atomic per key.
   */
  hit(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
  reset(key?: string): Promise<void>;
}

/** Default store: a Map with lazy eviction of expired windows. */
class MemoryRateLimitStore implements RateLimitStore {
  private windows = new Map<string, { count: number; resetAt: number }>();
  /** Bounds memory if keys are attacker-controlled (many distinct IPs). */
  private readonly maxKeys = 10_000;

  async hit(key: string, windowMs: number, now: number) {
    const existing = this.windows.get(key);
    if (existing && existing.resetAt > now) {
      existing.count += 1;
      return { ...existing };
    }

    if (this.windows.size >= this.maxKeys) this.evictExpired(now);

    const fresh = { count: 1, resetAt: now + windowMs };
    this.windows.set(key, fresh);
    return { ...fresh };
  }

  async reset(key?: string) {
    if (key === undefined) this.windows.clear();
    else this.windows.delete(key);
  }

  private evictExpired(now: number) {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    // Still full of live windows: drop the oldest rather than grow without
    // bound. Under that much pressure everyone is being limited anyway.
    if (this.windows.size >= this.maxKeys) {
      const oldest = [...this.windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
      for (const [key] of oldest.slice(0, Math.floor(this.maxKeys / 4))) this.windows.delete(key);
    }
  }
}

let store: RateLimitStore = new MemoryRateLimitStore();

/** Swap in a durable store (Postgres, Redis) for multi-instance deployments. */
export function setRateLimitStore(next: RateLimitStore) {
  store = next;
}

export function getRateLimitStore(): RateLimitStore {
  return store;
}

export async function checkRateLimit(
  key: string,
  rule: RateLimitRule,
  now = Date.now(),
): Promise<RateLimitResult> {
  const { count, resetAt } = await store.hit(key, rule.windowMs, now);
  const remaining = Math.max(0, rule.limit - count);
  return {
    allowed: count <= rule.limit,
    remaining,
    retryAfterMs: Math.max(0, resetAt - now),
  };
}

/** "3 minutes" / "45 seconds" — for a message a person reads. */
export function describeRetry(retryAfterMs: number): string {
  const seconds = Math.ceil(retryAfterMs / 1000);
  if (seconds <= 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Limits applied in the app. Collected here so the whole policy is visible in
 * one place rather than scattered across call sites.
 */
export const RATE_LIMITS = {
  /** Sign-in attempts, per client address and per identifier. */
  login: { limit: 10, windowMs: 10 * 60_000 },
  /** Assistant questions per signed-in user. Each one can call several tools. */
  assistant: { limit: 30, windowMs: 10 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;
