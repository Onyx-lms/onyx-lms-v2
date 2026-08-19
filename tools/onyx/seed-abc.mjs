/**
 * ABC Institution, with a term behind it.
 *
 * `seed-demo.mjs` builds this tenant's *people* -- one account per role and a
 * single Code Lab problem -- and stops there, deliberately. That leaves the
 * institution every role guide in docs/roles/ points at with no academic record
 * at all: no programme, no courses, no papers, no exam calendar, no timetable.
 * Signing in as student@demo.onyx showed seven zeroes.
 *
 * This fills that in, for the areas that make the product legible: taught
 * courses with content and work handed in, question banks and sat papers, a
 * Code Lab practice set with real submissions, an examination calendar with
 * seating and published marks, and a weekly timetable.
 *
 * It does NOT touch fees, careers, guardians or support -- seed-full.mjs covers
 * those for Meridian and Ashcroft, and they are not what this tenant was
 * missing.
 *
 * Everything goes through the HTTP API, for the reason the other seeders give:
 * the service layer is where the invariants live (publish rules, clash checks,
 * assertCanTeach, roster membership), and writing rows underneath it
 * reproduces those rules by hand and drifts from them silently.
 *
 * Usage
 *   node tools/onyx/seed-abc.mjs --api https://onyx-lms-v2.vercel.app
 *   node tools/onyx/seed-abc.mjs                  (defaults to 127.0.0.1:5173)
 *
 * Idempotent by natural key -- programme code, course code, problem slug, room
 * code, exam title, and (day, time, course) for a timetable slot. A re-run
 * after a partial failure resumes rather than duplicating, and a completed run
 * is a no-op. That property is load-bearing: this makes several hundred
 * requests against a remote API and *will* be interrupted.
 *
 * The tenant must already exist -- run seed-demo.mjs first if it does not.
 */

const API = (() => {
  const i = process.argv.indexOf('--api');
  return (i === -1 ? 'http://127.0.0.1:5173' : process.argv[i + 1]).replace(/\/+$/, '');
})();

const PW = 'Demo#2026!';
const TENANT_SLUG = 'abc-institution';
const ADMIN = { email: 'admin@demo.onyx', password: PW };

// ---------------------------------------------------------------- transport

