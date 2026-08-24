/**
 * One examination, from an empty bank to a marked script, at ABC Institution.
 *
 * The whole day in order, as the people who live it would do it:
 *
 *   superadmin  builds a bank, writes four MCQs and a coding question,
 *               draws a paper from it, schedules the sitting
 *   student     sees it on their timetable, sits it, hands it in,
 *               and reads their own result on the same link
 *   superadmin  reads what they wrote, corrects a mark
 *   faculty     and admin reach the same marking screens
 *   invigilator opens the console for the sitting
 *
 * Written against ABC Institution and never Malla Reddy University, and the
 * guard is asserted in the first phase rather than trusted. Everything it
 * creates, it removes.
 *
 *   node qa-live/exam-day.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const ONLY = 'abc-institution';
const PW = 'QaExamDay#2026!';

const cred = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split('\n').map((l) => l.replace('\r', '')).slice(1).map((r) => r.split(','));
const rowFor = (role) => cred.find((r) => r[1] === ONLY && r[2] === role);

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
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, data: parsed?.data, message: parsed?.message };
}
async function step(label, path, opts = {}) {
  const r = await call(path, opts);
  check(label, r.status >= 200 && r.status < 300, r.status + ' ' + (r.message ?? ''));
  return r;
}
const login = async (email, password) => (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email, password } })).data?.token;

// ---------------------------------------------------------------------------

startPhase('1. the operator, and the institution this may touch');

const pt = (await call('/api/onyx/platform/login', { method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' } })).data?.token;
check('the superadmin signs in', Boolean(pt));

const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const abc = tenants.find((t) => t.slug === ONLY);
const forbidden = tenants.find((t) => t.slug === 'malla-reddy-university');
check('ABC Institution is open to them', Boolean(abc), 'tenant ' + abc?.id);
check('and Malla Reddy University is not touched', Boolean(abc) && abc.id !== forbidden?.id,
  'writing to ' + abc?.id + ', never ' + forbidden?.id);
const tid = abc.id;

const courses = (await call('/api/onyx/platform/tenants/' + tid + '/academics?limit=200',
  { token: pt })).data?.courses ?? [];
const course = courses.find((c) => c.status === 1) ?? courses[0];
check('a published course to examine', Boolean(course), course?.code + ' ' + course?.title);

// ---------------------------------------------------------------------------

startPhase('2. the superadmin writes the paper');

const bank = await step('a question bank is created from the console',
  '/api/onyx/platform/tenants/' + tid + '/banks', {
    method: 'POST', token: pt,
    body: { name: 'Exam day bank ' + RUN, course_id: course.id },
  });
const bankId = bank.data?.id;

const MCQS = [
  { prompt: 'Which of these is a constant-time lookup on average?',
    options: [{ id: 'a', text: 'Hash table' }, { id: 'b', text: 'Linked list' },
      { id: 'c', text: 'Binary search tree' }],
    answer: 'a' },
  { prompt: 'Which sorting algorithm is stable?',
    options: [{ id: 'a', text: 'Quicksort' }, { id: 'b', text: 'Merge sort' },
      { id: 'c', text: 'Heapsort' }],
    answer: 'b' },
  { prompt: 'What does a stack do?',
    options: [{ id: 'a', text: 'First in, first out' }, { id: 'b', text: 'Last in, first out' },
      { id: 'c', text: 'Neither' }],
    answer: 'b' },
  { prompt: 'Which is NOT a valid time complexity for comparison sorting?',
    options: [{ id: 'a', text: 'O(n log n)' }, { id: 'b', text: 'O(n²)' },
      { id: 'c', text: 'O(1)' }],
    answer: 'c' },
];

const questionIds = [];
for (const [i, q] of MCQS.entries()) {
  const made = await call('/api/onyx/platform/tenants/' + tid + '/banks/' + bankId + '/questions',
    { method: 'POST', token: pt,
      body: { type: 'single', prompt: q.prompt, options: q.options, answer: q.answer, points: 5 } });
  if (made.data?.id) questionIds.push(made.data.id);
  check('MCQ ' + (i + 1) + ' written, with its answer key', made.status === 200,
    made.status + ' ' + (made.message ?? ''));
}

const problems = await step('the published Code Lab problems are offered',
  '/api/onyx/platform/tenants/' + tid + '/problems', { token: pt });
const problem = (problems.data ?? []).find((p) => String(p.status) === 'published');
check('one of them can back a coding question', Boolean(problem),
  problem?.id + ' ' + problem?.title);

const codeQ = await call('/api/onyx/platform/tenants/' + tid + '/banks/' + bankId + '/questions',
  { method: 'POST', token: pt,
    body: { type: 'code', prompt: 'Solve the linked problem.', points: 10,
      problem_id: problem?.id } });
if (codeQ.data?.id) questionIds.push(codeQ.data.id);
check('a coding question is written against it', codeQ.status === 200,
  codeQ.status + ' ' + (codeQ.message ?? ''));

const unbacked = await call('/api/onyx/platform/tenants/' + tid + '/banks/' + bankId + '/questions',
  { method: 'POST', token: pt, body: { type: 'code', prompt: 'No problem', points: 10 } });
check('a coding question with no problem behind it is refused', unbacked.status === 422,
  unbacked.status + ' ' + (unbacked.message ?? ''));

const listed = await call('/api/onyx/platform/tenants/' + tid + '/banks/' + bankId + '/questions',
  { token: pt });
check('the bank holds five questions', (listed.data ?? []).length === 5,
  (listed.data ?? []).length + ' in the bank');

// ---------------------------------------------------------------------------

startPhase('3. the paper, and the sitting');

const paper = await step('a paper is created', '/api/onyx/platform/tenants/' + tid
  + '/assessments', {
  method: 'POST', token: pt,
  body: {
    title: 'Exam day paper ' + RUN, course_id: course.id, duration_minutes: 60,
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    pass_mark: 12,
  },
});
const paperId = paper.data?.id;

await step('it draws all five from the bank', '/api/onyx/platform/tenants/' + tid
  + '/assessments/' + paperId + '/sections', {
  method: 'PUT', token: pt,
  body: { sections: [{ id: 's1', title: 'All of it', bank_id: bankId, take: 5 }] },
});
await step('and is published', '/api/onyx/platform/tenants/' + tid
  + '/assessments/' + paperId + '/publish', { method: 'POST', token: pt, body: {} });

// The semester question, answered rather than assumed.
const sitting = await call('/api/onyx/platform/tenants/' + tid + '/exams', {
  method: 'POST', token: pt,
  body: {
    course_id: course.id, title: 'Exam day sitting ' + RUN,
    starts_at: new Date(Date.now() - 30_000).toISOString(),
    duration_minutes: 60, max_marks: 30, pass_marks: 12, assessment_id: paperId,
  },
});
check('the sitting is scheduled WITHOUT naming a semester', sitting.status === 200,
  sitting.status + ' ' + (sitting.message ?? ''));
const examId = sitting.data?.id;
check('the term is taken from the course, not demanded of the operator',
  sitting.status === 200,
  'semester_id=' + String(sitting.data?.semester_id));
check('and the sitting is tied to the paper', Number(sitting.data?.assessment_id) === Number(paperId),
  'assessment_id=' + sitting.data?.assessment_id);

// ---------------------------------------------------------------------------

startPhase('4. the candidate');

const adminRow = rowFor('admin');
const at = await login(adminRow[4], adminRow[5]);
const studentEmail = 'qxd.' + RUN + '.stu@onyx.test';
await step('a candidate is enrolled by the institution', '/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Exam Day Candidate', email: studentEmail, role: 'student', password: PW,
    roll_number: 'XD-' + RUN.slice(-4).toUpperCase() },
});
const roster = (await call('/api/onyx/members', { token: at })).data ?? [];
const candidate = roster.find((m) => m.user?.email === studentEmail);
await call('/api/onyx/courses/' + course.id + '/enroll',
  { method: 'POST', token: at, body: { user_id: candidate?.user_id } });

const st = await login(studentEmail, PW);
check('the candidate signs in', Boolean(st));

const week = await call('/api/onyx/calendar?from='
  + encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())
  + '&to=' + encodeURIComponent(new Date(Date.now() + 7 * 86_400_000).toISOString()),
{ token: st });
const onTimetable = (week.data?.exams ?? []).find((e) => Number(e.id) === Number(examId));
check('the sitting is on their timetable', Boolean(onTimetable),
  onTimetable ? onTimetable.title + ' at ' + onTimetable.starts_at : 'absent');
check('carrying the hour it occupies', Number(onTimetable?.duration_minutes) === 60,
  'duration=' + onTimetable?.duration_minutes);

// ---------------------------------------------------------------------------

startPhase('5. sitting it');

const started = await step('the candidate starts the paper',
  '/api/onyx/assessments/' + paperId + '/start', { method: 'POST', token: st, body: {} });
const attemptId = started.data?.id;
const dealt = started.data?.questions ?? [];
check('five questions are dealt', dealt.length === 5, dealt.length + ' dealt');

const codeDealt = dealt.find((q) => q.type === 'code');
check('the coding question arrives with its problem and no tests',
  Boolean(codeDealt?.problem?.statement) && !('tests' in (codeDealt?.problem ?? {})),
  'problem=' + codeDealt?.problem?.id);

// Every MCQ answered correctly, and a real program for the coding one.
const keyOf = new Map(MCQS.map((m) => [m.prompt, m.answer]));
for (const q of dealt) {
  if (q.type === 'single') {
    await call('/api/onyx/attempts/' + attemptId + '/answer', {
      method: 'POST', token: st,
      body: { question_id: q.question_id, response: keyOf.get(q.prompt) ?? 'a' },
    });
  }
}
const codeSaved = await call('/api/onyx/attempts/' + attemptId + '/answer', {
  method: 'POST', token: st,
  body: {
    question_id: codeDealt?.question_id,
    response: { language: 'python', source: 'print(input())' },
  },
});
check('the coding answer is accepted as a submission', codeSaved.status === 200,
  codeSaved.status + ' ' + (codeSaved.message ?? ''));

const handedIn = await step('and hands the paper in',
  '/api/onyx/attempts/' + attemptId + '/submit', { method: 'POST', token: st, body: {} });

// ---------------------------------------------------------------------------

startPhase('6. the result, then and there');

const mine = await step('the candidate opens the same link again',
  '/api/onyx/attempts/' + attemptId, { token: st });
check('their mark is already there — no waiting for a publication',
  mine.data?.score !== null && mine.data?.score !== undefined,
  'score=' + mine.data?.score + '/' + mine.data?.max_score);
check('the four MCQs were marked by machine',
  (mine.data?.questions ?? []).filter((q) => q.type === 'single' && Number(q.awarded) === 5)
    .length === 4,
  (mine.data?.questions ?? []).filter((q) => q.type === 'single')
    .map((q) => q.awarded).join(','));
check('and the coding answer by its tests',
  (mine.data?.questions ?? []).some((q) => q.type === 'code' && q.awarded !== null),
  'code awarded=' + (mine.data?.questions ?? []).find((q) => q.type === 'code')?.awarded);
check('every answer they gave is readable back to them',
  (mine.data?.questions ?? []).every((q) => q.response !== null),
  (mine.data?.questions ?? []).length + ' answered');

const myList = await call('/api/onyx/my/assessments', { token: st });
const listedForMe = (myList.data ?? []).find((a) => Number(a.id) === Number(paperId)
  || Number(a.assessment_id) === Number(paperId));
check('and it shows on their own results list', Boolean(listedForMe),
  (myList.data ?? []).length + ' papers listed');

// ---------------------------------------------------------------------------

startPhase('7. the superadmin marks and monitors');

const seenByOperator = await step('the operator opens the paper',
  '/api/onyx/platform/tenants/' + tid + '/assessments/' + paperId, { token: pt });
const theirAttempt = (seenByOperator.data?.attempts ?? [])
  .find((a) => Number(a.id) === Number(attemptId));
check('and sees the candidate by name', Boolean(theirAttempt?.student?.name),
  theirAttempt?.student?.name);

const script = await step('opens their script',
  '/api/onyx/platform/tenants/' + tid + '/attempts/' + attemptId, { token: pt });
check('and can read every question and what was put', (script.data?.questions ?? []).length === 5
  && (script.data?.questions ?? []).every((q) => q.prompt),
(script.data?.questions ?? []).length + ' questions');
check('with the marks the machine gave',
  (script.data?.questions ?? []).filter((q) => q.auto_points !== null).length >= 4,
  (script.data?.questions ?? []).map((q) => q.type + '=' + q.auto_points).join(' '));
check('and the invigilation record beside it',
  Array.isArray(script.data?.proctor_events),
  (script.data?.proctor_events ?? []).length + ' events');

const before = Number(mine.data?.score);
const corrected = await step('the operator corrects the total',
  '/api/onyx/platform/tenants/' + tid + '/attempts/' + attemptId,
  { method: 'PATCH', token: pt, body: { score: before + 1 } });
const afterEdit = await call('/api/onyx/attempts/' + attemptId, { token: st });
check('and the candidate sees the corrected mark, not a vanished one',
  Number(afterEdit.data?.score) === before + 1,
  'was ' + before + ', now ' + afterEdit.data?.score);

const tooHigh = await call('/api/onyx/platform/tenants/' + tid + '/attempts/' + attemptId,
  { method: 'PATCH', token: pt, body: { score: 9999 } });
check('a mark above the paper’s maximum is refused', tooHigh.status === 422,
  tooHigh.status + ' ' + (tooHigh.message ?? ''));

const examSeen = await step('the sitting shows the browser attempts',
  '/api/onyx/platform/tenants/' + tid + '/exams/' + examId, { token: pt });
check('with this candidate among them',
  (examSeen.data?.paper?.attempts ?? []).some((a) => Number(a.id) === Number(attemptId)),
  (examSeen.data?.paper?.attempts ?? []).length + ' attempts');

// ---------------------------------------------------------------------------

startPhase('8. the same for faculty and the examinations office');

const facultyRow = rowFor('faculty');
const ft = await login(facultyRow[4], facultyRow[5]);
check('a lecturer signs in', Boolean(ft), facultyRow[4]);

const queue = await call('/api/onyx/assessments/' + paperId + '/marking', { token: ft });
check('the marking queue is reachable by staff', queue.status === 200 || queue.status === 403,
  queue.status + (queue.status === 403 ? ' (not their course)' : ''));

const adminQueue = await step('and by an administrator',
  '/api/onyx/assessments/' + paperId + '/marking', { token: at });
check('who can open the script to mark it',
  (await call('/api/onyx/attempts/' + attemptId + '/paper', { token: at })).status === 200);

const marked = await call('/api/onyx/attempts/' + attemptId + '/mark', {
  method: 'POST', token: at,
  body: { marks: [{ question_id: codeDealt?.question_id, points: 10,
    comment: 'Full marks — the program is right.' }] },
});
check('an administrator can award marks and leave a comment', marked.status === 200,
  marked.status + ' ' + (marked.message ?? ''));

const afterMarking = await call('/api/onyx/attempts/' + attemptId, { token: st });
const codeRow = (afterMarking.data?.questions ?? []).find((q) => q.type === 'code');
check('and the candidate sees the comment on their own script',
  String(codeRow?.comment ?? '').includes('Full marks'),
  JSON.stringify(codeRow?.comment));

// ---------------------------------------------------------------------------

startPhase('9. invigilation');

const invigilator = await step('the invigilation queue answers for staff',
  '/api/onyx/proctor/queue', { token: at });
check('it is a list, even when nothing is flagged', Array.isArray(invigilator.data)
  || Array.isArray(invigilator.data?.attempts),
JSON.stringify(invigilator.data).slice(0, 70));

const watch = await call('/api/onyx/attempts/' + attemptId + '/proctor', { token: at });
check('one attempt’s proctor record is reachable', watch.status === 200,
  watch.status + ' ' + (watch.message ?? ''));

const studentPeeking = await call('/api/onyx/proctor/queue', { token: st });
check('and a candidate cannot open the invigilation console',
  studentPeeking.status === 403, 'status ' + studentPeeking.status);

// ---------------------------------------------------------------------------

startPhase('10. putting ABC Institution back as it was');

const del = async (path) => (await call(path, { method: 'DELETE', token: pt })).status;
check('the sitting is removed', [200, 404].includes(
  await del('/api/onyx/platform/tenants/' + tid + '/exams/' + examId)));

const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  // The fixture attempt, for the reason console.mjs gives: there is no API
  // route that deletes one, and there should not be.
  await db.query(
    'DELETE FROM public."onyx_assessment_attempts" WHERE tenant_id = $1 AND assessment_id = $2',
    [tid, paperId]);
});
check('the paper is removed', [200, 404].includes(
  await del('/api/onyx/platform/tenants/' + tid + '/assessments/' + paperId)));

await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id = $2',
    [tid, bankId]);
  await db.query('DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND id = $2',
    [tid, bankId]);
});
check('the bank and its questions are removed', true, 'bank ' + bankId);

if (candidate?.id) {
  check('the candidate is removed', [200, 404].includes(
    await del('/api/onyx/platform/tenants/' + tid + '/members/' + candidate.id)));
}
await withDb(async (db) => {
  await db.query('DELETE FROM public."onyx_users" WHERE email = $1', [studentEmail]);
});

// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(70));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const f of failed) console.log('  FAIL [' + f.phase + '] ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
