/**
 * The whole arc the product is for, driven end to end.
 *
 *   super admin  ->  course, question paper (with a coding question written
 *                    on the spot), examination
 *   student      ->  enrols, sees it, sits it, submits code
 *   super admin  ->  reads the attempt, the marks and the submission back
 *
 * ABC Institution only (tenant 1). TENANT is a constant and every platform call
 * is /tenants/1/...; the tenant-side calls carry an ABC session, whose token
 * cannot address another institution.
 *
 * Runs against whatever QA_BASE points at -- local build or production.
 */
const BASE = process.env.QA_BASE ?? 'http://localhost:5199';
const TENANT = 1;
const STAMP = Date.now().toString(36);
const SOURCE = 'n = int(input())\nprint(n * n)\n';

let failures = 0;
const log = (...a) => console.log(...a);
const ok = (l, c, d = '') => {
  log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? ' — ' + d : ''));
  if (!c) failures += 1;
  return c;
};

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, ...(json ?? {}) };
}

function must(label, r) {
  if (!r.ok) {
    log('  FAIL  ' + label + ' — ' + r.status + ' ' + (r.message ?? '')
      + (r.errors ? ' ' + JSON.stringify(r.errors) : ''));
    failures += 1;
    throw new Error(label);
  }
  log('  PASS  ' + label);
  return r.data;
}

const S = {};

// ------------------------------------------------------------------ sign in
log('\n=== 1. Sign in ===');
{
  S.platform = must('the super admin signs in', await api('/api/onyx/platform/login', {
    method: 'POST',
    body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
  })).token;

  const tenant = must('ABC Institution opens in the console',
    await api('/api/onyx/platform/tenants/' + TENANT, { token: S.platform }));
  ok('the institution under test is ABC Institution', tenant.name === 'ABC Institution',
    tenant.name);

  const sd = must('the student signs in', await api('/api/onyx/auth/login', {
    method: 'POST',
    body: { email: 'student@demo.onyx', password: 'Demo#2026!', tenant_id: TENANT },
  }));
  S.student = sd.token;
  S.studentId = sd.user?.id;
  ok('their session is scoped to ABC', sd.tenant?.name === 'ABC Institution',
    String(sd.tenant?.name));

  const ad = must('ABC’s own administrator signs in', await api('/api/onyx/auth/login', {
    method: 'POST',
    body: { email: 'admin@demo.onyx', password: 'Demo#2026!', tenant_id: TENANT },
  }));
  S.admin = ad.token;
}

const base = '/api/onyx/platform/tenants/' + TENANT;

// ------------------------------------------------- 2. a course, from the console
log('\n=== 2. The super admin creates a course ===');
{
  const course = must('the course is created', await api(base + '/courses', {
    method: 'POST', token: S.platform,
    body: {
      code: 'QA' + STAMP.slice(-4).toUpperCase(),
      title: 'QA Programming ' + STAMP,
      credits: 4,
      status: 1,
    },
  }));
  S.courseId = course.id;
  ok('it is on the institution’s course list', Boolean(course.id), 'course ' + course.id);

  const academics = must('the console reads it back',
    await api(base + '/academics?limit=200', { token: S.platform }));
  const row = (academics.courses ?? []).find((c) => Number(c.id) === Number(course.id));
  ok('it appears in the console course list', Boolean(row),
    row ? row.code + ' — ' + row.title : 'not found');

  // A course nobody is on is a course nobody can sit an exam for -- which is
  // why the console can now enrol, rather than being able to build a course
  // and then having to sign in as the institution to make it reachable.
  must('the super admin enrols the student on it', await api(
    base + '/courses/' + course.id + '/enroll',
    { method: 'POST', token: S.platform, body: { user_id: S.studentId } }));

  const roster = must('the console reads the roster back', await api(
    base + '/courses/' + course.id + '/roster', { token: S.platform }));
  ok('the student is on it', roster.some((r) => String(r.user_id) === String(S.studentId)),
    roster.length + ' enrolled');

  const mine = await api('/api/onyx/my/courses', { token: S.student });
  ok('the student sees the new course among theirs',
    (mine.data ?? []).some((c) => Number(c.id) === Number(course.id)),
    (mine.data ?? []).length + ' courses');
}