let calls = 0;
async function call(path, { method, body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  calls += 1;
  const res = await fetch(API + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, ok: res.ok && json.ok !== false, body: json, data: json.data };
}

function die(what, r) {
  console.error('\nFAILED: ' + what + '\n  HTTP ' + r.status + '  ' + JSON.stringify(r.body).slice(0, 400));
  process.exit(1);
}

/** POST that dies on failure and returns `data`. */
async function post(what, path, body, token) {
  const r = await call(path, { body, token });
  if (!r.ok) die(what, r);
  return r.data;
}

const get = async (path, token) => (await call(path, { token })).data ?? [];

const step = (s) => process.stdout.write('  ' + s.padEnd(50));
const done = (n) => process.stdout.write(String(n) + '\n');

// -------------------------------------------------------------------- dates

const DAY = 86_400_000;
const at = (days, hour = 10, minute = 0) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const dateOnly = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

// ------------------------------------------------------------- the fixtures

const DOMAIN = 'demo.onyx';

/** Already present from seed-demo.mjs; named here so their rows can be found. */
const EXISTING = { faculty: 'faculty@demo.onyx', exams: 'exams@demo.onyx', student: 'Sam Student' };

/** A second teacher, so "taught by" is a column with more than one value in it. */
const EXTRA_FACULTY = { name: 'Dr. Hari Menon', email: 'hari.menon@demo.onyx' };

/**
 * The cohort. Sam Student comes first because that is the account every role
 * guide tells a reader to sign in as, and it should be the one with the fullest
 * history rather than an empty account beside eleven populated ones.
 */
const STUDENTS = [
  'Sam Student', 'Aarav Sharma', 'Diya Menon', 'Kabir Nair', 'Isha Reddy',
  'Rehan Qureshi', 'Tara Iyer', 'Yash Patel', 'Naina Bose', 'Arjun Rao',
  'Zoya Khan', 'Manav Gupta',
];

const PROGRAM = { name: 'B.Sc. Computer Science', code: 'ABCS', duration_semesters: 6 };
const SEMESTER = { name: 'Semester 4', number: 4 };
const BATCH = { name: 'CS 2024 intake', code: 'ABC24', year: 2024 };

/**
 * `facultyIndex` is into the faculty list, and the timetable below reads the
 * same value: a slot taught by somebody who is not on the course would pass the
 * clash check and still be wrong.
 */
const COURSES = [
  { code: 'ABC101', title: 'Programming Fundamentals', credits: 4, publish: true, facultyIndex: 0 },
  { code: 'ABC102', title: 'Data Structures and Algorithms', credits: 4, publish: true, facultyIndex: 1 },
  { code: 'ABC103', title: 'Database Management Systems', credits: 3, publish: true, facultyIndex: 0 },
  { code: 'ABC201', title: 'Web Application Development', credits: 3, publish: true, facultyIndex: 1 },
  // Sold rather than assigned: a published course a learner buys before they
  // can start it, so the locked/price/purchase path has something real behind
  // it. INR 1,499.00, in paise like every other amount in this product.
  { code: 'ABC301', title: 'Cloud and DevOps', credits: 4, publish: true, facultyIndex: 1,
    access: 'locked', price_minor: 149_900 },
  // Left in draft on purpose: the draft-visibility rule is only observable when
  // a draft actually exists, and a reviewer should be able to see this one from
  // the faculty side and confirm it is absent from the student's.
  { code: 'ABC302', title: 'Advanced Database Systems', credits: 3, publish: false,
    facultyIndex: 0 },
];

/** The Code Lab practice set. `source` is a solution that passes its own tests. */
const PROBLEMS = [
  {
    slug: 'abc-sum-two-numbers', title: 'Sum two numbers', difficulty: 'easy', topic: 'basics',
    statement: 'Read two integers on one line and print their sum.',
    source: 'import sys\nprint(sum(int(x) for x in sys.stdin.read().split()))\n',
    tests: [
      { name: 'small', stdin: '2 3\n', expected_stdout: '5', is_hidden: false, weight: 1 },
      { name: 'large', stdin: '1000 2500\n', expected_stdout: '3500', is_hidden: true, weight: 1 },
    ],
  },
  {
    slug: 'abc-reverse-a-string', title: 'Reverse a string', difficulty: 'easy', topic: 'strings',
    statement: 'Read one line and print it reversed.',
    source: 'print(input()[::-1])\n',
    tests: [
      { name: 'word', stdin: 'onyx\n', expected_stdout: 'xyno', is_hidden: false, weight: 1 },
      { name: 'phrase', stdin: 'abc institution\n', expected_stdout: 'noitutitsni cba', is_hidden: true, weight: 1 },
    ],
  },
  {
    slug: 'abc-count-vowels', title: 'Count the vowels', difficulty: 'medium', topic: 'strings',
    statement: 'Read one line and print how many vowels it contains.',
    source: 'print(sum(c in "aeiou" for c in input().lower()))\n',
    tests: [
      { name: 'phrase', stdin: 'data structures\n', expected_stdout: '5', is_hidden: false, weight: 1 },
    ],
  },
  {
    slug: 'abc-fizzbuzz', title: 'FizzBuzz to N', difficulty: 'easy', topic: 'basics',
    statement: 'Read N and print the FizzBuzz sequence from 1 to N, one entry per line.',
    source: 'n = int(input())\nfor i in range(1, n + 1):\n'
      + '    print("FizzBuzz" if i % 15 == 0 else "Fizz" if i % 3 == 0'
      + ' else "Buzz" if i % 5 == 0 else i)\n',
    tests: [
      { name: 'to five', stdin: '5\n', expected_stdout: '1\n2\nFizz\n4\nBuzz', is_hidden: false, weight: 1 },
    ],
  },
  {
    slug: 'abc-binary-search', title: 'Binary search', difficulty: 'hard', topic: 'algorithms',
    statement: 'Given a sorted list on the first line and a target on the second, '
      + 'print the index of the target or -1.',
    source: 'import bisect\nxs = [int(x) for x in input().split()]\nt = int(input())\n'
      + 'i = bisect.bisect_left(xs, t)\nprint(i if i < len(xs) and xs[i] == t else -1)\n',
    tests: [
      { name: 'found', stdin: '1 3 5 7\n5\n', expected_stdout: '2', is_hidden: false, weight: 2 },
      { name: 'missing', stdin: '1 3 5 7\n4\n', expected_stdout: '-1', is_hidden: true, weight: 2 },
    ],
  },
];

const ROOMS = [
  { code: 'ABC-A1', name: 'Lecture Room A1', capacity: 60, kind: 'lecture' },
  { code: 'ABC-A2', name: 'Lecture Room A2', capacity: 60, kind: 'lecture' },
  { code: 'ABC-B1', name: 'Computing Lab B1', capacity: 40, kind: 'lab' },
];

/**
 * The week, written out rather than generated.
 *
 * A generated grid satisfies the clash check by accident. This is the timetable
 * a registrar would actually build -- two or three contacts a week per taught
 * course, the long slots in the lab, one cohort so nothing overlaps itself, and
 * no teacher in two rooms at once. Written out so that a clash, if one ever
 * appears, is a fault in the product's checker and not in arithmetic here.
 *
 * day: 1 = Monday. `room` indexes ROOMS; `course` is a course code.
 */
const WEEK = [
  { day: 1, from: '09:00', to: '10:00', course: 'ABC101', room: 0 },
  { day: 1, from: '10:15', to: '11:15', course: 'ABC102', room: 0 },
  { day: 1, from: '11:30', to: '12:30', course: 'ABC103', room: 1 },
  { day: 2, from: '09:00', to: '10:00', course: 'ABC201', room: 1 },
  { day: 2, from: '10:15', to: '12:15', course: 'ABC101', room: 2 },
  { day: 3, from: '09:00', to: '10:00', course: 'ABC102', room: 0 },
  { day: 3, from: '10:15', to: '11:15', course: 'ABC103', room: 1 },
  { day: 4, from: '09:00', to: '11:00', course: 'ABC102', room: 2 },
  { day: 4, from: '11:15', to: '12:15', course: 'ABC201', room: 1 },
  { day: 5, from: '09:00', to: '10:00', course: 'ABC101', room: 0 },
  { day: 5, from: '10:15', to: '11:15', course: 'ABC201', room: 1 },
];

/**
 * Exam marks, as a spread rather than a formula.
 *
 * `38 + (i * 11) % 55` -- the arithmetic the other seeders use -- has a period
 * of five over twelve candidates and no dependence on the paper, so every exam
 * in the institution ends up with the same five marks repeated, and a class
 * average that is identical in every subject. Nothing that looks at a
 * distribution can be judged on that.
 *
 * Twelve values, rotated by five per paper, gives every candidate a different
 * profile across their subjects while keeping a couple of fails in the range
 * (pass is 40) so the fail branch, and the resits below, have somebody in them.
 */
const MARKS = [72, 58, 84, 41, 66, 35, 90, 47, 61, 38, 77, 55];

/**
 * How many of the twelve registers each learner misses -- one value per student,
 * in the order they appear in STUDENTS.
 *
 * Attendance is the one figure an institution acts on (a chase list, a bar on
 * sitting the paper), so it has to separate people: most turn up, several miss
 * a session, two have a real problem. Sam Student is first and misses none,
 * because that is the account a reader is told to sign in as.
 */
const ABSENCES = [0, 1, 0, 2, 1, 3, 0, 1, 4, 2, 0, 1];

const emailFor = (name) =>
  name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean).join('.') + '@' + DOMAIN;

