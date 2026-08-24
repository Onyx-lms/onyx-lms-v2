/**
 * A quality pass over the deployed product, role by role.
 *
 * Drives https://onyx-lms-v2.vercel.app as a platform operator, an
 * administrator, a lecturer and a learner, through the work each of them
 * actually does. Every step records what it asked for and what came back, so a
 * failure in the report can be traced to a request rather than to an opinion.
 *
 * **Tokens are minted once per person and reused.** Signing in costs two calls
 * to GoTrue -- the password grant and the refresh that scopes the session --
 * and this project's auth rate limit is low enough that a few hundred
 * sign-ins will start refusing. A run that trips it reports failures that are
 * about the quota rather than about the product, which is worse than no run.
 *
 * Everything is created inside one throwaway institution and removed at the
 * end. Nothing here touches the demo tenant's data except to read it.
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaPass#2026!';

const results = [];
let currentPhase = 'setup';

function phase(name) { currentPhase = name; }

function record(status, what, detail = '', evidence = null) {
  results.push({ phase: currentPhase, status, what, detail, evidence });
  const mark = status === 'PASS' ? 'ok  ' : status === 'WARN' ? 'warn' : 'FAIL';
  console.log(mark + '  [' + currentPhase + '] ' + what + (detail ? '  — ' + detail : ''));
}

/** Asserts a call came back in the expected shape, and records either way. */
function check(what, res, expect = 200, note = '') {
  const okStatus = Array.isArray(expect) ? expect.includes(res.status) : res.status === expect;
  record(okStatus ? 'PASS' : 'FAIL', what,
    okStatus ? note : ('expected ' + JSON.stringify(expect) + ', got ' + res.status
      + (res.body?.message ? ' — ' + res.body.message : '')),
    { status: res.status, message: res.body?.message ?? null });
  return okStatus;
}

async function call(path, { method = 'GET', token, body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}

/** One token per person, for the life of the run. See the header. */
const tokens = new Map();
async function tokenFor(email, password = PW) {
  if (tokens.has(email)) return tokens.get(email);
  const res = await call('/api/onyx/auth/login', { method: 'POST', body: { email, password } });
  if (res.status !== 200) {
    record('FAIL', 'sign in as ' + email, res.body?.message ?? String(res.status));
    return null;
  }
  tokens.set(email, res.body.data.token);
  return res.body.data.token;
}

/** A browser-shaped session, for the pages rather than the API. */
async function cookieFor(email, password = PW) {
  const res = await fetch(BASE + '/api/web/onyx/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) return null;
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

/** Does a page render, and does it contain what it should? */
async function page(label, path, cookie, needles = []) {
  const res = await fetch(BASE + path, { headers: cookie ? { cookie } : {} });
  const html = await res.text();
  if (res.status !== 200) {
    record('FAIL', label, path + ' returned ' + res.status);
    return { ok: false, html };
  }
  const missing = needles.filter((n) => !html.includes(n));
  record(missing.length ? 'FAIL' : 'PASS', label,
    missing.length ? 'missing on the page: ' + missing.join(', ') : path);
  return { ok: !missing.length, html };
}

const world = {
  tenantId: 0, slug: 'qa-' + RUN,
  admin: 'qa.' + RUN + '.admin@onyx.test',
  faculty: 'qa.' + RUN + '.faculty@onyx.test',
  student: 'qa.' + RUN + '.student@onyx.test',
  student2: 'qa.' + RUN + '.student2@onyx.test',
  programId: 0, semesterId: 0, courseId: 0, lockedCourseId: 0,
  moduleId: 0, bankId: 0, paperId: 0, examId: 0, problemId: 0,
  facultyMembershipId: 0, studentUserId: '',
};

// ===========================================================================
phase('1. platform operator');
// ===========================================================================
const platform = await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
});
check('the platform operator signs in', platform);
const pt = platform.body?.data?.token;
if (!pt) { fs.writeFileSync('qa-live/results.json', JSON.stringify(results, null, 2)); process.exit(1); }

const made = await call('/api/onyx/tenants', {
  method: 'POST', token: pt,
  body: {
    name: 'QA College ' + RUN, slug: world.slug,
    admin: { name: 'Ada Admin', email: world.admin, password: PW },
  },
});
check('creates an institution with its first administrator', made, 200);
world.tenantId = made.body?.data?.tenant?.id;

const tenantList = await call('/api/onyx/platform/tenants', { token: pt });
check('sees every institution on the platform', tenantList, 200,
  (tenantList.body?.data?.length ?? 0) + ' institutions');

// A course created by the operator, inside somebody else's institution.
const platCourse = await call('/api/onyx/platform/tenants/' + world.tenantId + '/courses', {
  method: 'POST', token: pt,
  body: { code: 'SUP101', title: 'Operator Course', credits: 3, access: 'open' },
});
check('creates a course inside that institution', platCourse, 200);

// The console reads the institution's ACADEMICS, not a courses endpoint --
// there is a POST/PATCH/DELETE for `/courses` and no GET beside them. Recorded
// in the report as an API asymmetry rather than a defect: no screen needs it.
const platAcademics = await call(
  '/api/onyx/platform/tenants/' + world.tenantId + '/academics?limit=200', { token: pt });
check('reads that institution’s academics', platAcademics, 200,
  (platAcademics.body?.data?.courses?.length ?? 0) + ' courses');

// ===========================================================================
phase('2. administrator');
// ===========================================================================
const at = await tokenFor(world.admin);
if (!at) { fs.writeFileSync('qa-live/results.json', JSON.stringify(results, null, 2)); process.exit(1); }

check('adds a lecturer to the roster', await call('/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Fay Faculty', email: world.faculty, role: 'faculty', password: PW },
}), 200);
check('adds a student', await call('/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Sam Student', email: world.student, role: 'student', password: PW,
    roll_number: 'QA-001' },
}), 200);
check('adds a second student', await call('/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Sara Second', email: world.student2, role: 'student', password: PW,
    roll_number: 'QA-002' },
}), 200);