// -------------------------------- 3. a paper, with the coding question written here
log('\n=== 3. The super admin builds a question paper ===');
{
  // The three calls the builder makes for a problem written on the form.
  const problem = must('the coding problem is written as part of the paper',
    await api(base + '/problems', {
      method: 'POST', token: S.platform,
      body: {
        title: 'QA Square the number ' + STAMP,
        statement: 'Read one integer n from standard input and print n squared.\n\n'
          + 'Input: a single integer.\nOutput: n * n on its own line.\n\nExample: 4 -> 16',
        difficulty: 'easy', languages: ['python'], course_id: S.courseId,
        time_limit_ms: 5000, memory_limit_kb: 256 * 1024, solution_rule: 'never',
      },
    }));
  S.problemId = problem.id;
  ok('it starts as a draft', problem.status === 'draft', problem.status);

  must('its test cases are saved', await api(base + '/problems/' + problem.id + '/tests', {
    method: 'PUT', token: S.platform,
    body: {
      tests: [
        { name: 'Example', stdin: '4\n', expected_stdout: '16', is_hidden: false, weight: 1 },
        { name: 'Zero', stdin: '0\n', expected_stdout: '0', is_hidden: true, weight: 1 },
        { name: 'Large', stdin: '250\n', expected_stdout: '62500', is_hidden: true, weight: 1 },
      ],
    },
  }));
  const live = must('it is published, so it can mark a question',
    await api(base + '/problems/' + problem.id + '/publish',
      { method: 'POST', token: S.platform }));
  ok('it is published', live.status === 'published', live.status);

  const bank = must('a question bank is made for the paper', await api(base + '/banks', {
    method: 'POST', token: S.platform,
    body: { name: 'QA paper ' + STAMP + ' — question bank', course_id: S.courseId },
  }));
  S.bankId = bank.id;

  must('the coding question is bound to the problem just written',
    await api(base + '/banks/' + bank.id + '/questions', {
      method: 'POST', token: S.platform,
      body: {
        type: 'code', points: 10, problem_id: problem.id,
        prompt: 'Write a program that reads an integer and prints its square.',
      },
    }));
  must('a multiple-choice question is added beside it',
    await api(base + '/banks/' + bank.id + '/questions', {
      method: 'POST', token: S.platform,
      body: {
        type: 'single', points: 5, prompt: 'Which of these squares a number in Python?',
        options: [{ id: 'a', text: 'n ** 2' }, { id: 'b', text: 'n // 2' }], answer: 'a',
      },
    }));

  const paper = must('the paper is created', await api(base + '/assessments', {
    method: 'POST', token: S.platform,
    body: { title: 'QA Coding paper ' + STAMP, course_id: S.courseId, duration_minutes: 60 },
  }));
  S.paperId = paper.id;
  must('it draws both questions', await api(base + '/assessments/' + paper.id + '/sections', {
    method: 'PUT', token: S.platform,
    body: { sections: [{ id: 's1', title: 'All questions', bank_id: bank.id, take: 2 }] },
  }));
  const published = must('the paper is published',
    await api(base + '/assessments/' + paper.id + '/publish',
      { method: 'POST', token: S.platform, body: {} }));
  ok('it is published', published.status === 'published', published.status);
}

// ------------------------------------------------------------- 4. the examination
log('\n=== 4. The super admin schedules the examination ===');
{
  // Two minutes ago, so the window the link opens is open now and the student
  // half of this test can actually sit it.
  const startsAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const exam = must('the exam is scheduled — with no semester in the body',
    await api(base + '/exams', {
      method: 'POST', token: S.platform,
      body: {
        title: 'QA Coding exam ' + STAMP, course_id: S.courseId,
        assessment_id: S.paperId, starts_at: startsAt,
        duration_minutes: 60, max_marks: 15, pass_marks: 6,
      },
    }));
  S.examId = exam.id;
  log('        stored semester_id = ' + JSON.stringify(exam.semester_id)
    + ' (taken from the course; null where it has none)');
  ok('it is scheduled and linked to the paper',
    exam.status === 'scheduled' && Number(exam.assessment_id) === Number(S.paperId));

  const academics = must('the console lists it',
    await api(base + '/academics?limit=200', { token: S.platform }));
  ok('the examination is on the institution’s list',
    academics.exams.some((e) => Number(e.id) === Number(exam.id)));
  const paper = (academics.assessments ?? []).find((a) => Number(a.id) === Number(S.paperId));
  ok('linking the paper opened its window on the sitting',
    Boolean(paper?.opens_at) && Boolean(paper?.closes_at)
    && Math.abs(Date.parse(paper.opens_at) - Date.parse(exam.starts_at)) < 1000,
    JSON.stringify({ opens: paper?.opens_at, closes: paper?.closes_at }));
}

