/**
 * A demo copy of Malla Reddy University, built from nothing.
 *
 * The original is READ ONLY here. Its sections and its courses are fetched and
 * copied; not one call in this file writes to it, and the guard below refuses
 * to run at all if the tenant it is about to write to is any institution other
 * than the demo one it created or found by slug. That guard is the whole
 * safety story: everything downstream takes `TID` from it, so a mistake in a
 * later step cannot land somewhere else.
 *
 * What it builds:
 *
 *   * the institution, with an administrator, an examinations officer and
 *     three lecturers;
 *   * the 24 teaching divisions, by the names the original uses;
 *   * all 63 courses, copied exactly -- same code, title, credits, access,
 *     price and status, including the ones that are locked or unpublished;
 *   * 60 students in every division, 1,440 in all, each with a roll number
 *     that says which division they are in;
 *   * every student enrolled in PYTHON, and deliberately NOT in WEB
 *     DEVELOPMENT, so the enrol button is still there to test;
 *   * question banks of TEN PARALLEL SETS, so roll 1 and roll 2 sit different
 *     papers and roll 11 comes back round to roll 1's;
 *   * examinations scheduled from them -- one for the whole cohort, one for a
 *     single division, one made of coding questions -- and a single-set
 *     assessment beside them.
 *
 * It is resumable. Every step asks what already exists before it writes, so a
 * run that dies half way through 1,440 accounts can simply be run again.
 *
 *   node --env-file=.env qa-live/seed-malla-reddy-demo.mjs
 */
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';

/** The institution being built. Nothing else is ever written to. */
const DEMO_SLUG = 'malla-reddy-demo';
const DEMO_NAME = 'Malla Reddy University (Demo)';
/** The original, read only, and named here so the guard can refuse it. */
const SOURCE_SLUG = 'malla-reddy-university';

const STAFF_PW = 'MrDemo#2026!';
const STUDENT_PW = 'Student#2026!';
const DOMAIN = 'mrdemo.test';

const PER_SECTION = 60;
const SETS = 10;
const PER_SET = 10;

/** How many accounts are created at once. Kept modest: Auth is the bottleneck. */
const LANES = 8;

const log = (...a) => console.log(...a);
const t0 = Date.now();
const since = () => '[' + String(Math.round((Date.now() - t0) / 1000)).padStart(4) + 's]';

async function call(path, { method = 'GET', token, body } = {}) {
  for (let tryNo = 1; tryNo <= 4; tryNo += 1) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const p = await res.json().catch(() => ({}));
      // 5xx is worth another go; a 4xx is an answer, not a hiccup.
      if (res.status >= 500 && tryNo < 4) {
        await new Promise((r) => setTimeout(r, 400 * tryNo));
        continue;
      }
      return { status: res.status, data: p?.data, message: p?.message };
    } catch (e) {
      if (tryNo === 4) return { status: 0, message: String(e) };
      await new Promise((r) => setTimeout(r, 400 * tryNo));
    }
  }
  return { status: 0, message: 'unreachable' };
}

/** Runs `work` over `items`, `LANES` at a time, reporting as it goes. */
async function inLanes(items, label, work) {
  let done = 0;
  let failed = 0;
  const queue = [...items];
  const lane = async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      try {
        await work(item);
      } catch (e) {
        failed += 1;
        if (failed <= 5) log('  ! ' + label + ': ' + String(e).slice(0, 120));
      }
      done += 1;
      if (done % 60 === 0 || done === items.length) {
        log(since() + '   ' + label + ' ' + done + '/' + items.length
          + (failed ? '  (' + failed + ' failed)' : ''));
      }
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  return { done, failed };
}

// ===========================================================================

log('\n' + '='.repeat(76));
log('Building ' + DEMO_NAME);
log('='.repeat(76));

const pt = (await call('/api/onyx/platform/login', {
  method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
})).data?.token;
if (!pt) { log('Could not sign in to the platform console.'); process.exit(1); }

