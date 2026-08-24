/**
 * Examinations, end to end, against the deployed site.
 *
 * `flows.mjs` sweeps the whole product and touches examinations in passing.
 * This one goes down the examination path and nothing else: a bank, every
 * question type the product offers, a paper built from that bank, a sitting
 * scheduled against it, the window the two share, the slot the sitting owns on
 * the timetable, a candidate sitting it, the mark that comes back instantly,
 * the correction a marker makes afterwards, and the mark sheet the office
 * publishes.
 *
 * **Nothing here is drawn at random.** `flows.mjs` builds its paper with
 * `take: 2` from a four-question bank, so which questions a candidate meets --
 * and therefore whether the result is instant or waiting on a marker -- differs
 * between runs. Every paper below takes every question in its bank, so a
 * failure means something changed rather than that the dice fell differently.
 *
 *   QA_BASE=https://onyx-lms-v2.vercel.app node qa-live/exams.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaExam#2026!';

const results = [];
let phase = '';

function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(52), detail);
  return pass;
}
const startPhase = (name) => { phase = name; console.log('\n== ' + name + ' =='); };

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
  return { status: res.status, body: parsed, data: parsed?.data, message: parsed?.message };
}

/** A call that is expected to work, checked as one step. */
async function step(label, path, opts = {}) {
  const r = await call(path, opts);
  check(label, r.status >= 200 && r.status < 300, r.status + ' ' + (r.message ?? ''));
  return r;
}

/** A call that is expected to be refused, which is just as much a feature. */
async function refuse(label, expected, path, opts = {}) {
  const r = await call(path, opts);
  check(label, r.status === expected, 'expected ' + expected + ', got ' + r.status);
  return r;
}

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

// ---------------------------------------------------------------------------

startPhase('1. an institution to examine');

const platform = await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
});
check('platform operator signs in', platform.status === 200, platform.status);
const pt = platform.data?.token;

const slug = 'qe-' + RUN;
const adminEmail = 'qe.' + RUN + '.admin@onyx.test';
const facultyEmail = 'qe.' + RUN + '.fac@onyx.test';
const studentEmail = 'qe.' + RUN + '.stu@onyx.test';

await step('institution created', '/api/onyx/tenants', {
  method: 'POST', token: pt,
  body: { name: 'Exam QA ' + RUN, slug, admin: { name: 'Ada Admin', email: adminEmail, password: PW } },
});

const login = async (email) => (await call('/api/onyx/auth/login', {
  method: 'POST', body: { email, password: PW },
})).data?.token;

const at = await login(adminEmail);
check('administrator signs in', Boolean(at));

await step('a lecturer is added', '/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Fay Faculty', email: facultyEmail, role: 'faculty', password: PW },
});
await step('a candidate is added', '/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Sam Student', email: studentEmail, role: 'student', password: PW },
});

const roster = (await call('/api/onyx/members', { token: at })).data ?? [];
const facultyMember = roster.find((m) => m.user?.email === facultyEmail);
const studentMember = roster.find((m) => m.user?.email === studentEmail);

const course = await step('a course to examine', '/api/onyx/courses', {
  method: 'POST', token: at,
  body: { code: 'EX' + RUN.slice(-4), title: 'Examinable Subject', credits: 4, access: 'open' },
});
const courseId = course.data?.id;
await step('the course is published', '/api/onyx/courses/' + courseId + '/publish',
  { method: 'POST', token: at });
await step('the candidate is enrolled', '/api/onyx/courses/' + courseId + '/enroll', {
  method: 'POST', token: at, body: { user_id: studentMember?.user_id },
});
await step('the lecturer is given the course', '/api/onyx/courses/' + courseId + '/faculty', {
  method: 'POST', token: at, body: { user_id: facultyMember?.user_id },
});

const ft = await login(facultyEmail);
const st = await login(studentEmail);
check('lecturer and candidate sign in', Boolean(ft) && Boolean(st));

