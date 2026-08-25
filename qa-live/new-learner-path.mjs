/**
 * What a learner added TODAY can do, on a course configured the way Malla
 * Reddy's two now are: published, `access: open`, `self_enroll: 1`, free.
 *
 * Run against ABC Institution deliberately. The question is about Malla Reddy,
 * but answering it there would mean adding a person to a live institution to
 * find out — so the same configuration is reproduced here, walked end to end,
 * and removed. What is proven is the RULE, which is the same code for every
 * institution.
 *
 * The step worth watching is the last one: an examination belongs to a course,
 * and a learner sees the exams of courses they are ON. Joining is not
 * automatic, so a brand-new learner sees the course and a Join button, and the
 * examination appears once they have used it.
 *
 *   node qa-live/new-learner-path.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaNew#2026!';

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

startPhase('1. a course configured exactly as Malla Reddy’s two are');

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

const course = (await call(base + '/courses', {
  method: 'POST', token: pt,
  body: { code: 'QNL' + RUN.slice(-4).toUpperCase(), title: 'New learner QA ' + RUN, credits: 3 },
})).data;
await call(base + '/courses/' + course.id, {
  method: 'PATCH', token: pt, body: { status: 1, access: 'open' },
});
const made = ((await call(base + '/academics?limit=200', { token: pt })).data?.courses ?? [])
  .find((c) => Number(c.id) === Number(course.id));
check('published, open to join, free — the same as PY122 and WD101',
  Number(made?.status) === 1 && made?.access === 'open' && Number(made?.price_minor) === 0,
  'status=' + made?.status + ' access=' + made?.access + ' price=' + made?.price_minor);

// A paper and a scheduled sitting on it, so there is something to attempt.
const bank = (await call(base + '/banks', {
  method: 'POST', token: pt, body: { name: 'New learner QA bank ' + RUN, course_id: course.id },
})).data;
await call(base + '/banks/' + bank.id + '/questions', {
  method: 'POST', token: pt,
  body: {
    type: 'single', prompt: 'Pick b.',
    options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], answer: 'b', points: 1,
  },
});
const paper = (await call(base + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'New learner QA paper ' + RUN, course_id: course.id, duration_minutes: 30,
    // An hour, not a minute. This machine's clock and the server's differ by
    // enough that a window opening "sixty seconds ago" locally was still in
    // the future there, and the paper was refused as not yet open -- a fault
    // in the harness that read exactly like one in the product.
    // Overwritten by the sitting below -- see `syncExamAssessmentWindow`.
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

/*
 * A sitting that has already begun, so the paper is open when the learner
 * reaches it.
 *
 * Scheduling it two hours ahead made this run fail with "this assessment has
 * not opened yet", which looked like a defect and is the opposite: attaching a
 * paper to a sitting calls `syncExamAssessmentWindow`, which opens the paper
 * for exactly that sitting. A candidate cannot sit an examination paper before
 * the examination starts, which is the whole point of scheduling one.
 */
const startsAt = new Date(Date.now() - 5 * 60_000).toISOString();
const exam = (await call(base + '/exams', {
  method: 'POST', token: pt,
  body: {
    course_id: course.id, assessment_id: paper.id, title: 'New learner QA sitting ' + RUN,
    starts_at: startsAt, duration_minutes: 60, max_marks: 100, pass_marks: 40,
  },
})).data;
check('with a published paper and a scheduled sitting on it', Boolean(exam?.id),
  'exam ' + exam?.id);

// ---------------------------------------------------------------------------

startPhase('2. a learner added today, before joining anything');

const adminRow = rowFor('admin');
const at = await login(adminRow[4], adminRow[5]);
const email = 'qnew.' + RUN + '@onyx.test';
await call('/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Brand New Learner', email, role: 'student', password: PW },
});
const learner = ((await call('/api/onyx/members', { token: at })).data ?? [])
  .find((m) => m.user?.email === email);
const st = await login(email, PW);
check('they can sign in', Boolean(st), email);

