/**
 * The demo institution, walked end to end by every role that uses it.
 *
 * Not a route checklist: four journeys, in the order the people who do them
 * would. A platform operator opening the restructured console; an
 * administrator looking for who is on what; a lecturer who has to find their
 * own courses, their bank and their marking; and a candidate who signs in,
 * enrols, sits an examination, hands it in and reads their result back.
 *
 * Tenant 798 only, and the guard refuses any other. It DELIBERATELY leaves
 * three handed-in attempts behind: a submissions table, a register, a marks
 * editor and a PDF bundle with nothing in them are indistinguishable from
 * broken ones, and somebody testing by hand should find them populated.
 *
 *   node --env-file=.env qa-live/e2e-malla-reddy-demo.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DEMO_SLUG = 'malla-reddy-demo';
const STAFF_PW = 'MrDemo#2026!';
const STUDENT_PW = 'Student#2026!';
const DOMAIN = 'mrdemo.test';

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(62), detail);
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
/** A binary fetch, for the PDFs -- `%PDF` or it is not one. */
async function pdf(path, token) {
  const res = await fetch(BASE + path, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    disposition: res.headers.get('content-disposition') ?? '',
    isPdf: buf.subarray(0, 4).toString() === '%PDF',
    bytes: buf.length,
  };
}
const login = async (e, p) => (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email: e, password: p } })).data?.token;

// ===========================================================================

startPhase('1. the platform operator opens the institution');

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;
const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const demo = tenants.find((t) => t.slug === DEMO_SLUG);
const original = tenants.find((t) => t.slug === 'malla-reddy-university');
check('the demo is there and is not the original',
  Boolean(demo) && demo.id !== original?.id,
  'tenant ' + demo?.id + ', original ' + original?.id);
const TID = Number(demo.id);
if (tenants.some((t) => t.slug !== DEMO_SLUG && Number(t.id) === TID)) {
  console.log('REFUSING: that id belongs to another institution.');
  process.exit(1);
}
const base = '/api/onyx/platform/tenants/' + TID;

/*
 * FLOORS, NOT SNAPSHOTS.
 *
 * These seven checks used to assert the exact figures the demo was seeded
 * with -- 1,440 students, 63 courses, three papers, sixty in Alpha-CSE. Then
 * somebody used the demo, which is the entire point of a demo: a learner
 * signed herself up, and a course with two papers was built to try the
 * authoring screens. Every seeded figure moved by one or two, every assertion
 * went red, and the reported numbers beside them were all CORRECT. Seven red
 * lines that mean "the demo was used" teach a reader to skim past red.
 *
 * So each one now asserts the thing it was actually for. "The superadmin sees
 * EVERY enrolment, not the first thousand" was never a claim that the number
 * is 1,440 -- it is a claim that PostgREST did not silently truncate at 1,000,
 * and `=== 1440` was a brittle proxy for `!== 1000`. The seed is a FLOOR:
 * nothing may go missing, anything may be added. Where an exact identity
 * matters -- these three papers exist, this lecturer teaches these courses --
 * it is asserted by name, which is both stricter and stable.
 *
 * This is the lesson the question-bank check above already learned, applied to
 * the rest of the file rather than to one line of it.
 */

/** The demo as seeded. Growth is fine; loss is not. */
const SEEDED = {
  students: 1440, faculty: 3, courses: 63, enrolments: 1440, alphaCse: 60,
  papers: ['Mid-term examination', 'Coding', 'Alpha-CSE only'],
  raoTeaches: ['PY122', 'WD101'],
};

/** A count that came back as exactly the PostgREST page size is the bug. */
const notTruncated = (n) => Number(n) !== 1000;

const overview = (await call(base, { token: pt })).data;
const students = Number(overview?.members_by_role?.student);
check('the overview counts every student',
  students >= SEEDED.students && notTruncated(students)
  && Number(overview?.members_by_role?.faculty) >= SEEDED.faculty,
  students.toLocaleString('en-IN') + ' students, '
  + overview?.members_by_role?.faculty + ' faculty');