// ---------------------------------------------------------------------------

startPhase('2. a question bank, every type the product offers');

const bank = await step('bank created', '/api/onyx/banks', {
  method: 'POST', token: ft, body: { name: 'Finals bank ' + RUN, course_id: courseId },
});
const bankId = bank.data?.id;
const addQuestion = (label, body) =>
  step(label, '/api/onyx/banks/' + bankId + '/questions', { method: 'POST', token: ft, body });

const q1 = await addQuestion('single answer', {
  type: 'single', prompt: 'Which planet is closest to the sun?', points: 5,
  options: [{ id: 'a', text: 'Mercury' }, { id: 'b', text: 'Venus' }, { id: 'c', text: 'Mars' }],
  answer: 'a', explanation: 'Mercury orbits nearest.',
});
const q2 = await addQuestion('several answers', {
  type: 'multiple', prompt: 'Which of these are prime?', points: 5,
  options: [{ id: 'a', text: '2' }, { id: 'b', text: '4' }, { id: 'c', text: '7' }],
  answer: ['a', 'c'],
});
const q3 = await addQuestion('true or false', {
  type: 'truefalse', prompt: 'Water boils at 100°C at sea level.', points: 5, answer: 'true',
});
const q4 = await addQuestion('short answer with alternatives', {
  type: 'short', prompt: 'Name the largest ocean.', points: 5,
  answer: ['pacific', 'the pacific'],
});
const q5 = await addQuestion('essay, which needs a person', {
  type: 'essay', prompt: 'Explain why the seasons change.', points: 20,
});

// The coding question, with real tests behind it -- the part reported broken.
const problem = await step('a Code Lab problem', '/api/onyx/problems', {
  method: 'POST', token: ft,
  body: {
    title: 'Sum two integers ' + RUN, slug: 'qe-sum-' + RUN,
    statement: 'Read two integers on one line and print their sum.',
    difficulty: 'easy', languages: ['python'], time_limit_ms: 2000,
  },
});
const problemId = problem.data?.id;
await step('its tests, one of them hidden', '/api/onyx/problems/' + problemId + '/tests', {
  method: 'PUT', token: ft,
  body: {
    tests: [
      { name: 'sample', stdin: '1 2', expected_stdout: '3', weight: 1, is_hidden: false },
      { name: 'hidden', stdin: '40 2', expected_stdout: '42', weight: 1, is_hidden: true },
    ],
  },
});
await step('the problem is published', '/api/onyx/problems/' + problemId + '/publish',
  { method: 'POST', token: ft });

const q6 = await addQuestion('coding question bound to that problem', {
  type: 'code', prompt: 'Write a program that adds two integers.', points: 10,
  problem_id: problemId,
});
check('the coding question kept its problem',
  Number(q6.data?.problem_id) === Number(problemId),
  'problem_id=' + q6.data?.problem_id);

await refuse('a coding question with no problem is refused', 422,
  '/api/onyx/banks/' + bankId + '/questions', {
    method: 'POST', token: ft,
    body: { type: 'code', prompt: 'Unbound', points: 10 },
  });

const questions = (await call('/api/onyx/banks/' + bankId + '/questions', { token: ft })).data ?? [];
check('all six questions are in the bank', questions.length === 6, questions.length + ' present');

await refuse('a candidate cannot read the bank', 403,
  '/api/onyx/banks/' + bankId + '/questions', { token: st });

// ---------------------------------------------------------------------------

startPhase('3. the paper');

// Everything in the bank, so the sitting below is the same paper every run.
const paper = await step('paper drawn from the whole bank', '/api/onyx/assessments', {
  method: 'POST', token: ft,
  body: {
    title: 'Finals paper ' + RUN, course_id: courseId, duration_minutes: 60,
    attempts_allowed: 1, instant_results: true,
    sections: [{ id: 's1', title: 'All of it', bank_id: bankId, take: 6 }],
  },
});
const paperId = paper.data?.id;
check('instant results are on by default', paper.data?.instant_results !== false,
  'instant_results=' + paper.data?.instant_results);