const tenants = (await call('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const source = tenants.find((t) => t.slug === SOURCE_SLUG);
if (!source) { log('The original Malla Reddy is not there to copy from.'); process.exit(1); }

const adminEmail = 'admin@' + DOMAIN;
let demo = tenants.find((t) => t.slug === DEMO_SLUG);
if (!demo) {
  log(since() + ' creating the institution…');
  const made = await call('/api/onyx/platform/tenants', {
    method: 'POST', token: pt,
    body: {
      name: DEMO_NAME, slug: DEMO_SLUG,
      admin: { name: 'Demo Administrator', email: adminEmail, password: STAFF_PW },
    },
  });
  if (!made.data) { log('Could not create it: ' + made.message); process.exit(1); }
  demo = made.data.tenant ?? made.data;
} else {
  log(since() + ' the institution already exists — carrying on where it left off.');
}

const TID = Number(demo.id);

/*
 * The guard everything else stands on.
 *
 * It refuses on identity, not on absence: the id being written to must be the
 * demo institution's, and must not be the original's or any other one on the
 * list. Failing closed here is the difference between a seeding script and an
 * accident.
 */
if (!Number.isFinite(TID) || TID <= 0) { log('No usable demo tenant id.'); process.exit(1); }
if (TID === Number(source.id)) { log('REFUSING: that is the original.'); process.exit(1); }
const others = tenants.filter((t) => t.slug !== DEMO_SLUG).map((t) => Number(t.id));
if (others.includes(TID)) { log('REFUSING: that id belongs to another institution.'); process.exit(1); }
log(since() + ' writing only to tenant ' + TID + ' (' + DEMO_SLUG + ');'
  + ' the original is ' + source.id + ' and is never written to.');

const base = '/api/onyx/platform/tenants/' + TID;
const from = '/api/onyx/platform/tenants/' + source.id;

// ---------------------------------------------------------------- 1. sections

log('\n' + since() + ' SECTIONS');
const sourceSections = ((await call(from + '/sections', { token: pt })).data ?? [])
  .filter((sx) => sx.status === 1)
  .sort((a, b) => Number(a.sort) - Number(b.sort));
log('  the original has ' + sourceSections.length);

let sections = (await call(base + '/sections', { token: pt })).data ?? [];
for (const sx of sourceSections) {
  if (sections.some((s) => String(s.name) === String(sx.name))) continue;
  await call(base + '/sections', { method: 'POST', token: pt, body: { name: sx.name } });
}
sections = ((await call(base + '/sections', { token: pt })).data ?? [])
  .filter((sx) => sx.status === 1)
  .sort((a, b) => Number(a.sort) - Number(b.sort));
log(since() + '  the demo now has ' + sections.length);

// ----------------------------------------------------------------- 2. courses

log('\n' + since() + ' COURSES');
const sourceCourses = ((await call(from + '/academics?limit=200', { token: pt })).data
  ?.courses ?? []);
log('  the original has ' + sourceCourses.length);

let courses = ((await call(base + '/academics?limit=200', { token: pt })).data?.courses ?? []);
const haveCode = new Set(courses.map((c) => String(c.code)));
const toMake = sourceCourses.filter((c) => !haveCode.has(String(c.code)));
await inLanes(toMake, 'courses', async (c) => {
  // Copied exactly, including the ones that are locked or unpublished: the
  // demo is meant to look like the institution it is a demo OF, and quietly
  // publishing somebody's draft course would make it look like something else.
  await call(base + '/courses', {
    method: 'POST', token: pt,
    body: {
      code: c.code, title: c.title, credits: Number(c.credits ?? 3),
      access: c.access ?? 'batch', price_minor: Number(c.price_minor ?? 0),
      currency: c.currency ?? 'INR', status: Number(c.status ?? 1),
      self_enroll: Boolean(c.self_enroll),
    },
  });
});
courses = ((await call(base + '/academics?limit=200', { token: pt })).data?.courses ?? []);
log(since() + '  the demo now has ' + courses.length);

const byCode = new Map(courses.map((c) => [String(c.code), c]));
const PYTHON = byCode.get('PY122');
const WEBDEV = byCode.get('WD101');
if (!PYTHON || !WEBDEV) { log('The two open courses did not copy across.'); process.exit(1); }

// ------------------------------------------------------------------- 3. staff

log('\n' + since() + ' STAFF');
const STAFF = [
  { name: 'Demo Administrator', email: adminEmail, role: 'admin' },
  { name: 'Demo Examinations Officer', email: 'exams@' + DOMAIN, role: 'exams' },
  { name: 'Dr Anjali Rao', email: 'faculty1@' + DOMAIN, role: 'faculty' },
  { name: 'Dr Vikram Iyer', email: 'faculty2@' + DOMAIN, role: 'faculty' },
  { name: 'Dr Sneha Kulkarni', email: 'faculty3@' + DOMAIN, role: 'faculty' },
];
for (const person of STAFF) {
  const made = await call(base + '/members', {
    method: 'POST', token: pt,
    body: { name: person.name, email: person.email, role: person.role, password: STAFF_PW },
  });
  log('  ' + person.role.padEnd(8) + person.email
    + (made.status === 200 ? '  created' : '  ' + (made.message ?? made.status)));
}

const at = (await call('/api/onyx/auth/login', {
  method: 'POST', body: { email: adminEmail, password: STAFF_PW },
})).data?.token;
if (!at) { log('Could not sign in as the demo administrator.'); process.exit(1); }

// ---------------------------------------------------------------- 4. students

log('\n' + since() + ' STUDENTS — ' + PER_SECTION + ' in each of ' + sections.length
  + ' divisions (' + PER_SECTION * sections.length + ')');

/** `alpha-cse.007@mrdemo.test`, roll `MRD-ALPHA-CSE-007`. */
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Diya', 'Ishaan', 'Kavya', 'Meera',
  'Rohan', 'Saanvi', 'Tanvi', 'Arjun', 'Nikhil', 'Priya', 'Rahul', 'Sneha',
  'Varun', 'Lakshmi', 'Karthik', 'Divya'];
const LAST = ['Reddy', 'Rao', 'Sharma', 'Naidu', 'Verma', 'Iyer', 'Chowdary', 'Kumar',
  'Menon', 'Pillai', 'Shetty', 'Gupta'];

const roster = [];
for (const sx of sections) {
  for (let n = 1; n <= PER_SECTION; n += 1) {
    const nn = String(n).padStart(3, '0');
    const code = String(sx.code);
    roster.push({
      section_id: Number(sx.id),
      section: String(sx.name),
      roll: 'MRD-' + code.toUpperCase() + '-' + nn,
      email: code + '.' + nn + '@' + DOMAIN,
      name: FIRST[(n + Number(sx.id)) % FIRST.length] + ' '
        + LAST[(n * 3 + Number(sx.id)) % LAST.length],
    });
  }
}

/*
 * Who is already there, read straight from the database.
 *
 * The console's own people route caps at 200, which is the right cap for a
 * screen and useless for a resume check across 1,440 -- and creating each one
 * to see which are refused would spend 1,440 round trips to learn nothing.
 */
const { withDb } = await import('../tests/e2e/harness.ts');
const existing = await withDb(async (db) => {
  const got = await db.query(
    'SELECT lower(u.email) AS email FROM public."onyx_memberships" m'
    + '  JOIN public."onyx_users" u ON u.id = m.user_id'
    + ' WHERE m.tenant_id = $1', [TID]);
  return new Set(got.rows.map((r) => r.email));
});
log('  ' + existing.size + ' already exist; ' + (roster.length - existing.size) + ' to create');

const wanted = roster.filter((r) => !existing.has(r.email));
await inLanes(wanted, 'students', async (r) => {
  const made = await call(base + '/members', {
    method: 'POST', token: pt,
    body: { name: r.name, email: r.email, role: 'student', password: STUDENT_PW },
  });
  if (made.status !== 200 && !/already a member/i.test(made.message ?? '')) {
    throw new Error(r.email + ': ' + (made.message ?? made.status));
  }
});

// ------------------------------------------- 5. roll numbers, divisions, rolls

log('\n' + since() + ' ROLL NUMBERS, DIVISIONS AND ENROLMENT');

await withDb(async (db) => {
  // Every statement below carries `tenant_id = TID`, which the guard above has
  // already proved is the demo institution. A row belonging to anybody else
  // cannot be reached by any of them.
  const emails = roster.map((r) => r.email);
  const rolls = roster.map((r) => r.roll);
  const sids = roster.map((r) => r.section_id);

  const set = await db.query(
    'UPDATE public."onyx_memberships" AS m'
    + '   SET roll_number = v.roll, section_id = v.section_id'
    + '  FROM (SELECT unnest($2::text[]) AS email,'
    + '               unnest($3::text[]) AS roll,'
    + '               unnest($4::bigint[]) AS section_id) AS v'
    + '  JOIN public."onyx_users" u ON lower(u.email) = v.email'
    + ' WHERE m.tenant_id = $1 AND m.user_id = u.id',
    [TID, emails, rolls, sids]);
  console.log(since() + '  roll number and division set on ' + set.rowCount);

  // Enrolled in PYTHON so an examination can be sat today. Deliberately NOT in
  // WEB DEVELOPMENT: that one is left open so the enrol button itself is still
  // something there is a way to test.
  const enrolled = await db.query(
    'INSERT INTO public."onyx_enrollments" (tenant_id, course_id, user_id, status)'
    + ' SELECT $1, $2, m.user_id, 1 FROM public."onyx_memberships" m'
    + '  WHERE m.tenant_id = $1 AND m.role = \'student\''
    + '    AND NOT EXISTS (SELECT 1 FROM public."onyx_enrollments" e'
    + '                     WHERE e.tenant_id = $1 AND e.course_id = $2'
    + '                       AND e.user_id = m.user_id)',
    [TID, Number(PYTHON.id)]);
  console.log(since() + '  enrolled in PYTHON: ' + enrolled.rowCount);
});

// ------------------------------------------------------------ 6. coding problems

log('\n' + since() + ' CODE LAB PROBLEMS (one per set, so each set is genuinely different)');
const problems = (await call(base + '/problems', { token: pt })).data ?? [];
const problemOf = new Map(problems.map((p) => [String(p.title), p]));
const CODING = [
  ['Sum of two numbers', 'Read two integers and print their sum.', '3 4', '7'],
  ['Largest of three', 'Read three integers and print the largest.', '3 9 4', '9'],
  ['Reverse a string', 'Read a word and print it backwards.', 'onyx', 'xyno'],
  ['Count the vowels', 'Read a word and print how many vowels it has.', 'education', '5'],
  ['Factorial', 'Read n and print n!.', '5', '120'],
  ['Fizz or Buzz', 'Print Fizz if n divides by 3, Buzz if by 5, else n.', '15', 'Fizz'],
  ['Is it a palindrome', 'Print yes if the word reads the same backwards.', 'level', 'yes'],
  ['Sum to n', 'Read n and print 1+2+...+n.', '10', '55'],
  ['Second largest', 'Read five integers and print the second largest.', '4 9 1 7 3', '7'],
  ['Count the words', 'Read a line and print how many words it has.', 'a b c d', '4'],
];
const problemIds = [];
for (const [title, statement, input, output] of CODING) {
  let p = problemOf.get(title);
  if (!p) {
    const made = await call(base + '/problems', {
      method: 'POST', token: pt,
      body: {
        title,
        statement: statement + '\n\nRead from standard input and print the answer.',
        difficulty: 'easy',
        languages: ['python', 'javascript'],
      },
    });
    p = made.data;
  }
  if (!p?.id) { log('  ! could not create ' + title); continue; }
  // Cases are a separate write, and publishing refuses without at least one
  // VISIBLE case -- a problem with none would accept anything and score zero.
  await call(base + '/problems/' + p.id + '/tests', {
    method: 'PUT', token: pt,
    body: {
      tests: [
        { name: 'example', stdin: input, expected_stdout: output, is_hidden: false },
        { name: 'marked', stdin: input, expected_stdout: output, is_hidden: true },
      ],
    },
  });
  const live = await call(base + '/problems/' + p.id + '/publish',
    { method: 'POST', token: pt, body: {} });
  if (live.status !== 200) { log('  ! ' + title + ': ' + (live.message ?? live.status)); continue; }
  problemIds.push(Number(p.id));
}
log(since() + '  ' + problemIds.length + ' problems published');

// ------------------------------------------------------------------- 7. banks

log('\n' + since() + ' QUESTION BANKS');

const banksNow = (await call(base + '/banks', { token: pt })).data ?? [];
const bankByName = new Map(banksNow.map((b) => [String(b.name), b]));

async function bank(name, courseId, build) {
  const already = bankByName.get(name);
  if (already && Number(already.question_count) > 0) {
    log('  ' + name + ' — already built (' + already.set_count + ' sets, '
      + already.question_count + ' questions)');
    return already;
  }
  const made = already ?? (await call(base + '/banks', {
    method: 'POST', token: pt, body: { name, course_id: courseId },
  })).data;
  const questions = build();
  await inLanes(questions, name, async (q) => {
    const put = await call(base + '/banks/' + made.id + '/questions',
      { method: 'POST', token: pt, body: q });
    if (put.status !== 200) throw new Error(put.message ?? String(put.status));
  });
  log(since() + '  ' + name + ' — ' + questions.length + ' questions');
  return made;
}

/** Ten parallel sets of ten, every question keyed, so results are instant. */
function tenSets(topic) {
  const out = [];
  for (let sx = 1; sx <= SETS; sx += 1) {
    for (let i = 1; i <= PER_SET; i += 1) {
      const n = (sx - 1) * PER_SET + i;
      if (i <= 6) {
        out.push({
          set_number: sx, type: 'single', points: 2,
          prompt: topic + ' — Set ' + sx + ', Q' + i + ': which of these is correct? (#' + n + ')',
          options: [
            { id: 'a', text: 'Statement A about ' + topic + ' #' + n },
            { id: 'b', text: 'Statement B about ' + topic + ' #' + n + ' (correct)' },
            { id: 'c', text: 'Statement C about ' + topic + ' #' + n },
            { id: 'd', text: 'Statement D about ' + topic + ' #' + n },
          ],
          answer: 'b',
        });
      } else if (i <= 8) {
        out.push({
          set_number: sx, type: 'multiple', points: 3,
          prompt: topic + ' — Set ' + sx + ', Q' + i + ': tick every true statement. (#' + n + ')',
          options: [
            { id: 'a', text: 'True of ' + topic + ' #' + n },
            { id: 'b', text: 'Also true of ' + topic + ' #' + n },
            { id: 'c', text: 'False about ' + topic + ' #' + n },
            { id: 'd', text: 'Also false about ' + topic + ' #' + n },
          ],
          answer: ['a', 'b'],
        });
      } else if (i === 9) {
        out.push({
          set_number: sx, type: 'truefalse', points: 1,
          prompt: topic + ' — Set ' + sx + ', Q9: ' + topic
            + ' is examinable in this paper. (#' + n + ')',
          answer: 'true',
        });
      } else {
        out.push({
          set_number: sx, type: 'short', points: 2,
          prompt: topic + ' — Set ' + sx + ', Q10: name the topic of this paper in one word.',
          answer: [topic.toLowerCase(), topic.toUpperCase(), topic],
        });
      }
    }
  }
  return out;
}

const pythonBank = await bank('PYTHON — mid-term, ten sets', Number(PYTHON.id),
  () => tenSets('Python'));
const webBank = await bank('WEB DEVELOPMENT — mid-term, ten sets', Number(WEBDEV.id),
  () => tenSets('Web'));

const codeBank = await bank('PYTHON — coding, ten sets', Number(PYTHON.id), () => {
  const out = [];
  for (let sx = 1; sx <= SETS; sx += 1) {
    out.push({
      set_number: sx, type: 'single', points: 2,
      prompt: 'Set ' + sx + ', Q1: which reads a line from standard input in Python?',
      options: [
        { id: 'a', text: 'read()' }, { id: 'b', text: 'input()' },
        { id: 'c', text: 'scan()' }, { id: 'd', text: 'gets()' },
      ],
      answer: 'b',
    });
    out.push({
      set_number: sx, type: 'truefalse', points: 1,
      prompt: 'Set ' + sx + ', Q2: Python indexes lists from zero.',
      answer: 'true',
    });
    if (problemIds[sx - 1]) {
      out.push({
        set_number: sx, type: 'code', points: 7,
        prompt: 'Set ' + sx + ', Q3: ' + CODING[sx - 1][0] + '. '
          + CODING[sx - 1][1] + ' Your code is marked by running its tests.',
        problem_id: problemIds[sx - 1],
      });
    }
  }
  return out;
});

// A bank of ONE set, which is what an ordinary class test is.
const classTest = await bank('PYTHON — class test (single set)', Number(PYTHON.id), () => {
  const out = [];
  for (let i = 1; i <= 8; i += 1) {
    out.push({
      type: 'single', points: 1,
      prompt: 'Class test Q' + i + ': which of these is correct?',
      options: [
        { id: 'a', text: 'Wrong answer ' + i }, { id: 'b', text: 'Right answer ' + i },
        { id: 'c', text: 'Also wrong ' + i }, { id: 'd', text: 'Also wrong ' + i },
      ],
      answer: 'b',
    });
  }
  return out;
});

// ------------------------------------------------------- 8. papers and sittings

log('\n' + since() + ' PAPERS AND SITTINGS');

const alpha = sections.find((sx) => String(sx.name) === 'Alpha-CSE') ?? sections[0];
const hour = 3_600_000;

/** The four writes the console's own scheduling form makes, in the same order. */
async function schedule({ title, courseId, bankId, take, sectionId, opensIn, minutes, marks }) {
  const already = ((await call(base + '/academics?limit=200', { token: pt })).data?.exams ?? [])
    .find((e) => String(e.title) === title);
  if (already) { log('  ' + title + ' — already scheduled'); return already; }

  const startsAt = new Date(Date.now() + opensIn).toISOString();
  const paper = (await call(base + '/assessments', {
    method: 'POST', token: pt,
    body: {
      title: title + ' (paper)', course_id: courseId, duration_minutes: minutes,
      opens_at: startsAt,
      closes_at: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
      section_id: sectionId ?? null,
      // Monitored, as an examination is -- but not watched, because nobody is
      // sitting in front of a camera for a demo. Turn "watch" on from the
      // paper's own settings when testing live invigilation.
      proctoring: true, require_camera: false, require_screen: false, watch_camera: false,
      anonymous_marking: false, instant_results: true,
    },
  })).data;
  if (!paper?.id) { log('  ! ' + title + ': the paper could not be created'); return null; }

  await call(base + '/assessments/' + paper.id + '/sections', {
    method: 'PUT', token: pt,
    body: { sections: [{ id: 's1', title: 'All questions', bank_id: bankId, take }] },
  });
  await call(base + '/assessments/' + paper.id + '/publish',
    { method: 'POST', token: pt, body: {} });

  const exam = (await call(base + '/exams', {
    method: 'POST', token: pt,
    body: {
      title, course_id: courseId, assessment_id: paper.id, starts_at: startsAt,
      section_id: sectionId ?? null, duration_minutes: minutes,
      max_marks: marks, pass_marks: Math.round(marks * 0.4),
    },
  })).data;
  log('  ' + title + ' — exam ' + exam?.id + ' on paper ' + paper.id
    + (sectionId ? ' (one division)' : ' (every division)'));
  return exam;
}

await schedule({
  title: 'PYTHON — Mid-term examination',
  courseId: Number(PYTHON.id), bankId: Number(pythonBank.id), take: PER_SET,
  sectionId: null, opensIn: -5 * 60_000, minutes: 90, marks: 19,
});
await schedule({
  title: 'PYTHON — Coding examination',
  courseId: Number(PYTHON.id), bankId: Number(codeBank.id), take: 3,
  sectionId: null, opensIn: -5 * 60_000, minutes: 120, marks: 10,
});
await schedule({
  title: 'WEB DEVELOPMENT — Mid-term (Alpha-CSE only)',
  courseId: Number(WEBDEV.id), bankId: Number(webBank.id), take: PER_SET,
  sectionId: Number(alpha.id), opensIn: 24 * hour, minutes: 90, marks: 19,
});

// The single-set assessment, which is not a sitting -- it is a class test that
// is simply open.
const testTitle = 'PYTHON — class test';
const haveTest = ((await call(base + '/academics?limit=200', { token: pt })).data?.assessments
  ?? []).find((a) => String(a.title) === testTitle);
if (!haveTest) {
  const paper = (await call(base + '/assessments', {
    method: 'POST', token: pt,
    body: {
      title: testTitle, course_id: Number(PYTHON.id), duration_minutes: 30,
      opens_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      closes_at: new Date(Date.now() + 30 * 24 * hour).toISOString(),
      section_id: null,
      proctoring: false, require_camera: false, require_screen: false, watch_camera: false,
      anonymous_marking: false, instant_results: true,
    },
  })).data;
  await call(base + '/assessments/' + paper.id + '/sections', {
    method: 'PUT', token: pt,
    body: { sections: [{ id: 's1', title: 'All questions', bank_id: Number(classTest.id), take: 8 }] },
  });
  await call(base + '/assessments/' + paper.id + '/publish',
    { method: 'POST', token: pt, body: {} });
  log('  ' + testTitle + ' — paper ' + paper.id + ' (one set, open for a month)');
} else {
  log('  ' + testTitle + ' — already there');
}

// -------------------------------------------------------------- 9. credentials

log('\n' + since() + ' CREDENTIALS');
const rows = [['role', 'name', 'section', 'roll_number', 'email', 'password']];
for (const person of STAFF) rows.push([person.role, person.name, '', '', person.email, STAFF_PW]);
for (const r of roster) rows.push(['student', r.name, r.section, r.roll, r.email, STUDENT_PW]);
const csv = rows.map((r) => r.map((v) => (/[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v))
  .join(',')).join('\n');
fs.writeFileSync('malla-reddy-demo-credentials.csv', csv + '\n');
log('  wrote malla-reddy-demo-credentials.csv — ' + (rows.length - 1) + ' accounts');

// ------------------------------------------------------------------ 10. report

const finalAcademics = (await call(base + '/academics?limit=200', { token: pt })).data;
const finalBanks = (await call(base + '/banks', { token: pt })).data ?? [];
const finalTenant = (await call(base, { token: pt })).data;

log('\n' + '='.repeat(76));
log(DEMO_NAME + '   tenant ' + TID + '   /onyx/platform/tenants/' + TID);
log('='.repeat(76));
log('  members        ' + JSON.stringify(finalTenant?.tenant?.members_by_role
  ?? finalTenant?.members_by_role ?? {}));
log('  sections       ' + sections.length);
log('  courses        ' + (finalAcademics?.courses ?? []).length);
log('  question banks ' + finalBanks.length);
for (const b of finalBanks) {
  log('     ' + String(b.name).padEnd(42) + b.set_count + ' sets · '
    + b.question_count + ' questions');
}
log('  papers         ' + (finalAcademics?.assessments ?? []).length);
log('  examinations   ' + (finalAcademics?.exams ?? []).length);
log('');
log('  admin          ' + adminEmail + '   ' + STAFF_PW);
log('  every student  <section-code>.<001-060>@' + DOMAIN + '   ' + STUDENT_PW);
log('  for example    ' + roster[0].email + '  (' + roster[0].roll + ', '
  + roster[0].section + ')');
log('');
log('  The original Malla Reddy (tenant ' + source.id + ') was read and never written to.');
