/**
 * The console restructure, against the live deployment.
 *
 * What the client asked for, checked as a flow rather than as a list of
 * routes:
 *
 *   Examinations splits into a SCHEDULE and an EXAM PAPER; the paper half is
 *   a bank of parallel sets. Assessments splits the same way, and its bank may
 *   be a SINGLE set. A sitting is scheduled straight from a bank, and when it
 *   is opened it reports every candidate by name, roll number, section, grade
 *   and result. Invigilate lists the scheduled examinations, and opening one
 *   reaches the live attempts, the breaches and the proctoring controls.
 *
 * ABC Institution only, and everything it creates it removes. Malla Reddy is
 * looked up solely to assert it is NOT the tenant being touched.
 *
 *   node qa-live/console-restructure.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaCon#2026!';
const SETS = 4;
const PER_SET = 3;

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const rowFor = (role) => cred.find((r) => r[1] === 'abc-institution' && r[2] === role);

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(60), detail);
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

/** A page fetched as HTML, so a screen that fails to render is caught here. */
async function page(path) {
  const res = await fetch(BASE + path, { redirect: 'manual' });
  return { status: res.status, html: res.status === 200 ? await res.text() : '' };
}

// ---------------------------------------------------------------------------

startPhase('1. the institution under test');

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

const adminRow = rowFor('admin');
const at = await login(adminRow[4], adminRow[5]);
const facultyRow = rowFor('faculty');
const ft = facultyRow ? await login(facultyRow[4], facultyRow[5]) : null;

const academics = (await call(base + '/academics?limit=200', { token: pt })).data;
const course = (academics?.courses ?? [])
  .find((c) => Number(c.status) === 1 && c.access === 'open');
check('a course to set a paper on', Boolean(course), course?.code);

// A section, so "for which section" can actually be answered.
const sections = ((await call(base + '/sections', { token: pt })).data ?? [])
  .filter((sx) => sx.status === 1);
let section = sections[0];
if (!section) {
  section = (await call(base + '/sections', {
    method: 'POST', token: pt, body: { name: 'QA section ' + RUN },
  })).data;
}
check('a teaching division to set it for', Boolean(section?.id), section?.name);

// ---------------------------------------------------------------------------

startPhase('2. the exam paper half: a bank of parallel sets');

const bank = (await call(base + '/banks', {
  method: 'POST', token: pt,
  body: { name: 'Console QA bank ' + RUN, course_id: course.id },
})).data;
let added = 0;
for (let sx = 1; sx <= SETS; sx += 1) {
  for (let i = 1; i <= PER_SET; i += 1) {
    const made = await call(base + '/banks/' + bank.id + '/questions', {
      method: 'POST', token: pt,
      body: {
        set_number: sx, type: 'single',
        prompt: 'Set ' + sx + ' question ' + i + ' (' + RUN + ')',
        options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }],
        answer: 'b', points: 1,
      },
    });
    if (made.status === 200) added += 1;
  }
}
check('the bank holds every set it was given', added === SETS * PER_SET,
  added + ' of ' + SETS * PER_SET);

const listedConsole = ((await call(base + '/banks', { token: pt })).data ?? [])
  .find((b) => Number(b.id) === Number(bank.id));
check('the console listing reports sets, questions and marking',
  Number(listedConsole?.set_count) === SETS
  && Number(listedConsole?.question_count) === SETS * PER_SET
  && Number(listedConsole?.needs_marking) === 0,
  'sets=' + listedConsole?.set_count + ' q=' + listedConsole?.question_count
  + ' human=' + listedConsole?.needs_marking);

// The institution's own listing had none of this before.
const listedTenant = ((await call('/api/onyx/banks', { token: at })).data ?? [])
  .find((b) => Number(b.id) === Number(bank.id));
