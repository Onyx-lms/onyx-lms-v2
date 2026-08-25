/**
 * A lecturer can cancel a paper — and cannot cancel one somebody has sat.
 *
 * The second half is the one worth the test. Deleting a paper takes its
 * candidates' answers and marks with it, so the refusal is the feature; a test
 * that only proved the delete works would pass on a version that quietly
 * destroyed somebody's marks.
 *
 * ABC Institution only, and everything it creates it removes.
 *
 *   node qa-live/paper-delete.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaDel#2026!';

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const rowFor = (role) => cred.find((r) => r[1] === 'abc-institution' && r[2] === role);

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(56), detail);
  return pass;
}
async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const p = await res.json().catch(() => ({}));
  return { status: res.status, data: p?.data, message: p?.message };
}
const login = async (e, p) => (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email: e, password: p } })).data?.token;

// ---------------------------------------------------------------------------

startPhase('1. the institution and its people');

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;
const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const abc = tenants.find((t) => t.slug === 'abc-institution');
const forbidden = tenants.find((t) => t.slug === 'malla-reddy-university');
check('ABC Institution is the one being touched',
  Boolean(abc) && abc.id !== forbidden?.id,
  'tenant ' + abc?.id + ', never ' + forbidden?.id);
const tid = abc.id;
const base = '/api/onyx/platform/tenants/' + tid;

const adminRow = rowFor('admin');
const at = await login(adminRow[4], adminRow[5]);
const facultyRow = rowFor('faculty');
const ft = await login(facultyRow[4], facultyRow[5]);
check('an administrator and a lecturer are signed in', Boolean(at) && Boolean(ft), '');

const course = (await call(base + '/courses', {
  method: 'POST', token: pt,
  body: { code: 'QAD' + RUN.slice(-4).toUpperCase(), title: 'Delete QA course ' + RUN, credits: 3 },
})).data;

// Published and open to join. A console course is created as a draft, and a
// candidate cannot reach a paper on a course they cannot see -- which made the
// sitting below silently not happen, and the "refused once sat" check pass for
// entirely the wrong reason.
await call(base + '/courses/' + course.id, {
  method: 'PATCH', token: pt, body: { status: 1, access: 'open' },
});

// The lecturer has to teach it, or every faculty route on it is a 403 — which
// would make this test pass for entirely the wrong reason.
const teacher = ((await call(base + '/people?role=faculty&limit=200', { token: pt })).data?.people
  ?? []).find((p) => p.email === facultyRow[4]);
await call(base + '/courses/' + course.id + '/faculty',
  { method: 'POST', token: pt, body: { user_id: teacher.user_id } });
check('and the lecturer teaches the course', Boolean(teacher), course.code);

const bank = (await call('/api/onyx/banks', {
  method: 'POST', token: ft,
  body: { name: 'Delete QA bank ' + RUN, course_id: course.id },
})).data;
await call('/api/onyx/banks/' + bank.id + '/questions', {
  method: 'POST', token: ft,
  body: {
    type: 'single', prompt: 'Pick b.',
    options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], answer: 'b', points: 1,
  },
});

const makePaper = async (title) => {
  const paper = (await call('/api/onyx/assessments', {
    method: 'POST', token: ft,
    body: {
      title, course_id: course.id, duration_minutes: 30,
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
      sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: 1 }],
      proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
    },
  })).data;
  return paper;
};

// ---------------------------------------------------------------------------

startPhase('2. a paper nobody has sat');

const spare = await makePaper('Delete QA spare ' + RUN);
check('a lecturer can set a paper', Boolean(spare?.id), 'paper ' + spare?.id);

const gone = await call('/api/onyx/assessments/' + spare.id, { method: 'DELETE', token: ft });
check('and remove it again', gone.status === 200, gone.status + ' ' + (gone.message ?? ''));

const missing = await call('/api/onyx/assessments/' + spare.id, { token: ft });
check('it is really gone', missing.status === 404, String(missing.status));

// ---------------------------------------------------------------------------

startPhase('3. a paper somebody has sat');

const sat = await makePaper('Delete QA sat ' + RUN);
await call('/api/onyx/assessments/' + sat.id, { method: 'PATCH', token: ft,
  body: { status: 'published' } });

const email = 'qdel.' + RUN + '@onyx.test';
await call('/api/onyx/members', { method: 'POST', token: at,
  body: { name: 'Delete QA Candidate', email, role: 'student', password: PW } });
const learner = ((await call('/api/onyx/members', { token: at })).data ?? [])
  .find((m) => m.user?.email === email);
await call('/api/onyx/courses/' + course.id + '/enroll',
  { method: 'POST', token: at, body: { user_id: learner.user_id } });
const st = await login(email, PW);

const started = await call('/api/onyx/assessments/' + sat.id + '/start',
  { method: 'POST', token: st, body: {} });
check('a candidate sits it', started.status === 200,
  started.status + ' ' + (started.message ?? ''));

const refused = await call('/api/onyx/assessments/' + sat.id, { method: 'DELETE', token: ft });
check('the lecturer is refused, and told why', refused.status === 422,
  refused.status + ' ' + (refused.message ?? ''));
check('and the refusal names the number of candidates',
  /candidate/.test(String(refused.message ?? '')), refused.message ?? '');

const alive = await call('/api/onyx/assessments/' + sat.id, { token: ft });
check('the paper and its sitting survive the attempt', alive.status === 200, String(alive.status));

// The console must be refused for the same reason -- the rule is one rule now.
const consoleRefused = await call(base + '/assessments/' + sat.id,
  { method: 'DELETE', token: pt });
check('and the console is refused on the same grounds', consoleRefused.status === 422,
  consoleRefused.status + ' ' + (consoleRefused.message ?? ''));

// ---------------------------------------------------------------------------

startPhase('4. who may do it');

const other = 'qdel.' + RUN + '.f@onyx.test';
await call('/api/onyx/members', { method: 'POST', token: at,
  body: { name: 'Other Lecturer', email: other, role: 'faculty', password: PW } });
const otherMember = ((await call('/api/onyx/members', { token: at })).data ?? [])
  .find((m) => m.user?.email === other);
const ot = await login(other, PW);
const spare2 = await makePaper('Delete QA guard ' + RUN);
const notTheirs = await call('/api/onyx/assessments/' + spare2.id,
  { method: 'DELETE', token: ot });
check('a lecturer who does not teach the course cannot remove its paper',
  notTheirs.status === 403, notTheirs.status + ' ' + (notTheirs.message ?? ''));

const anon = await fetch(BASE + '/api/onyx/assessments/' + spare2.id, { method: 'DELETE' });
check('and neither can an anonymous caller', anon.status === 401, String(anon.status));

const byLearner = await call('/api/onyx/assessments/' + spare2.id,
  { method: 'DELETE', token: st });
check('nor a candidate', byLearner.status === 403, String(byLearner.status));

// ---------------------------------------------------------------------------

startPhase('5. putting ABC Institution back as it was');

await call('/api/onyx/assessments/' + spare2.id, { method: 'DELETE', token: ft });
const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND assessment_id = $2', [tid, sat.id]);
});
const cleared = await call(base + '/assessments/' + sat.id, { method: 'DELETE', token: pt });
check('the sat paper is removed once its sitting is', [200, 404].includes(cleared.status),
  String(cleared.status));

const removedCourse = await call(base + '/courses/' + course.id,
  { method: 'DELETE', token: pt });
check('the course is removed', [200, 404].includes(removedCourse.status),
  String(removedCourse.status));
for (const m of [learner, otherMember]) {
  await call(base + '/members/' + m.id, { method: 'DELETE', token: pt });
}
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_users" WHERE email = ANY($1)', [[email, other]]);
  await db.query('DELETE FROM public."onyx_question_versions" WHERE tenant_id = $1'
    + ' AND question_id IN (SELECT id FROM public."onyx_questions" WHERE bank_id = $2)',
  [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id = $2',
    [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND id = $2',
    [tid, bank.id]);
});
check('and the people and bank it added', true, '2 people, 1 bank');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
