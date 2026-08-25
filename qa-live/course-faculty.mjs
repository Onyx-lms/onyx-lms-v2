/**
 * An operator says who teaches a course, and it actually means something.
 *
 * The claim worth checking is not that a row appears. It is that the lecturer
 * named can then DO the things `assertCanTeach` gates -- read the course as
 * theirs, mark on it, invigilate it -- and that a lecturer who was not named
 * still cannot. A test that only asserted the assignment wrote a row would pass
 * on a feature that changed nothing.
 *
 * ABC Institution only, and everything it creates it removes.
 *
 *   node qa-live/course-faculty.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaFac#2026!';

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

startPhase('1. an institution, a course and two lecturers');

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

// Two lecturers of this run's own, so nothing already on a real course is
// disturbed and the "cannot teach" half has somebody to be refused.
const mine = 'qfac.' + RUN + '.a@onyx.test';
const other = 'qfac.' + RUN + '.b@onyx.test';
for (const [email, name] of [[mine, 'Assigned Lecturer'], [other, 'Other Lecturer']]) {
  await call('/api/onyx/members', {
    method: 'POST', token: at,
    body: { name, email, role: 'faculty', password: PW },
  });
}
const roster = (await call('/api/onyx/members', { token: at })).data ?? [];
const lecturer = roster.find((m) => m.user?.email === mine);
const bystander = roster.find((m) => m.user?.email === other);
check('two lecturers exist', Boolean(lecturer) && Boolean(bystander),
  'assigned + a bystander');

const course = (await call(base + '/courses', {
  method: 'POST', token: pt,
  body: {
    code: 'QAF' + RUN.slice(-4).toUpperCase(),
    title: 'Faculty QA course ' + RUN,
    credits: 3,
  },
})).data;
check('a course is created from the console', Boolean(course?.id), 'course ' + course?.id);

// ---------------------------------------------------------------------------

startPhase('2. before anybody is assigned');

const empty = await call(base + '/courses/' + course.id + '/faculty', { token: pt });
check('the console can read who teaches it', empty.status === 200, String(empty.status));
check('and nobody does yet', (empty.data ?? []).length === 0,
  (empty.data ?? []).length + ' assigned');

const ft = await login(mine, PW);
const before = await call('/api/onyx/courses/' + course.id + '/roster', { token: ft });
check('so the lecturer is refused the course', before.status === 403,
  before.status + ' ' + (before.message ?? ''));

const listed = ((await call(base + '/academics?limit=200', { token: pt })).data?.courses ?? [])
  .find((c) => Number(c.id) === Number(course.id));
check('and the course list reports nobody teaching it',
  Number(listed?.faculty_count) === 0, 'faculty_count=' + listed?.faculty_count);

// ---------------------------------------------------------------------------

startPhase('3. the operator assigns a lecturer');

const assigned = await call(base + '/courses/' + course.id + '/faculty', {
  method: 'POST', token: pt, body: { user_id: lecturer.user_id },
});
check('the console assigns them', assigned.status === 200,
  assigned.status + ' ' + (assigned.message ?? ''));

const now = await call(base + '/courses/' + course.id + '/faculty', { token: pt });
check('and they are named, not just an id',
  (now.data ?? []).some((f) => f.user_id === lecturer.user_id && f.name),
  (now.data ?? []).map((f) => f.name).join(', '));

// The claim that matters: the assignment changes what they may do.
const after = await call('/api/onyx/courses/' + course.id + '/roster', { token: ft });
check('the lecturer can now open the course they teach', after.status === 200,
  after.status + ' ' + (after.message ?? ''));

const bt = await login(other, PW);
const refused = await call('/api/onyx/courses/' + course.id + '/roster', { token: bt });
check('a lecturer who was not assigned still cannot', refused.status === 403,
  refused.status + ' ' + (refused.message ?? ''));

const relisted = ((await call(base + '/academics?limit=200', { token: pt })).data?.courses ?? [])
  .find((c) => Number(c.id) === Number(course.id));
check('the course list now counts them',
  Number(relisted?.faculty_count) === 1, 'faculty_count=' + relisted?.faculty_count);

// ---------------------------------------------------------------------------

startPhase('4. the rules the institution already had');

const again = await call(base + '/courses/' + course.id + '/faculty', {
  method: 'POST', token: pt, body: { user_id: lecturer.user_id },
});
check('assigning the same person twice is not an error, and not a duplicate',
  again.status === 200 && again.data?.assigned === false,
  again.status + ' ' + (again.message ?? ''));

const learnerEmail = 'qfac.' + RUN + '.s@onyx.test';
await call('/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Not A Lecturer', email: learnerEmail, role: 'student', password: PW },
});
const learner = ((await call('/api/onyx/members', { token: at })).data ?? [])
  .find((m) => m.user?.email === learnerEmail);
const wrongRole = await call(base + '/courses/' + course.id + '/faculty', {
  method: 'POST', token: pt, body: { user_id: learner.user_id },
});
check('a student cannot be assigned to teach', wrongRole.status === 422,
  wrongRole.status + ' ' + (wrongRole.message ?? ''));

// Fill the second slot, then try a third: the cap belongs to the service and
// must apply to the console exactly as it does to the institution.
await call(base + '/courses/' + course.id + '/faculty', {
  method: 'POST', token: pt, body: { user_id: bystander.user_id },
});
const facultyRow = cred.find((r) => r[1] === 'abc-institution' && r[2] === 'faculty');
const third = ((await call(base + '/people?role=faculty&limit=200', { token: pt })).data?.people
  ?? []).find((p) => p.email === facultyRow[4]);
const overCap = await call(base + '/courses/' + course.id + '/faculty', {
  method: 'POST', token: pt, body: { user_id: third.user_id },
});
check('a course runs to two, and says so', overCap.status === 422,
  overCap.status + ' ' + (overCap.message ?? ''));

const removed = await call(
  base + '/courses/' + course.id + '/faculty/' + bystander.user_id,
  { method: 'DELETE', token: pt });
check('and one can be taken off again', removed.status === 200,
  removed.status + ' ' + (removed.message ?? ''));

const anon = await fetch(BASE + base + '/courses/' + course.id + '/faculty', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_id: lecturer.user_id }),
});
check('none of this is open to an anonymous caller', anon.status === 401, String(anon.status));

// ---------------------------------------------------------------------------

startPhase('5. putting ABC Institution back as it was');

const gone = await call(base + '/courses/' + course.id, { method: 'DELETE', token: pt });
check('the course is removed', [200, 404].includes(gone.status),
  gone.status + ' ' + (gone.message ?? ''));
for (const m of [lecturer, bystander, learner]) {
  await call(base + '/members/' + m.id, { method: 'DELETE', token: pt });
}
const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_users" WHERE email = ANY($1)',
    [[mine, other, learnerEmail]]);
});
check('and the three people it added', true, 'lecturers and the learner');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
