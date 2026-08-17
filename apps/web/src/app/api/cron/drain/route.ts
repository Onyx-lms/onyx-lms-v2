/**
 * The Code Lab grading queue's safety net.
 *
 * v1 drained this queue from a `setInterval` every 2 seconds inside the
 * always-on Fastify process. v2 has no always-on process, and Vercel Cron on the
 * Hobby plan runs **once per day** -- a `* * * * *` expression is rejected at
 * deploy time. So neither the old interval nor Vercel's scheduler can carry
 * grading latency.
 *
 * What carries it instead is `after()`: the submit route enqueues and then drains
 * in the same invocation, so in the ordinary case a submission is graded
 * immediately -- sooner than v1's average half-tick wait. See
 * apps/web/src/server/after-dispatch.ts.
 *
 * This endpoint is the second half of that design, not the first. It exists for
 * the cases `after()` cannot cover: an invocation killed mid-drain, a transient
 * Judge0 failure that needs its backoff honoured, a job whose worker died
 * holding the row at `running`. `requeueStale()` inside `runCodeLabWorker` is
 * what makes those eligible again.
 *
 * It is driven by **pg_cron**, per minute, from inside Postgres
 * (supabase/onyx/migrations/0017_schedule_jobs.sql) -- which sidesteps the Hobby
 * cron floor entirely, because Supabase's scheduler is not Vercel's.
 *
 * Bounded on purpose. `maxPasses` caps the work one invocation will take on, so
 * a large backlog is drained over several minutes rather than by one function
 * running until it is killed and losing the claim on everything it held.
 */
import { NextResponse } from 'next/server';
import { ctx } from '@/server/context';
import { denyCron } from '@/server/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Judge0 is given 30s per submission by execution.provider.ts, and a pass can
 * hold several. 300s is the Hobby ceiling with Fluid compute -- the earlier
 * 10s/60s figures no longer apply -- so this is the whole budget, not a guess.
 */
export const maxDuration = 300;

async function run(request: Request): Promise<Response> {
  const denied = denyCron(request);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const started = Date.now();
  const errors: string[] = [];
  try {
    const result = await ctx().onyxRunWorker({
      concurrency: 4,
      // Bounded so a backlog cannot run the invocation to its limit. Whatever is
      // left is still queued and the next minute picks it up.
      maxPasses: 50,
      onError: (message) => errors.push(message),
    });
    return NextResponse.json({
      ok: true,
      data: { ...result, ms: Date.now() - started, errors: errors.slice(0, 10) },
    });
  } catch (err) {
    // A failing drain must be loud: this is the endpoint that stops a learner
    // staring at a spinner, and a 200 here would hide that it never ran.
    console.error('[cron/drain] failed', err);
    return NextResponse.json({
      ok: false,
      level: 'error',
      message: err instanceof Error ? err.message : 'The grading pass failed.',
    }, { status: 500 });
  }
}

/** POST for pg_net, GET so Vercel Cron and a human with curl can both call it. */
export const GET = run;
export const POST = run;