// ============================================================================

console.log('\nSeeding ABC Institution at ' + API + '\n');

const adminLogin = await call('/api/onyx/auth/login', { body: ADMIN });
if (!adminLogin.ok) die('sign in as ' + ADMIN.email + ' (run seed-demo.mjs first)', adminLogin);
const admin = adminLogin.data.token;

// Seeding the wrong institution silently is worse than saying so, and every
// natural key below assumes this one.
const me = await get('/api/onyx/me', admin);
const slug = me?.tenant?.slug ?? me?.membership?.tenant?.slug ?? null;
if (slug && slug !== TENANT_SLUG) {
  console.error('  ' + ADMIN.email + ' administers ' + slug + ', not ' + TENANT_SLUG + '.');
  process.exit(1);
}

/**
 * A learner's token, minted once and kept.
 *
 * Not a micro-optimisation: sign-in goes to GoTrue, which rate-limits by IP
 * (30 in 5 minutes by default). Signing in per student per course -- as the
 * earlier seeders do -- puts this run past that on the assignment step alone,
 * and a 429 there is invisible: tokenFor() returns null, the loop skips that
 * learner, and the seed finishes reporting a smaller number without ever
 * saying why. Twelve accounts, twelve sign-ins.
 *
 * The 429 that can still happen is retried once, slowly, rather than dropped.
 */
const tokens = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tokenFor = async (email) => {
  if (tokens.has(email)) return tokens.get(email);
  let r = await call('/api/onyx/auth/login', { body: { email, password: PW } });
  if (r.status === 429) {
    console.log('\n    rate-limited signing in as ' + email + '; waiting 60s');
    await sleep(60_000);
    r = await call('/api/onyx/auth/login', { body: { email, password: PW } });
  }
  const token = r.ok ? r.data.token : null;
  if (!token) console.log('\n    could not sign in as ' + email + ' (HTTP ' + r.status + ')');
  tokens.set(email, token);
  return token;
};

// ---- people ----------------------------------------------------------------
// The existing seven accounts are left exactly as they are; only the cohort and
// the second teacher are added, because a single student cannot show a roster,
// a mark distribution or a marking queue.
step('people');
const roster = await get('/api/onyx/members', admin);
const byEmail = new Map((roster ?? [])
  .map((m) => [(m.user?.email ?? '').toLowerCase(), m.user_id ?? m.user?.id]));

const ensureMember = async (name, email, role, rollNumber) => {
  const existing = byEmail.get(email.toLowerCase());
  if (existing) return { id: existing, created: false };
  const made = await post('add ' + role + ' ' + email, '/api/onyx/members',
    { name, email, password: PW, role, ...(rollNumber ? { roll_number: rollNumber } : {}) }, admin);
  const id = made.user?.id ?? made.user_id ?? made.id;
  byEmail.set(email.toLowerCase(), id);
  return { id, created: true };
};

let newAccounts = 0;
const facultyIds = [];
const firstFaculty = byEmail.get(EXISTING.faculty);
if (firstFaculty) facultyIds.push(firstFaculty);
const second = await ensureMember(EXTRA_FACULTY.name, EXTRA_FACULTY.email, 'faculty');
if (second.created) newAccounts += 1;
facultyIds.push(second.id);

const studentIds = [];
const studentEmails = [];
for (const [i, name] of STUDENTS.entries()) {
  const email = name === EXISTING.student ? 'student@demo.onyx' : emailFor(name);
  const r = await ensureMember(name, email, 'student',
    BATCH.code + '-' + String(i + 1).padStart(3, '0'));
  if (r.created) newAccounts += 1;
  studentIds.push(r.id);
  studentEmails.push(email);
}
done(studentIds.length + ' students, ' + facultyIds.length + ' faculty (' + newAccounts + ' new)');

// ---- academic structure ----------------------------------------------------
step('programme, semester, batch');
const programs = await get('/api/onyx/programs', admin);
let program = (programs ?? []).find((p) => p.code === PROGRAM.code);
if (!program) program = await post('programme', '/api/onyx/programs', PROGRAM, admin);

const semesters = await get('/api/onyx/semesters?program_id=' + program.id, admin);
let semester = (semesters ?? []).find((s) => s.number === SEMESTER.number);
if (!semester) {
  semester = await post('semester', '/api/onyx/semesters', {
    program_id: Number(program.id), name: SEMESTER.name, number: SEMESTER.number,
    starts_on: dateOnly(-60), ends_on: dateOnly(60),
  }, admin);
}

