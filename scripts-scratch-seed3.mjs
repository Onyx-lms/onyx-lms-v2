/** Second pass: satisfy the validations the first pass tripped over. */
const API = 'http://127.0.0.1:4000';
const PW = 'Demo#2026!';
async function api(path, opts = {}) {
  const h = {};
  if (opts.body !== undefined) h['Content-Type'] = 'application/json';
  if (opts.token) h.Authorization = 'Bearer ' + opts.token;
  const res = await fetch(API + path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: h, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const login = async (e) => (await api('/api/onyx/auth/login', { body: { email: e, password: PW } })).data.token;
const say = (l, r) => console.log(l.padEnd(44), r.ok ? 'ok' : `FAILED ${r.status} ${r.message ?? ''}`);

const admin = await login('admin@demo.onyx');
const faculty = await login('faculty@demo.onyx');
const student = await login('student@demo.onyx');

const roster = await api('/api/onyx/members', { token: admin });
const byEmail = Object.fromEntries(roster.data.map((m) => [m.user.email, m.user.id]));
const studentId = byEmail['student@demo.onyx'];
const student2Id = byEmail['student2@demo.onyx'];

// ---- practice problem: tests, then publish --------------------------------
const probs = await api('/api/onyx/problems', { token: admin });
for (const p of probs.data ?? []) {
  say(`tests for "${p.title}"`, await api(`/api/onyx/problems/${p.id}/tests`, {
    token: admin, method: 'PUT',
    body: { tests: [
      { name: 'example', stdin: '2 7 11 15\n9', expected_stdout: '0 1', weight: 1 },
      { name: 'hidden', stdin: '3 2 4\n6', expected_stdout: '1 2', is_hidden: true, weight: 1 },
    ] },
  }));
  say(`publish "${p.title}"`,
    await api(`/api/onyx/problems/${p.id}/publish`, { token: admin, method: 'POST' }));
}

// ---- lessons with real bodies ---------------------------------------------
const courses = await api('/api/onyx/courses', { token: admin });
const course = (courses.data ?? []).find((c) => c.code === 'CS101');
const outline = await api(`/api/onyx/courses/${course.id}/outline`, { token: admin });
const moduleId = outline.data.modules[0].id;

const LESSONS = [
  ['What is programming?', 'Programming is writing instructions a computer can follow. In this course you will write, run and debug your own programs.'],
  ['Installing Python', 'Download Python from python.org, run the installer, and confirm it works by running `python --version` in a terminal.'],
  ['Your first program', 'Every language starts here. Type `print("Hello, world!")` into a file, save it as hello.py, and run it.'],
  ['Variables and types', 'A variable is a name for a value. Python has numbers, strings, booleans and lists, and it works out the type for you.'],
  ['Loops and iteration', 'A loop repeats work. `for` walks over a sequence; `while` repeats until a condition stops being true.'],
  ['Functions', 'A function is a named, reusable block of code. Define one with `def`, call it by name, and give it arguments.'],
];
if (!outline.data.modules[0].lessons.length) {
  let sort = 1;
  for (const [title, body] of LESSONS) {
    say(`lesson "${title}"`, await api(`/api/onyx/modules/${moduleId}/lessons`, {
      token: admin,
      body: { title, type: 'text', body, duration_seconds: 300, sort, is_preview: sort <= 2 },
    }));
    sort += 1;
  }
}

// ---- attendance ------------------------------------------------------------
const sessions = await api(`/api/onyx/courses/${course.id}/attendance`, { token: faculty });
const sess = (sessions.data ?? [])[0];
if (sess) {
  say('mark attendance', await api(`/api/onyx/attendance/${sess.id}/mark`, {
    token: faculty,
    body: { entries: [
      { user_id: studentId, status: 'present' },
      { user_id: student2Id, status: 'late' },
    ] },
  }));
}

// ---- lesson progress -------------------------------------------------------
const o2 = await api(`/api/onyx/courses/${course.id}/outline`, { token: student });
for (const l of (o2.data.modules[0].lessons ?? []).slice(0, 3)) {
  say(`complete "${l.title}"`, await api(`/api/onyx/lessons/${l.id}/complete`,
    { token: student, method: 'POST' }));
}

console.log('\n--- what a student now sees ---');
const prog = (await api('/api/onyx/progress', { token: student })).data;
console.log('lessons   ', JSON.stringify(prog.lessons));
console.log('assignments', JSON.stringify(prog.assignments));
console.log('attendance', JSON.stringify(prog.attendance));
console.log('streak    ', JSON.stringify(prog.streak));
console.log('problems visible:', ((await api('/api/onyx/problems', { token: student })).data ?? []).length);