await step('the paper is published', '/api/onyx/assessments/' + paperId + '/publish',
  { method: 'POST', token: ft });

const preview = await step('staff can preview it', '/api/onyx/assessments/' + paperId + '/preview',
  { token: ft });
check('the preview deals all six questions', (preview.data?.questions ?? preview.data ?? []).length === 6,
  'dealt ' + ((preview.data?.questions ?? preview.data ?? []).length));

const asStudent = await call('/api/onyx/assessments/' + paperId, { token: st });
check('a candidate sees the paper but not its sections',
  asStudent.status === 200 && asStudent.data?.sections === undefined,
  'sections=' + JSON.stringify(asStudent.data?.sections));

// ---------------------------------------------------------------------------

startPhase('4. scheduling the sitting');

const startsAt = iso(60 * 60 * 1000);            // an hour from now
const exam = await step('examination scheduled against the paper', '/api/onyx/exams', {
  method: 'POST', token: ft,
  body: {
    course_id: courseId, title: 'Finals sitting ' + RUN, starts_at: startsAt,
    duration_minutes: 90, max_marks: 50, pass_marks: 20, assessment_id: paperId,
  },
});
const examId = exam.data?.id;
check('it took the term from the course rather than asking',
  exam.status === 200, 'semester_id=' + String(exam.data?.semester_id));

// The window the paper and the sitting share -- an exam that opens at ten and
// a paper that opens whenever is the defect this check exists for.
const synced = (await call('/api/onyx/assessments/' + paperId, { token: ft })).data ?? {};
check('the paper took the sitting\'s window',
  Boolean(synced.opens_at) && Boolean(synced.closes_at),
  'opens=' + synced.opens_at + ' closes=' + synced.closes_at);
const windowMinutes = synced.opens_at && synced.closes_at
  ? Math.round((Date.parse(synced.closes_at) - Date.parse(synced.opens_at)) / 60000) : null;
check('and the window is the sitting\'s length, not the paper\'s',
  windowMinutes === 90, windowMinutes + ' minutes');

// A real paper on a real other course, because "no such assessment" is a
// different refusal (404) from "that paper is not on this course" (422), and
// only the second one is the invariant worth holding.
const otherCourse = await step('a second course', '/api/onyx/courses', {
  method: 'POST', token: at,
  body: { code: 'OT' + RUN.slice(-4), title: 'Another subject', credits: 3, access: 'open' },
});
const otherPaper = await step('with a paper of its own', '/api/onyx/assessments', {
  method: 'POST', token: at,
  body: {
    title: 'Other paper ' + RUN, course_id: otherCourse.data?.id, duration_minutes: 30,
    sections: [{ id: 's1', title: 'All', bank_id: bankId, take: 1 }],
  },
});
await refuse('an examination cannot borrow another course\u2019s paper', 422, '/api/onyx/exams', {
  method: 'POST', token: at,
  body: {
    course_id: courseId, title: 'Mismatched', starts_at: iso(2 * 3600_000),
    assessment_id: otherPaper.data?.id,
  },
});
await refuse('and an examination on a paper that does not exist is not found', 404,
  '/api/onyx/exams', {
    method: 'POST', token: at,
    body: { course_id: courseId, title: 'Nothing', starts_at: iso(2 * 3600_000),
      assessment_id: 999_999 },
  });
await refuse('a candidate cannot schedule an examination', 403, '/api/onyx/exams', {
  method: 'POST', token: st,
  body: { course_id: courseId, title: 'Free marks', starts_at: iso(3600_000) },
});