const batches = await get('/api/onyx/batches?program_id=' + program.id, admin);
let batch = (batches ?? []).find((b) => b.code === BATCH.code);
if (!batch) {
  batch = await post('batch', '/api/onyx/batches',
    { program_id: Number(program.id), ...BATCH }, admin);
}

const batchMembers = await get('/api/onyx/batches/' + batch.id + '/members', admin);
const inBatch = new Set((batchMembers ?? []).map((m) => String(m.user_id)));
const toAdd = studentIds.filter((id) => !inBatch.has(String(id)));
if (toAdd.length) {
  await post('batch members', '/api/onyx/batches/' + batch.id + '/members',
    { user_ids: toAdd }, admin);
}
done(program.code + ' / ' + semester.name + ' / ' + batch.code);

// ---- courses ---------------------------------------------------------------
step('courses');
const existingCourses = await get('/api/onyx/courses?all=1', admin);
const courses = [];
for (const spec of COURSES) {
  let course = (existingCourses ?? []).find((c) => c.code === spec.code);
  const facultyId = facultyIds[spec.facultyIndex % facultyIds.length];
  if (!course) {
    course = await post('course ' + spec.code, '/api/onyx/courses', {
      code: spec.code, title: spec.title, credits: spec.credits,
      program_id: Number(program.id), semester_id: Number(semester.id),
      description: spec.title + ' for ' + PROGRAM.name + ', ' + SEMESTER.name + '.',
      ...(spec.access ? { access: spec.access } : {}),
      ...(spec.price_minor ? { price_minor: spec.price_minor } : {}),
    }, admin);
    if (facultyId) {
      await call('/api/onyx/courses/' + course.id + '/faculty',
        { body: { user_id: facultyId }, token: admin });
    }
    if (spec.publish) {
      await call('/api/onyx/courses/' + course.id + '/publish', { method: 'POST', token: admin });
    }
    // The draft one gets the cohort too: a draft course a batch is already
    // enrolled on is the state a registrar actually creates, and it leaves the
    // visibility rule as the only reason a student cannot see it.
    //
    // A LOCKED course does not: enrolling the batch onto something they are
    // meant to buy would leave nobody able to see the price, which is the one
    // thing that course exists to show.
    if (spec.access !== 'locked') {
      await call('/api/onyx/courses/' + course.id + '/enroll',
        { body: { batch_id: Number(batch.id) }, token: admin });
    }
  }
  courses.push({ ...course, spec, facultyId });
}
const live = courses.filter((c) => c.spec.publish);
done(courses.length + ' (' + (courses.length - live.length) + ' draft)');

// ---- content ---------------------------------------------------------------
step('modules and lessons');
let lessonCount = 0;
for (const course of courses) {
  const outline = (await call('/api/onyx/courses/' + course.id + '/outline', { token: admin })).data;
  if ((outline?.modules ?? []).length) {
    lessonCount += (outline.modules ?? []).reduce((n, m) => n + (m.lessons?.length ?? 0), 0);
    continue;
  }
  for (const [wi, unit] of ['Foundations', 'Core techniques', 'Applied work'].entries()) {
    const mod = await post('module', '/api/onyx/courses/' + course.id + '/modules',
      { title: 'Unit ' + (wi + 1) + ' — ' + unit, sort: wi }, admin);
    // One of every kind, so every branch of the lesson viewer has something real
    // behind it rather than being reachable only in theory.
    const lessons = [
      { title: unit + ': reading', type: 'text',
        body: 'Notes for ' + unit.toLowerCase() + ' in ' + course.title
          + '.\n\nWork through the examples before the lab session.' },
      { title: unit + ': lecture recording', type: 'video',
        path: 'onyx/demo/' + course.code.toLowerCase() + '-u' + (wi + 1) + '.mp4',
        duration_seconds: 1800 },
      { title: unit + ': slides', type: 'document',
        path: 'onyx/demo/' + course.code.toLowerCase() + '-u' + (wi + 1) + '.pdf' },
      { title: unit + ': reference diagram', type: 'image',
        path: 'onyx/demo/' + course.code.toLowerCase() + '-u' + (wi + 1) + '.png' },
      { title: unit + ': further reading', type: 'link',
        path: 'https://example.org/' + course.code.toLowerCase() + '/' + (wi + 1) },
    ];
    for (const [li, l] of lessons.entries()) {
      await post('lesson', '/api/onyx/modules/' + mod.id + '/lessons',
        { ...l, sort: li, is_preview: wi === 0 && li === 0 }, admin);
      lessonCount += 1;
    }
  }
}
done(lessonCount + ' lessons');