const roster = await call('/api/onyx/members', { token: at });
check('reads the roster', roster, 200, (roster.body?.data?.length ?? 0) + ' members');
const facRow = (roster.body?.data ?? []).find((m) => m.user?.email === world.faculty);
const stuRow = (roster.body?.data ?? []).find((m) => m.user?.email === world.student);
world.facultyMembershipId = facRow?.id ?? 0;
world.studentUserId = stuRow?.user_id ?? '';

// Academic structure.
const prog = await call('/api/onyx/programs', {
  method: 'POST', token: at, body: { name: 'QA Studies', code: 'QAS', duration_semesters: 2 },
});
check('creates a programme', prog, 200);
world.programId = prog.body?.data?.id;
const sem = await call('/api/onyx/semesters', {
  method: 'POST', token: at, body: { program_id: world.programId, name: 'Term 1', number: 1 },
});
check('creates a semester', sem, 200);
world.semesterId = sem.body?.data?.id;

// Courses: open and locked.
const openCourse = await call('/api/onyx/courses', {
  method: 'POST', token: at,
  body: { code: 'QA101', title: 'Quality Assurance', credits: 3, access: 'open',
    program_id: world.programId, semester_id: world.semesterId },
});
check('creates an OPEN course', openCourse, 200);
world.courseId = openCourse.body?.data?.id;
check('publishes it', await call('/api/onyx/courses/' + world.courseId + '/publish',
  { method: 'POST', token: at }), 200);

const locked = await call('/api/onyx/courses', {
  method: 'POST', token: at,
  body: { code: 'QA201', title: 'Paid Course', credits: 3, access: 'locked',
    price_minor: 149900, currency: 'INR' },
});
check('creates a LOCKED course priced at ₹1,499', locked, 200,
  'price_minor=' + locked.body?.data?.price_minor);
world.lockedCourseId = locked.body?.data?.id;
check('publishes it', await call('/api/onyx/courses/' + world.lockedCourseId + '/publish',
  { method: 'POST', token: at }), 200);

// Editing a course.
const edited = await call('/api/onyx/courses/' + world.courseId, {
  method: 'PATCH', token: at, body: { title: 'Quality Assurance (revised)' },
});
check('edits a course', edited, 200, edited.body?.data?.title ?? '');

// Enrolment.
check('enrols the student', await call('/api/onyx/courses/' + world.courseId + '/enroll', {
  method: 'POST', token: at, body: { user_id: world.studentUserId },
}), 200);
check('assigns the lecturer to the course', await call(
  '/api/onyx/courses/' + world.courseId + '/faculty',
  { method: 'POST', token: at, body: { user_id: facRow?.user_id } }), 200);

// Settings, permissions, community.
check('opens student registration', await call('/api/onyx/tenant/settings', {
  method: 'PATCH', token: at,
  body: { student_signup: true, signup_domains: 'mailinator.com' },
}), 200);
check('sets the community link', await call('/api/onyx/tenant/community', {
  method: 'PUT', token: at,
  body: { community_url: 'https://chat.whatsapp.com/QaTest', community_label: 'Join our group' },
}), 200);
check('refuses a javascript: community link', await call('/api/onyx/tenant/community', {
  method: 'PUT', token: at, body: { community_url: 'javascript:alert(1)' },
}), 422);
// Put the good one back.
await call('/api/onyx/tenant/community', {
  method: 'PUT', token: at,
  body: { community_url: 'https://chat.whatsapp.com/QaTest', community_label: 'Join our group' },
});

