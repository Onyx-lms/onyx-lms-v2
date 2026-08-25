/**
 * How long every screen actually takes, measured rather than guessed.
 *
 * Optimising an application by reading it is how you spend a day making
 * something 3ms faster while a page nobody looked at takes four seconds. So
 * this walks the product as each role and times it — every navigation a real
 * person makes, plus the API calls underneath the slow ones — and prints the
 * worst first.
 *
 * **What is measured.** Server-rendered HTML: the time from request to last
 * byte, which is what somebody waits for before the page appears. Every route
 * is fetched THREE times and the median reported: a serverless function's
 * first call in a while pays for a cold start, and reporting that as the
 * page's speed would send you optimising the wrong thing. The first timing is
 * kept and shown separately, because a cold start is a real experience for the
 * first person through the door each morning.
 *
 * Read-only. It signs in, it looks, and it writes nothing.
 *
 *   node --env-file=.env qa-live/latency-report.mjs [tenantId]
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DOMAIN = 'mrdemo.test';
const STAFF_PW = 'MrDemo#2026!';
const STUDENT_PW = 'Student#2026!';
const RUNS = 3;

const rows = [];

async function timeOnce(url, headers) {
  const began = Date.now();
  const res = await fetch(url, { headers, redirect: 'manual' });
  // Drained, not merely awaited: a response is not "arrived" until its body
  // is, and a page that streams slowly would otherwise time as instant.
  const body = await res.text();
  return { ms: Date.now() - began, status: res.status, bytes: body.length };
}

/** Median of `RUNS`, plus the cold first, plus the size. */
async function measure(label, group, url, headers = {}) {
  const timings = [];
  let last = null;
  for (let i = 0; i < RUNS; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: three
    // parallel requests would measure the platform's concurrency, not the page.
    last = await timeOnce(url, headers);
    timings.push(last.ms);
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const row = {
    label, group,
    cold: timings[0],
    median: sorted[Math.floor(sorted.length / 2)],
    best: sorted[0],
    status: last.status,
    kb: Math.round((last.bytes / 1024) * 10) / 10,
  };
  rows.push(row);
  const flag = row.median >= 2000 ? ' ⟵ SLOW' : row.median >= 1000 ? ' ⟵ slow' : '';
  console.log('  ' + String(row.median).padStart(5) + 'ms  '
    + ('(cold ' + row.cold + 'ms)').padStart(13) + '  '
    + String(row.kb + 'kb').padStart(9) + '  '
    + label.padEnd(46) + flag);
  return row;
}

async function json(path, token) {
  const res = await fetch(BASE + path, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  const body = await res.json().catch(() => ({}));
  return body?.data;
}

const login = async (email, password) => {
  const res = await fetch(BASE + '/api/onyx/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).data;
};

const cookieFor = (session) => 'onyx_tenant_session=' + encodeURIComponent(JSON.stringify({
  token: session.token, refresh_token: session.refresh_token, expires_at: session.expires_at,
}));

// ---------------------------------------------------------------------------

console.log('\nMeasuring ' + BASE + ' — median of ' + RUNS + ' runs per screen.\n');

const platform = await (await fetch(BASE + '/api/onyx/platform/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'superadmin@onyx.platform', password: 'Platform#2026!' }),
})).json();
const pt = platform.data.token;
const platformCookie = 'onyx_platform_session=' + encodeURIComponent(JSON.stringify({
  token: pt, refresh_token: platform.data.refresh_token, expires_at: platform.data.expires_at,
}));

const tenants = await json('/api/onyx/platform/tenants', pt);
const demo = tenants.find((t) => t.slug === 'malla-reddy-demo') ?? tenants[0];
const TID = Number(process.argv[2] ?? demo.id);
const at = TID ? '/onyx/platform/tenants/' + TID : '';

// Ids to deep-link with, so the detail pages are measured on real records.
const academics = await json('/api/onyx/platform/tenants/' + TID + '/academics?limit=200', pt);
const course = (academics?.courses ?? [])[0];
const exam = (academics?.exams ?? [])[0];
const paper = (academics?.assessments ?? [])[0];
const sections = await json('/api/onyx/platform/tenants/' + TID + '/sections', pt);
const someSection = (sections ?? [])[0];
const people = await json('/api/onyx/platform/tenants/' + TID + '/people?role=student&limit=1', pt);
const someStudent = (people?.people ?? [])[0];

// ---------------------------------------------------------------------------

console.log('THE PLATFORM CONSOLE (superadmin)');
const H = { cookie: platformCookie };
await measure('Institutions directory', 'console', BASE + '/onyx/platform', H);
await measure('Institution overview', 'console', BASE + at, H);
await measure('Students (1,440)', 'console', BASE + at + '/students', H);
await measure('Students, filtered to one section', 'console',
  BASE + at + '/students?section=' + (someSection?.id ?? ''), H);
await measure('Faculty', 'console', BASE + at + '/faculty', H);
await measure('Sections', 'console', BASE + at + '/sections', H);
if (someSection) {
  await measure('One section (60 students)', 'console',
    BASE + at + '/sections/' + someSection.id, H);
}
if (someStudent) {
  await measure('One student’s record', 'console',
    BASE + at + '/students/' + someStudent.user_id, H);
}
await measure('Courses (63)', 'console', BASE + at + '/courses', H);
if (course) {
  await measure('One course', 'console', BASE + at + '/courses/' + course.id, H);
}
await measure('Examinations — schedule', 'console', BASE + at + '/examinations', H);
await measure('Examinations — papers', 'console', BASE + at + '/examinations/papers', H);
if (exam) {
  await measure('One sitting (register)', 'console', BASE + at + '/examinations/' + exam.id, H);
}
await measure('Assessments — schedule', 'console', BASE + at + '/assessments', H);
await measure('Assessments — banks', 'console', BASE + at + '/assessments/banks', H);
if (paper) {
  await measure('One paper', 'console', BASE + at + '/assessments/' + paper.id, H);
}
await measure('Invigilate', 'console', BASE + at + '/invigilate', H);
if (exam) {
  await measure('Invigilate — one sitting', 'console', BASE + at + '/invigilate/' + exam.id, H);
}
await measure('Code Lab', 'console', BASE + at + '/problems', H);
await measure('Timetable', 'console', BASE + at + '/timetable', H);
await measure('Grades', 'console', BASE + at + '/grades', H);
await measure('Fees', 'console', BASE + at + '/fees', H);
await measure('Help', 'console', BASE + at + '/support', H);
await measure('Settings', 'console', BASE + at + '/settings', H);

// ---------------------------------------------------------------------------

console.log('\nTHE INSTITUTION — ADMIN');
const admin = await login('admin@' + DOMAIN, STAFF_PW);
const A = { cookie: cookieFor(admin) };
await measure('Dashboard', 'admin', BASE + '/onyx/dashboard', A);
await measure('People (1,445)', 'admin', BASE + '/onyx/people', A);
await measure('Students', 'admin', BASE + '/onyx/people?role=student', A);
await measure('Courses', 'admin', BASE + '/onyx/courses', A);
await measure('Examinations', 'admin', BASE + '/onyx/exams', A);
await measure('Assessments', 'admin', BASE + '/onyx/assessments', A);
await measure('Invigilate', 'admin', BASE + '/onyx/invigilate', A);
await measure('Timetable', 'admin', BASE + '/onyx/timetable', A);
await measure('Results', 'admin', BASE + '/onyx/results', A);
await measure('Settings', 'admin', BASE + '/onyx/settings', A);

// ---------------------------------------------------------------------------

console.log('\nTHE INSTITUTION — FACULTY');
const faculty = await login('faculty1@' + DOMAIN, STAFF_PW);
const F = { cookie: cookieFor(faculty) };
await measure('Dashboard', 'faculty', BASE + '/onyx/dashboard', F);
await measure('My courses', 'faculty', BASE + '/onyx/courses', F);
await measure('Examinations — schedule', 'faculty', BASE + '/onyx/exams', F);
await measure('Examinations — papers', 'faculty', BASE + '/onyx/exams/papers', F);
if (exam) {
  await measure('One exam (submissions)', 'faculty', BASE + '/onyx/exams/' + exam.id, F);
}
await measure('Assessments — schedule', 'faculty', BASE + '/onyx/assessments', F);
await measure('Assessments — banks', 'faculty', BASE + '/onyx/assessments/banks', F);
await measure('Invigilate', 'faculty', BASE + '/onyx/invigilate', F);
await measure('Practice', 'faculty', BASE + '/onyx/practice', F);

// ---------------------------------------------------------------------------

console.log('\nTHE INSTITUTION — STUDENT');
const student = await login('alpha-cse.007@' + DOMAIN, STUDENT_PW);
const S = { cookie: cookieFor(student) };
await measure('Dashboard', 'student', BASE + '/onyx/dashboard', S);
await measure('Courses', 'student', BASE + '/onyx/courses', S);
await measure('Examinations', 'student', BASE + '/onyx/exams', S);
await measure('Assessments', 'student', BASE + '/onyx/assessments', S);
await measure('Timetable', 'student', BASE + '/onyx/timetable', S);
await measure('Results', 'student', BASE + '/onyx/results', S);
await measure('Practice', 'student', BASE + '/onyx/practice', S);
await measure('Workspaces', 'student', BASE + '/onyx/workspaces', S);
await measure('Profile', 'student', BASE + '/onyx/profile', S);

// ---------------------------------------------------------------------------

console.log('\nTHE API UNDERNEATH');
const apis = [
  ['GET /platform/tenants', '/api/onyx/platform/tenants', pt],
  ['GET /tenants/:id (overview)', '/api/onyx/platform/tenants/' + TID, pt],
  ['GET /people?role=student&limit=200', '/api/onyx/platform/tenants/' + TID
    + '/people?role=student&limit=200', pt],
  ['GET /academics?limit=200', '/api/onyx/platform/tenants/' + TID + '/academics?limit=200', pt],
  ['GET /banks', '/api/onyx/platform/tenants/' + TID + '/banks', pt],
  ['GET /sections', '/api/onyx/platform/tenants/' + TID + '/sections', pt],
  ['GET /proctor/queue', '/api/onyx/platform/tenants/' + TID + '/proctor/queue', pt],
  ['GET /courses/:id/roster (1,440)', course
    ? '/api/onyx/platform/tenants/' + TID + '/courses/' + course.id + '/roster' : null, pt],
  ['GET /exams/:id (register)', exam
    ? '/api/onyx/platform/tenants/' + TID + '/exams/' + exam.id : null, pt],
  ['GET /me (student)', '/api/onyx/me', student.token],
  ['GET /courses (student)', '/api/onyx/courses', student.token],
  ['GET /exams (student)', '/api/onyx/exams', student.token],
  ['GET /members (admin, 1,445)', '/api/onyx/members', admin.token],
];
for (const [label, path, token] of apis) {
  if (!path) continue;
  // eslint-disable-next-line no-await-in-loop -- see measure()
  await measure(label, 'api', BASE + path, { Authorization: 'Bearer ' + token });
}

// ---------------------------------------------------------------------------

const worst = [...rows].sort((a, b) => b.median - a.median);
console.log('\n' + '='.repeat(86));
console.log('THE TWELVE SLOWEST, worst first');
console.log('='.repeat(86));
for (const r of worst.slice(0, 12)) {
  console.log('  ' + String(r.median).padStart(5) + 'ms  '
    + String(r.kb + 'kb').padStart(9) + '  '
    + r.group.padEnd(9) + r.label);
}

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
console.log('\nBY AREA (median of the screens in it)');
for (const group of ['console', 'admin', 'faculty', 'student', 'api']) {
  const inGroup = rows.filter((r) => r.group === group);
  if (!inGroup.length) continue;
  console.log('  ' + group.padEnd(10)
    + String(median(inGroup.map((r) => r.median))).padStart(5) + 'ms median, '
    + String(Math.max(...inGroup.map((r) => r.median))).padStart(5) + 'ms worst, '
    + inGroup.length + ' screens');
}

const bad = rows.filter((r) => r.status >= 400);
if (bad.length) {
  console.log('\nNOT OK (measured anyway, but the timing means little)');
  for (const r of bad) console.log('  HTTP ' + r.status + '  ' + r.label);
}
console.log('');