// ---- assignments, submissions, marks ---------------------------------------
// Each stage checks what is already there rather than the stage before it: an
// assignment left half-built by an interrupted run (published, handed in, never
// marked) is finished on the next one instead of being skipped because the
// assignment itself exists.
step('assignments and submissions');
let submitted = 0;
let graded = 0;
for (const course of live) {
  const title = course.title + ' — practical 1';
  const existing = await get('/api/onyx/courses/' + course.id + '/assignments', admin);
  let assignment = (existing ?? []).find((a) => a.title === title);
  if (!assignment) {
    assignment = await post('assignment', '/api/onyx/courses/' + course.id + '/assignments', {
      title, instructions: 'Answer in your own words and show your working.',
      due_at: at(-3, 23, 59), total_points: 100, late_penalty_percent: 10,
      allow_resubmission: true,
    }, admin);
    await call('/api/onyx/assignments/' + assignment.id + '/rubric', {
      method: 'PUT', token: admin,
      body: {
        criteria: [
          { title: 'Correctness', description: 'Does it do the right thing?', points: 60 },
          { title: 'Clarity', description: 'Can somebody else follow it?', points: 40 },
        ],
      },
    });
    await call('/api/onyx/assignments/' + assignment.id + '/publish', { method: 'POST', token: admin });
  }

  // Two thirds hand in, which is what a real deadline looks like -- and it
  // leaves the marking queue with something in it and the chase list too.
  let detail = await get('/api/onyx/assignments/' + assignment.id, admin);
  const handedIn = new Set((detail?.submissions ?? []).map((s) => String(s.user_id)));
  const handIn = studentEmails.slice(0, Math.ceil(studentEmails.length * 0.66));
  for (const [i, email] of handIn.entries()) {
    // Per learner, not per assignment: `allow_resubmission` is on, so
    // re-submitting for somebody who already handed in would add a second
    // attempt on every run rather than being a no-op.
    if (handedIn.has(String(studentIds[i]))) continue;
    const token = await tokenFor(email);
    if (!token) continue;
    const r = await call('/api/onyx/assignments/' + assignment.id + '/submit', {
      token,
      body: {
        body: 'Submission for ' + course.title + ' by ' + STUDENTS[i]
          + '.\n\nApproach: work the smallest case by hand, then generalise.',
      },
    });
    if (r.ok) submitted += 1;
  }

  // Mark and return about half of them, so both "marked" and "waiting" exist.
  detail = await get('/api/onyx/assignments/' + assignment.id, admin);
  const criteria = detail?.rubric ?? [];
  const outOf = criteria.reduce((n, cr) => n + Number(cr.points), 0);
  // Half of the pile, counted against the pile -- not against what is still
  // waiting. Marking "half of whatever is unmarked" would mark another half on
  // every re-run, so a script whose whole contract is idempotency would walk the
  // marking queue to empty over a few runs and lose the waiting state on purpose.
  const all = detail?.submissions ?? [];
  const target = Math.ceil(all.length / 2) - all.filter((s) => s.status !== 'submitted').length;
  const queue = all.filter((s) => s.status === 'submitted');
  for (const [i, sub] of queue.slice(0, Math.max(0, target)).entries()) {
    const total = 58 + ((i * 7) % 35);
    // Against the rubric, criterion by criterion. A flat `score` is refused
    // outright once a rubric exists ("This assignment is graded by rubric"),
    // which is the product being right: two numbers meant to agree eventually
    // will not. The earlier seeders send one anyway, so their grading step
    // 422s on every submission and quietly leaves every mark unset.
    const body = criteria.length
      ? {
        feedback: 'Solid on correctness; tighten the explanation.',
        scores: criteria.map((cr) => ({
          criterion_id: Number(cr.id),
          points: Math.min(Number(cr.points),
            Math.round((total * Number(cr.points)) / (outOf || 100))),
          comment: null,
        })),
      }
      : { score: total, feedback: 'Solid on correctness; tighten the explanation.' };
    const r = await call('/api/onyx/submissions/' + sub.id + '/grade', { token: admin, body });
    if (!r.ok) { console.log('\n    could not grade submission ' + sub.id + ': '
      + JSON.stringify(r.body).slice(0, 160)); continue; }
    await call('/api/onyx/submissions/' + sub.id + '/return', { method: 'POST', token: admin });
    graded += 1;
  }
}
done(submitted + ' submissions, ' + graded + ' marked and returned');

// ---- attendance ------------------------------------------------------------
// Marked by the person who teaches the course, not by the administrator: it is
// faculty who take a register, and doing it as admin would exercise a path
// nobody uses and never touch assertCanTeach.
//
// Three sittings behind each course and one running now. The past ones are
// closed, so self check-in on them is shut -- which is the correct behaviour and
// also why they cannot be checked into. The live one is left open, so the QR
// panel has a session to show and a learner has something to check in to.
step('attendance');
let sessions = 0;
let registers = 0;
let amended = 0;
for (const [ci, course] of live.entries()) {
  const teacher = (await tokenFor(course.facultyId === facultyIds[0]
    ? EXISTING.faculty : EXTRA_FACULTY.email)) ?? admin;
  const held = await get('/api/onyx/courses/' + course.id + '/attendance', admin);
  const byTitle = new Map((held ?? []).map((s) => [s.title, s]));

  for (const [di, d] of [-14, -7, -2].entries()) {
    const title = 'Lecture ' + course.code + ' ' + dateOnly(d);
    // The register, from each learner's own attendance profile rather than from
    // a rotation over the cohort.
    //
    // A rotation looks varied inside any one register and is perfectly flat
    // across the term: every learner passes through every position, so all
    // twelve end on the same percentage and no report can distinguish anybody.
    // ABSENCES gives each learner a different number of missed sessions and the
    // offset spreads them over the twelve registers, so a chase list has the
    // same people on it that a percentage would put there.
    const slot = ci * 3 + di;
    const entries = studentIds.map((id, i) => {
      const away = ABSENCES[i % ABSENCES.length];
      const p = (slot + i * 5) % 12;
      const status = p < away ? (p === 0 ? 'excused' : 'absent')
        : p === away ? 'late' : 'present';
      return {
        user_id: id, status,
        note: status === 'excused' ? 'Medical certificate on file.' : null,
      };
    });

    const existing = byTitle.get(title);
    if (!existing) {
      const s = await post('attendance session', '/api/onyx/courses/' + course.id + '/attendance',
        { title, scheduled_at: at(d, 9 + di), duration_minutes: 60 }, teacher);
      await call('/api/onyx/attendance/' + s.id + '/mark', { token: teacher, body: { entries } });
      await call('/api/onyx/attendance/' + s.id + '/close', { method: 'POST', token: teacher });
      registers += 1;
    } else {
      // A register from an earlier run that disagrees with the one above is
      // amended -- the same call faculty use to correct a mark they got wrong,
      // and only for the rows that actually differ. Once they agree this does
      // nothing, so it converges instead of rewriting the register every run.
      const roster = await get('/api/onyx/attendance/' + existing.id + '/roster', teacher);
      const now = new Map((roster?.roster ?? [])
        .map((r) => [String(r.user_id), r.record?.status ?? null]));
      const drift = entries.filter((e) => now.get(String(e.user_id)) !== e.status);
      if (drift.length) {
        const r = await call('/api/onyx/attendance/' + existing.id + '/mark',
          { token: teacher, body: { entries: drift } });
        if (r.ok) amended += drift.length;
      }
    }
    sessions += 1;
  }

  const liveTitle = 'Lecture ' + course.code + ' (today)';
  if (!byTitle.has(liveTitle)) {
    await post('live attendance session', '/api/onyx/courses/' + course.id + '/attendance',
      { title: liveTitle, scheduled_at: at(0, new Date().getHours()), duration_minutes: 90 },
      teacher);
  }
  sessions += 1;
}
done(sessions + ' sessions, ' + registers + ' registers taken'
  + (amended ? ', ' + amended + ' rows amended' : ''));

