/**
 * Points pg_cron at an environment's app, and schedules the background jobs.
 *
 * Migration 0017 builds the mechanism -- pg_cron, pg_net, `onyx.job_runner` and
 * `onyx.trigger_job()` -- but deliberately schedules nothing, because a schedule
 * needs a URL and a secret and neither belongs in a committed file. This supplies
 * them, so applying the migration stays inert and turning the jobs on is an
 * explicit act per environment.
 *
 *   node tools/onyx/schedule-jobs.mjs --url http://127.0.0.1:5175
 *   node tools/onyx/schedule-jobs.mjs --url https://onyx-lms-v2.vercel.app
 *   node tools/onyx/schedule-jobs.mjs --status
 *   node tools/onyx/schedule-jobs.mjs --unschedule
 *
 * The secret comes from CRON_SECRET in the environment, never an argument -- an
 * argument ends up in shell history.
 *
 * WHY EVERY MINUTE, FOR BOTH.
 *
 * One minute is pg_cron's floor, and it is the floor that matters: on Vercel's
 * Hobby plan Vercel Cron cannot run more often than daily, which is why the
 * scheduler is here at all (see 0017's header).
 *
 * Grading does not depend on this to feel fast -- the submit request drains the
 * queue itself via `after()` (apps/web/src/server/after-dispatch.ts), so the
 * common path is immediate. This is the retry net for the cases that pass cannot
 * cover, and a minute is the right cadence for a net.
 *
 * The expiry sweep matches what v1 ran on its own interval, so behaviour is
 * unchanged rather than merely approximated.
 *
 * Both jobs are safe to miss and safe to double-fire, which is what makes
 * pg_cron's at-most-once delivery acceptable: `claim()` takes rows with
 * `FOR UPDATE SKIP LOCKED` so two passes cannot grade the same submission, and
 * the sweep only ever touches attempts already past their expiry.
 */
import { connect, loadEnv } from '../db/connect.mjs';

const arg = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? null : process.argv[i + 1];
};
const has = (name) => process.argv.includes('--' + name);

/** name -> [schedule, endpoint]. The name is what `cron.unschedule` takes. */
const JOBS = {
  'onyx-drain-queue': ['* * * * *', '/api/cron/drain'],
  'onyx-expire-attempts': ['* * * * *', '/api/cron/expire-attempts'],
};

/**
 * Jobs that need no HTTP hop at all.
 *
 * Pure SQL, so pg_cron calls the function directly -- no pg_net, no endpoint, no
 * shared secret, and nothing to be reachable from the internet. The two jobs above
 * only go over HTTP because their logic lives in TypeScript and must not be
 * duplicated in plpgsql; that reasoning does not apply here.
 *
 * Daily rather than per-minute: an expired rate-limit bucket is harmless, it is
 * only the unbounded accumulation of them that matters, and 03:17 is a quiet
 * minute chosen so it does not collide with every other cron on the hour.
 */
const SQL_JOBS = {
  'onyx-rate-limit-sweep': ['17 3 * * *', 'SELECT public.onyx_rate_limit_sweep()'],
};

const env = loadEnv();
const client = await connect();

try {
  if (has('status')) {
    const { rows: cfg } = await client.query(
      'SELECT "base_url", "updated_at" FROM onyx."job_runner" WHERE "id"');
    console.log(cfg.length
      ? 'runner: ' + cfg[0].base_url + '  (set ' + cfg[0].updated_at.toISOString() + ')'
      : 'runner: NOT CONFIGURED -- the jobs cannot fire');

    const { rows: jobs } = await client.query(
      `SELECT jobname, schedule, active FROM cron.job
        WHERE jobname = ANY($1) ORDER BY jobname`,
      [[...Object.keys(JOBS), ...Object.keys(SQL_JOBS)]]);
    if (!jobs.length) console.log('cron: no Onyx jobs scheduled');
    for (const j of jobs) {
      console.log('cron: ' + j.jobname.padEnd(22) + j.schedule.padEnd(12)
        + (j.active ? 'active' : 'INACTIVE'));
    }

    // The last few attempts, so "is it actually reaching the app" has an answer
    // that is not a guess. pg_net records every response it received.
    const { rows: recent } = await client.query(
      `SELECT r.status_code, r.created, left(coalesce(r.error_msg, ''), 60) err
         FROM net._http_response r ORDER BY r.id DESC LIMIT 5`).catch(() => ({ rows: [] }));
    if (recent.length) {
      console.log('\nlast pg_net responses (newest first):');
      for (const r of recent) {
        console.log('  ' + String(r.status_code ?? 'no status').padEnd(10)
          + (r.created ? r.created.toISOString() : '') + (r.err ? '  ' + r.err : ''));
      }
    } else {
      console.log('\nno pg_net responses recorded yet');
    }
    process.exit(0);
  }

  if (has('unschedule')) {
    for (const name of [...Object.keys(JOBS), ...Object.keys(SQL_JOBS)]) {
      // `cron.unschedule` throws if the job is absent, which makes a re-run of a
      // teardown fail for the wrong reason.
      const { rows } = await client.query(
        'SELECT jobid FROM cron.job WHERE jobname = $1', [name]);
      if (!rows.length) { console.log('- ' + name + ' (was not scheduled)'); continue; }
      await client.query('SELECT cron.unschedule($1)', [name]);
      console.log('unscheduled ' + name);
    }
    // The row goes too: leaving a base_url and secret behind for jobs that no
    // longer run is a stale credential nobody will think to rotate.
    await client.query('DELETE FROM onyx."job_runner" WHERE "id"');
    console.log('cleared onyx.job_runner');
    process.exit(0);
  }

  const url = arg('url');
  if (!url) {
    console.error('usage: node tools/onyx/schedule-jobs.mjs --url <app base url>');
    console.error('       (also --status, --unschedule)');
    process.exit(1);
  }
  if (!/^https?:\/\//.test(url)) {
    console.error('--url must include the scheme, e.g. https://example.vercel.app');
    process.exit(1);
  }
  const secret = env.CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET is not set. The endpoints refuse to run without it, '
      + 'so scheduling them would only produce 503s.');
    process.exit(1);
  }

  const base = url.replace(/\/+$/, '');

  await client.query(
    `INSERT INTO onyx."job_runner" ("id", "base_url", "secret")
     VALUES (true, $1, $2)
     ON CONFLICT ("id") DO UPDATE
       SET "base_url" = EXCLUDED."base_url",
           "secret" = EXCLUDED."secret",
           "updated_at" = now()`,
    [base, secret]);
  console.log('runner -> ' + base);

  for (const [name, [schedule, path]] of Object.entries(JOBS)) {
    // cron.schedule upserts by name, so re-running this repoints an existing job
    // rather than creating a duplicate that would double every tick.
    await client.query('SELECT cron.schedule($1, $2, $3)',
      [name, schedule, `SELECT onyx.trigger_job(${quote(path)})`]);
    console.log('scheduled ' + name.padEnd(22) + schedule.padEnd(12) + path);
  }

  for (const [name, [schedule, statement]] of Object.entries(SQL_JOBS)) {
    await client.query('SELECT cron.schedule($1, $2, $3)', [name, schedule, statement]);
    console.log('scheduled ' + name.padEnd(22) + schedule.padEnd(12) + '(SQL, no HTTP)');
  }

  console.log('\nVerify with: node tools/onyx/schedule-jobs.mjs --status');
  console.log('The first tick lands within a minute.');
} finally {
  await client.end();
}

/** Single-quoted SQL literal, for embedding in the cron command string. */
function quote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}