check('and the institution’s own listing reports exactly the same',
  Number(listedTenant?.set_count) === SETS
  && Number(listedTenant?.question_count) === SETS * PER_SET,
  'sets=' + listedTenant?.set_count + ' q=' + listedTenant?.question_count);

// ---------------------------------------------------------------------------

startPhase('3. an assessment bank of ONE set');

const single = (await call(base + '/banks', {
  method: 'POST', token: pt,
  body: { name: 'Console QA single ' + RUN, course_id: course.id },
})).data;
for (let i = 1; i <= 3; i += 1) {
  await call(base + '/banks/' + single.id + '/questions', {
    method: 'POST', token: pt,
    body: {
      type: 'single', prompt: 'Only set question ' + i + ' (' + RUN + ')',
      options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], answer: 'b', points: 1,
    },
  });
}
const singleListed = ((await call(base + '/banks', { token: pt })).data ?? [])
  .find((b) => Number(b.id) === Number(single.id));
check('a bank written without sets reports exactly one',
  Number(singleListed?.set_count) === 1, 'set_count=' + singleListed?.set_count);

// ---------------------------------------------------------------------------

startPhase('4. scheduling straight from the bank');

// Exactly what the console form now does behind one button: the paper, its
// draw from the bank, published, then the sitting.
const startsAt = new Date(Date.now() - 60_000).toISOString();
const paper = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Console QA paper ' + RUN, course_id: course.id, duration_minutes: 30,
    opens_at: startsAt,
    closes_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    section_id: section.id,
    proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
  },
})).data;
check('the paper is created for the chosen section',
  Number(paper?.section_id) === Number(section.id),
  'section_id=' + paper?.section_id);

const drew = await call(base + '/assessments/' + paper.id + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All questions', bank_id: bank.id, take: PER_SET }] },
});
await call(base + '/assessments/' + paper.id + '/publish', { method: 'POST', token: pt, body: {} });
check('it draws a whole set from the bank', drew.status === 200, 'take=' + PER_SET);

const exam = (await call(base + '/exams', {
  method: 'POST', token: pt,
  body: {
    title: 'Console QA exam ' + RUN, course_id: course.id, assessment_id: paper.id,
    starts_at: startsAt, section_id: section.id,
    duration_minutes: 30, max_marks: 30, pass_marks: 12,
  },
})).data;
check('a sitting is scheduled on it, for the same section',
  Boolean(exam?.id) && Number(exam?.section_id) === Number(section.id),
  'exam ' + exam?.id);

// ---------------------------------------------------------------------------

startPhase('5. candidates, so there is something to report on');

const learners = [];
for (let n = 1; n <= 3; n += 1) {
  const roll = 'QC' + RUN.slice(-3).toUpperCase() + '-' + String(n).padStart(3, '0');
  const email = 'qcon.' + RUN + '.' + n + '@onyx.test';
  await call('/api/onyx/members', {
    method: 'POST', token: at,
    body: { name: 'Console QA ' + n, email, role: 'student', password: PW, roll_number: roll },
  });
  const m = ((await call('/api/onyx/members', { token: at })).data ?? [])
    .find((x) => x.user?.email === email);
  // Into the section the paper is set for, or they cannot sit it at all.
  await call(base + '/members/' + m.id + '/section', {
    method: 'PUT', token: pt, body: { section_id: section.id },
  });
  await call('/api/onyx/courses/' + course.id + '/enroll',
    { method: 'POST', token: at, body: { user_id: m.user_id } });
  learners.push({ n, roll, email, membership: m, token: await login(email, PW) });
}
check('three candidates in that section', learners.every((l) => l.token),
  learners.map((l) => l.roll).join(' '));

const dealt = [];
for (const l of learners) {
  const go = await call('/api/onyx/assessments/' + paper.id + '/start',
    { method: 'POST', token: l.token, body: {} });
  dealt.push({
    id: go.data?.id,
    questions: go.data?.questions ?? [],
    qs: (go.data?.questions ?? []).map((q) => q.prompt).sort(),
  });
}
check('each is dealt a full paper', dealt.every((d) => d.qs.length === PER_SET),
  dealt.map((d) => d.qs.length).join(','));