const courseCount = Number(overview?.counts?.courses);
const enrolCount = Number(overview?.counts?.enrollments);
check('and every course',
  courseCount >= SEEDED.courses && enrolCount >= SEEDED.enrolments
  && notTruncated(courseCount) && notTruncated(enrolCount),
  courseCount + ' courses, ' + enrolCount + ' enrolments');

const academics = (await call(base + '/academics?limit=200', { token: pt })).data;
const exams = academics?.exams ?? [];
const banks = (await call(base + '/banks', { token: pt })).data ?? [];
// By name rather than by count: these three must be there, and a fourth
// somebody scheduled while trying the product is not a regression.
const missingPapers = SEEDED.papers.filter(
  (name) => !exams.some((e) => String(e.title).includes(name)));
check('Exam schedule lists the sittings', missingPapers.length === 0,
  exams.length + ' papers' + (missingPapers.length ? ', MISSING ' + missingPapers.join(', ') : '')
  + ' — ' + exams.map((e) => e.title.replace(/^[A-Z ]+— /, '')).join(' · '));
// A count, not an exact total: banks accumulate as the institution is used,
// and asserting "exactly four" made this fail the first time somebody added a
// fifth -- which is a demo being used, not a product breaking.
check('Exam paper lists the banks, with their sets',
  banks.length >= 4 && banks.filter((b) => Number(b.set_count) === 10).length >= 3
  && banks.every((b) => b.set_count !== undefined),
  banks.length + ' banks, ' + banks.filter((b) => Number(b.set_count) === 10).length
  + ' of ten sets');

const online = exams.filter((e) => e.assessment_id != null);
/*
 * The claim is that a paper sat in a browser is DISTINGUISHABLE from one sat
 * on paper -- it carries an assessment_id. Counting them was a proxy; naming
 * the seeded three and requiring each to carry one says it directly.
 */
const seededOnline = SEEDED.papers
  .map((name) => exams.find((e) => String(e.title).includes(name)))
  .filter(Boolean);
check('Invigilate can tell which sittings are sat in a browser',
  seededOnline.length === SEEDED.papers.length
  && seededOnline.every((e) => e.assessment_id != null),
  online.length + ' of ' + exams.length + ' sat online');
const python = exams.find((e) => /Mid-term examination/.test(e.title));
const coding = exams.find((e) => /Coding/.test(e.title));
const webdev = exams.find((e) => /Alpha-CSE only/.test(e.title));
check('and which one is set for a single division',
  exams.filter((e) => e.section_id != null).length === 1,
  'section ' + webdev?.section_id);

const queue = (await call(base + '/proctor/queue', { token: pt })).data;
check('the invigilation queue answers for this institution', Array.isArray(queue),
  (queue ?? []).length + ' attempts');

// ===========================================================================

startPhase('2. the administrator looks for who is on what');

const at = await login('admin@' + DOMAIN, STAFF_PW);
check('the administrator signs in', Boolean(at), 'admin@' + DOMAIN);

const sections = ((await call(base + '/sections', { token: pt })).data ?? [])
  .filter((sx) => sx.status === 1).sort((a, b) => Number(a.sort) - Number(b.sort));
check('24 divisions, in the original’s order', sections.length === 24,
  sections[0].name + ' → ' + sections[23].name);

const alpha = sections.find((sx) => sx.name === 'Alpha-CSE');
const inAlpha = (await call(base + '/people?role=student&section_id=' + alpha.id
  + '&limit=200', { token: pt })).data;
// Named "at least sixty" now: a division that GAINS a student is a division
// somebody enrolled into, and a division that LOSES one is the defect.
check('a division still holds its sixty',
  Number(inAlpha?.total) >= SEEDED.alphaCse && notTruncated(inAlpha?.total),
  inAlpha?.total + ' in ' + alpha.name);
check('and every one of them is numbered',
  (inAlpha?.people ?? []).every((p) => p.roll_number),
  (inAlpha?.people ?? [])[0]?.roll_number);

const pythonCourse = (academics?.courses ?? []).find((c) => c.code === 'PY122');
const webCourse = (academics?.courses ?? []).find((c) => c.code === 'WD101');
const roster = (await call(base + '/courses/' + pythonCourse.id + '/roster',
  { token: pt })).data;
