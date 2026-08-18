/**
 * A whole institution, not just its accounts.
 *
 * `seed-demo.mjs` stands up one tenant, one account per role and a single Code
 * Lab problem -- enough to sign in and prove the grading queue drains, and no
 * more. That was the right scope for it and it stays as it is. But a database
 * with seven users and no courses cannot be *evaluated*: every list is empty,
 * every dashboard is a set of zeroes, and no screen in the product can be
 * judged on how it handles real volume, real names, or the states that only
 * appear once data has a history.
 *
 * So this builds two institutions with populated academic years behind them --
 * programmes, cohorts, taught courses, submitted work, sat papers, published
 * marks, raised invoices, open tickets. Roughly what a college looks like
 * halfway through a term.
 *
 * Everything goes through the HTTP API for the reason seed-demo.mjs gives: the
 * service layer is where the invariants live, and seeding underneath it
 * reproduces those rules by hand and drifts from them silently. It is slower.
 * It is also the only version that proves the endpoints work.
 *
 * Usage
 *   node tools/onyx/seed-full.mjs --api https://onyx-lms-v2.vercel.app
 *   node tools/onyx/seed-full.mjs                     (defaults to localhost:5175)
 *
 * Idempotent by natural key -- programme code, course code, problem slug, and
 * so on. A re-run after a partial failure resumes rather than duplicating, and
 * a completed run is a no-op. That property is load-bearing: this talks to a
 * remote API over a few hundred requests and *will* be interrupted.
 */

const API = (() => {
  const i = process.argv.indexOf('--api');
  return (i === -1 ? 'http://127.0.0.1:5175' : process.argv[i + 1]).replace(/\/+$/, '');
})();

const PW = 'Demo#2026!';
const PLATFORM = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };

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

let line = '';
const step = (s) => { line = s; process.stdout.write('  ' + s.padEnd(52)); };
const done = (n) => { process.stdout.write(String(n) + '\n'); line = ''; };

// -------------------------------------------------------------------- dates

const DAY = 86_400_000;
const at = (days, hour = 10, minute = 0) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const dateOnly = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const pick = (arr, i) => arr[i % arr.length];

// ------------------------------------------------------------- the fixtures

/**
 * Two institutions, sized differently on purpose.
 *
 * Meridian is the one to look at: enough students that a roster scrolls, enough
 * courses that a dashboard has to choose what to show, and enough history that
 * "recent" means something. Ashcroft is small, and exists so that every
 * cross-tenant claim has a populated tenant to fail against -- an isolation
 * test against an empty second tenant proves nothing, because a completely
 * broken policy returns an empty list too.
 */
const INSTITUTIONS = [
  {
    slug: 'meridian-tech',
    name: 'Meridian Institute of Technology',
    plan: 'standard',
    admin: { name: 'Kavya Rao', email: 'kavya.rao@meridian.edu', password: PW },
    staff: [
      { role: 'faculty', name: 'Dr. Arun Menon', email: 'arun.menon@meridian.edu' },
      { role: 'faculty', name: 'Dr. Leela Iyer', email: 'leela.iyer@meridian.edu' },
      { role: 'exams', name: 'Ravi Chandran', email: 'ravi.chandran@meridian.edu' },
      { role: 'placement', name: 'Nisha Verma', email: 'nisha.verma@meridian.edu' },
      { role: 'employer', name: 'Deepak Shah', email: 'deepak.shah@northwind.example' },
      { role: 'guardian', name: 'Sunita Pillai', email: 'sunita.pillai@example.com' },
    ],
    students: [
      'Aditya Pillai', 'Ananya Krishnan', 'Rohan Desai', 'Meera Nair',
      'Vikram Reddy', 'Sneha Joshi', 'Karthik Subramanian', 'Priya Bhatt',
      'Imran Sheikh', 'Divya Ramesh', 'Nikhil Kulkarni', 'Fatima Ansari',
    ],
    program: { name: 'B.Tech Computer Science', code: 'BTCS', duration_semesters: 8 },
    semester: { name: 'Semester 3', number: 3 },
    batch: { name: 'CS 2024 intake', code: 'CS24', year: 2024 },
    courses: [
      { code: 'CS201', title: 'Data Structures', credits: 4, publish: true, facultyIndex: 0 },
      { code: 'CS202', title: 'Operating Systems', credits: 4, publish: true, facultyIndex: 1 },
      { code: 'CS203', title: 'Database Systems', credits: 3, publish: true, facultyIndex: 0 },
      // Left unpublished on purpose: the draft-visibility rule is only
      // observable when a draft actually exists, and a reviewer should be able
      // to see one from the faculty side and confirm it is absent from the
      // student's.
      { code: 'CS310', title: 'Machine Learning', credits: 4, publish: false, facultyIndex: 1 },
    ],
  },
  {
    slug: 'ashcroft-poly',
    name: 'Ashcroft Polytechnic',
    plan: 'standard',
    admin: { name: 'George Ashcroft', email: 'g.ashcroft@ashcroft.ac', password: PW },
    staff: [
      { role: 'faculty', name: 'Dr. Helen Marsh', email: 'h.marsh@ashcroft.ac' },
      { role: 'exams', name: 'Peter Vance', email: 'p.vance@ashcroft.ac' },
    ],
    students: ['Owen Blake', 'Ruth Calder', 'Ellis Fenn', 'Nora Whitlock'],
    program: { name: 'Diploma in Software Engineering', code: 'DSE', duration_semesters: 6 },
    semester: { name: 'Semester 2', number: 2 },
    batch: { name: 'SE 2025 intake', code: 'SE25', year: 2025 },
    courses: [
      { code: 'SE101', title: 'Programming Foundations', credits: 4, publish: true, facultyIndex: 0 },
      { code: 'SE102', title: 'Web Development', credits: 3, publish: true, facultyIndex: 0 },
    ],
  },
];

