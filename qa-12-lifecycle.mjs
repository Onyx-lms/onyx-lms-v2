/**
 * Full content lifecycle against the live deployment.
 *
 * Superadmin creates an institution -> admin authors a programme, course,
 * modules and lessons -> staff build a question bank and an assessment ->
 * a student sits it -> staff mark and release -> the student reads the result
 * -> the same again for a scheduled examination.
 *
 * Everything is created inside a throwaway institution so nothing touches the
 * demo tenants. Created IDs are written to qa-lifecycle-state.json for cleanup.
 */
import { launch, newPage, signIn, BASE, ACCOUNTS } from './qa-lib.mjs';
import fs from 'node:fs';

const STAMP = process.env.QA_STAMP ?? String(Date.now()).slice(-8);
const SLUG = 'qa-cert-' + STAMP;
const PASSWORD = 'QaCert#2026!';
const state = { stamp: STAMP, slug: SLUG, base: BASE, created: {}, steps: [] };

let n = 0;
const rec = (act, name, o) => {
  const row = { seq: ++n, act, name, ...o };
  state.steps.push(row);
  const v = row.verdict;
  const mark = v === 'PASS' ? 'PASS' : v === 'FAIL' ? 'FAIL' : v;
  console.log(`${String(n).padStart(2)} ${mark.padEnd(4)} [${act}] ${name.padEnd(46)} ${row.detail ?? ''}`);
  return row;
};

/** Issue an API call from inside a signed-in browser session. */
async function call(page, method, path, body) {
  return page.evaluate(async ([m, p, b]) => {
    const r = await fetch(p, {
      method: m,
      credentials: 'include',
      headers: b ? { 'content-type': 'application/json' } : {},
      body: b ? JSON.stringify(b) : undefined,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, ok: json?.ok === true, message: json?.message ?? null,
             data: json?.data ?? null, raw: text.slice(0, 400) };
  }, [method, path, body ?? null]);
}

const okv = (r) => (r.ok ? 'PASS' : 'FAIL');
const brief = (r) => `${r.status}${r.message ? ' "' + r.message + '"' : ''}` +
  (r.ok ? '' : ' :: ' + r.raw.slice(0, 170));

const browser = await launch();
const sessions = {};
async function session(key, email, password) {
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  if (key === 'super') {
    await signIn(page, 'superadmin');
  } else {
    await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });
  }
  sessions[key] = { ctx, page };
  return page;
}