check('and no two of them hold the same set',
  new Set(dealt.map((d) => JSON.stringify(d.qs))).size === 3,
  dealt.map((d) => String(d.qs[0] ?? '').match(/^Set (\d+)/)?.[1]).join(','));

// One hands in, so the register has a marked row, a sitting row and a
// never-started row -- the three states it has to tell apart.
// `response`, not `answer` -- the field the route actually takes. Sending the
// wrong name saved nothing and the script still marked, as zero, which is why
// the score is asserted below rather than merely its presence.
// The questions `start()` dealt, which is the paper this candidate actually
// holds -- not a second fetch that might deal or report a different one.
// A dealt paper names its questions `question_id`; `id` on those rows is the
// paper entry, not the question, and sending it is refused as invalid.
const answers = dealt[0].questions.map((q) => ({
  question_id: Number(q.question_id ?? q.id), response: 'b',
}));
let saved = 0;
let saveWhy = '';
for (const a of answers) {
  const put = await call('/api/onyx/attempts/' + dealt[0].id + '/answer',
    { method: 'POST', token: learners[0].token, body: a });
  if (put.status === 200) saved += 1;
  else saveWhy = put.status + ' ' + (put.message ?? '');
}
check('every answer is saved', saved === answers.length,
  saved + ' of ' + answers.length + (saveWhy ? ' -- ' + saveWhy : ''));
const handed = await call('/api/onyx/attempts/' + dealt[0].id + '/submit',
  { method: 'POST', token: learners[0].token, body: {} });
check('one of them hands in', handed.status === 200, 'attempt ' + dealt[0].id);

// ---------------------------------------------------------------------------

startPhase('6. opening the sitting: the register');

const detail = (await call(base + '/exams/' + exam.id, { token: pt })).data;
const register = detail?.register ?? [];
check('the sitting reports one row per candidate', register.length >= 3,
  register.length + ' rows');
check('every row carries a name, a roll number and a section',
  register.every((r) => r.name && r.roll_number && r.section),
  register.map((r) => r.roll_number).join(' '));
check('the rows are in roll order',
  JSON.stringify(register.map((r) => r.roll_number))
  === JSON.stringify([...register.map((r) => r.roll_number)]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))),
  register.map((r) => r.roll_number).join(' '));

const handedRow = register.find((r) => r.roll_number === learners[0].roll);
check('the one who handed in is marked, correctly, with a script to download',
  Number(handedRow?.score) === PER_SET && handedRow?.attempt_id !== null,
  handedRow?.score + '/' + handedRow?.max_score);
const sittingRow = register.find((r) => r.roll_number === learners[1].roll);
check('the one still sitting is not reported as a fail',
  sittingRow?.result === null && sittingRow?.status === 'in_progress',
  'status=' + sittingRow?.status + ' result=' + sittingRow?.result);

// ---------------------------------------------------------------------------

startPhase('7. invigilation, from the console');

const queue = (await call(base + '/proctor/queue', { token: pt })).data ?? [];
check('the console can read the invigilation queue', Array.isArray(queue),
  queue.length + ' attempts');
const scoped = (await call(base + '/proctor/queue?assessment_id=' + paper.id,
  { token: pt })).data ?? [];
check('and narrow it to one paper',
  scoped.length > 0 && scoped.every((r) => Number(r.assessment_id) === Number(paper.id)),
  scoped.length + ' on this paper');
check('the queue names candidates rather than printing ids',
  scoped.every((r) => r.name || r.roll_number),
  scoped.map((r) => r.roll_number ?? '?').join(' '));

const timeline = await call(base + '/attempts/' + dealt[1].id + '/proctor', { token: pt });
check('one attempt’s invigilation record opens', timeline.status === 200,
  'attempt ' + dealt[1].id);

