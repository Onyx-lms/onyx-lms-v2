/** Publish the demo content that was left in draft, and give the course real lessons. */
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
const say = (l, r) => console.log(l.padEnd(42), r.ok ? 'ok' : `FAILED ${r.status} ${r.message ?? ''}`);

const admin = await login('admin@demo.onyx');
const faculty = await login('faculty@demo.onyx');
const student = await login('student@demo.onyx');

// ---- publish the practice problem -----------------------------------------
const probs = await api('/api/onyx/problems', { token: admin });
for (const p of probs.data ?? []) {
  say(`publish problem "${p.title}"`,
    await api(`/api/onyx/problems/${p.id}/publish`, { token: admin, method: 'POST' }));
}

// ---- course content --------------------------------------------------------
const courses = await api('/api/onyx/courses', { token: admin });
const course = (courses.data ?? []).find((c) => c.code === 'CS101');
const outline = await api(`/api/onyx/courses/${course.id}/outline`, { token: admin });
let moduleId = outline.data?.modules?.[0]?.id;
if (!moduleId) {
  const m = await api(`/api/onyx/courses/${course.id}/modules`, {
    token: admin, body: { title: 'Getting Started' } });
  moduleId = m.data?.id;
}

const LESSONS = [
  ['What is programming?', 'text', 1],
  ['Installing Python', 'text', 2],
  ['Your first program', 'video', 3],
  ['Variables and types', 'text', 4],
  ['Loops and iteration', 'text', 5],
  ['Functions', 'text', 6],
];
const existing = (outline.data?.modules?.[0]?.lessons ?? []).length;
if (!existing) {
  for (const [title, type, sort] of LESSONS) {
    const r = await api(`/api/onyx/modules/${moduleId}/lessons`, {
      token: admin,
      body: { title, type, sort, duration_seconds: 300, is_preview: sort <= 2 },
    });
    say(`lesson "${title}"`, r);
  }
} else {
  console.log(`lessons already present (${existing})`);
}

// ---- publish the assignment, and add a second, overdue one ----------------
const assigns = await api(`/api/onyx/courses/${course.id}/assignments`, { token: admin });
for (const a of assigns.data ?? []) {
  say(`publish assignment "${a.title}"`,
    await api(`/api/onyx/assignments/${a.id}/publish`, { token: admin, method: 'POST' }));
}
if ((assigns.data ?? []).length < 2) {
  const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const made = await api(`/api/onyx/courses/${course.id}/assignments`, {
    token: admin,
    body: { title: 'Loops worksheet', instructions: 'Complete the exercises on iteration.',
      due_at: past, total_points: 50 },
  });
  say('create overdue assignment', made);
  if (made.ok) {
    say('publish it', await api(`/api/onyx/assignments/${made.data.id}/publish`,
      { token: admin, method: 'POST' }));
  }
}

// ---- attendance: mark the student present so the figure is not 0% ---------
const sessions = await api(`/api/onyx/courses/${course.id}/attendance`, { token: faculty });
const sess = (sessions.data ?? [])[0];
if (sess) {
  say('mark attendance (manual)', await api(`/api/onyx/attendance/${sess.id}/mark`, {
    token: faculty, body: { entries: [{ user_id: null }] } }));
}

// ---- lesson progress: complete two so the streak and % are non-zero -------
const outline2 = await api(`/api/onyx/courses/${course.id}/outline`, { token: student });
const lessons = outline2.data?.modules?.[0]?.lessons ?? [];
for (const l of lessons.slice(0, 2)) {
  say(`complete lesson "${l.title}"`, await api(`/api/onyx/lessons/${l.id}/complete`, {
    token: student, method: 'POST' }));
}

console.log('\n--- what a student now sees ---');
const prog = await api('/api/onyx/progress', { token: student });
console.log('progress:', JSON.stringify(prog.data));
const pr = await api('/api/onyx/problems', { token: student });
console.log('problems visible to student:', (pr.data ?? []).length);
