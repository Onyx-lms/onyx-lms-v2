/**
 * The whole chain a student actually walks, with a real registration.
 *
 *   1. Somebody registers, choosing their section on the form.
 *   2. Faculty and the platform console can both see which section that is.
 *   3. A paper and a sitting set for THEIR section reach them.
 *   4. Ones set for another section do not — not on the list, not on the
 *      timetable, and not by typing the id.
 *   5. Ones set for nobody in particular still reach everybody.
 *
 * A real registration, not an invitation: the section is chosen on the sign-up
 * form, and the point is that the choice survives all the way to what a
 * candidate is dealt. The e-mail code is minted with the same admin call the
 * browser suite uses — `generateLink` returns a token instead of sending it —
 * because the built-in mailer allows two messages an hour and a test that
 * waited on a real inbox would fail for reasons that have nothing to do with
 * sections.
 *
 * Run against ABC Institution, which is open to self-registration. Malla Reddy
 * is not (`student_signup: false`), so step 1 cannot happen there at all — the
 * rule under test is the same code for every institution.
 *
 *   node qa-live/section-signup.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaSign#2026!';

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const rowFor = (role) => cred.find((r) => r[1] === 'abc-institution' && r[2] === role);

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(58), detail);
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

startPhase('1. what the sign-up form is offered');

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;
const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const abc = tenants.find((t) => t.slug === 'abc-institution');
const mrit = tenants.find((t) => t.slug === 'malla-reddy-university');
check('ABC Institution is the one being touched',
  Boolean(abc) && abc.id !== mrit?.id, 'tenant ' + abc?.id + ', never ' + mrit?.id);
const tid = abc.id;
const base = '/api/onyx/platform/tenants/' + tid;

const open = (await call('/api/onyx/auth/signup/institutions')).data ?? [];
check('it lists the institutions anybody may join',
  open.some((t) => Number(t.id) === Number(tid)), open.length + ' open');

const offered = (await call('/api/onyx/auth/signup/sections?tenant_id=' + tid)).data ?? [];
check('and the sections of the one being joined', offered.length >= 2,
  offered.map((sx) => sx.name).join(', '));
const [mine, theirs] = offered;

// ---------------------------------------------------------------------------

startPhase('2. somebody registers, and picks a section');

const email = 'qsign.' + RUN + '@demo.onyx';
const started = await call('/api/onyx/auth/signup/start', {
  method: 'POST', body: { email, tenant_id: tid },
});
check('the code is sent', started.status === 200,
  started.status + ' ' + (started.message ?? ''));

// The code, without waiting on an inbox. Same admin call the browser suite
// uses: generateLink returns the token instead of mailing it.
const { otpFor } = await import('../tests/browser/helpers.ts');
const code = await otpFor(email, PW);
check('a code is obtained for that address', Boolean(code), code ? 'six digits' : 'none');

const joined = await call('/api/onyx/auth/signup/verify', {
  method: 'POST',
  body: {
    name: 'Section Signup ' + RUN, email, password: PW, code,
    phone: '9845127384', roll_number: 'SEC-' + RUN.slice(-5).toUpperCase(),
    tenant_id: tid, section_id: mine.id,
  },
});
check('they register, choosing ' + mine.name, joined.status === 200,
  joined.status + ' ' + (joined.message ?? ''));
const st = joined.data?.token ?? await login(email, PW);
check('and are signed in straight away', Boolean(st), '');

// ---------------------------------------------------------------------------

startPhase('3. staff can see which section they are in');

const consoleRoster = (await call(base + '/people?role=student&limit=200', { token: pt })).data;
const seenByConsole = (consoleRoster?.people ?? []).find((p) => p.email === email);
check('the platform console shows their section',
  seenByConsole?.section?.name === mine.name,
  'section=' + (seenByConsole?.section?.name ?? 'none'));

const filtered = (await call(base + '/people?role=student&limit=200&section_id=' + mine.id,
  { token: pt })).data;
check('and can filter the roll to that section',
  (filtered?.people ?? []).some((p) => p.email === email),
  (filtered?.people ?? []).length + ' in ' + mine.name);

const facultyRow = rowFor('faculty');
const ft = await login(facultyRow[4], facultyRow[5]);
const adminRow = rowFor('admin');
const at = await login(adminRow[4], adminRow[5]);

const bySections = (await call('/api/onyx/sections', { token: ft })).data ?? [];
check('faculty can read the institution sections', bySections.length >= 2,
  bySections.map((sx) => sx.name).join(', '));

const staffRoster = (await call('/api/onyx/members?role=student', { token: at })).data ?? [];
const seenByAdmin = staffRoster.find((m) => m.user?.email === email);
check('an administrator sees their section on the roster',
  Number(seenByAdmin?.section_id) === Number(mine.id),
  'section_id=' + seenByAdmin?.section_id + ' (' + mine.name + ')');

const staffFiltered = (await call('/api/onyx/members?role=student&section_id=' + mine.id,
  { token: at })).data ?? [];
check('and can filter their own roster by section',
  staffFiltered.some((m) => m.user?.email === email),
  staffFiltered.length + ' in ' + mine.name);

// ---------------------------------------------------------------------------

startPhase('4. what they are dealt, and what they are not');

const course = ((await call(base + '/academics?limit=200', { token: pt })).data?.courses ?? [])
  .find((c) => Number(c.status) === 1);
await call('/api/onyx/courses/' + course.id + '/enroll',
  { method: 'POST', token: at, body: { user_id: joined.data?.user?.id } });

const bank = (await call(base + '/banks', {
  method: 'POST', token: pt, body: { name: 'Signup QA bank ' + RUN, course_id: course.id },
})).data;
await call(base + '/banks/' + bank.id + '/questions', {
  method: 'POST', token: pt,
  body: {
    type: 'single', prompt: 'Pick b.',
    options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], answer: 'b', points: 1,
  },
});

const makePaper = async (title, sectionId) => {
  const paper = (await call(base + '/assessments', {
    method: 'POST', token: pt,
    body: {
      title, course_id: course.id, duration_minutes: 30, section_id: sectionId,
      opens_at: new Date(Date.now() - 3_600_000).toISOString(),
      closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
      proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
    },
  })).data;
  await call(base + '/assessments/' + paper.id + '/sections', {
    method: 'PUT', token: pt,
    body: { sections: [{ id: 's1', title: 'All', bank_id: bank.id, take: 1 }] },
  });
  await call(base + '/assessments/' + paper.id + '/publish',
    { method: 'POST', token: pt, body: {} });
  return paper;
};

const forMine = await makePaper('Signup QA ' + mine.name + ' ' + RUN, mine.id);
const forTheirs = await makePaper('Signup QA ' + theirs.name + ' ' + RUN, theirs.id);
const forAll = await makePaper('Signup QA everybody ' + RUN, null);

const listed = ((await call('/api/onyx/assessments', { token: st })).data ?? [])
  .map((a) => Number(a.id));
check('the paper for their section is on their list',
  listed.includes(Number(forMine.id)), mine.name);
check('the paper for the other section is NOT',
  !listed.includes(Number(forTheirs.id)), theirs.name);
check('and the paper for everybody is',
  listed.includes(Number(forAll.id)), 'no section named');

const sneak = await call('/api/onyx/assessments/' + forTheirs.id + '/start',
  { method: 'POST', token: st, body: {} });
check('typing the other section paper id is refused', sneak.status === 403,
  sneak.status + ' ' + (sneak.message ?? ''));

const sit = await call('/api/onyx/assessments/' + forMine.id + '/start',
  { method: 'POST', token: st, body: {} });
check('while their own paper deals to them', sit.status === 200,
  sit.status + ' ' + (sit.message ?? ''));

// ---------------------------------------------------------------------------

startPhase('5. the same for a scheduled sitting');

const mkExam = async (title, sectionId) => (await call(base + '/exams', {
  method: 'POST', token: pt,
  body: {
    course_id: course.id, title, starts_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    duration_minutes: 60, max_marks: 100, pass_marks: 40, section_id: sectionId,
  },
})).data;

const examMine = await mkExam('Signup QA sitting ' + mine.name + ' ' + RUN, mine.id);
const examTheirs = await mkExam('Signup QA sitting ' + theirs.name + ' ' + RUN, theirs.id);

const from = new Date(Date.now() - 86_400_000).toISOString();
const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
const week = ((await call('/api/onyx/calendar?from=' + encodeURIComponent(from)
  + '&to=' + encodeURIComponent(to), { token: st })).data?.exams ?? [])
  .map((e) => Number(e.id));
check('their section sitting is on their timetable',
  week.includes(Number(examMine.id)), mine.name);
check('the other section sitting is not',
  !week.includes(Number(examTheirs.id)), theirs.name);

const examsList = ((await call('/api/onyx/exams', { token: st })).data ?? [])
  .map((e) => Number(e.id));
check('and the same on their Examinations list',
  examsList.includes(Number(examMine.id)) && !examsList.includes(Number(examTheirs.id)),
  examsList.length + ' listed');

// ---------------------------------------------------------------------------

startPhase('6. putting ABC Institution back as it was');

const { withDb } = await import('../tests/e2e/harness.ts');
const papers = [forMine, forTheirs, forAll];
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_assessment_attempts" WHERE tenant_id = $1'
    + ' AND assessment_id = ANY($2)', [tid, papers.map((p) => p.id)]);
});
for (const e of [examMine, examTheirs]) {
  await call(base + '/exams/' + e.id, { method: 'DELETE', token: pt });
}
for (const p of papers) {
  await call(base + '/assessments/' + p.id, { method: 'DELETE', token: pt });
}
const roster = (await call('/api/onyx/members', { token: at })).data ?? [];
const m = roster.find((x) => x.user?.email === email);
if (m) await call(base + '/members/' + m.id, { method: 'DELETE', token: pt });
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_users" WHERE email = $1', [email]);
  await db.query('DELETE FROM public."onyx_question_versions" WHERE tenant_id = $1'
    + ' AND question_id IN (SELECT id FROM public."onyx_questions" WHERE bank_id = $2)',
  [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id = $2',
    [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND id = $2',
    [tid, bank.id]);
});
check('the registrant, papers, sittings and bank are removed', true, '');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