// ---- practice --------------------------------------------------------------
step('code lab problems');
const existingProblems = await get('/api/onyx/problems?all=1', admin);
const problems = [];
let newProblems = 0;
for (const [pi, spec] of PROBLEMS.entries()) {
  let p = (existingProblems ?? []).find((x) => x.slug === spec.slug);
  if (!p) {
    p = await post('problem ' + spec.slug, '/api/onyx/problems', {
      title: spec.title, slug: spec.slug, statement: spec.statement,
      difficulty: spec.difficulty, topic: spec.topic, languages: ['python'],
      // Attached to a taught course, so the set appears on the course page and
      // not only in the institution-wide bank.
      course_id: Number(live[pi % live.length].id),
    }, admin);
    await call('/api/onyx/problems/' + p.id + '/tests',
      { method: 'PUT', token: admin, body: { tests: spec.tests } });
    await call('/api/onyx/problems/' + p.id + '/hints', {
      method: 'PUT', token: admin,
      body: {
        hints: [{ body: 'Start from the smallest case and check it by hand.', penalty_percent: 10 }],
      },
    });
    await call('/api/onyx/problems/' + p.id + '/publish', { method: 'POST', token: admin });
    newProblems += 1;
  }
  problems.push({ id: Number(p.id), source: spec.source });
}
done(problems.length + ' (' + newProblems + ' new)');

// Real rows, so the practice screens have something to show. The sandbox may be
// absent or rate-limited (503) -- survivable, and the rows still exist as
// queued, which is itself a state worth being able to look at.
step('practice submissions');
let practice = 0;
for (const [si, email] of studentEmails.slice(0, 8).entries()) {
  const token = await tokenFor(email);
  if (!token) continue;
  // Per problem, not per learner. Skipping anybody who has *any* practice
  // history at all leaves the one account with a prior submission -- Sam
  // Student, from seed-demo.mjs, and the account every role guide tells a
  // reader to sign in as -- with an empty set beside eleven populated ones.
  const mine = await get('/api/onyx/practice/results', token);
  const sat = new Set((mine ?? []).map((r) => Number(r.problem_id)));
  for (const p of problems.slice(0, 2 + (si % 4))) {
    if (sat.has(p.id)) continue;
    // Every third learner hands in something that does not pass, so the results
    // screens have failures on them and not only green ticks.
    const wrong = si % 3 === 2;
    const r = await call('/api/onyx/problems/' + p.id + '/submit', {
      token,
      body: { language: 'python', mode: 'submit', source: wrong ? 'print("todo")\n' : p.source },
    });
    if (r.ok) practice += 1;
  }
}
await call('/api/onyx/queue/drain', { body: { concurrency: 4 }, token: admin });
done(practice);

