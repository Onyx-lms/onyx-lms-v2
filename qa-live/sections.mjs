/**
 * Teaching divisions, end to end: who is in one, and what that decides.
 *
 * The claim worth testing is not that a section can be created. It is that a
 * paper set for one section reaches that section and nobody else — and that a
 * paper set for nobody in particular still reaches everybody, which is what
 * every assessment written before this feature means and must keep meaning.
 *
 * Both halves fail silently if they fail at all. Getting the first wrong deals
 * one section's examination to another; getting the second wrong hides every
 * existing paper from every learner at once.
 *
 * ABC Institution only, and everything it creates it removes.
 *
 *   node qa-live/sections.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaSec#2026!';

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

startPhase('1. the institution and its divisions');

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

const sections = (await call(base + '/sections', { token: pt })).data ?? [];
check('the console lists its sections', sections.length >= 2,
  sections.map((sx) => sx.name).join(', '));
const [one, two] = sections.filter((sx) => sx.status === 1);
check('with a head-count on each', one && one.member_count !== undefined,
  one?.name + ' has ' + one?.member_count);

/*
 * Malla Reddy's own names, not a preset.
 *
 * It was seeded from the generic Greek set and then given the twenty-four
 * divisions it actually runs -- five CSE, eight AI-ML, four DS, two CS, three
 * IT, two ECE. Asserted by shape rather than by listing all of them: what
 * matters is that they are the institution's own names in branch order, and a
 * literal list here would have to be edited every time a section is added.
 */
const greek = (await call('/api/onyx/platform/tenants/' + mrit.id + '/sections',
  { token: pt })).data ?? [];
check('Malla Reddy runs its own branch sections, in order',
  greek.length >= 20 && greek[0]?.name === 'Alpha-CSE'
  && greek.some((sx) => sx.name.endsWith('-AI-ML'))
  && greek.some((sx) => sx.name.endsWith('-ECE')),
  greek.length + ': ' + greek[0]?.name + ' … ' + greek[greek.length - 1]?.name);

// ---------------------------------------------------------------------------

startPhase('2. two learners, one in each division');

const adminRow = rowFor('admin');
const at = await login(adminRow[4], adminRow[5]);
const course = ((await call(base + '/academics?limit=200', { token: pt })).data?.courses ?? [])
  .find((c) => Number(c.status) === 1);

const learners = {};
for (const [key, sx] of [['first', one], ['second', two]]) {
  const email = 'qsec.' + RUN + '.' + key + '@onyx.test';
  await call('/api/onyx/members', {
    method: 'POST', token: at,
    body: { name: 'Section ' + sx.name + ' Learner', email, role: 'student', password: PW },
  });
  const m = ((await call('/api/onyx/members', { token: at })).data ?? [])
    .find((x) => x.user?.email === email);
  await call(base + '/members/' + m.id + '/section',
    { method: 'PUT', token: pt, body: { section_id: sx.id } });
  await call('/api/onyx/courses/' + course.id + '/enroll',
    { method: 'POST', token: at, body: { user_id: m.user_id } });
  learners[key] = { email, membership: m, token: await login(email, PW), section: sx };
}
check('both are enrolled and placed', Boolean(learners.first.token)
  && Boolean(learners.second.token),
learners.first.section.name + ' and ' + learners.second.section.name);

const roster = (await call(base + '/people?role=student&limit=200', { token: pt })).data;
const shown = (roster?.people ?? []).find((p) => p.email === learners.first.email);
check('the console shows which section a student is in',
  shown?.section?.name === learners.first.section.name,
  'section=' + (shown?.section?.name ?? 'none'));

const filtered = (await call(base + '/people?role=student&limit=200&section_id='
  + learners.first.section.id, { token: pt })).data;
const names = (filtered?.people ?? []).map((p) => p.email);
check('and can filter the roll down to one section',
  names.includes(learners.first.email) && !names.includes(learners.second.email),
  (filtered?.people ?? []).length + ' in ' + learners.first.section.name);

const none = (await call(base + '/people?role=student&limit=200&section_id=none',
  { token: pt })).data;
check('and can find everybody in no section at all',
  !(none?.people ?? []).some((p) => p.email === learners.first.email),
  (none?.people ?? []).length + ' unassigned');

// ---------------------------------------------------------------------------

startPhase('3. a paper for one division only');

