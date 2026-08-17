/**
 * Work that runs after a response has been sent.
 *
 * THE PROBLEM THIS SOLVES.
 *
 * Submitting code enqueues a job; something has to pick it up. In v1 that was a
 * `setInterval` draining the queue every 2 seconds inside an always-on Fastify
 * process. v2 has no always-on process, and on Vercel's Hobby plan Vercel Cron
 * runs **once per day** -- a `* * * * *` schedule is rejected at deploy. Waiting
 * for a scheduler would mean a learner watching a spinner for up to 25 hours.
 *
 * So the submit request drains the queue itself, immediately after answering. The
 * response is not held up by grading -- the route still returns "Queued." at
 * once, which is the contract the UI was built against -- but the grading starts
 * in the same invocation instead of waiting for a tick. In the ordinary case that
 * is *faster* than v1, which averaged half an interval of dead time.
 *
 * `after()` rather than a floating promise. A bare `void drain()` is not
 * "background work" on a serverless platform, it is work the runtime is entitled
 * to kill the instant the response flushes. `after()` (stable since Next 15.1,
 * backed by Vercel's `waitUntil`) keeps the invocation alive until the callback
 * settles, and runs it even when the response was an error.
 *
 * The cron endpoint at /api/cron/drain is the other half and is NOT redundant:
 * this covers the common path, that covers the ones it cannot -- an invocation
 * killed mid-drain, a Judge0 failure whose backoff must be honoured, a row left
 * at `running` by a dead worker. Tail latency is the honest cost: if this pass
 * dies, the job waits for the next pg_cron minute.
 *
 * WHY A MAP RATHER THAN A CALL IN THE SERVICE.
 *
 * `after()` comes from `next/server`. Importing it inside `packages/core` would
 * couple 13,000 lines of framework-agnostic business logic to Next -- and that
 * independence is the entire reason 574 route handlers could move without being
 * rewritten. So the knowledge lives at the boundary instead: one table, keyed by
 * the route pattern the matcher already resolved, greppable in one place.
 */
import type { AppContext } from './context.ts';

/** Keyed by `METHOD /pattern` -- the pattern as registered, not the request path. */
const AFTER: Record<string, (ctx: AppContext) => Promise<unknown>> = {
  /**
   * The only route that enqueues anything (codelab.service.ts:437 is the sole
   * `enqueue` call site outside QueueService itself).
   *
   * Deliberately small: `maxPasses: 3` and `concurrency: 2`. This pass exists to
   * grade *this* submission, not to work off a backlog -- that is the cron
   * endpoint's job, with a larger budget. Draining hard here would make one
   * learner's submit request pay for everyone else's queue.
   */
  'POST /api/onyx/problems/:id/submit': (ctx) => ctx.onyxRunWorker({
    concurrency: 2,
    maxPasses: 3,
    onError: (message) => console.error('[after:drain] ' + message),
  }),
};

/** The follow-up for a resolved route, or undefined. */
export function afterFor(method: string, pattern: string): ((ctx: AppContext) => Promise<unknown>) | undefined {
  return AFTER[method.toUpperCase() + ' ' + pattern];
}

/** Exposed for the test that asserts every key names a route that exists. */
export const AFTER_KEYS = Object.keys(AFTER);