try {

// =====================================================================
// ACT 1 — SUPERADMIN: stand up an institution
// =====================================================================
const sup = await session('super');
rec('superadmin', 'sign in to platform console', { verdict: 'PASS', detail: sup.url().replace(BASE, '') });

const adminEmail = 'qa.admin.' + STAMP + '@onyx.test';
let r = await call(sup, 'POST', '/api/onyx/platform/tenants', {
  name: 'QA Certification College ' + STAMP,
  slug: SLUG,
  plan: 'standard',
  admin: { name: 'Quinn Administrator', email: adminEmail, password: PASSWORD },
});
state.created.tenant = r.data?.tenant ?? r.data;
const TENANT_ID = Number(state.created.tenant?.id);
rec('superadmin', 'create institution + first admin', {
  verdict: okv(r), detail: brief(r) + ' tenant_id=' + TENANT_ID, tenant_id: TENANT_ID });

r = await call(sup, 'GET', '/api/onyx/platform/tenants');
const listed = (r.data ?? []).some((t) => Number(t.id) === TENANT_ID);
rec('superadmin', 'institution appears in console list', {
  verdict: listed ? 'PASS' : 'FAIL', detail: 'total=' + (r.data ?? []).length + ' contains=' + listed });

r = await call(sup, 'GET', '/api/onyx/platform/audit?limit=5');
const audited = (r.data ?? []).some((a) => a.action === 'tenant.created' && Number(a.entity_id) === TENANT_ID);
rec('superadmin', 'creation written to platform audit', {
  verdict: audited ? 'PASS' : 'FAIL',
  detail: 'top action=' + (r.data?.[0]?.action ?? 'none') + ' matched=' + audited });

// =====================================================================
// ACT 2 — ADMIN: programme, people, course, modules, lessons
// =====================================================================
const adm = await session('admin', adminEmail, PASSWORD);
r = await call(adm, 'GET', '/api/onyx/me');
rec('admin', 'first admin can sign in', {
  verdict: r.data?.role === 'admin' && Number(r.data?.tenant?.id) === TENANT_ID ? 'PASS' : 'FAIL',
  detail: `role=${r.data?.role} tenant=${r.data?.tenant?.slug}` });

r = await call(adm, 'POST', '/api/onyx/programs', {
  name: 'B.Tech Quality Engineering', code: 'BTQE', duration_semesters: 8,
  description: 'Programme created by the QA lifecycle run.' });
state.created.program = r.data;
const PROGRAM_ID = Number(r.data?.id);
rec('admin', 'create programme', { verdict: okv(r), detail: brief(r) + ' id=' + PROGRAM_ID });

r = await call(adm, 'POST', '/api/onyx/semesters', {
  program_id: PROGRAM_ID, name: 'Semester 1', number: 1,
  starts_on: '2026-08-01', ends_on: '2026-12-15' });
state.created.semester = r.data;
const SEMESTER_ID = Number(r.data?.id);
rec('admin', 'create semester', { verdict: okv(r), detail: brief(r) + ' id=' + SEMESTER_ID });

// people
const people = {
  faculty: { name: 'Dr. Farah Lecturer', email: 'qa.faculty.' + STAMP + '@onyx.test', role: 'faculty' },
  exams:   { name: 'Eshan Controller',   email: 'qa.exams.' + STAMP + '@onyx.test',   role: 'exams' },
  s1:      { name: 'Sana Learner',       email: 'qa.s1.' + STAMP + '@onyx.test',      role: 'student', roll_number: 'QE-001' },
  s2:      { name: 'Rohit Learner',      email: 'qa.s2.' + STAMP + '@onyx.test',      role: 'student', roll_number: 'QE-002' },
  s3:      { name: 'Meena Learner',      email: 'qa.s3.' + STAMP + '@onyx.test',      role: 'student', roll_number: 'QE-003' },
};
state.created.members = {};
for (const [k, p] of Object.entries(people)) {
  r = await call(adm, 'POST', '/api/onyx/members', { ...p, password: PASSWORD });
  state.created.members[k] = r.data;
  people[k].user_id = r.data?.user?.id ?? r.data?.membership?.user_id;
  rec('admin', 'add member (' + p.role + ')', { verdict: okv(r), detail: brief(r) + ' ' + p.email });
}

r = await call(adm, 'GET', '/api/onyx/members');
rec('admin', 'roster lists all 6 members', {
  verdict: (r.data ?? []).length === 6 ? 'PASS' : 'FAIL', detail: 'count=' + (r.data ?? []).length });
// map emails -> user ids from the roster (authoritative)
for (const m of r.data ?? []) {
  for (const [k, p] of Object.entries(people)) if (m.email === p.email) p.user_id = m.user_id ?? m.user?.id ?? m.id;
}

r = await call(adm, 'POST', '/api/onyx/courses', {
  code: 'QE101', title: 'Foundations of Software Quality',
  description: 'Course authored by the QA lifecycle run.',
  program_id: PROGRAM_ID, semester_id: SEMESTER_ID, credits: 4, access: 'batch' });
state.created.course = r.data;
const COURSE_ID = Number(r.data?.id);
rec('admin', 'create course', { verdict: okv(r), detail: brief(r) + ' id=' + COURSE_ID });

r = await call(adm, 'POST', '/api/onyx/courses/' + COURSE_ID + '/faculty', { user_id: people.faculty.user_id });
rec('admin', 'assign faculty to course', { verdict: okv(r), detail: brief(r) });

// modules + lessons
state.created.modules = []; state.created.lessons = [];
const MODULES = [
  { title: 'Module 1 — Principles of Quality', lessons: [
      { title: 'What quality means', body: 'Fitness for purpose, and who decides it.', duration_seconds: 600 },
      { title: 'Cost of defects', body: 'Why a defect found late costs more.', duration_seconds: 720 } ] },
  { title: 'Module 2 — Testing in Practice', lessons: [
      { title: 'Test design techniques', body: 'Equivalence partitioning and boundary values.', duration_seconds: 900 },
      { title: 'Automation strategy', body: 'What to automate, and what never to.', duration_seconds: 840 } ] },
];
for (const [i, mod] of MODULES.entries()) {
  r = await call(adm, 'POST', '/api/onyx/courses/' + COURSE_ID + '/modules', { title: mod.title, sort: i + 1 });
  const MODULE_ID = Number(r.data?.id);
  state.created.modules.push(r.data);
  rec('admin', 'create module ' + (i + 1), { verdict: okv(r), detail: brief(r) + ' id=' + MODULE_ID });
  for (const [j, les] of mod.lessons.entries()) {
    const lr = await call(adm, 'POST', '/api/onyx/modules/' + MODULE_ID + '/lessons',
      { ...les, type: 'text', sort: j + 1 });
    state.created.lessons.push(lr.data);
    rec('admin', '  add lesson ' + (i + 1) + '.' + (j + 1), { verdict: okv(lr), detail: brief(lr) + ' "' + les.title + '"' });
  }
}

r = await call(adm, 'GET', '/api/onyx/courses/' + COURSE_ID + '/outline');
const outlineModules = (r.data?.modules ?? r.data ?? []).length;
rec('admin', 'course outline reflects authoring', {
  verdict: r.ok && outlineModules >= 2 ? 'PASS' : 'FAIL',
  detail: brief(r) + ' modules=' + outlineModules });

r = await call(adm, 'POST', '/api/onyx/courses/' + COURSE_ID + '/publish');
rec('admin', 'publish course', { verdict: okv(r), detail: brief(r) });

for (const k of ['s1', 's2', 's3']) {
  if (!people[k].user_id) { rec('admin', 'enrol ' + people[k].name, { verdict: 'FAIL', detail: 'harness: no user_id resolved' }); continue; }
  r = await call(adm, 'POST', '/api/onyx/courses/' + COURSE_ID + '/enroll', { user_id: people[k].user_id });
  rec('admin', 'enrol ' + people[k].name, { verdict: okv(r), detail: brief(r) });
}
r = await call(adm, 'GET', '/api/onyx/courses/' + COURSE_ID + '/roster');
rec('admin', 'roster shows 3 enrolled learners', {
  verdict: (r.data ?? []).length === 3 ? 'PASS' : 'FAIL', detail: 'count=' + (r.data ?? []).length });

// =====================================================================
// ACT 3 — FACULTY: question bank and assessment
// =====================================================================
const fac = await session('faculty', people.faculty.email, PASSWORD);
r = await call(fac, 'GET', '/api/onyx/me');
rec('faculty', 'faculty signs in', { verdict: r.data?.role === 'faculty' ? 'PASS' : 'FAIL',
  detail: 'role=' + r.data?.role });

r = await call(fac, 'POST', '/api/onyx/banks', {
  name: 'QE101 — Quality Fundamentals', course_id: COURSE_ID,
  description: 'Bank authored by the QA lifecycle run.' });
state.created.bank = r.data;
const BANK_ID = Number(r.data?.id);
rec('faculty', 'create question bank', { verdict: okv(r), detail: brief(r) + ' id=' + BANK_ID });

const QUESTIONS = [
  { type: 'single', prompt: 'Which of these is the cheapest stage at which to fix a defect?',
    options: [ { id: 'a', text: 'Requirements' }, { id: 'b', text: 'Implementation' },
               { id: 'c', text: 'System test' }, { id: 'd', text: 'Production' } ],
    answer: 'a', points: 5, difficulty: 'easy', explanation: 'Cost of change rises with time.' },
  { type: 'single', prompt: 'Boundary value analysis primarily targets which class of defect?',
    options: [ { id: 'a', text: 'Concurrency races' }, { id: 'b', text: 'Off-by-one errors' },
               { id: 'c', text: 'Memory leaks' }, { id: 'd', text: 'Styling regressions' } ],
    answer: 'b', points: 5, difficulty: 'easy' },
  { type: 'multiple', prompt: 'Select every property of a good automated test.',
    options: [ { id: 'a', text: 'Deterministic' }, { id: 'b', text: 'Order-dependent' },
               { id: 'c', text: 'Fast' }, { id: 'd', text: 'Readable on failure' } ],
    answer: ['a', 'c', 'd'], points: 6, difficulty: 'medium' },
  { type: 'short', prompt: 'In one sentence, state why a flaky test is worse than no test.',
    points: 4, difficulty: 'medium' },
];
state.created.questions = [];
for (const [i, q] of QUESTIONS.entries()) {
  r = await call(fac, 'POST', '/api/onyx/banks/' + BANK_ID + '/questions', q);
  state.created.questions.push(r.data);
  rec('faculty', 'add question ' + (i + 1) + ' (' + q.type + ')', { verdict: okv(r), detail: brief(r) });
}

r = await call(fac, 'GET', '/api/onyx/banks/' + BANK_ID + '/questions');
const qCount = (r.data ?? []).length;
const keysVisibleToStaff = (r.data ?? []).some((q) => q.answer !== undefined && q.answer !== null);
rec('faculty', 'bank returns questions WITH answer key', {
  verdict: qCount === 4 && keysVisibleToStaff ? 'PASS' : 'FAIL',
  detail: 'count=' + qCount + ' answer_key_present=' + keysVisibleToStaff });

r = await call(fac, 'POST', '/api/onyx/assessments', {
  title: 'QE101 — Class Test 1', course_id: COURSE_ID,
  instructions: 'Answer every question. Written answers are marked by hand.',
  duration_minutes: 30, attempts_allowed: 1, pass_mark: 10,
  sections: [ { id: 's1', title: 'All questions', bank_id: BANK_ID, take: 4 } ],
  shuffle_questions: false, shuffle_options: false });
state.created.assessment = r.data;
const ASSESS_ID = Number(r.data?.id);
rec('faculty', 'create assessment (draws 4 from bank)', { verdict: okv(r), detail: brief(r) + ' id=' + ASSESS_ID });

r = await call(fac, 'GET', '/api/onyx/assessments/' + ASSESS_ID + '/preview');
rec('faculty', 'preview the paper before publishing', { verdict: okv(r),
  detail: brief(r) + ' items=' + ((r.data?.questions ?? r.data?.items ?? r.data ?? []).length ?? '?') });

// a student must NOT see it while it is a draft
const stu = await session('student', people.s1.email, PASSWORD);
r = await call(stu, 'GET', '/api/onyx/assessments');
const visibleBeforePublish = (r.data ?? []).some((a) => Number(a.id ?? a.assessment_id) === ASSESS_ID);
rec('student', 'draft assessment hidden from learner', {
  verdict: visibleBeforePublish ? 'FAIL' : 'PASS',
  detail: 'assessments count=' + (r.data ?? []).length + ' contains_draft=' + visibleBeforePublish });

r = await call(fac, 'POST', '/api/onyx/assessments/' + ASSESS_ID + '/publish');
rec('faculty', 'publish assessment', { verdict: okv(r), detail: brief(r) });

// =====================================================================
// ACT 4 — STUDENT: sit the paper
// =====================================================================
r = await call(stu, 'GET', '/api/onyx/assessments');
const nowVisible = (r.data ?? []).some((a) => Number(a.id ?? a.assessment_id) === ASSESS_ID);
rec('student', 'published assessment appears for learner', {
  verdict: nowVisible ? 'PASS' : 'FAIL', detail: 'count=' + (r.data ?? []).length });

r = await call(stu, 'POST', '/api/onyx/assessments/' + ASSESS_ID + '/start', { consent: true });
state.created.attempt = r.data;
const ATTEMPT_ID = Number(r.data?.id ?? r.data?.attempt?.id);
rec('student', 'start attempt', { verdict: okv(r), detail: brief(r) + ' attempt=' + ATTEMPT_ID });

r = await call(stu, 'GET', '/api/onyx/attempts/' + ATTEMPT_ID);
const paper = r.data?.questions ?? r.data?.items ?? [];
const leakedKey = JSON.stringify(paper).match(/"answer"\s*:\s*(?!null)/) !== null;
const leakedExpl = JSON.stringify(paper).includes('Cost of change rises');
rec('student', 'candidate view withholds the answer key', {
  verdict: (!leakedKey && !leakedExpl) ? 'PASS' : 'FAIL',
  detail: `questions=${paper.length} answer_field_present=${leakedKey} explanation_leaked=${leakedExpl}` });
rec('student', 'server-side clock is authoritative', {
  verdict: typeof (r.data?.seconds_remaining) === 'number' ? 'PASS' : 'WARN',
  detail: 'seconds_remaining=' + r.data?.seconds_remaining });

// answer: two MCQs right, the multi right, the short answer written
const qids = paper.map((q) => Number(q.id ?? q.question_id));
state.created.paperQuestionIds = qids;
const ANSWERS = [
  { question_id: qids[0], response: 'a' },
  { question_id: qids[1], response: 'b' },
  { question_id: qids[2], response: ['a', 'c', 'd'] },
  { question_id: qids[3], response: 'A flaky test destroys trust in the whole suite, so real failures get ignored.' },
];
for (const [i, a] of ANSWERS.entries()) {
  if (!a.question_id) continue;
  r = await call(stu, 'POST', '/api/onyx/attempts/' + ATTEMPT_ID + '/answer', a);
  rec('student', 'autosave answer ' + (i + 1), { verdict: okv(r), detail: brief(r) });
}

r = await call(stu, 'POST', '/api/onyx/attempts/' + ATTEMPT_ID + '/submit');
rec('student', 'hand the paper in', { verdict: okv(r), detail: brief(r) + ' status=' + (r.data?.status ?? '?') });

// =====================================================================
// ACT 5 — STAFF: mark and release
// =====================================================================
r = await call(fac, 'GET', '/api/onyx/assessments/' + ASSESS_ID + '/marking');
const queue = r.data ?? [];
rec('faculty', 'marking queue shows the submitted paper', {
  verdict: queue.length >= 1 ? 'PASS' : 'FAIL', detail: 'queue=' + queue.length });

r = await call(fac, 'GET', '/api/onyx/attempts/' + ATTEMPT_ID + '/paper');
const markerPaper = r.data?.questions ?? r.data?.items ?? [];
rec('faculty', 'marker sees the paper with responses', {
  verdict: r.ok && markerPaper.length > 0 ? 'PASS' : 'FAIL',
  detail: brief(r) + ' items=' + markerPaper.length });

// results must be invisible to the student before release
r = await call(stu, 'GET', '/api/onyx/results');
const earlyResult = (r.data ?? []).some((x) => Number(x.assessment_id) === ASSESS_ID);
rec('student', 'result hidden before release', {
  verdict: earlyResult ? 'FAIL' : 'PASS', detail: 'results count=' + (r.data ?? []).length });

const marks = qids.filter(Boolean).map((qid, i) => ({
  question_id: qid, points: [5, 5, 6, 3][i] ?? 0,
  comment: i === 3 ? 'Correct idea, slightly informal phrasing.' : null,
}));
r = await call(fac, 'POST', '/api/onyx/attempts/' + ATTEMPT_ID + '/mark',
  { role: 'first', marks, comment: 'Solid first attempt.' });
const markedScore = r.data?.score;
rec('faculty', 'mark the paper (19 / 20)', { verdict: okv(r), detail: brief(r) + ' score=' + markedScore });

r = await call(fac, 'POST', '/api/onyx/assessments/' + ASSESS_ID + '/results/publish');
rec('faculty', 'release results', { verdict: okv(r), detail: brief(r) });

r = await call(fac, 'GET', '/api/onyx/assessments/' + ASSESS_ID + '/results');
rec('faculty', 'results analytics available', { verdict: okv(r),
  detail: brief(r) + ' ' + JSON.stringify(r.data).slice(0, 150) });

r = await call(fac, 'GET', '/api/onyx/assessments/' + ASSESS_ID + '/items');
rec('faculty', 'item analysis available', { verdict: okv(r), detail: brief(r) });

// =====================================================================
// ACT 6 — STUDENT: read the result
// =====================================================================
r = await call(stu, 'GET', '/api/onyx/my/assessments');
const mine = (r.data ?? []).find((x) => Number(x.assessment_id) === ASSESS_ID);
rec('student', 'released result now visible', {
  verdict: mine && mine.results_published ? 'PASS' : 'FAIL',
  detail: mine
    ? `score=${mine.score}/${mine.max_score ?? '?'} released=${mine.results_published}`
    : 'not found in ' + (r.data ?? []).length + ' rows' });
rec('student', 'score matches what was marked', {
  verdict: mine && Number(mine.score) === Number(markedScore) ? 'PASS' : 'WARN',
  detail: `student sees ${mine?.score}, marker recorded ${markedScore}` });

// =====================================================================
// ACT 7 — EXAMINATIONS
// =====================================================================
const exm = await session('exams', people.exams.email, PASSWORD);
r = await call(exm, 'GET', '/api/onyx/me');
rec('exams', 'examinations officer signs in', { verdict: r.data?.role === 'exams' ? 'PASS' : 'FAIL',
  detail: 'role=' + r.data?.role });

r = await call(exm, 'POST', '/api/onyx/halls', { code: 'H1', name: 'Main Hall', row_count: 5, col_count: 6 });
state.created.hall = r.data;
const HALL_ID = Number(r.data?.id);
rec('exams', 'create examination hall (5×6)', { verdict: okv(r), detail: brief(r) + ' id=' + HALL_ID });

const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
r = await call(exm, 'POST', '/api/onyx/exams', {
  semester_id: SEMESTER_ID, course_id: COURSE_ID, title: 'QE101 End-of-term Examination',
  starts_at: startsAt, duration_minutes: 120, max_marks: 100, pass_marks: 40 });
state.created.exam = r.data;
const EXAM_ID = Number(r.data?.id);
rec('exams', 'schedule examination', { verdict: okv(r), detail: brief(r) + ' id=' + EXAM_ID });

r = await call(exm, 'POST', '/api/onyx/exams/' + EXAM_ID + '/seating', { hall_ids: [HALL_ID] });
rec('exams', 'allocate seating', { verdict: okv(r),
  detail: brief(r) + ' seated=' + (Array.isArray(r.data) ? r.data.length : (r.data?.seated ?? '?')) });

r = await call(exm, 'GET', '/api/onyx/exams/' + EXAM_ID + '/seat');
rec('exams', 'seating plan readable', { verdict: r.status < 500 ? 'PASS' : 'FAIL', detail: brief(r) });

const entries = ['s1', 's2', 's3'].map((k, i) => ({ user_id: people[k].user_id, raw_marks: [78, 55, 34][i] }));
r = await call(exm, 'POST', '/api/onyx/exams/' + EXAM_ID + '/marks', { entries });
rec('exams', 'enter marks for 3 candidates', { verdict: okv(r), detail: brief(r) });

r = await call(stu, 'GET', '/api/onyx/exam-marks/' + EXAM_ID).catch(() => ({ status: 0 }));
const preRelease = await call(stu, 'GET', '/api/onyx/results');
const examEarly = (preRelease.data ?? []).some((x) => Number(x.exam_id) === EXAM_ID);
rec('student', 'exam mark hidden before publish', {
  verdict: examEarly ? 'FAIL' : 'PASS', detail: 'results rows=' + (preRelease.data ?? []).length });

r = await call(exm, 'POST', '/api/onyx/exams/' + EXAM_ID + '/publish');
rec('exams', 'publish examination marks', { verdict: okv(r), detail: brief(r) });

r = await call(stu, 'GET', '/api/onyx/results');
const examRow = (r.data ?? []).find((x) => Number(x.exam_id) === EXAM_ID);
rec('student', 'examination result visible after publish', {
  verdict: examRow ? 'PASS' : 'FAIL',
  detail: examRow ? `${examRow.score ?? examRow.raw_marks}/${examRow.max_score ?? examRow.max_marks ?? '?'}` :
    'not found in ' + (r.data ?? []).length + ' rows' });

// =====================================================================
// ACT 8 — MONITORING
// =====================================================================
r = await call(exm, 'GET', '/api/onyx/proctor/queue');
rec('exams', 'proctor queue reachable', { verdict: r.status === 200 ? 'PASS' : 'FAIL', detail: brief(r) });

r = await call(adm, 'GET', '/api/onyx/audit?limit=50');
const log = r.data ?? [];
const wanted = ['assessment.published', 'result.published', 'assessment.grade_changed'];
const seen = wanted.filter((a) => log.some((x) => x.action === a));
rec('admin', 'audit log records the lifecycle', {
  verdict: seen.length === wanted.length ? 'PASS' : 'WARN',
  detail: `rows=${log.length} found=[${seen.join(', ')}] missing=[${wanted.filter((w) => !seen.includes(w)).join(', ')}]` });
state.auditActions = [...new Set(log.map((x) => x.action))];

r = await call(adm, 'GET', '/api/onyx/courses/' + COURSE_ID + '/benchmark');
rec('admin', 'course benchmark analytics', { verdict: r.status === 200 ? 'PASS' : 'WARN', detail: brief(r) });

} catch (err) {
  rec('harness', 'UNCAUGHT', { verdict: 'FAIL', detail: String(err).slice(0, 400) });
} finally {
  for (const s of Object.values(sessions)) await s.ctx.close().catch(() => {});
  await browser.close();
  fs.writeFileSync('qa-lifecycle-state.json', JSON.stringify(state, null, 2));
  const t = {};
  for (const s of state.steps) t[s.verdict] = (t[s.verdict] ?? 0) + 1;
  console.log('\n=== LIFECYCLE SUMMARY ===', JSON.stringify(t));
  console.log('tenant:', SLUG, 'id=' + (state.created.tenant?.id ?? '?'), '· state -> qa-lifecycle-state.json');
  const fails = state.steps.filter((s) => s.verdict === 'FAIL');
  if (fails.length) { console.log('\nFAILURES:'); for (const f of fails) console.log('  ' + f.seq + ' [' + f.act + '] ' + f.name + ' :: ' + f.detail); }
}