const emailFor = (name, domain) =>
  name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').join('.') + '@' + domain;

// ============================================================================

console.log('\nSeeding ' + API + '\n');

const platform = await call('/api/onyx/platform/login', { body: PLATFORM });
if (!platform.ok) die('platform login (run grant-platform-admin.mjs first)', platform);
const platformToken = platform.data.token;
console.log('signed in as ' + PLATFORM.email + '\n');

const summary = [];

for (const inst of INSTITUTIONS) {
  console.log('-'.repeat(64));
  console.log(inst.name);
  console.log('-'.repeat(64));

  const domain = inst.admin.email.split('@')[1];

  // ---- institution --------------------------------------------------------
  step('institution');
  const found = await get('/api/onyx/platform/tenants?search='
    + encodeURIComponent(inst.name), platformToken);
  let tenant = (found ?? []).find((t) => t.slug === inst.slug);
  if (!tenant) {
    const made = await post('create institution', '/api/onyx/platform/tenants',
      { name: inst.name, slug: inst.slug, plan: inst.plan, admin: inst.admin }, platformToken);
    tenant = made.tenant ?? made;
  }
  done('id ' + tenant.id);

  const adminLogin = await call('/api/onyx/auth/login',
    { body: { email: inst.admin.email, password: PW } });
  if (!adminLogin.ok) die('admin login for ' + inst.name, adminLogin);
  const admin = adminLogin.data.token;

  // ---- people -------------------------------------------------------------
  step('people');
  const roster = await get('/api/onyx/members', admin);
  const byEmail = new Map((roster ?? [])
    .map((m) => [(m.user?.email ?? '').toLowerCase(), m.user_id]));

  const ensureMember = async (name, email, role) => {
    const existing = byEmail.get(email.toLowerCase());
    if (existing) return existing;
    const made = await post('add ' + role + ' ' + email, '/api/onyx/members',
      { name, email, password: PW, role }, admin);
    const id = made.user_id ?? made.user?.id ?? made.id;
    byEmail.set(email.toLowerCase(), id);
    return id;
  };

  const staffIds = [];
  for (const s of inst.staff) staffIds.push(await ensureMember(s.name, s.email, s.role));
  const facultyIds = inst.staff
    .map((s, i) => (s.role === 'faculty' ? staffIds[i] : null)).filter(Boolean);
  const employerUserId = inst.staff
    .map((s, i) => (s.role === 'employer' ? staffIds[i] : null)).filter(Boolean)[0] ?? null;
  const guardianUserId = inst.staff
    .map((s, i) => (s.role === 'guardian' ? staffIds[i] : null)).filter(Boolean)[0] ?? null;

  const studentIds = [];
  for (const name of inst.students) {
    studentIds.push(await ensureMember(name, emailFor(name, domain), 'student'));
  }
  done(1 + inst.staff.length + inst.students.length + ' accounts');

  // ---- academic structure -------------------------------------------------
  step('programme, semester, batch');
  const programs = await get('/api/onyx/programs', admin);
  let program = (programs ?? []).find((p) => p.code === inst.program.code);
  if (!program) program = await post('programme', '/api/onyx/programs', inst.program, admin);

  const semesters = await get('/api/onyx/semesters?program_id=' + program.id, admin);
  let semester = (semesters ?? []).find((s) => s.number === inst.semester.number);
  if (!semester) {
    semester = await post('semester', '/api/onyx/semesters', {
      program_id: Number(program.id),
      name: inst.semester.name,
      number: inst.semester.number,
      starts_on: dateOnly(-60),
      ends_on: dateOnly(60),
    }, admin);
  }

  const batches = await get('/api/onyx/batches?program_id=' + program.id, admin);
  let batch = (batches ?? []).find((b) => b.code === inst.batch.code);
  if (!batch) {
    batch = await post('batch', '/api/onyx/batches', {
      program_id: Number(program.id), ...inst.batch,
    }, admin);
  }

  const members = await get('/api/onyx/batches/' + batch.id + '/members', admin);
  const inBatch = new Set((members ?? []).map((m) => String(m.user_id)));
  const toAdd = studentIds.filter((id) => !inBatch.has(String(id)));
  if (toAdd.length) {
    await post('batch members', '/api/onyx/batches/' + batch.id + '/members',
      { user_ids: toAdd }, admin);
  }
  done(program.code + ' / ' + semester.name + ' / ' + batch.code);

  // ---- courses ------------------------------------------------------------
  step('courses');
  const existingCourses = await get('/api/onyx/courses?all=1', admin);
  const courses = [];
  for (const spec of inst.courses) {
    let course = (existingCourses ?? []).find((c) => c.code === spec.code);
    if (!course) {
      course = await post('course ' + spec.code, '/api/onyx/courses', {
        code: spec.code, title: spec.title, credits: spec.credits,
        program_id: Number(program.id), semester_id: Number(semester.id),
        description: spec.title + ' for ' + inst.program.name + ', ' + inst.semester.name + '.',
      }, admin);
      const facultyId = pick(facultyIds, spec.facultyIndex);
      if (facultyId) {
        await call('/api/onyx/courses/' + course.id + '/faculty',
          { body: { user_id: facultyId }, token: admin });
      }
      if (spec.publish) {
        await call('/api/onyx/courses/' + course.id + '/publish', { method: 'POST', token: admin });
      }
      await call('/api/onyx/courses/' + course.id + '/enroll',
        { body: { batch_id: Number(batch.id) }, token: admin });
    }
    courses.push({ ...course, spec, facultyId: pick(facultyIds, spec.facultyIndex) });
  }
  done(courses.length + ' (' + courses.filter((c) => !c.spec.publish).length + ' draft)');

  // ---- content ------------------------------------------------------------
  step('modules and lessons');
  let lessonCount = 0;
  for (const course of courses) {
    const outline = (await call('/api/onyx/courses/' + course.id + '/outline',
      { token: admin })).data;
    if ((outline?.modules ?? []).length) { lessonCount += (outline.modules ?? [])
      .reduce((n, m) => n + (m.lessons?.length ?? 0), 0); continue; }

    for (const [wi, week] of ['Foundations', 'Core techniques', 'Applied work'].entries()) {
      const mod = await post('module', '/api/onyx/courses/' + course.id + '/modules',
        { title: 'Unit ' + (wi + 1) + ' — ' + week, sort: wi }, admin);
      // One of every kind, so every branch of the lesson viewer has something
      // real behind it rather than being reachable only in theory.
      const lessons = [
        { title: week + ': reading', type: 'text', body: 'Notes for ' + week.toLowerCase()
          + ' in ' + course.title + '.\n\nWork through the examples before the lab.' },
        { title: week + ': lecture recording', type: 'video',
          path: 'onyx/demo/' + course.code.toLowerCase() + '-u' + (wi + 1) + '.mp4',
          duration_seconds: 1800 },
        { title: week + ': slides', type: 'document',
          path: 'onyx/demo/' + course.code.toLowerCase() + '-u' + (wi + 1) + '.pdf' },
        { title: week + ': reference diagram', type: 'image',
          path: 'onyx/demo/' + course.code.toLowerCase() + '-u' + (wi + 1) + '.png' },
        { title: week + ': further reading', type: 'link',
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

  // ---- assignments, submissions, marks ------------------------------------
  step('assignments and submissions');
  let submitted = 0;
  for (const course of courses.filter((c) => c.spec.publish)) {
    const existing = await get('/api/onyx/courses/' + course.id + '/assignments', admin);
    if ((existing ?? []).length) continue;

    const assignment = await post('assignment', '/api/onyx/courses/' + course.id + '/assignments', {
      title: course.title + ' — practical 1',
      instructions: 'Answer in your own words. Show your working.',
      due_at: at(-3, 23, 59),
      total_points: 100,
      late_penalty_percent: 10,
      allow_resubmission: true,
    }, admin);
    await call('/api/onyx/assignments/' + assignment.id + '/rubric', {
      method: 'PUT', token: admin,
      body: { criteria: [
        { title: 'Correctness', description: 'Does it do the right thing?', points: 60 },
        { title: 'Clarity', description: 'Can somebody else follow it?', points: 40 },
      ] },
    });
    await call('/api/onyx/assignments/' + assignment.id + '/publish', { method: 'POST', token: admin });

    // Two thirds hand in, which is what a real deadline looks like -- and it
    // leaves the marking queue with something in it and the chase list too.
    const handIn = studentIds.slice(0, Math.ceil(studentIds.length * 0.66));
    for (const [i, sid] of handIn.entries()) {
      const who = await call('/api/onyx/auth/login',
        { body: { email: emailFor(inst.students[studentIds.indexOf(sid)], domain), password: PW } });
      if (!who.ok) continue;
      const r = await call('/api/onyx/assignments/' + assignment.id + '/submit', {
        token: who.data.token,
        body: { body: 'Submission for ' + course.title + ' by student ' + (i + 1)
          + '.\n\nApproach: iterate, measure, then simplify.' },
      });
      if (r.ok) submitted += 1;
    }

    // Mark and return about half of them, so both "marked" and "waiting" exist.
    const queue = await get('/api/onyx/assignments/' + assignment.id, admin);
    for (const [i, sub] of (queue?.submissions ?? []).slice(0, Math.ceil(handIn.length / 2)).entries()) {
      await call('/api/onyx/submissions/' + sub.id + '/grade', {
        token: admin,
        body: { score: 58 + ((i * 7) % 35), feedback: 'Solid on correctness; tighten the explanation.' },
      });
      await call('/api/onyx/submissions/' + sub.id + '/return', { method: 'POST', token: admin });
    }
  }
  done(submitted + ' submissions');

  // ---- attendance ---------------------------------------------------------
  step('attendance');
  let sessions = 0;
  for (const course of courses.filter((c) => c.spec.publish)) {
    const had = await get('/api/onyx/courses/' + course.id + '/attendance', admin);
    if ((had ?? []).length) { sessions += had.length; continue; }
    // Past sessions are marked by hand -- self check-in on them is closed now,
    // which is the correct behaviour and also why they cannot be checked into.
    for (const d of [-14, -7, -2]) {
      const s = await post('session', '/api/onyx/courses/' + course.id + '/attendance',
        { title: 'Lecture ' + course.code + ' ' + dateOnly(d), scheduled_at: at(d, 9),
          duration_minutes: 60 }, admin);
      const marks = studentIds.map((id, i) => ({
        user_id: id,
        status: i % 9 === 0 ? 'absent' : i % 5 === 0 ? 'late' : 'present',
      }));
      await call('/api/onyx/attendance/' + s.id + '/mark', { token: admin, body: { entries: marks } });
      await call('/api/onyx/attendance/' + s.id + '/close', { method: 'POST', token: admin });
      sessions += 1;
    }
    // ...and one running now, so the QR panel has a live session to show.
    await post('live session', '/api/onyx/courses/' + course.id + '/attendance',
      { title: 'Lecture ' + course.code + ' (today)', scheduled_at: at(0, new Date().getHours()),
        duration_minutes: 90 }, admin);
    sessions += 1;
  }
  done(sessions + ' sessions');

  summary.push({
    institution: inst.name, tenant: tenant.id, admin: inst.admin.email,
    students: studentIds.length, courses: courses.length,
    context: { admin, program, semester, batch, courses, studentIds, facultyIds,
      employerUserId, guardianUserId, inst, domain },
  });
  console.log('');
}

// The second pass (assessments, exams, careers, campus) lives in seed-full-2 so
// each file stays readable; it is imported rather than duplicated.
const { secondPass } = await import('./seed-full-extra.mjs');
await secondPass({ call, post, get, step, done, at, dateOnly, pick, die, summary, PW, emailFor });

console.log('='.repeat(64));
for (const s of summary) {
  console.log('  ' + s.institution + '  (tenant ' + s.tenant + ')');
  console.log('    admin ' + s.admin + '   ' + s.students + ' students, ' + s.courses + ' courses');
}
console.log('\n  every seeded password is ' + PW);
console.log('  ' + calls + ' API calls\n');