const onCourse = roster?.enrollments ?? roster?.roster ?? roster ?? [];
check('the superadmin sees EVERY enrolment, not the first thousand',
  Array.isArray(onCourse) && onCourse.length >= SEEDED.enrolments
  && notTruncated(onCourse.length),
  onCourse.length + ' on ' + pythonCourse.code);
const webRoster = (await call(base + '/courses/' + webCourse.id + '/roster',
  { token: pt })).data ?? [];
check('Web Development is left all but empty, so enrolling has something to do',
  webRoster.length < 50,
  webCourse.code + ' has ' + webRoster.length + ' against ' + pythonCourse.code
  + '’s ' + onCourse.length);

// ===========================================================================

startPhase('3. the lecturer finds their own teaching');

/*
 * Assigned here rather than assumed.
 *
 * Faculty are course-scoped everywhere -- a lecturer sees the courses they
 * teach, not the institution's 63 -- and the seed created three lecturers and
 * gave them nothing to teach, so all three signed in to an empty screen. That
 * is a hole in the demo, not a bug in the product, and this is where it is
 * filled: Dr Rao takes both open courses.
 */
const faculty = (await call(base + '/people?role=faculty&limit=200', { token: pt }))
  .data?.people ?? [];
const rao = faculty.find((f) => String(f.email) === 'faculty1@' + DOMAIN);
for (const course of [pythonCourse, webCourse]) {
  await call(base + '/courses/' + course.id + '/faculty',
    { method: 'POST', token: pt, body: { user_id: rao.user_id } });
}
const ft = await login('faculty1@' + DOMAIN, STAFF_PW);
check('the lecturer signs in', Boolean(ft), 'faculty1@' + DOMAIN);

const mine = (await call('/api/onyx/my/courses', { token: ft })).data ?? [];
// The two courses just assigned above, by code. A third course somebody gave
// Dr Rao while using the demo does not make this check's claim untrue.
const codes = mine.map((c) => c.code);
check('and sees the courses they teach',
  SEEDED.raoTeaches.every((c) => codes.includes(c)),
  codes.join(' ') || 'nothing');

const facultyBanks = (await call('/api/onyx/banks', { token: ft })).data ?? [];
check('the bank listing tells them the sets and the marking',
  facultyBanks.length >= 4
  && facultyBanks.every((b) => b.set_count !== undefined && b.needs_marking !== undefined),
  facultyBanks.length + ' banks, every one reporting its sets and its marking');

const facultySections = (await call('/api/onyx/sections', { token: ft })).data ?? [];
check('and can set a paper for one division', facultySections.length === 24,
  facultySections.length + ' to choose from');

const facultyExams = (await call('/api/onyx/exams', { token: ft })).data ?? [];
check('the lecturer sees the scheduled sittings', facultyExams.length >= 3,
  facultyExams.length + ' sittings');

const facultyQueue = (await call('/api/onyx/proctor/queue', { token: ft })).data;
check('and the invigilation queue for their own papers', Array.isArray(facultyQueue),
  (facultyQueue ?? []).length + ' attempts');

// ===========================================================================

startPhase('4. a candidate signs in, enrols, and sits the examination');

/** Three from three different divisions, so the sets can be compared. */
const sitters = [
  { email: 'alpha-cse.005@' + DOMAIN, roll: 'MRD-ALPHA-CSE-005', section: 'Alpha-CSE' },
  { email: 'beta-cse.005@' + DOMAIN, roll: 'MRD-BETA-CSE-005', section: 'Beta-CSE' },
  { email: 'gamma-it.012@' + DOMAIN, roll: 'MRD-GAMMA-IT-012', section: 'gamma-IT' },
];
for (const s of sitters) s.token = await login(s.email, STUDENT_PW);
check('three candidates from three divisions sign in', sitters.every((s) => s.token),
  sitters.map((s) => s.roll).join(' '));

