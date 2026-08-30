/**
 * Removes the papers and banks that web-demo-mallareddy.mjs leaves behind,
 * keeping the newest of each.
 *
 * That suite has to build a fresh "Web + code QA <run>" bank and a fresh
 * "Web development test <run>" paper on every full run -- proving the AUTHOR
 * path (create a bank, put a web question and a coding question on it, draw a
 * paper from it, publish) is the point of the run, so there is no way to reuse
 * last time's bank without skipping the thing under test. It closes its
 * paper's window on the way out rather than deleting it, on purpose, so one
 * standing web-and-code paper is always sittable for suites like
 * code-is-kept.mjs that need one. The cost of that is a new pair left behind
 * every run, and neither a bank nor an assessment has a DELETE route a suite
 * could call on itself for the older ones.
 *
 * So this is a sweep, the same shape as cleanup-authoring-trial.mjs and for
 * the same reason: there are no product routes for the job, the demo's seeded
 * shape is a contract other suites read, and a periodic pass rather than a
 * per-run one is what a real product's own housekeeping would look like here
 * too. Run it after a batch of QA runs, not after every single one.
 *
 * THE ONE THAT MUST SURVIVE. The newest "Web development test %" paper is
 * left alone whatever its age -- that is the one reopen-demo-exams.mjs keeps
 * open, and the one code-is-kept.mjs sits. Deleting it out from under them
 * would trade thirty-six rows of litter for a suite failure.
 *
 *   node --env-file=.env qa-live/cleanup-web-demo-trial.mjs
 */
import { connect } from '../tools/db/connect.mjs';

const TENANT = 798;
const client = await connect();

const { rows: [t] } = await client.query(
  'select slug from public."onyx_tenants" where id = $1', [TENANT]);
if (t?.slug !== 'malla-reddy-demo') throw new Error('Refusing: tenant is ' + t?.slug);

const papers = await client.query(`
  select id,
    (select string_agg((s->>'bank_id'), ',') from jsonb_array_elements(sections) s) as bank_ids
  from public."onyx_assessments"
  where tenant_id = $1 and title like 'Web development test %'
  order by id desc`, [TENANT]);

if (papers.rows.length <= 1) {
  console.log('Nothing to sweep: ' + papers.rows.length + ' paper(s) of this shape.');
  await client.end();
  process.exit(0);
}

const [keep, ...stale] = papers.rows;
console.log('keeping paper ' + keep.id + ' (the newest -- it is the standing one)');
console.log('sweeping ' + stale.length + ' older paper(s)');

const staleIds = stale.map((r) => r.id);
const staleBankIds = [...new Set(
  stale.flatMap((r) => (r.bank_ids ?? '').split(',').filter(Boolean).map(Number)),
)].filter((id) => id !== Number((keep.bank_ids ?? '').split(',')[0]));

/*
 * A paper with real attempts is not litter, whatever its title matches --
 * somebody sat it. Checked before anything is deleted, not trusted to be
 * empty because every run before this one always was.
 */
const attempts = staleIds.length
  ? await client.query(
    `select assessment_id, count(*)::int as n from public."onyx_assessment_attempts"
       where tenant_id = $1 and assessment_id = any($2::bigint[]) group by 1`,
    [TENANT, staleIds])
  : { rows: [] };
const withAttempts = new Set(attempts.rows.map((r) => Number(r.assessment_id)));
if (withAttempts.size) {
  console.log('SKIPPING ' + withAttempts.size + ' paper(s) with real attempts on them: '
    + [...withAttempts].join(', '));
}
const toDeletePapers = staleIds.filter((id) => !withAttempts.has(Number(id)));

if (toDeletePapers.length) {
  const gone = await client.query(
    'delete from public."onyx_assessments" where id = any($1::bigint[])', [toDeletePapers]);
  console.log('papers removed:', gone.rowCount);
} else {
  console.log('papers removed: 0');
}

/*
 * Now the banks. Only ones no surviving paper still points at -- the keeper's
 * own bank, and any paper skipped above for holding real attempts.
 */
const stillReferenced = new Set([
  ...(keep.bank_ids ?? '').split(',').filter(Boolean).map(Number),
  ...stale.filter((r) => withAttempts.has(Number(r.id)))
    .flatMap((r) => (r.bank_ids ?? '').split(',').filter(Boolean).map(Number)),
]);
const toDeleteBanks = staleBankIds.filter((id) => !stillReferenced.has(id));

if (toDeleteBanks.length) {
  // onyx_questions.bank_id cascades, so this takes the questions with it.
  const gone = await client.query(
    'delete from public."onyx_question_banks" where tenant_id = $1 and id = any($2::bigint[])',
    [TENANT, toDeleteBanks]);
  console.log('banks removed (questions cascade):', gone.rowCount);
} else {
  console.log('banks removed: 0');
}

for (const [label, sql] of [
  ['"Web development test %" papers left', `select count(*)::int n from public."onyx_assessments" where tenant_id=$1 and title like 'Web development test %'`],
  ['"Web + code QA %" banks left', `select count(*)::int n from public."onyx_question_banks" where tenant_id=$1 and name like 'Web + code QA %'`],
]) {
  const { rows: [r] } = await client.query(sql, [TENANT]);
  console.log(label + ':', r.n);
}

await client.end();
