/**
 * The rest of the product, end to end, against the deployed site.
 *
 * `flows.mjs` sweeps the core, `exams.mjs` goes down the examination path and
 * `pay.mjs` down the money one. This covers what was left: the timetable, the
 * practice arena and its sandbox, workspaces, contests, and the roster search
 * staff actually use to find somebody.
 *
 * Every check is a real request as a real role, and each refusal is checked as
 * carefully as each success -- a feature that works for the person who should
 * not have it is not working.
 *
 *   node qa-live/features.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaFeat#2026!';

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(54), detail);
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
async function refuse(label, expected, path, opts = {}) {
  const r = await call(path, opts);
  const want = Array.isArray(expected) ? expected : [expected];
  check(label, want.includes(r.status),
    'expected ' + want.join('/') + ', got ' + r.status + ' ' + (r.message ?? ''));
  return r;
}

// ---------------------------------------------------------------------------

startPhase('1. an institution with people in it');

const pt = (await call('/api/onyx/platform/login', { method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' } })).data?.token;
const slug = 'qf-' + RUN;
const adminEmail = 'qf.' + RUN + '.admin@onyx.test';
const facultyEmail = 'qf.' + RUN + '.fac@onyx.test';
const studentEmail = 'qf.' + RUN + '.stu@onyx.test';

await step('institution created', '/api/onyx/tenants', { method: 'POST', token: pt,
  body: { name: 'Feature QA ' + RUN, slug,
    admin: { name: 'Ada Admin', email: adminEmail, password: PW } } });
const login = async (email) => (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email, password: PW } })).data?.token;
const at = await login(adminEmail);

await step('a lecturer', '/api/onyx/members', { method: 'POST', token: at,
  body: { name: 'Fay Faculty', email: facultyEmail, role: 'faculty', password: PW } });
await step('a learner, with a roll number', '/api/onyx/members', { method: 'POST', token: at,
  body: { name: 'Sunil Kumar', email: studentEmail, role: 'student', password: PW,
    roll_number: 'CS-2026-' + RUN.slice(-4).toUpperCase() } });

const roster = (await call('/api/onyx/members', { token: at })).data ?? [];
const student = roster.find((m) => m.user?.email === studentEmail);
const faculty = roster.find((m) => m.user?.email === facultyEmail);
const roll = student?.roll_number;
check('the roll number is on their membership', Boolean(roll), 'roll=' + roll);

const ft = await login(facultyEmail);
const st = await login(studentEmail);

// ---------------------------------------------------------------------------

startPhase('2. finding a student by name or roll number');

const byName = await call('/api/onyx/members?search=' + encodeURIComponent('Sunil'), { token: at });
check('an administrator finds them by name',
  (byName.data ?? []).some((m) => m.user?.email === studentEmail),
  (byName.data ?? []).length + ' matched');

const byRoll = await call('/api/onyx/members?search=' + encodeURIComponent(roll ?? ''),
  { token: at });
check('and by roll number, which is what staff are holding',
  (byRoll.data ?? []).some((m) => m.user?.email === studentEmail),
  (byRoll.data ?? []).length + ' matched');

const byPart = await call('/api/onyx/members?search=' + encodeURIComponent('cs-2026'),
  { token: at });
check('a partial roll number matches, case-insensitively',
  (byPart.data ?? []).some((m) => m.user?.email === studentEmail),
  (byPart.data ?? []).length + ' matched');

const nobody = await call('/api/onyx/members?search=zzz-no-such-person', { token: at });
check('and a search for nobody finds nobody rather than everybody',
  (nobody.data ?? []).length === 0, (nobody.data ?? []).length + ' matched');

const roleFiltered = await call('/api/onyx/members?role=student', { token: at });
check('filtering by role returns only that role',
  (roleFiltered.data ?? []).length > 0
  && (roleFiltered.data ?? []).every((m) => m.role === 'student'),
  (roleFiltered.data ?? []).length + ' students');

// The superadmin's own view of the same roll.
const tenantId = (await call('/api/onyx/platform/tenants', { token: pt })).data
  ?.find?.((t) => t.slug === slug)?.id;
const people = await step('the platform console reads the roll',
  '/api/onyx/platform/tenants/' + tenantId + '/people?role=student', { token: pt });
const consoleStudent = (people.data?.people ?? []).find((p) => p.email === studentEmail);
check('and it carries the roll number, so it can be shown and searched',
  consoleStudent?.roll_number === roll,
  'roll_number=' + String(consoleStudent?.roll_number));

await refuse('a learner cannot search the roster', 403, '/api/onyx/members?search=a',
  { token: st });

// ---------------------------------------------------------------------------

startPhase('3. the timetable');

const programme = await step('a programme', '/api/onyx/programs', { method: 'POST', token: at,
  body: { name: 'BSc Computing ' + RUN, code: 'BSC' + RUN.slice(-3), duration_semesters: 6 } });
const semester = await step('a semester', '/api/onyx/semesters', { method: 'POST', token: at,
  body: { program_id: programme.data?.id, name: 'Semester 1', number: 1 } });
const batch = await step('a batch', '/api/onyx/batches', { method: 'POST', token: at,
  body: { program_id: programme.data?.id, name: '2026 intake', code: 'B' + RUN.slice(-4),
    year: 2026 } });
const room = await step('a room to teach in', '/api/onyx/rooms', { method: 'POST', token: at,
  body: { code: 'R' + RUN.slice(-4), name: 'Lecture Hall 1', capacity: 60, kind: 'lecture' } });

const course = await step('a course', '/api/onyx/courses', { method: 'POST', token: at,
  body: { code: 'TT' + RUN.slice(-4), title: 'Timetabled Subject', credits: 4, access: 'open',
    program_id: programme.data?.id, semester_id: semester.data?.id } });
await step('published', '/api/onyx/courses/' + course.data?.id + '/publish',
  { method: 'POST', token: at });
await step('the lecturer teaches it', '/api/onyx/courses/' + course.data?.id + '/faculty',
  { method: 'POST', token: at, body: { user_id: faculty?.user_id } });
await step('the learner is enrolled', '/api/onyx/courses/' + course.data?.id + '/enroll',
  { method: 'POST', token: at, body: { user_id: student?.user_id } });

// A batch with nobody in it is not a class, and the API says so: scheduling
// against an empty batch is refused with a message naming the fix. So the
// learner joins the batch first, which is what an institution does anyway.
await step('the learner joins the batch', '/api/onyx/batches/' + batch.data?.id + '/members',
  { method: 'POST', token: at, body: { user_ids: [student?.user_id] } });

const slot = {
  semester_id: semester.data?.id, course_id: course.data?.id, batch_id: batch.data?.id,
  room_id: room.data?.id, faculty_id: faculty?.user_id,
  day_of_week: 2, starts_at: '09:00', ends_at: '10:00',
};
const scheduled = await step('a class is put on the grid', '/api/onyx/timetable',
  { method: 'POST', token: at, body: slot });

// The invariant the whole feature rests on.
await refuse('the same room at the same hour is refused', [409, 422], '/api/onyx/timetable', {
  method: 'POST', token: at,
  body: { ...slot, course_id: course.data?.id, starts_at: '09:30', ends_at: '10:30' },
});
const clashCheck = await step('and a clash can be asked about before committing',
  '/api/onyx/timetable/check', { method: 'POST', token: at, body: slot });
check('the check reports the conflict rather than staying silent',
  JSON.stringify(clashCheck.data ?? {}).length > 2,
  JSON.stringify(clashCheck.data).slice(0, 90));

const draftForLearner = await call('/api/onyx/timetable', { token: st });
check('a learner sees nothing until it is published',
  (draftForLearner.data ?? []).length === 0,
  (draftForLearner.data ?? []).length + ' slots');

await step('the registry publishes the grid', '/api/onyx/timetable/publish',
  { method: 'POST', token: at, body: { semester_id: semester.data?.id } });

const mine = await call('/api/onyx/timetable', { token: st });
check('and then sees their own class on it',
  (mine.data ?? []).some((s) => Number(s.course_id) === Number(course.data?.id)),
  (mine.data ?? []).length + ' slots');

const theirs = await call('/api/onyx/timetable', { token: ft });
check('the lecturer sees what they teach',
  (theirs.data ?? []).some((s) => Number(s.course_id) === Number(course.data?.id)),
  (theirs.data ?? []).length + ' slots');

await refuse('a learner cannot schedule a class', 403, '/api/onyx/timetable',
  { method: 'POST', token: st, body: slot });

check('the slot carries a real start and end, not just a day',
  scheduled.data?.starts_at === '09:00' || String(scheduled.data?.starts_at).startsWith('09:00'),
  scheduled.data?.starts_at + '–' + scheduled.data?.ends_at);

// ---------------------------------------------------------------------------

startPhase('4. practice, and the sandbox behind it');

const problem = await step('a problem is authored', '/api/onyx/problems', {
  method: 'POST', token: ft,
  body: { title: 'Reverse a string ' + RUN, slug: 'qf-rev-' + RUN,
    statement: 'Read a line and print it reversed.', difficulty: 'easy',
    languages: ['python'], time_limit_ms: 2000 },
});
const problemId = problem.data?.id;
await step('with tests, one of them hidden', '/api/onyx/problems/' + problemId + '/tests', {
  method: 'PUT', token: ft,
  body: { tests: [
    { name: 'sample', stdin: 'abc', expected_stdout: 'cba', weight: 1, is_hidden: false },
    { name: 'hidden', stdin: 'onyx', expected_stdout: 'xyno', weight: 1, is_hidden: true } ] },
});
await step('and a hint', '/api/onyx/problems/' + problemId + '/hints', {
  method: 'PUT', token: ft,
  body: { hints: [{ body: 'Slicing with a negative step reverses a sequence.' }] },
});

const draftToLearner = await call('/api/onyx/problems/' + problemId, { token: st });
check('a draft problem is not visible to a learner',
  draftToLearner.status === 404 || draftToLearner.status === 403,
  draftToLearner.status);

await step('published', '/api/onyx/problems/' + problemId + '/publish',
  { method: 'POST', token: ft });

const seen = await step('the learner opens it', '/api/onyx/problems/' + problemId,
  { token: st });
const shownTests = JSON.stringify(seen.data ?? {});
check('the statement is there and the hidden test is not',
  shownTests.includes('reversed') && !shownTests.includes('xyno'),
  'hidden expected_stdout leaked: ' + shownTests.includes('xyno'));

const wrong = await step('a wrong answer is submitted',
  '/api/onyx/problems/' + problemId + '/submit', {
    method: 'POST', token: st,
    body: { language: 'python', source: 'print("nope")', mode: 'submit' },
  });
let wrongScore = null;
for (let i = 0; i < 20 && wrongScore === null; i += 1) {
  await new Promise((r) => setTimeout(r, 2_000));
  const s = await call('/api/onyx/submissions/code/' + wrong.data?.id, { token: st });
  if (s.data?.status === 'done') wrongScore = Number(s.data?.score ?? 0);
}
check('and scores nothing, because the tests say so', wrongScore === 0,
  'score=' + wrongScore);

const right = await step('then a correct one',
  '/api/onyx/problems/' + problemId + '/submit', {
    method: 'POST', token: st,
    body: { language: 'python', source: 'print(input()[::-1])', mode: 'submit' },
  });
let rightResult = null;
for (let i = 0; i < 20 && !rightResult; i += 1) {
  await new Promise((r) => setTimeout(r, 2_000));
  const s = await call('/api/onyx/submissions/code/' + right.data?.id, { token: st });
  if (s.data?.status === 'done') rightResult = s.data;
}
check('which passes every case, the hidden one included',
  rightResult && Number(rightResult.score) === Number(rightResult.max_score)
  && Number(rightResult.max_score) > 0,
  'score=' + rightResult?.score + '/' + rightResult?.max_score);

const history = await call('/api/onyx/problems/' + problemId + '/submissions', { token: st });
check('both attempts are on their record', (history.data ?? []).length >= 2,
  (history.data ?? []).length + ' submissions');

const hint = await step('a hint can be asked for',
  '/api/onyx/problems/' + problemId + '/hint', { method: 'POST', token: st, body: {} });
check('and it says something useful',
  JSON.stringify(hint.data ?? {}).toLowerCase().includes('slic'),
  JSON.stringify(hint.data).slice(0, 70));

await refuse('a learner cannot author a problem', 403, '/api/onyx/problems', {
  method: 'POST', token: st,
  body: { title: 'Mine', slug: 'qf-mine-' + RUN, statement: 'x', difficulty: 'easy',
    languages: ['python'] },
});
await refuse('nor rewrite its tests', 403, '/api/onyx/problems/' + problemId + '/tests',
  { method: 'PUT', token: st, body: { tests: [] } });

// ---------------------------------------------------------------------------

startPhase('5. workspaces');

const ws = await step('a learner makes a workspace', '/api/onyx/workspaces', {
  method: 'POST', token: st,
  body: { title: 'Scratch ' + RUN, language: 'python', entry_path: 'main.py',
    files: [{ path: 'main.py', content: 'print("hello from a workspace")' }] },
});
const wsId = ws.data?.id;

const opened = await step('and opens it again', '/api/onyx/workspaces/' + wsId, { token: st });
check('the file they wrote is still in it',
  JSON.stringify(opened.data ?? {}).includes('hello from a workspace'),
  (opened.data?.files ?? []).length + ' files');

await step('the files are edited', '/api/onyx/workspaces/' + wsId + '/files', {
  method: 'PUT', token: st,
  body: { files: [{ path: 'main.py', content: 'print(6 * 7)' }] },
});

const run = await step('and it runs', '/api/onyx/workspaces/' + wsId + '/run',
  { method: 'POST', token: st, body: {} });
let output = JSON.stringify(run.data ?? '');
for (let i = 0; i < 15 && !output.includes('42'); i += 1) {
  await new Promise((r) => setTimeout(r, 2_000));
  const again = await call('/api/onyx/workspaces/' + wsId, { token: st });
  output = JSON.stringify(again.data ?? '') + JSON.stringify(run.data ?? '');
}
check('printing what the code prints', output.includes('42'),
  output.includes('42') ? 'saw 42' : output.slice(0, 110));

const listed = await call('/api/onyx/workspaces', { token: st });
check('it is on their list', (listed.data ?? []).some((w) => Number(w.id) === Number(wsId)),
  (listed.data ?? []).length + ' workspaces');

// Somebody else's workspace is somebody else's.
const otherStudentEmail = 'qf.' + RUN + '.stu2@onyx.test';
await call('/api/onyx/members', { method: 'POST', token: at,
  body: { name: 'Other Learner', email: otherStudentEmail, role: 'student', password: PW } });
const st2 = await login(otherStudentEmail);
await refuse('another learner cannot open it', [403, 404],
  '/api/onyx/workspaces/' + wsId, { token: st2 });
await refuse('nor run it', [403, 404], '/api/onyx/workspaces/' + wsId + '/run',
  { method: 'POST', token: st2, body: {} });

// ---------------------------------------------------------------------------

startPhase('6. contests');

const contest = await call('/api/onyx/contests', { method: 'POST', token: ft,
  body: { title: 'Weekly ' + RUN, starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    problems: [{ problem_id: problemId, points: 100 }] } });
check('a contest is set', contest.status === 200, contest.status + ' ' + (contest.message ?? ''));

if (contest.status === 200) {
  const contestId = contest.data?.id;
  await step('and published', '/api/onyx/contests/' + contestId + '/publish',
    { method: 'POST', token: ft, body: {} });
  const board = await step('its leaderboard reads',
    '/api/onyx/contests/' + contestId + '/leaderboard', { token: st });
  check('starting empty rather than erroring', Array.isArray(board.data)
    || Array.isArray(board.data?.rows), JSON.stringify(board.data).slice(0, 60));
}

// ---------------------------------------------------------------------------

startPhase('7. the screens these features live on');

const pages = [
  ['/onyx/timetable', 'timetable'], ['/onyx/practice', 'practice'],
  ['/onyx/workspaces', 'workspaces'], ['/onyx/contests', 'contests'],
  ['/onyx/people', 'people'], ['/onyx/assessments', 'assessments'],
  ['/onyx/exams', 'examinations'], ['/onyx/courses', 'courses'],
];
for (const [path, name] of pages) {
  const res = await fetch(BASE + path, { redirect: 'manual' });
  check('a signed-out visitor is sent away from ' + name,
    res.status === 307 || res.status === 302 || res.status === 401,
    'status ' + res.status);
}

// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(66));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const f of failed) console.log('  FAIL [' + f.phase + '] ' + f.label + ' -- ' + f.detail);
console.log('SLUG ' + slug);

const fs = await import('node:fs/promises');
await fs.writeFile(new URL('./features.json', import.meta.url),
  JSON.stringify({ base: BASE, slug, run: RUN, passed, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