/*
 * These three are put back as they were before the walk starts.
 *
 * A paper allows one attempt, and enrolling somebody who is already enrolled
 * is refused -- both correct, and both mean a second run of this file would
 * fail at the first step with "you have used all your attempts" and prove
 * nothing about the product. So their attempts on the three papers are
 * removed and their Web Development enrolment withdrawn, which is exactly the
 * state a fresh candidate is in. Only these three are touched, by user id.
 */
const { withDb } = await import('../tests/e2e/harness.ts');
const papers = [python.assessment_id, coding.assessment_id, webdev.assessment_id]
  .filter(Boolean).map(Number);
await withDb(async (db) => {
  const emails = sitters.map((s) => s.email);
  const ids = (await db.query(
    'SELECT u.id FROM public."onyx_users" u WHERE lower(u.email) = ANY($1)',
    [emails])).rows.map((r) => r.id);
  await db.query(
    'DELETE FROM public."onyx_assessment_answers" WHERE tenant_id = $1'
    + '   AND attempt_id IN (SELECT id FROM public."onyx_assessment_attempts"'
    + '                       WHERE tenant_id = $1 AND user_id = ANY($2)'
    + '                         AND assessment_id = ANY($3))',
    [TID, ids, papers]);
  await db.query(
    'DELETE FROM public."onyx_proctor_events" WHERE tenant_id = $1'
    + '   AND attempt_id IN (SELECT id FROM public."onyx_assessment_attempts"'
    + '                       WHERE tenant_id = $1 AND user_id = ANY($2)'
    + '                         AND assessment_id = ANY($3))',
    [TID, ids, papers]);
  const gone = await db.query(
    'DELETE FROM public."onyx_assessment_attempts"'
    + ' WHERE tenant_id = $1 AND user_id = ANY($2) AND assessment_id = ANY($3)',
    [TID, ids, papers]);
  const off = await db.query(
    'DELETE FROM public."onyx_enrollments"'
    + ' WHERE tenant_id = $1 AND course_id = $2 AND user_id = ANY($3)',
    [TID, Number(webCourse.id), ids]);
  console.log('   reset: ' + gone.rowCount + ' old attempts, '
    + off.rowCount + ' Web Development enrolments withdrawn');
});

const me = (await call('/api/onyx/me', { token: sitters[0].token })).data;
check('a candidate’s own record names their division and their number',
  Boolean(me?.section?.name) && Boolean(me?.roll_number),
  (me?.section?.name ?? 'no section') + ' · ' + me?.roll_number);

const catalogue = (await call('/api/onyx/courses', { token: sitters[0].token })).data ?? [];
check('they can see the institution’s courses', catalogue.length > 0,
  catalogue.length + ' visible');

// The enrol button, exercised: Web Development is open and they are not on it.
const joined = await call('/api/onyx/courses/' + webCourse.id + '/enroll',
  { method: 'POST', token: sitters[0].token, body: {} });
check('and can enrol themselves in an open course',
  joined.status === 200, webCourse.code + ' → ' + (joined.message ?? joined.status));

const timetable = (await call('/api/onyx/exams', { token: sitters[0].token })).data ?? [];
check('the examination is on their own timetable',
  timetable.some((e) => Number(e.id) === Number(python.id)),
  timetable.length + ' sittings listed');

const sat = [];
for (const s of sitters) {
  const go = await call('/api/onyx/assessments/' + python.assessment_id + '/start',
    { method: 'POST', token: s.token, body: { consent: true } });
  sat.push({
    ...s,
    attempt: go.data?.id,
    questions: go.data?.questions ?? [],
    status: go.status,
    message: go.message,
  });
}
check('each is dealt a full paper of ten', sat.every((s) => s.questions.length === 10),
  sat.map((s) => s.questions.length).join(',') + '  ' + (sat[0].message ?? ''));

/*
 * The rotation is by ROLL ORDINAL, and that is the point.
 *
 * Roll 005 of Alpha-CSE and roll 005 of Beta-CSE therefore sit the same set --
 * and should. They are in different halls; the guarantee the arrangement
 * exists for is that neighbours within reach of each other differ, and
 * neighbours are numbered consecutively. An earlier version of this check
 * asserted all three differed, which asserted the opposite of the design.
 */
