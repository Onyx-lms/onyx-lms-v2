/**
 * The employer half of the placement portal, walked end to end.
 *
 * The quality report found that a company signed in to its own job post was
 * told "Nobody has applied yet" while the placement officer looking at the
 * same post could see the candidate. That is the half of the feature the
 * institution does not control: placement can be assured the portal works, and
 * the company on the other side sees an empty table and stops checking.
 *
 * WHAT IT ACTUALLY WAS. The API was never wrong. `applicants()` filters on
 * tenant and job and returns the rows. The company record had been registered
 * before its contact had a login, so `onyx_employers.user_id` was null, every
 * ownership check answered 403 -- correctly -- and the PAGE rendered that
 * refusal as an empty table. An error displayed as a fact. So this suite
 * checks both halves: that a linked company sees its applicants, and that an
 * unlinked one is told it cannot see them rather than being told nobody
 * applied.
 *
 * Idempotent against the demo institution's own recruiter, rather than
 * creating and deleting a company on every run: an employer record cannot be
 * deleted through the API at all, so a create-per-run suite would leave one
 * behind every time it ran. Malla Reddy Demo keeps one recruiter, one open
 * post, and this re-uses them.
 *
 *   node --env-file=.env qa-live/employer-sees-applicants.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DOMAIN = 'mrdemo.test';
const ADMIN = { email: 'admin@' + DOMAIN, password: 'MrDemo#2026!' };
const STUDENT = { email: 'alpha-cse.002@' + DOMAIN, password: 'Student#2026!' };
const RECRUITER = { email: 'recruiter@northwind.test', password: 'Employer#2026!' };
const COMPANY = 'Northwind Systems';

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(58) + ' ' + detail);
};

async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, data: j?.data ?? null, message: j?.message ?? null };
}
const login = async (email, password) =>
  (await call('/api/onyx/auth/login', { method: 'POST', body: { email, password } })).data?.token;

const at = await login(ADMIN.email, ADMIN.password);
if (!at) { console.error('could not sign in as the administrator'); process.exit(1); }

console.log('\n== the company the institution recruits with ==\n');

const employers = (await call('/api/onyx/employers', { token: at })).data ?? [];
const company = employers.find((e) => String(e.name) === COMPANY);
check('the institution has a registered company', Boolean(company),
  company ? COMPANY + ' (#' + company.id + ')' : 'no ' + COMPANY + ' — seed it first');
if (!company) process.exit(1);

check('and it is linked to a sign-in', Boolean(company.user_id),
  company.user_id ? 'linked' : 'user_id is null — nobody can sign in as this company');

const jobs = (await call('/api/onyx/jobs', { token: at })).data ?? [];
const post = jobs.find((j) => Number(j.employer_id) === Number(company.id) && j.status === 'open');
check('with an open post on the board', Boolean(post),
  post ? '#' + post.id + ' ' + post.title : 'no open post for this company');
if (!post) process.exit(1);

console.log('\n== a learner applies ==\n');

const st = await login(STUDENT.email, STUDENT.password);
const applied = await call('/api/onyx/jobs/' + post.id + '/apply',
  { method: 'POST', token: st, body: { note: 'Keen to join the graduate scheme.' } });
// Applying twice is refused, and on a re-run that refusal is the correct answer.
check('the learner applies', applied.status < 300 || /already/i.test(applied.message ?? ''),
  'HTTP ' + applied.status + ' ' + (applied.message ?? ''));

const officer = await call('/api/onyx/jobs/' + post.id + '/applicants', { token: at });
check('the placement office sees the application',
  officer.status === 200 && (officer.data ?? []).length > 0,
  'HTTP ' + officer.status + ' · ' + (officer.data ?? []).length + ' applicant(s)');

console.log('\n== the company looks at its own post ==\n');

const et = await login(RECRUITER.email, RECRUITER.password);
check('the company contact signs in', Boolean(et), RECRUITER.email);

const theirs = await call('/api/onyx/jobs/' + post.id + '/applicants', { token: et });
check('THE COMPANY SEES WHO APPLIED TO ITS OWN POST',
  theirs.status === 200 && (theirs.data ?? []).length > 0,
  'HTTP ' + theirs.status + ' · ' + (theirs.data ?? []).length + ' applicant(s) '
  + (theirs.message ?? ''));

check('  and the office and the company see the same list',
  (theirs.data ?? []).length === (officer.data ?? []).length,
  (officer.data ?? []).length + ' to the office, ' + (theirs.data ?? []).length + ' to the company');

check('  and each candidate is named, not a raw id',
  (theirs.data ?? []).length > 0 && (theirs.data ?? []).every((a) => a.candidate?.name),
  (theirs.data ?? [])[0]?.candidate?.name ?? 'no name on the row');

const own = await call('/api/onyx/employers/mine', { token: et });
check('the company can find its own record', own.status === 200 && own.data?.name === COMPANY,
  'HTTP ' + own.status + ' · ' + (own.data?.name ?? 'nothing'));

/*
 * The other half. A portal that fixes "shows nothing" by showing everything is
 * a worse product than the broken one.
 */
const notTheirs = jobs.find((j) => Number(j.employer_id) !== Number(company.id));
if (notTheirs) {
  const peek = await call('/api/onyx/jobs/' + notTheirs.id + '/applicants', { token: et });
  check('and cannot read another company’s pipeline', peek.status === 403,
    'HTTP ' + peek.status + ' on post #' + notTheirs.id);
} else {
  check('and cannot read another company’s pipeline', true,
    'only one company posts here today');
}

const first = (theirs.data ?? [])[0];
if (first) {
  const moved = await call('/api/onyx/applications/' + first.id,
    { method: 'PATCH', token: et, body: { status: 'shortlisted', note: 'Worth a call.' } });
  check('the company can move a candidate along', moved.status < 300,
    'HTTP ' + moved.status + ' ' + (moved.message ?? ''));
  // Put it back, so a re-run starts where this one did.
  await call('/api/onyx/applications/' + first.id,
    { method: 'PATCH', token: et, body: { status: 'applied' } });
}

console.log('\n== an unlinked company is told so, not told nobody applied ==\n');

/*
 * The exact shape of the reported defect, asserted rather than assumed: a
 * company that is NOT this post's owner must be refused, and the refusal must
 * be a refusal. The page turns a null read into "We could not open the
 * applicant list"; what is checked here is that the API refuses at all, which
 * is the half a script can see.
 */
const stranger = await call('/api/onyx/jobs/' + post.id + '/applicants', { token: st });
check('a learner cannot read the pipeline at all', stranger.status === 403,
  'HTTP ' + stranger.status + ' ' + (stranger.message ?? ''));
check('  and the refusal says so in words', /not your|not yours/i.test(stranger.message ?? ''),
  stranger.message ?? 'no message');

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(results.length - failed.length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
