/**
 * The guard in front of every scheduled endpoint.
 *
 * These are public URLs on the deployment. Nothing about them is expensive to
 * call once, but the grading drain and the expiry sweep both write, and an
 * unauthenticated way to trigger writes on a loop is a denial-of-service button
 * with a nice name. So each one checks a shared secret.
 *
 * `CRON_SECRET` is read from the environment and compared in constant time. If
 * it is unset the endpoints refuse outright rather than defaulting to open --
 * the failure mode of a missing secret should be "the job stops running", which
 * is visible in the job table, not "anyone can run the job", which is not
 * visible anywhere.
 *
 * Vercel injects `Authorization: Bearer $CRON_SECRET` into its own cron
 * invocations, and pg_cron is configured to send the same header
 * (supabase/onyx/migrations/0017_schedule_jobs.sql), so one check covers both
 * triggers.
 */
import { timingSafeEqual } from 'node:crypto';

/** Compares without leaking where the difference is. */
function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export type CronDenial = { status: number; body: { ok: false; level: 'error'; message: string } };

/**
 * `null` when the caller may proceed, otherwise the response to return.
 *
 * Accepts the secret as a bearer token or as `x-cron-secret`. pg_net can send
 * either; the second exists because a bearer header on a Supabase-originated
 * request is easy to confuse with a user token when reading logs.
 */
export function denyCron(request: Request): CronDenial | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return {
      status: 503,
      body: { ok: false, level: 'error', message: 'This endpoint is not configured.' },
    };
  }

  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const header = request.headers.get('x-cron-secret') ?? '';

  if (equal(bearer, expected) || equal(header, expected)) return null;
  // 404, not 401: an endpoint that says "wrong secret" has confirmed it exists
  // and is worth guessing at.
  return { status: 404, body: { ok: false, level: 'error', message: 'Not found.' } };
}