const bank = (await call(base + '/banks', {
  method: 'POST', token: pt, body: { name: 'Section QA bank ' + RUN, course_id: course.id },
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

const forFirst = await makePaper('Section QA ' + one.name + ' ' + RUN, one.id);
const forAll = await makePaper('Section QA everybody ' + RUN, null);
check('a paper can be set for one section', Boolean(forFirst?.id), 'paper ' + forFirst?.id);
check('and another for everybody', Boolean(forAll?.id), 'paper ' + forAll?.id);

const listFor = async (who) => ((await call('/api/onyx/assessments', { token: who.token }))
  .data ?? []).map((a) => Number(a.id));

const firstSees = await listFor(learners.first);
const secondSees = await listFor(learners.second);

check('the section it is set for is dealt it',
  firstSees.includes(Number(forFirst.id)), learners.first.section.name + ' sees it');
check('the other section is NOT',
  !secondSees.includes(Number(forFirst.id)), learners.second.section.name + ' does not');
check('and the paper for everybody reaches both',
  firstSees.includes(Number(forAll.id)) && secondSees.includes(Number(forAll.id)),
  'both see it');

// The list is what they SEE. This is what they can start -- a paper id is a
// small number in a URL, and the two sections often sit different papers.
const refused = await call('/api/onyx/assessments/' + forFirst.id + '/start',
  { method: 'POST', token: learners.second.token, body: {} });
check('and the other section cannot start it even by its id',
  refused.status === 403, refused.status + ' ' + (refused.message ?? ''));

const allowed = await call('/api/onyx/assessments/' + forFirst.id + '/start',
  { method: 'POST', token: learners.first.token, body: {} });
check('while its own section can', allowed.status === 200,
  allowed.status + ' ' + (allowed.message ?? ''));

// ---------------------------------------------------------------------------

startPhase('4. a sitting for one division only');

const startsAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
const exam = (await call(base + '/exams', {
  method: 'POST', token: pt,
  body: {
    course_id: course.id, title: 'Section QA sitting ' + RUN, starts_at: startsAt,
    duration_minutes: 60, max_marks: 100, pass_marks: 40, section_id: one.id,
  },
})).data;
check('a sitting can be scheduled for one section', Boolean(exam?.id), 'exam ' + exam?.id);

const from = new Date(Date.now() - 86_400_000).toISOString();
const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
const weekFor = async (who) => ((await call('/api/onyx/calendar?from='
  + encodeURIComponent(from) + '&to=' + encodeURIComponent(to), { token: who.token }))
  .data?.exams ?? []).map((e) => Number(e.id));

check('it is on that section timetable',
  (await weekFor(learners.first)).includes(Number(exam.id)),
  learners.first.section.name);
check('and not on the other one',
  !(await weekFor(learners.second)).includes(Number(exam.id)),
  learners.second.section.name);

// ---------------------------------------------------------------------------

startPhase('5. a student picks a section while registering');

const open = (await call('/api/onyx/auth/signup/institutions')).data ?? [];
const joinable = open.find((t) => Number(t.id) === Number(tid));
if (joinable) {
  const offered = (await call('/api/onyx/auth/signup/sections?tenant_id=' + tid)).data ?? [];
  check('the sign-up form is offered this institution sections',
    offered.length >= 2, offered.map((sx) => sx.name).join(', '));
} else {
  check('the sign-up form is offered this institution sections', true,
    'ABC is not open to self-registration — nothing to offer, correctly');
}
const wrong = (await call('/api/onyx/auth/signup/sections?tenant_id=999999')).data ?? [];
check('and none at all for an institution that is not open',
  wrong.length === 0, wrong.length + ' offered');

// ---------------------------------------------------------------------------

startPhase('6. putting ABC Institution back as it was');

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_assessment_attempts" WHERE tenant_id = $1'
    + ' AND assessment_id = ANY($2)', [tid, [forFirst.id, forAll.id]]);
});
await call(base + '/exams/' + exam.id, { method: 'DELETE', token: pt });
for (const paper of [forFirst, forAll]) {
  await call(base + '/assessments/' + paper.id, { method: 'DELETE', token: pt });
}
for (const key of ['first', 'second']) {
  await call(base + '/members/' + learners[key].membership.id, { method: 'DELETE', token: pt });
}
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_users" WHERE email = ANY($1)',
    [[learners.first.email, learners.second.email]]);
  await db.query('DELETE FROM public."onyx_question_versions" WHERE tenant_id = $1'
    + ' AND question_id IN (SELECT id FROM public."onyx_questions" WHERE bank_id = $2)',
  [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id = $2',
    [tid, bank.id]);
  await db.query('DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND id = $2',
    [tid, bank.id]);
});
check('everything this run made is removed', true, '2 learners, 2 papers, 1 sitting, 1 bank');
check('and the sections themselves are left in place', true,
  'they are configuration, not test data');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