// An examination on a course with no term at all -- migration 0037.
const orphan = await step('a course belonging to no programme', '/api/onyx/courses', {
  method: 'POST', token: at,
  body: { code: 'OR' + RUN.slice(-4), title: 'Certification only', credits: 2, access: 'open' },
});
const orphanExam = await call('/api/onyx/exams', {
  method: 'POST', token: at,
  body: { course_id: orphan.data?.id, title: 'Certification sitting', starts_at: iso(4 * 3600_000),
    duration_minutes: 60 },
});
check('an examination on it is scheduled, with no term named',
  orphanExam.status === 200 && !orphanExam.data?.semester_id,
  orphanExam.status + ' semester_id=' + String(orphanExam.data?.semester_id));

// ---------------------------------------------------------------------------

startPhase('5. the sitting owns its slot on the timetable');

const week = await step('the week, as staff see it',
  '/api/onyx/calendar?from=' + encodeURIComponent(iso(-3600_000))
  + '&to=' + encodeURIComponent(iso(7 * 86_400_000)), { token: ft });
// The calendar answers with the two things it holds, kept apart: the sittings
// and the papers. An examination is not an assessment window, and the screen
// draws them differently.
const examsOn = week.data?.exams ?? [];
const papersOn = week.data?.assessments ?? [];
const mine = examsOn.find((e) => String(e.title ?? '').includes(RUN));
check('the examination is on it', Boolean(mine), mine ? mine.title : 'absent');
check('it carries its own start, not the day',
  Boolean(mine?.starts_at) && Math.abs(Date.parse(mine.starts_at) - Date.parse(startsAt)) < 60_000,
  'starts_at=' + mine?.starts_at);
check('and the ninety minutes it occupies, so it owns a slot rather than a day',
  Number(mine?.duration_minutes) === 90, 'duration=' + mine?.duration_minutes);
check('the paper it is sat on is on the calendar too',
  papersOn.some((a) => Number(a.id) === Number(paperId)), papersOn.length + ' papers');

const studentWeek = await call('/api/onyx/calendar?from='
  + encodeURIComponent(iso(-3600_000)) + '&to=' + encodeURIComponent(iso(7 * 86_400_000)),
{ token: st });
const studentExams = studentWeek.data?.exams ?? [];
check('the candidate sees the sitting on their own week',
  studentExams.some((e) => String(e.title ?? '').includes(RUN)),
  studentExams.length + ' sittings');
check('and not the other course, which they are not enrolled on',
  !studentExams.some((e) => Number(e.course_id) === Number(otherCourse.data?.id)),
  studentExams.map((e) => e.course_id).join(','));

// ---------------------------------------------------------------------------

startPhase('6. sitting the paper');

// The window opens an hour from now, so the sitting is pulled back to now --
// the same PATCH an examinations officer makes when a sitting is brought
// forward, and the reason to check the paper follows it.
await step('the sitting is brought forward', '/api/onyx/exams/' + examId, {
  method: 'PATCH', token: ft, body: { starts_at: iso(-60_000) },
});
const moved = (await call('/api/onyx/assessments/' + paperId, { token: ft })).data ?? {};
check('the paper followed it', Date.parse(moved.opens_at) < Date.now(),
  'opens=' + moved.opens_at);

const started = await step('the candidate starts', '/api/onyx/assessments/' + paperId + '/start',
  { method: 'POST', token: st, body: {} });
const attemptId = started.data?.id;
const dealt = started.data?.questions ?? [];
check('six questions are dealt', dealt.length === 6, dealt.length + ' dealt');

const codeQ = dealt.find((q) => q.type === 'code');
check('the coding question arrives with its problem, and no tests',
  Boolean(codeQ?.problem?.statement) && !('tests' in (codeQ?.problem ?? {})),
  'problem=' + codeQ?.problem?.id);

const answer = (questionId, response) =>
  call('/api/onyx/attempts/' + attemptId + '/answer', {
    method: 'POST', token: st, body: { question_id: questionId, response },
  });

