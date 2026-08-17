/**
 * Ends assessment attempts whose time ran out while nobody was looking.
 *
 * ASS-01b. The paper's own timer hands in at zero, so this only ever catches the
 * candidate whose browser died -- but until v1 added the sweep, nothing caught
 * them at all: the attempt sat at `in_progress` for ever, and the marking queue
 * excludes that status, so the paper was never marked and no invigilator was
 * told.
 *
 * WHY THIS IS NOT A POSTGRES FUNCTION.
 *
 * The obvious move on Vercel Hobby -- where Vercel Cron runs once a day -- is to
 * push this into plpgsql and let pg_cron run it entirely inside the database, no
 * HTTP involved. It cannot be done, and the reason is worth recording so nobody
 * tries again: expiring an attempt calls `#finalise`, which auto-marks it. That
 * walks the paper, matches each answer against the question version's answer
 * key, and scores objective questions through `scoreObjective` -- including the
 * deliberate refusal to score an MCQ whose author never set a correct option,
 * because marking every response wrong by default is not objectivity, it is
 * silence. Those rules live in TypeScript and are covered by the core suite.
 * Reimplementing them in SQL would mean two copies of the marking logic, and the
 * copy that drifts is the one that runs unattended at 3am.
 *
 * So the sweep stays here and pg_cron reaches it over HTTP instead -- which still
 * gets per-minute scheduling on the free tier, because the scheduler is
 * Supabase's rather than Vercel's.
 *
 * Idempotent by construction: it selects only `in_progress` attempts already past
 * `expires_at`, and a per-attempt failure is swallowed so one stuck paper cannot
 * strand the rest. A missed run costs latency, never correctness -- which is what
 * makes it safe under pg_cron's at-most-once delivery.
 */
import { NextResponse } from 'next/server';
import { ctx } from '@/server/context';
import { denyCron } from '@/server/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * The sweep walks every tenant serially. At this scale that is quick, but it is
 * a reconciliation pass: if it is ever cut short, the next run continues from
 * where the data is, not from where the loop was. Truncation costs a minute.
 */
export const maxDuration = 300;

async function run(request: Request): Promise<Response> {
  const denied = denyCron(request);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const started = Date.now();
  try {
    const result = await ctx().onyxAssess.expireOverdueEverywhere();
    // Logged rather than merely returned: pg_net fires and forgets, so its caller
    // never reads this body. The function log is where a saturating sweep shows
    // up -- a count that stops falling means the pass is not keeping up.
    if (result.expired > 0) {
      console.log('[cron/expire-attempts] expired ' + result.expired
        + ' attempt(s) across ' + result.tenants + ' tenant(s)');
    }
    return NextResponse.json({ ok: true, data: { ...result, ms: Date.now() - started } });
  } catch (err) {
    console.error('[cron/expire-attempts] failed', err);
    return NextResponse.json({
      ok: false,
      level: 'error',
      message: err instanceof Error ? err.message : 'The expiry sweep failed.',
    }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