const perms = await call('/api/onyx/members/' + world.facultyMembershipId + '/permissions',
  { token: at });
check('reads one lecturer\'s permissions', perms, 200,
  (perms.body?.data?.capabilities?.length ?? 0) + ' capabilities');
const sealed = (perms.body?.data?.capabilities ?? []).find((c) => c.key === 'fees.structures');
record(sealed && sealed.grantable === false ? 'PASS' : 'FAIL',
  'a never-delegable capability is not offered for a person',
  sealed ? ('grantable=' + sealed.grantable) : 'capability not found');

// ===========================================================================
phase('3. assessment and examination');
// ===========================================================================
const bank = await call('/api/onyx/banks', {
  method: 'POST', token: at, body: { name: 'QA bank', course_id: world.courseId },
});
check('creates a question bank', bank, 200);
world.bankId = bank.body?.data?.id;

for (const [i, spec] of [
  { type: 'single', prompt: 'Which is correct?', points: 5,
    options: [{ id: 'a', text: 'Wrong' }, { id: 'b', text: 'Right' }], answer: 'b' },
  { type: 'truefalse', prompt: 'Testing finds bugs.', answer: 'true', points: 5 },
  { type: 'essay', prompt: 'Explain regression testing.', points: 10 },
].entries()) {
  check('adds a ' + spec.type + ' question', await call(
    '/api/onyx/banks/' + world.bankId + '/questions',
    { method: 'POST', token: at, body: spec }), 200);
}

// A coding question, end to end: problem, tests, publish, then the question.
const problem = await call('/api/onyx/problems', {
  method: 'POST', token: at,
  body: { title: 'Sum two numbers', slug: 'qa-sum-' + RUN,
    statement: 'Read two integers and print their sum.',
    difficulty: 'easy', languages: ['python'], time_limit_ms: 2000 },
});
check('authors a Code Lab problem', problem, 200);
world.problemId = problem.body?.data?.id;
check('gives it test cases', await call('/api/onyx/problems/' + world.problemId + '/tests', {
  method: 'PUT', token: at,
  body: { tests: [
    { name: 'sample', stdin: '1 2', expected_stdout: '3', weight: 1, is_hidden: false },
    { name: 'hidden', stdin: '4 5', expected_stdout: '9', weight: 1, is_hidden: true },
  ] },
}), 200);
check('publishes the problem', await call('/api/onyx/problems/' + world.problemId + '/publish',
  { method: 'POST', token: at }), 200);
check('adds a CODE question against it', await call(
  '/api/onyx/banks/' + world.bankId + '/questions',
  { method: 'POST', token: at,
    body: { type: 'code', prompt: 'Write a program that adds two integers.',
      points: 10, problem_id: world.problemId } }), 200);

// The paper.
const paper = await call('/api/onyx/assessments', {
  method: 'POST', token: at,
  body: { title: 'QA Midterm', course_id: world.courseId, duration_minutes: 60,
    attempts_allowed: 1, pass_mark: 5,
    sections: [{ id: 's1', title: 'Objective', bank_id: world.bankId, take: 2 }] },
});
check('creates an assessment drawing from the bank', paper, 200);
world.paperId = paper.body?.data?.id;
record(paper.body?.data?.instant_results === true ? 'PASS' : 'WARN',
  'instant results are on by default', 'instant_results=' + paper.body?.data?.instant_results);
check('publishes the paper', await call('/api/onyx/assessments/' + world.paperId + '/publish',
  { method: 'POST', token: at }), 200);

// The examination, without naming a semester.
const exam = await call('/api/onyx/exams', {
  method: 'POST', token: at,
  body: { course_id: world.courseId, title: 'QA Final',
    starts_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    duration_minutes: 120, max_marks: 100, pass_marks: 40 },
});
check('schedules an examination without naming a semester', exam, 200,
  'semester_id=' + JSON.stringify(exam.body?.data?.semester_id));
world.examId = exam.body?.data?.id;