// ---- assessments -----------------------------------------------------------
step('question banks and papers');
const banks = await get('/api/onyx/banks', admin);
let papers = 0;
for (const course of live.slice(0, 3)) {
  const bankName = course.title + ' question bank';
  let bank = (banks ?? []).find((b) => b.name === bankName);
  if (!bank) {
    bank = await post('bank', '/api/onyx/banks', {
      name: bankName, course_id: Number(course.id),
      description: 'Questions for ' + course.title + '.',
    }, admin);
    // One of every type, plus a keyless objective. The keyless one is the reason
    // the marking queue ever has objective questions in it: a question with no
    // answer key is hand-marked, not wrong by default.
    const questions = [
      { type: 'single', prompt: 'Which structure gives O(1) average lookup?', points: 2,
        options: [{ id: 'a', text: 'Linked list' }, { id: 'b', text: 'Hash table' },
          { id: 'c', text: 'Binary tree' }], answer: 'b', difficulty: 'easy',
        tags: ['structures'], explanation: 'Hashing gives constant-time average lookup.' },
      { type: 'multiple', prompt: 'Which of these are stable sorts?', points: 3,
        options: [{ id: 'a', text: 'Merge sort' }, { id: 'b', text: 'Quick sort' },
          { id: 'c', text: 'Insertion sort' }], answer: ['a', 'c'], difficulty: 'medium',
        tags: ['algorithms'] },
      { type: 'truefalse', prompt: 'A stack is first-in, first-out.', points: 1,
        answer: 'false', difficulty: 'easy', tags: ['structures'] },
      { type: 'short', prompt: 'Name the traversal that visits root, then left, then right.',
        points: 2, answer: ['preorder', 'pre-order'], difficulty: 'medium', tags: ['trees'] },
      { type: 'essay', prompt: 'Explain when you would choose a heap over a sorted array.',
        points: 6, difficulty: 'hard', tags: ['structures'] },
      { type: 'single', prompt: 'Which approach would you take here, and why?', points: 4,
        options: [{ id: 'a', text: 'Iterative' }, { id: 'b', text: 'Recursive' }],
        difficulty: 'hard', tags: ['judgement'] },
    ];
    for (const q of questions) {
      await post('question', '/api/onyx/banks/' + bank.id + '/questions', q, admin);
    }
  }

  const already = await get('/api/onyx/assessments?course_id=' + course.id, admin);
  if ((already ?? []).length) { papers += already.length; continue; }
  const paper = await post('assessment', '/api/onyx/assessments', {
    title: course.title + ' — class test',
    course_id: Number(course.id),
    instructions: 'Answer every question. Marks are shown beside each one.',
    opens_at: at(-1, 9), closes_at: at(14, 23),
    duration_minutes: 45, attempts_allowed: 2, pass_mark: 8,
    sections: [
      { id: 's1', title: 'Objective', bank_id: Number(bank.id), take: 4 },
      { id: 's2', title: 'Written', bank_id: Number(bank.id), take: 1 },
    ],
    shuffle_questions: true, shuffle_options: true,
    anonymous_marking: true, moderation_required: false,
  }, admin);
  await call('/api/onyx/assessments/' + paper.id + '/publish', { method: 'POST', token: admin });
  papers += 1;

  // Sit it, so the marking queue and the results screens are not empty.
  for (const email of studentEmails.slice(0, 6)) {
    const token = await tokenFor(email);
    if (!token) continue;
    const started = await call('/api/onyx/assessments/' + paper.id + '/start', { body: {}, token });
    if (!started.ok) continue;
    const attempt = started.data;
    // `questions`, not `paper`. attemptForCandidate() projects the dealt paper
    // into a `questions` array; reading `paper` here (as seed-full-extra.mjs
    // does) silently iterates nothing, so every answer POST is skipped, every
    // response stays null and every attempt scores zero -- which still looks
    // like a populated results screen until you read the numbers.
    for (const entry of attempt.questions ?? []) {
      await call('/api/onyx/attempts/' + attempt.id + '/answer', {
        token,
        body: {
          question_id: entry.question_id,
          response: entry.type === 'multiple' ? ['a']
            : entry.type === 'truefalse' ? 'false'
              : entry.type === 'short' ? 'preorder'
                : entry.type === 'essay'
                  ? 'A heap keeps the smallest item cheap to reach, and a sorted array '
                    + 'pays for that on every insertion.'
                  : 'b',
        },
      });
    }
    await call('/api/onyx/attempts/' + attempt.id + '/submit', { method: 'POST', token });
  }

  // Mark the written answers and release, so a learner has a real result.
  const queue = await get('/api/onyx/assessments/' + paper.id + '/marking', admin);
  for (const row of (queue ?? []).slice(0, 3)) {
    const sat = await get('/api/onyx/attempts/' + row.id + '/paper', admin);
    // `objective: false` is the marker view's own word for "a person has to
    // score this" -- an essay, or an MCQ-shaped question authored without a
    // key. Deciding it here from the type would miss the keyless one, which is
    // the only reason it is in the bank.
    const marks = (sat?.questions ?? [])
      .filter((q) => !q.objective)
      .map((q) => ({
        question_id: q.question_id, points: Math.ceil((q.points ?? 2) * 0.7),
        comment: 'Reasonable, but be specific about the cost.',
      }));
    if (marks.length) {
      await call('/api/onyx/attempts/' + row.id + '/mark', { token: admin, body: { marks } });
    }
  }
  await call('/api/onyx/assessments/' + paper.id + '/results/publish',
    { method: 'POST', token: admin });
}
done(papers + ' papers');

// ---- examinations ----------------------------------------------------------
// The blueprint splits these acts on purpose -- examinations creates the hall,
// seats the candidates and publishes; marks are entered by the course side -- so
// the seed uses the right token for each rather than doing everything as admin
// and proving nothing.
step('halls, exams, seating, marks');
const examToken = (await tokenFor(EXISTING.exams)) ?? admin;
const halls = await get('/api/onyx/halls', examToken);
let hall = (halls ?? []).find((h) => h.code === 'ABC-H1');
if (!hall) {
  hall = await post('hall', '/api/onyx/halls',
    { code: 'ABC-H1', name: 'Main Examination Hall', row_count: 10, col_count: 6 }, examToken);
}