// ------------------------------------------------------------ 5. the student sits it
log('\n=== 5. The student sits the examination ===');
{
  const from = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 9 * 86_400_000).toISOString();
  const cal = must('the student reads their calendar', await api(
    '/api/onyx/calendar?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to),
    { token: S.student }));
  ok('the examination is on it',
    (cal.exams ?? []).some((e) => Number(e.id) === Number(S.examId)));
  ok('so is the paper behind it, in the window the exam opened',
    (cal.assessments ?? []).some((a) => Number(a.id) === Number(S.paperId)));

  const attempt = must('an attempt is dealt', await api(
    '/api/onyx/assessments/' + S.paperId + '/start',
    { method: 'POST', token: S.student, body: {} }));
  S.attemptId = attempt.id;
  const qs = attempt.questions ?? [];
  log('        drawn: ' + qs.map((q) => q.type).join(', '));

  const code = qs.find((q) => q.type === 'code');
  ok('the paper drew the coding question', Boolean(code));
  ok('the candidate is not handed the answer key',
    !JSON.stringify(qs).includes('expected_stdout'));

  if (code) {
    must('the candidate answers it with a program', await api(
      '/api/onyx/attempts/' + S.attemptId + '/answer', {
        method: 'POST', token: S.student,
        body: {
          question_id: code.question_id,
          response: { language: 'python', source: SOURCE },
        },
      }));

    const found = must('the hand-in reaches the staff feed', await api(
      '/api/onyx/practice/submissions?problem_id=' + S.problemId
      + '&user_id=' + S.studentId, { token: S.admin }));
    S.submissionId = (found.submissions ?? [])[0]?.id ?? null;
    ok('answering queued a Code Lab submission', Boolean(S.submissionId),
      'submission ' + S.submissionId);

    if (S.submissionId) {
      await api('/api/onyx/queue/drain', { method: 'POST', token: S.platform, body: {} });
      let graded = null;
      for (let i = 0; i < 40; i += 1) {
        const r = await api('/api/onyx/submissions/code/' + S.submissionId,
          { token: S.student });
        if (r.ok && (r.data.status === 'done' || r.data.status === 'failed')) {
          graded = r.data; break;
        }
        await new Promise((res) => setTimeout(res, 3000));
      }
      if (!graded) {
        ok('the sandbox graded it', false, 'still queued after two minutes');
      } else {
        log('        verdict: ' + graded.status + ' ' + graded.score + '/' + graded.max_score
          + ' (' + graded.passed + '/' + graded.total + ' cases)'
          + (graded.error ? ' error=' + graded.error : ''));
        ok('the sandbox graded it', graded.status === 'done',
          graded.status + (graded.error ? ': ' + graded.error : ''));
        ok('a correct program scores full marks',
          graded.max_score > 0 && graded.score >= graded.max_score,
          graded.score + '/' + graded.max_score);
        const hidden = (graded.cases ?? []).filter((c) => c.is_hidden);
        ok('the hidden cases ran and passed',
          hidden.length === 2 && hidden.every((c) => c.passed), hidden.length + ' hidden');
        ok('their output is still withheld from the candidate',
          hidden.every((c) => c.stdout === null));
      }
    }
  }

  const single = qs.find((q) => q.type === 'single');
  if (single) {
    const a = await api('/api/onyx/attempts/' + S.attemptId + '/answer', {
      method: 'POST', token: S.student,
      body: { question_id: single.question_id, response: 'a' },
    });
    ok('the multiple-choice answer is saved', a.ok === true, a.message ?? '');
  }

  const handed = must('the student hands the paper in', await api(
    '/api/onyx/attempts/' + S.attemptId + '/submit', { method: 'POST', token: S.student }));
  log('        attempt: ' + handed.status + ' ' + handed.score + '/' + handed.max_score);
  ok('the coding question was marked by the problem’s own test suite',
    Number(handed.score) === 15,
    handed.score + '/' + handed.max_score + ' (10 code + 5 choice)');
}