const setOf = (s) => String(s.questions[0]?.prompt ?? '').match(/Set (\d+)/)?.[1];
check('the set follows the roll number, not the division',
  setOf(sat[0]) === setOf(sat[1]) && setOf(sat[0]) === '5',
  'roll 005 sits set ' + setOf(sat[0]) + ' in both divisions');
check('and a different roll sits a different set',
  setOf(sat[2]) !== setOf(sat[0]),
  'roll 012 → set ' + setOf(sat[2]) + ', roll 005 → set ' + setOf(sat[0]));

// Answered properly: every question keyed 'b', the multiples ['a','b'], the
// true/false 'true', the short answer the topic. So the score is a real score.
for (const s of sat) {
  for (const q of s.questions) {
    const response = q.type === 'multiple' ? ['a', 'b']
      : q.type === 'truefalse' ? 'true'
        : q.type === 'short' ? 'python'
          : 'b';
    await call('/api/onyx/attempts/' + s.attempt + '/answer', {
      method: 'POST', token: s.token,
      body: { question_id: Number(q.question_id ?? q.id), response },
    });
  }
  const handed = await call('/api/onyx/attempts/' + s.attempt + '/submit',
    { method: 'POST', token: s.token, body: {} });
  s.handed = handed.status === 200;
  s.result = handed.data;
}
check('all three hand in', sat.every((s) => s.handed), sat.map((s) => s.attempt).join(' '));

const own = (await call('/api/onyx/attempts/' + sat[0].attempt, { token: sat[0].token })).data;
check('a candidate reads their own marked paper back',
  own?.status === 'published' && Number(own?.score) > 0,
  own?.score + ' / ' + own?.max_score + '  (' + own?.status + ')');

const ownPdf = await pdf('/api/onyx/attempts/' + sat[0].attempt + '/script.pdf', sat[0].token);
check('and downloads their own script as a PDF',
  ownPdf.status === 200 && ownPdf.isPdf && /attachment/.test(ownPdf.disposition),
  ownPdf.bytes + ' bytes, ' + ownPdf.type);

const notYours = await pdf('/api/onyx/attempts/' + sat[1].attempt + '/script.pdf', sat[0].token);
check('but not somebody else’s', notYours.status === 403 || notYours.status === 404,
  'HTTP ' + notYours.status);

// ===========================================================================

startPhase('5. the lecturer marks and reports');

const submissions = (await call('/api/onyx/assessments/' + python.assessment_id + '/marking',
  { token: ft })).data ?? [];
check('the submissions table lists everybody who handed in', submissions.length >= 3,
  submissions.length + ' scripts');
check('by name, roll number and division',
  submissions.slice(0, 3).every((r) => r.candidate && r.roll_number && r.section),
  submissions[0]?.roll_number + ' · ' + submissions[0]?.section);

const bundle = await pdf('/api/onyx/assessments/' + python.assessment_id + '/scripts.pdf', ft);
check('“download all” returns one document with every script',
  bundle.status === 200 && bundle.isPdf, bundle.bytes + ' bytes');

const one = await pdf('/api/onyx/attempts/' + sat[1].attempt + '/marker-script.pdf', ft);
check('and one row returns one script', one.status === 200 && one.isPdf,
  one.bytes + ' bytes');

// ===========================================================================

startPhase('6. the operator reads the sitting back');

const sitting = (await call(base + '/exams/' + python.id, { token: pt })).data;
const wholeRegister = sitting?.register ?? [];
/*
 * The candidates who HANDED IN.
 *
 * A register legitimately lists somebody who opened the paper and is still on
 * it -- that row has no mark yet, by definition, and the three checks below
 * are all about the marks. Filtering here rather than asserting a row count
 * keeps the claims about marking true whether or not somebody happens to be
 * mid-paper when the suite runs; the count is asserted as a floor beside it,
 * because the three who sat must still be there.
 */
const register = wholeRegister.filter((r) => r.score !== null);
check('every candidate who handed in is on the register', register.length >= 3,
  register.length + ' handed in of ' + wholeRegister.length + ' on the sheet');
