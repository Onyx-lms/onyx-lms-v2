/**
 * P-08 -- fixed-window limiter.
 *
 * Mirrors Laravel's `throttle:6,1` on sign-in, password reset and the
 * verification resend.
 *
 * THE STORE IS ASYNC, AND HAD TO BECOME SO.
 *
 * `hit()` used to be synchronous, which was fine while the only implementation
 * was a `Map` in a single always-on API process. Serving the API from serverless
 * functions broke that quietly: each instance keeps its own Map, so "six attempts
 * per minute" becomes six per minute *per instance*, and instances are created in
 * response to load -- which is to say, in response to someone attempting a lot of
 * logins. Nothing errors. No test fails. The control simply is not there.
 *
 * A shared bucket means a round trip, so `hit()` returns a promise and
 * `RateLimiter.check()` is async. That is the only breaking part of the change,
 * and it reaches exactly two call sites (auth.routes.ts, account.routes.ts).
 */
export interface RateLimitStore {
  hit(key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }>;
}

/**
 * In-process buckets.
 *
 * Still the right store for the unit tests -- they assert the windowing rule, not
 * the transport -- and for anything genuinely single-process. It is NOT correct
 * behind more than one instance; see `SupabaseRateLimitStore` for that, and the
 * note above for why the difference is invisible if you get it wrong.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  #buckets = new Map<string, { count: number; resetAt: number }>();
  async hit(key: string, windowSeconds: number) {
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

/**
 * The narrow slice of a Supabase client this needs, so tests can fake it.
 *
 * `PromiseLike`, not `Promise`: supabase-js returns a PostgrestFilterBuilder from
 * `rpc()`, which is awaitable but is not a Promise -- it has no `catch`/`finally`.
 * Typing this as `Promise` compiles nowhere and passes nothing.
 */
export interface RateLimitRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

/**
 * Buckets shared by every instance, in Postgres.
 *
 * The counting happens inside `onyx.rate_limit_hit` (migration 0018) as a single
 * upsert, deliberately: read-then-write from here would let two concurrent
 * attempts both see `count = 1` and both be allowed, which is exactly the case a
 * limiter exists for.
 *
 * FAILS OPEN, ON PURPOSE.
 *
 * If the database is unreachable this allows the request rather than refusing it.
 * The limiter guards against repetition, not against catastrophe -- and the
 * alternative is that a blip in the rate-limit table locks every user out of
 * signing in, which converts a minor dependency failure into a total outage. The
 * failure is logged so it cannot pass unnoticed.
 */
export class SupabaseRateLimitStore implements RateLimitStore {
  #rpc: RateLimitRpc;
  #onError: (message: string) => void;

  constructor(rpc: RateLimitRpc, onError?: (message: string) => void) {
    this.#rpc = rpc;
    this.#onError = onError ?? ((m) => console.error('[rate-limit] ' + m));
  }

  async hit(key: string, windowSeconds: number) {
    try {
      const { data, error } = await this.#rpc.rpc('onyx_rate_limit_hit', {
        p_key: key,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new Error(error.message);
      // `RETURNS TABLE` arrives as an array of one row.
      const row = (Array.isArray(data) ? data[0] : data) as
        { count?: number; reset_at?: string } | undefined;
      if (!row || typeof row.count !== 'number' || !row.reset_at) {
        throw new Error('onyx_rate_limit_hit returned no row');
      }
      return { count: row.count, resetAt: Date.parse(row.reset_at) };
    } catch (err) {
      this.#onError(err instanceof Error ? err.message : String(err));
      // Open, not closed -- see the class comment. `count: 1` is "first attempt
      // in a fresh window", i.e. allowed.
      return { count: 1, resetAt: Date.now() + windowSeconds * 1000 };
    }
  }
}

export class RateLimiter {
  #store: RateLimitStore;
  constructor(store: RateLimitStore = new MemoryRateLimitStore()) { this.#store = store; }

  /** @returns allowed=false once `maxAttempts` is exceeded inside the window. */
  async check(key: string, maxAttempts: number, perMinutes = 1) {
    const { count, resetAt } = await this.#store.hit(key, perMinutes * 60);
    return {
      allowed: count <= maxAttempts,
      remaining: Math.max(0, maxAttempts - count),
      retryAfter: Math.max(0, Math.ceil((resetAt - Date.now()) / 1000)),
    };
  }
}