const existingExams = await get('/api/onyx/exams', examToken);
let examCount = 0;
let corrected = 0;
for (const [ci, course] of live.entries()) {
  const title = course.title + ' end-of-term';
  const intended = new Map(studentIds
    .map((id, i) => [String(id), MARKS[(i + ci * 5) % MARKS.length]]));
  const exam = (existingExams ?? []).find((e) => e.title === title);
  if (exam) {
    // An exam left over from an earlier run keeps its marks: enterMarks()
    // refuses to overwrite a published one on purpose ("publishing is not
    // undone by re-entry"), so a mark that disagrees with the spread above is
    // corrected the way the product corrects one -- an audited override on the
    // single mark, by the examinations office. On a fresh run nothing
    // disagrees and this does nothing.
    const entered = await get('/api/onyx/exams/' + exam.id + '/marks', examToken);
    for (const m of entered ?? []) {
      const want = intended.get(String(m.user_id));
      if (want === undefined || Number(m.final_marks) === want) continue;
      const r = await call('/api/onyx/exam-marks/' + m.id,
        { method: 'PATCH', body: { raw_marks: want, final_marks: want }, token: examToken });
      if (r.ok) corrected += 1;
    }
  } else {
    const made = await post('exam ' + course.code, '/api/onyx/exams', {
      semester_id: Number(semester.id), course_id: Number(course.id), title,
      // Spread across days so the clash check has nothing to trip on, and in the
      // past so marks can legitimately exist.
      starts_at: at(-24 + ci * 3, 9 + (ci % 3)), duration_minutes: 120,
      max_marks: 100, pass_marks: 40,
    }, examToken);
    await call('/api/onyx/exams/' + made.id + '/seating',
      { body: { hall_ids: [Number(hall.id)] }, token: examToken });
    const entries = studentIds.map((id, i) => ({
      user_id: id, raw_marks: MARKS[(i + ci * 5) % MARKS.length],
    }));
    await call('/api/onyx/exams/' + made.id + '/marks', { body: { entries }, token: admin });
    await call('/api/onyx/exams/' + made.id + '/publish', { method: 'POST', token: examToken });
  }
  examCount += 1;
}

// Two ahead and unmarked -- seated, but not sat -- so "upcoming" is not empty.
for (const [ui, course] of live.slice(0, 2).entries()) {
  const title = course.title + ' resit';
  if ((existingExams ?? []).some((e) => e.title === title)) { examCount += 1; continue; }
  const made = await call('/api/onyx/exams', {
    token: examToken,
    body: {
      semester_id: Number(semester.id), course_id: Number(course.id), title,
      starts_at: at(18 + ui * 2, 9), duration_minutes: 120, max_marks: 100, pass_marks: 40,
    },
  });
  if (!made.ok) continue;
  await call('/api/onyx/exams/' + made.data.id + '/seating',
    { body: { hall_ids: [Number(hall.id)] }, token: examToken });
  examCount += 1;
}
done(examCount + ' exams' + (corrected ? ', ' + corrected + ' marks corrected' : ''));

// ---- rooms and timetable ---------------------------------------------------
step('rooms and timetable');
const rooms = await get('/api/onyx/rooms', admin);
const roomIds = [];
for (const r of ROOMS) {
  let room = (rooms ?? []).find((x) => x.code === r.code);
  if (!room) room = await post('room', '/api/onyx/rooms', r, admin);
  roomIds.push(Number(room.id));
}

const byCode = new Map(courses.map((c) => [c.code, c]));
const grid = await get('/api/onyx/timetable?semester_id=' + semester.id, admin);
const already = new Set((grid?.slots ?? (Array.isArray(grid) ? grid : []))
  .map((s) => [s.day_of_week, String(s.starts_at).slice(0, 5), String(s.course_id)].join('|')));

let slots = 0;
let clashed = 0;
for (const s of WEEK) {
  const course = byCode.get(s.course);
  if (!course) continue;
  if (already.has([s.day, s.from, String(course.id)].join('|'))) continue;
  const body = {
    semester_id: Number(semester.id), course_id: Number(course.id),
    batch_id: Number(batch.id), room_id: roomIds[s.room],
    faculty_id: course.facultyId, day_of_week: s.day,
    starts_at: s.from, ends_at: s.to,
  };
  // Ask before writing. A clash here is a mistake in WEEK above, and it should
  // be named on the way past rather than swallowed as a failed POST.
  const check = await call('/api/onyx/timetable/check', { body, token: admin });
  if (check.ok && check.data?.clear === false) {
    clashed += 1;
    console.log('\n    clash: ' + s.course + ' day ' + s.day + ' ' + s.from + '-' + s.to + ' -> '
      + JSON.stringify(check.data.clashes).slice(0, 200));
    continue;
  }
  const r = await call('/api/onyx/timetable', { body, token: admin });
  if (r.ok) slots += 1;
}
// A draft timetable is a room a learner never turns up to, so publish it.
await call('/api/onyx/timetable/publish',
  { body: { semester_id: Number(semester.id) }, token: admin });
done(slots + ' new slots, published' + (clashed ? '  (' + clashed + ' CLASHED)' : ''));

// ----------------------------------------------------------------- summary

console.log('\n' + '='.repeat(66));
console.log('  ABC Institution');
console.log('    ' + studentIds.length + ' students, ' + facultyIds.length + ' faculty');
console.log('    ' + courses.length + ' courses (' + live.length + ' taught, '
  + (courses.length - live.length) + ' draft), ' + lessonCount + ' lessons');
console.log('    ' + papers + ' papers, ' + examCount + ' exams, ' + problems.length
  + ' practice problems, ' + WEEK.length + ' timetable slots');
console.log('    ' + sessions + ' attendance sessions');
console.log('\n  admin@demo.onyx / ' + PW + '   (every seeded account uses that password)');
console.log('  ' + calls + ' API calls\n');