check('with name, roll number, division, marks and result',
  register.every((r) => r.name && r.roll_number && r.section
    && r.score !== null && r.result !== null),
  register.map((r) => r.roll_number.slice(-3) + '=' + r.score + '/' + r.max_score
    + ' ' + r.result).join('  '));
check('in roll order across divisions',
  register.map((r) => r.roll_number).join(' ')
  === [...register.map((r) => r.roll_number)]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(' '),
  register.map((r) => r.section).join(' · '));

const consolePdf = await pdf(base + '/attempts/' + sat[2].attempt + '/script.pdf', pt);
check('the console can download any script', consolePdf.status === 200 && consolePdf.isPdf,
  consolePdf.bytes + ' bytes');
const examBundle = await pdf(base + '/exams/' + python.id + '/scripts.pdf', pt);
check('and every script on the sitting at once',
  examBundle.status === 200 && examBundle.isPdf, examBundle.bytes + ' bytes');

// The result, which had been null for every online sitting: the ledger has no
// row for a paper sat in a browser, and only the ledger was being read.
check('pass or fail is decided from the mark the candidate actually has',
  register.every((r) => r.result === 'pass'),
  register.map((r) => r.score + '/' + r.max_score + '→' + r.result).join('  '));

// ===========================================================================

startPhase('7. the coding examination, and a division-only one');

const codeGo = await call('/api/onyx/assessments/' + coding.assessment_id + '/start',
  { method: 'POST', token: sitters[1].token, body: { consent: true } });
const codeQs = codeGo.data?.questions ?? [];
check('a candidate is dealt a coding paper', codeQs.length === 3,
  codeQs.map((q) => q.type).join(' '));
const codeQ = codeQs.find((q) => q.type === 'code');
check('with a real Code Lab problem behind the code question',
  Boolean(codeQ?.problem?.id) && Boolean(codeQ?.problem?.title),
  codeQ?.problem?.title);

/*
 * Enrolled first, on purpose.
 *
 * Without it the refusal comes from the enrolment rule -- "you are not on this
 * course" -- which proves nothing about divisions. The claim is that somebody
 * who IS on the course is still refused a paper set for another division.
 */
await call('/api/onyx/courses/' + webCourse.id + '/enroll',
  { method: 'POST', token: sitters[1].token, body: {} });
const wrongDivision = await call('/api/onyx/assessments/' + webdev.assessment_id + '/start',
  { method: 'POST', token: sitters[1].token, body: { consent: true } });
check('a division-only paper refuses somebody on the course from another division',
  wrongDivision.status === 403 && /another section/i.test(wrongDivision.message ?? ''),
  wrongDivision.status + ' ' + (wrongDivision.message ?? '').slice(0, 44));
const rightDivision = await call('/api/onyx/assessments/' + webdev.assessment_id + '/start',
  { method: 'POST', token: sitters[0].token, body: { consent: true } });
check('and deals it to the division it is set for',
  (rightDivision.data?.questions ?? []).length === 10,
  (rightDivision.data?.questions ?? []).length + ' questions to Alpha-CSE');

// That one is left open rather than handed in, so somebody testing by hand
// finds a paper in progress on the invigilation console.
const liveQueue = (await call(base + '/proctor/queue?assessment_id=' + webdev.assessment_id,
  { token: pt })).data ?? [];
check('and the invigilation console sees it being sat, by name',
  liveQueue.some((r) => r.status === 'in_progress' && (r.roll_number || r.name)),
  liveQueue.map((r) => r.roll_number ?? '?').join(' '));

// ===========================================================================

startPhase('8. what is left behind, on purpose');

console.log('   three handed-in scripts on the Python mid-term, one paper in progress');
console.log('   on the Web Development sitting, and one coding attempt open.');
console.log('   A submissions table with nothing in it looks broken; this one will not.');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(80));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const x of failed) console.log('  FAIL [' + x.phase + '] ' + x.label + ' -- ' + x.detail);
process.exit(failed.length ? 1 : 0);