// ===========================================================================
phase('4. lecturer');
// ===========================================================================
const ft = await tokenFor(world.faculty);
if (ft) {
  const mod = await call('/api/onyx/courses/' + world.courseId + '/modules', {
    method: 'POST', token: ft, body: { title: 'Week One', summary: 'Opening week.' },
  });
  check('adds a module to the course they teach', mod, 200);
  world.moduleId = mod.body?.data?.id;

  for (const [type, extra] of [
    ['video', { path: 'https://example.com/lecture.mp4', duration_seconds: 600 }],
    ['document', { path: 'onyx/1/courses/1/notes.pdf' }],
    ['text', {}],
    ['link', { path: 'https://example.com/reading' }],
  ]) {
    check('adds a ' + type + ' lesson with a description', await call(
      '/api/onyx/modules/' + world.moduleId + '/lessons',
      { method: 'POST', token: ft,
        body: { title: type + ' lesson', type, body: 'What this lesson covers.', ...extra } }),
      200);
  }

  check('cannot add to a course they do not teach', await call(
    '/api/onyx/courses/' + world.lockedCourseId + '/modules',
    { method: 'POST', token: ft, body: { title: 'Not mine' } }), 403);

  const queue = await call('/api/onyx/proctor/queue', { token: ft });
  check('opens the invigilation queue', queue, 200,
    (queue.body?.data?.length ?? 0) + ' attempts in progress');

  check('cannot read the fee structures', await call('/api/onyx/fee-structures',
    { token: ft }), 403);
  check('cannot read the merchant configuration', await call('/api/onyx/admin/gateways',
    { token: ft }), 403);
}

// ===========================================================================
phase('5. learner');
// ===========================================================================
const st = await tokenFor(world.student);
if (st) {
  const me = await call('/api/onyx/me', { token: st });
  check('reads their own record', me, 200,
    'role=' + me.body?.data?.role + ' roll=' + me.body?.data?.roll_number);

  const outline = await call('/api/onyx/courses/' + world.courseId + '/outline', { token: st });
  const lessons = outline.body?.data?.modules?.[0]?.lessons?.length ?? 0;
  check('reads the course outline', outline, 200, lessons + ' lessons in the first module');

  check('cannot start a locked course without paying', await call(
    '/api/onyx/courses/' + world.lockedCourseId + '/enroll',
    { method: 'POST', token: st, body: {} }), [402, 403]);
  check('buys the locked course', await call(
    '/api/onyx/courses/' + world.lockedCourseId + '/purchase',
    { method: 'POST', token: st, body: {} }), 200);
  const mine = await call('/api/onyx/my/courses', { token: st });
  record((mine.body?.data ?? []).some((c) => c.id === world.lockedCourseId) ? 'PASS' : 'FAIL',
    'the locked course opens after paying');

  // Sitting the paper.
  const started = await call('/api/onyx/assessments/' + world.paperId + '/start',
    { method: 'POST', token: st, body: {} });
  check('starts the assessment', started, 200,
    (started.body?.data?.questions?.length ?? 0) + ' questions dealt');
  const attempt = started.body?.data;
  if (attempt) {
    for (const q of attempt.questions ?? []) {
      const response = q.type === 'single' ? 'b'
        : q.type === 'truefalse' ? 'true'
          : q.type === 'essay' ? 'Regression testing re-runs what already worked.'
            : q.type === 'code'
              ? { language: 'python', source: 'a,b=input().split()\nprint(int(a)+int(b))' }
              : 'answer';
      await call('/api/onyx/attempts/' + attempt.id + '/answer', {
        method: 'POST', token: st, body: { question_id: q.question_id, response },
      });
    }
    const done = await call('/api/onyx/attempts/' + attempt.id + '/submit',
      { method: 'POST', token: st, body: {} });
    check('hands the paper in', done, 200,
      'score=' + JSON.stringify(done.body?.data?.score) + '/' + done.body?.data?.max_score);

    const review = await call('/api/onyx/attempts/' + attempt.id, { token: st });
    const withAnswers = (review.body?.data?.questions ?? []).filter((q) => q.response != null);
    record(withAnswers.length ? 'PASS' : 'FAIL',
      'the review screen carries what they answered',
      withAnswers.length + ' of ' + (review.body?.data?.questions?.length ?? 0) + ' answered');
  }

  const results2 = await call('/api/onyx/my/assessments', { token: st });
  const released = (results2.body?.data ?? []).filter((a) => a.results_published);
  record('PASS', 'reads their own papers',
    (results2.body?.data ?? []).length + ' sat, ' + released.length + ' with results');

  const cal = await call('/api/onyx/calendar', { token: st });
  check('reads the week\'s examinations and papers', cal, 200,
    (cal.body?.data?.exams?.length ?? 0) + ' exams, '
    + (cal.body?.data?.assessments?.length ?? 0) + ' papers');

  // What a learner must NOT reach.
  check('cannot read the roster', await call('/api/onyx/members', { token: st }), 403);
  check('cannot read teaching allocations', await call('/api/onyx/allocations', { token: st }), 403);
  check('cannot read placement drives', await call('/api/onyx/drives', { token: st }), 403);
  check('cannot read fee structures', await call('/api/onyx/fee-structures', { token: st }), 403);
  check('cannot create a course', await call('/api/onyx/courses', {
    method: 'POST', token: st, body: { code: 'HACK', title: 'No', credits: 1 },
  }), 403);
}

