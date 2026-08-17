/**
 * P-08 -- fixed-window limiter.
 *
 * Mirrors Laravel's `throttle:6,1` on the verification-resend and
 * password-reset routes. In-process by design: a single API instance needs no
 * Redis for this, and the limiter takes a store so a shared backend can be
 * dropped in later without touching call sites.
 */
export interface RateLimitStore {
  hit(key: string, windowSeconds: number): { count: number; resetAt: number };
}

export class MemoryRateLimitStore implements RateLimitStore {
  #buckets = new Map<string, { count: number; resetAt: number }>();
  hit(key: string, windowSeconds: number) {
    const now = Date.now();
    const found = this.#buckets.get(key);
    if (!found || found.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowSeconds * 1000 };
      this.#buckets.set(key, fresh);
      return fresh;
    }
    found.count += 1;
    return found;
  }
  clear() { this.#buckets.clear(); }
}

export class RateLimiter {
  #store: RateLimitStore;
  constructor(store: RateLimitStore = new MemoryRateLimitStore()) { this.#store = store; }

  /** @returns allowed=false once `maxAttempts` is exceeded inside the window. */
  check(key: string, maxAttempts: number, perMinutes = 1) {
    const { count, resetAt } = this.#store.hit(key, perMinutes * 60);
    return {
      allowed: count <= maxAttempts,
      remaining: Math.max(0, maxAttempts - count),
      retryAfter: Math.max(0, Math.ceil((resetAt - Date.now()) / 1000)),
    };
  }
}