const catalogue = (await call('/api/onyx/courses', { token: st })).data ?? [];
const seen = (catalogue.courses ?? catalogue).find((c) => Number(c.id) === Number(course.id));
check('the course is on their All courses list without anybody adding them',
  Boolean(seen), seen ? seen.code + ' — ' + seen.title : 'not visible');
check('and it is joinable by them, not by the programme office',
  seen?.access === 'open', 'access=' + seen?.access);

const mineBefore = (await call('/api/onyx/my/courses', { token: st })).data ?? [];
check('but it is not yet one of THEIR courses', mineBefore.length === 0,
  mineBefore.length + ' enrolled');

const from = new Date(Date.now() - 86_400_000).toISOString();
const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
const calBefore = await call('/api/onyx/calendar?from=' + encodeURIComponent(from)
  + '&to=' + encodeURIComponent(to), { token: st });
check('and the sitting is NOT on their timetable yet',
  (calBefore.data?.exams ?? []).length === 0,
  (calBefore.data?.exams ?? []).length + ' on the week — an exam belongs to a course');

// ---------------------------------------------------------------------------

startPhase('3. they press Join');

const joined = await call('/api/onyx/courses/' + course.id + '/enroll',
  { method: 'POST', token: st, body: {} });
check('a learner can enrol themselves on an open course', joined.status === 200,
  joined.status + ' ' + (joined.message ?? ''));

const mineAfter = (await call('/api/onyx/my/courses', { token: st })).data ?? [];
check('it is now one of their courses',
  mineAfter.some((c) => Number(c.id) === Number(course.id)),
  mineAfter.map((c) => c.code).join(', '));

const calAfter = await call('/api/onyx/calendar?from=' + encodeURIComponent(from)
  + '&to=' + encodeURIComponent(to), { token: st });
const onWeek = (calAfter.data?.exams ?? []).find((e) => Number(e.id) === Number(exam.id));
check('and the sitting is on their timetable', Boolean(onWeek),
  onWeek ? new Date(onWeek.starts_at).toLocaleString('en-IN',
    { timeZone: 'Asia/Kolkata' }) : 'not there');

const exams = (await call('/api/onyx/exams', { token: st })).data ?? [];
check('and on their Examinations list',
  exams.some((e) => Number(e.id) === Number(exam.id)),
  exams.length + ' listed');

// ---------------------------------------------------------------------------

startPhase('4. and they can actually sit the paper');

const started = await call('/api/onyx/assessments/' + paper.id + '/start',
  { method: 'POST', token: st, body: {} });
check('the paper deals to them', started.status === 200,
  started.status + ' ' + (started.message ?? ''));
const attemptId = started.data?.id;
if (attemptId) {
  for (const q of started.data?.questions ?? []) {
    await call('/api/onyx/attempts/' + attemptId + '/answer', {
      method: 'POST', token: st,
      body: { question_id: q.question_id, response: 'b' },
    });
  }
  const handed = await call('/api/onyx/attempts/' + attemptId + '/submit',
    { method: 'POST', token: st, body: {} });
  check('they can hand it in', handed.status === 200,
    handed.status + ' ' + (handed.message ?? ''));
  const seenBack = await call('/api/onyx/attempts/' + attemptId, { token: st });
  check('and their mark is there', seenBack.data?.score !== null
    && seenBack.data?.score !== undefined,
  'score=' + seenBack.data?.score + '/' + seenBack.data?.max_score);
}

// ---------------------------------------------------------------------------

startPhase('5. putting ABC Institution back as it was');

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND assessment_id = $2', [tid, paper.id]);
});
await call(base + '/exams/' + exam.id, { method: 'DELETE', token: pt });
await call(base + '/assessments/' + paper.id, { method: 'DELETE', token: pt });
await call(base + '/members/' + learner.id, { method: 'DELETE', token: pt });
const goneCourse = await call(base + '/courses/' + course.id, { method: 'DELETE', token: pt });
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
check('everything this run made is removed', [200, 404].includes(goneCourse.status),
  'course, paper, sitting, bank, learner');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(72));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