// ---------------------------------------- 6. what the super admin can see afterwards
log('\n=== 6. The super admin reads it all back ===');
{
  const grades = must('the console grade book loads',
    await api(base + '/grades?limit=200', { token: S.platform }));
  ok('the sitting is in the grade book',
    JSON.stringify(grades).includes('QA Coding paper ' + STAMP),
    'searched the grades payload');

  const feed = must('the console reads the practice submission feed',
    await api(base + '/code-submissions?limit=50', { token: S.platform }));
  const row = (feed.submissions ?? []).find((r) => Number(r.id) === Number(S.submissionId));
  ok('the super admin sees the hand-in, with the learner named', Boolean(row),
    row ? row.learner + ' | ' + row.problem_title + ' | ' + row.status + ' '
      + row.score + '/' + row.max_score : 'not in the feed');
  ok('the feed does not carry the learner’s source code',
    !JSON.stringify(feed).includes('print(n * n)'));

  const byProblem = must('it filters by problem', await api(
    base + '/code-submissions?problem_id=' + S.problemId, { token: S.platform }));
  ok('filtering by problem returns only that problem’s hand-ins',
    (byProblem.submissions ?? []).length > 0
    && (byProblem.submissions ?? []).every((r) => Number(r.problem_id) === Number(S.problemId)),
    (byProblem.submissions ?? []).length + ' rows');

  const byLearner = must('it filters by learner', await api(
    base + '/code-submissions?user_id=' + S.studentId, { token: S.platform }));
  ok('filtering by learner returns only theirs',
    (byLearner.submissions ?? []).every((r) => r.user_id === S.studentId),
    (byLearner.submissions ?? []).length + ' rows');

  const problems = must('the console lists the problem it authored',
    await api(base + '/problems', { token: S.platform }));
  ok('the problem is in ABC’s bank',
    problems.some((p) => Number(p.id) === Number(S.problemId)));

  const own = await api('/api/onyx/attempts/' + S.attemptId, { token: S.student });
  ok('the student can read their own result', own.ok === true,
    own.ok ? own.data.status + ' ' + own.data.score : own.message);
  const practice = await api('/api/onyx/practice/results', { token: S.student });
  ok('the problem is on their practice record',
    (practice.data ?? []).some((r) => Number(r.problem_id) === Number(S.problemId)));
}

// ----------------------------------------------------------- 7. blast radius
log('\n=== 7. Nothing outside ABC was touched ===');
{
  const malla = await api('/api/onyx/platform/tenants/738/problems', { token: S.platform });
  ok('Malla Reddy University has no problem from this run',
    ((malla.data ?? []).filter((p) => String(p.title).startsWith('QA '))).length === 0);
  const mallaAcad = await api('/api/onyx/platform/tenants/738/academics?limit=200',
    { token: S.platform });
  const d = mallaAcad.data ?? {};
  ok('nor a course, a paper or an exam',
    ((d.courses ?? []).filter((c) => String(c.title).startsWith('QA '))).length === 0
    && ((d.assessments ?? []).filter((a) => String(a.title).startsWith('QA '))).length === 0
    && ((d.exams ?? []).filter((e) => String(e.title).startsWith('QA '))).length === 0);
}

log('\n=== ids ===');
log(JSON.stringify({
  courseId: S.courseId, problemId: S.problemId, paperId: S.paperId,
  examId: S.examId, attemptId: S.attemptId, submissionId: S.submissionId,
}, null, 2));
log('\n' + (failures ? failures + ' FAILURES' : 'the whole arc works'));
process.exitCode = failures ? 1 : 0;