const byId = Object.fromEntries(dealt.map((q) => [q.question_id, q]));
const idOf = (created) => Number(created.data?.id);
await answer(idOf(q1), 'a');
await answer(idOf(q2), ['a', 'c']);
await answer(idOf(q3), 'true');
await answer(idOf(q4), 'Pacific');
await answer(idOf(q5), 'Because the earth is tilted on its axis.');
// The shape the sitting screen sends: a language and a program, which is
// what the sandbox runs. A response that is neither is refused just below,
// rather than stored as something nothing can mark.
const codeAnswer = await answer(idOf(q6), {
  language: 'python',
  source: 'a, b = map(int, input().split())\nprint(a + b)',
});
check('every answer is saved, the code one included',
  codeAnswer.status === 200 || codeAnswer.status === 201, codeAnswer.status);

const shapeless = await call('/api/onyx/attempts/' + attemptId + '/answer', {
  method: 'POST', token: st,
  body: { question_id: idOf(q6), response: { note: 'not a program' } },
});
check('a code answer the sandbox cannot run is refused rather than stored',
  shapeless.status === 422, 'got ' + shapeless.status + ' ' + (shapeless.message ?? ''));
check('the paper dealt what the bank holds', Object.keys(byId).length === 6);

const submitted = await step('the paper is handed in',
  '/api/onyx/attempts/' + attemptId + '/submit', { method: 'POST', token: st, body: {} });

// ---------------------------------------------------------------------------

startPhase('7. what comes back');

const review = await step('the candidate opens their attempt',
  '/api/onyx/attempts/' + attemptId, { token: st });
const rq = review.data?.questions ?? [];

check('their own answers are readable',
  rq.filter((q) => q.response !== null && q.response !== '').length === 6,
  rq.filter((q) => q.response !== null && q.response !== '').length + '/6 present');

check('the coding answer went to the sandbox as written',
  String(rq.find((q) => q.type === 'code')?.response?.source ?? '').includes('input'),
  'response=' + JSON.stringify(rq.find((q) => q.type === 'code')?.response).slice(0, 40));

// A paper carrying an essay must NOT release instantly -- that is the whole
// rule, and the check that would have caught it going wrong.
check('a paper with an essay on it is held for the marker',
  review.data?.status !== 'published' && review.data?.score === null,
  'status=' + review.data?.status + ' score=' + String(review.data?.score));
check('and the marks are held with it, every one of them',
  rq.every((q) => q.awarded === null),
  rq.map((q) => q.type + '=' + q.awarded).join(' '));

// What the machine DID mark is visible to the marker straight away, which is
// where "the coding question is broken" would show first.
const markerView = await step('the marker opens the paper',
  '/api/onyx/attempts/' + attemptId + '/paper', { token: ft });
const mq = markerView.data?.questions ?? [];
const autoOf = (type) => mq.find((q) => q.type === type)?.auto_points;
check('the objective questions were marked by machine at hand-in',
  ['single', 'multiple', 'truefalse', 'short'].every((t) => Number(autoOf(t)) === 5),
  ['single', 'multiple', 'truefalse', 'short'].map((t) => t + '=' + autoOf(t)).join(' '));
check('the coding answer was marked by its tests, hidden case included',
  Number(autoOf('code')) === 10, 'awarded=' + autoOf('code') + '/10');
check('and only the essay is left for a person',
  autoOf('essay') === null || autoOf('essay') === undefined,
  'essay auto=' + String(autoOf('essay')));

startPhase('8. the marker, and the correction');

const queue = await step('it is in the marking queue',
  '/api/onyx/assessments/' + paperId + '/marking', { token: ft });
const queued = (queue.data ?? []).some((a) => Number(a.id) === Number(attemptId));
check('the attempt is waiting there', queued, (queue.data ?? []).length + ' waiting');

const marked = await step('the marker awards the essay',
  '/api/onyx/attempts/' + attemptId + '/mark', {
    method: 'POST', token: ft,
    body: {
      marks: [{ question_id: idOf(q5), points: 16,
        comment: 'The tilt is right; say more about why the angle matters.' }],
      comment: 'A good answer.',
    },
  });