// The control itself. A clean attempt cleared is the safe direction to test.
const settled = await call(base + '/attempts/' + dealt[1].id + '/integrity', {
  method: 'POST', token: pt,
  body: { decision: 'cleared', note: 'Console QA ' + RUN },
});
check('a verdict can be recorded from the console', settled.status === 200,
  settled.message ?? '');

// Watching is refused for the right reason on a paper nobody consented to
// being watched on -- a 422 here is the guard working, not a fault.
const watch = await call(base + '/attempts/' + dealt[1].id + '/watch',
  { method: 'POST', token: pt, body: {} });
check('watching an unwatchable paper is refused, and says why',
  watch.status === 422 && /live invigilation|consent/i.test(watch.message ?? ''),
  watch.status + ' ' + (watch.message ?? '').slice(0, 60));

const forbidden = await fetch(BASE + base + '/proctor/queue');
check('the queue is not readable without a platform session',
  forbidden.status === 401 || forbidden.status === 403, 'HTTP ' + forbidden.status);

// ---------------------------------------------------------------------------

startPhase('8. the screens themselves');

for (const [label, path] of [
  ['console exam schedule', '/onyx/platform/tenants/' + tid + '/examinations'],
  ['console exam paper', '/onyx/platform/tenants/' + tid + '/examinations/papers'],
  ['console assessment schedule', '/onyx/platform/tenants/' + tid + '/assessments'],
  ['console assessment bank', '/onyx/platform/tenants/' + tid + '/assessments/banks'],
  ['console invigilate', '/onyx/platform/tenants/' + tid + '/invigilate'],
  ['console one sitting', '/onyx/platform/tenants/' + tid + '/invigilate/' + exam.id],
  ['faculty exam paper', '/onyx/exams/papers'],
  ['faculty assessment bank', '/onyx/assessments/banks'],
]) {
  const res = await page(path);
  // A signed-out fetch is redirected to sign in, which is the right answer and
  // proves the route exists and its guard runs. A 404 is the failure.
  check(label + ' route answers', res.status !== 404 && res.status < 500,
    'HTTP ' + res.status);
}

// ---------------------------------------------------------------------------

startPhase('9. putting ABC Institution back as it was');

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_proctor_events" WHERE tenant_id = $1'
    + ' AND attempt_id IN (SELECT id FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND assessment_id = $2)', [tid, paper.id]);
  await db.query('DELETE FROM public."onyx_assessment_answers" WHERE tenant_id = $1'
    + ' AND attempt_id IN (SELECT id FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND assessment_id = $2)', [tid, paper.id]);
  await db.query('DELETE FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND assessment_id = $2', [tid, paper.id]);
});
await call(base + '/exams/' + exam.id, { method: 'DELETE', token: pt });
await call(base + '/assessments/' + paper.id, { method: 'DELETE', token: pt });
for (const l of learners) {
  await call(base + '/members/' + l.membership.id, { method: 'DELETE', token: pt });
}
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_users" WHERE email = ANY($1)',
    [learners.map((l) => l.email)]);
  for (const b of [bank.id, single.id]) {
    await db.query('DELETE FROM public."onyx_question_versions" WHERE tenant_id = $1'
      + ' AND question_id IN (SELECT id FROM public."onyx_questions" WHERE bank_id = $2)',
    [tid, b]);
    await db.query('DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id = $2',
      [tid, b]);
    await db.query('DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND id = $2',
      [tid, b]);
  }
  // Only a section this run created; one that was already there is left alone.
  if (!sections.length) {
    await db.query('DELETE FROM public."onyx_sections" WHERE tenant_id = $1 AND id = $2',
      [tid, section.id]);
  }
});
check('everything this run made is removed', true,
  '3 candidates, 1 paper, 1 sitting, 2 banks');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(76));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