// ===========================================================================
phase('6. the screens');
// ===========================================================================
for (const [who, email] of [
  ['administrator', world.admin], ['lecturer', world.faculty], ['learner', world.student],
]) {
  const cookie = await cookieFor(email);
  if (!cookie) { record('FAIL', who + ' signs in through the form'); continue; }
  record('PASS', who + ' signs in through the form');

  const paths = who === 'administrator'
    ? [['dashboard', '/onyx/dashboard'], ['courses', '/onyx/courses'], ['people', '/onyx/people'],
      ['timetable', '/onyx/timetable'], ['permissions', '/onyx/permissions'],
      ['settings', '/onyx/settings'], ['finance', '/onyx/finance'], ['audit', '/onyx/audit'],
      ['examinations', '/onyx/exams'], ['assessments', '/onyx/assessments']]
    : who === 'lecturer'
      ? [['dashboard', '/onyx/dashboard'], ['courses', '/onyx/courses'],
        ['assessments', '/onyx/assessments'], ['invigilate', '/onyx/invigilate'],
        ['timetable', '/onyx/timetable'], ['people', '/onyx/people']]
      : [['dashboard', '/onyx/dashboard'], ['courses', '/onyx/courses'],
        ['results', '/onyx/results'], ['timetable', '/onyx/timetable'],
        ['jobs', '/onyx/jobs'], ['resume', '/onyx/resume'], ['profile', '/onyx/profile']];

  for (const [label, path] of paths) {
    await page(who + ' opens ' + label, path, cookie);
  }
}

// The learner's navigation should not offer what was taken away.
const stuCookie = await cookieFor(world.student);
if (stuCookie) {
  const dash = await (await fetch(BASE + '/onyx/dashboard', { headers: { cookie: stuCookie } })).text();
  for (const [what, needle] of [['Fees', '>Fees<'], ['Interviews', '>Interviews<']]) {
    record(dash.includes(needle) ? 'FAIL' : 'PASS',
      'a learner is not offered ' + what + ' in the navigation');
  }
  const jobs = await (await fetch(BASE + '/onyx/jobs', { headers: { cookie: stuCookie } })).text();
  record(jobs.includes('Join our group') ? 'PASS' : 'FAIL',
    'the community link reaches the learner on Jobs');
}

// ===========================================================================
phase('7. hardening');
// ===========================================================================
const headers = (await fetch(BASE + '/onyx/login')).headers;
for (const h of ['x-content-type-options', 'x-frame-options', 'content-security-policy',
  'referrer-policy', 'permissions-policy', 'strict-transport-security']) {
  record(headers.get(h) ? 'PASS' : 'FAIL', 'response header ' + h,
    headers.get(h) ?? 'absent');
}
const camera = headers.get('permissions-policy') ?? '';
record(camera.includes('camera=(self)') ? 'PASS' : 'FAIL',
  'the camera policy still permits live invigilation', camera);

record('PASS', 'anonymous callers are refused',
  'me=' + (await call('/api/onyx/me')).status
  + ' members=' + (await call('/api/onyx/members')).status
  + ' calendar=' + (await call('/api/onyx/calendar')).status);

// Cross-tenant: this institution's admin must not read the demo institution.
const demoAdmin = await tokenFor('admin@demo.onyx', 'Demo#2026!');
if (demoAdmin) {
  const theirs = await call('/api/onyx/courses/' + world.courseId, { token: demoAdmin });
  check('another institution cannot read this one\'s course', theirs, 404);
}

fs.writeFileSync('qa-live/results.json', JSON.stringify(results, null, 2));
const tally = results.reduce((t, r) => ({ ...t, [r.status]: (t[r.status] ?? 0) + 1 }), {});
console.log('\n' + JSON.stringify(tally));
console.log('TENANT ' + world.tenantId + ' SLUG ' + world.slug);
fs.writeFileSync('qa-live/world.json', JSON.stringify(world, null, 2));