check('the total now includes the essay', Number(marked.data?.score) === 46,
  'score=' + marked.data?.score + '/50');

// Marked is not released. A paper that needed a person is let out by a person
// -- instant release is for papers where nothing awaited one.
const stillHeld = await call('/api/onyx/attempts/' + attemptId, { token: st });
check('marking alone does not release it', stillHeld.data?.score === null,
  'score=' + String(stillHeld.data?.score));

await step('the course’s own lecturer releases it',
  '/api/onyx/assessments/' + paperId + '/results/publish',
  { method: 'POST', token: ft, body: {} });

const afterMark = await call('/api/onyx/attempts/' + attemptId, { token: st });
check('the candidate sees the mark once it is out',
  Number(afterMark.data?.score) === 46, 'score=' + String(afterMark.data?.score));
const releasedQ = afterMark.data?.questions ?? [];
check('every question now carries the mark it earned',
  releasedQ.every((q) => q.awarded !== null),
  releasedQ.map((q) => q.type + '=' + q.awarded).join(' '));
const essayAfter = releasedQ.find((q) => q.type === 'essay');
check('and the marker\'s comment reaches them',
  typeof essayAfter?.comment === 'string' && essayAfter.comment.includes('tilt'),
  'comment=' + JSON.stringify(essayAfter?.comment));

// One sitting allowed, and it has been used, so the key is no longer worth
// protecting.
const single = (afterMark.data?.questions ?? []).find((q) => q.type === 'single');
check('the answer key appears now there is no resit left',
  single?.expected !== null && single?.expected !== undefined,
  'expected=' + JSON.stringify(single?.expected));

const corrected = await step('a marker may still correct a released result',
  '/api/onyx/attempts/' + attemptId + '/mark', {
    method: 'POST', token: ft,
    body: { marks: [{ question_id: idOf(q5), points: 18, comment: 'On reflection, better than 16.' }] },
  });
check('the correction lands', Number(corrected.data?.score) === 48,
  'score=' + corrected.data?.score);
const afterCorrection = await call('/api/onyx/attempts/' + attemptId, { token: st });
check('and the result does not vanish while it is improved',
  Number(afterCorrection.data?.score) === 48,
  'score=' + String(afterCorrection.data?.score));

startPhase('9. the mark sheet');

await step('marks are pulled through from the paper',
  '/api/onyx/exams/' + examId + '/marks/sync-from-paper', { method: 'POST', token: at, body: {} });
const sheet = await step('the sheet reads', '/api/onyx/exams/' + examId + '/marks', { token: at });
const row = (sheet.data ?? []).find((m) => String(m.user_id) === String(studentMember?.user_id));
check('the candidate is on it with their mark', Boolean(row), 'marks=' + (sheet.data ?? []).length);

await step('the sitting is published',
  '/api/onyx/exams/' + examId + '/publish', { method: 'POST', token: at, body: {} });

await refuse('a candidate cannot read the whole mark sheet', 403,
  '/api/onyx/exams/' + examId + '/marks', { token: st });
await refuse('nor edit the examination', 403, '/api/onyx/exams/' + examId,
  { method: 'PATCH', token: st, body: { title: 'Everyone passes' } });

const myResults = await step('their own results list',
  '/api/onyx/my/assessments', { token: st });
const listed = (myResults.data ?? []).find((a) => Number(a.id) === Number(paperId)
  || Number(a.assessment_id) === Number(paperId));
check('the paper shows there with a mark', Boolean(listed),
  (myResults.data ?? []).length + ' listed');

// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(64));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const f of failed) console.log('  FAIL [' + f.phase + '] ' + f.label + ' -- ' + f.detail);
console.log('SLUG ' + slug);

const fs = await import('node:fs/promises');
await fs.writeFile(new URL('./exams.json', import.meta.url),
  JSON.stringify({ base: BASE, slug, run: RUN, passed, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
