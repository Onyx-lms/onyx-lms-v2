/**
 * Server time per endpoint, which is where pagination and query shape show up.
 *
 * The page-level probe said time-to-first-byte was 30-90 ms everywhere while
 * pages still took a second and a half. That is what an App Router page looks
 * like: the shell flushes immediately and every await happens inside the
 * stream, so TTFB measures the shell and nothing else. Measuring the API
 * directly is the only way to see what the database is actually being asked.
 *
 * Median of three, plus the response size, because an endpoint that answers
 * fast and returns 1,400 rows is still a page that renders slowly.
 *
 *   node --env-file=.env qa-live/_perf-api.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUNS = 3;

const login = async (email, password, path = '/api/onyx/auth/login') =>
  (await (await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })).json())?.data?.token;

const st = await login('alpha-cse.001@mrdemo.test', 'Student#2026!');
const ft = await login('faculty1@mrdemo.test', 'MrDemo#2026!');
const at = await login('admin@mrdemo.test', 'MrDemo#2026!');
const pt = await login('superadmin@onyx.platform', 'Platform#2026!',
  '/api/onyx/platform/login');

const ENDPOINTS = [
  ['student', st, '/api/onyx/me'],
  ['student', st, '/api/onyx/my/courses'],
  ['student', st, '/api/onyx/dashboard'],
  ['student', st, '/api/onyx/results'],
  ['student', st, '/api/onyx/timetable'],
  ['student', st, '/api/onyx/problems'],
  ['student', st, '/api/onyx/assessments'],
  ['student', st, '/api/onyx/exams'],
  ['student', st, '/api/onyx/notifications'],
  ['student', st, '/api/onyx/courses'],
  ['student', st, '/api/onyx/catalogue'],

  ['faculty', ft, '/api/onyx/my/courses'],
  ['faculty', ft, '/api/onyx/banks'],
  ['faculty', ft, '/api/onyx/assessments'],
  ['faculty', ft, '/api/onyx/exams'],

  ['admin', at, '/api/onyx/members?limit=50'],
  ['admin', at, '/api/onyx/members?limit=200'],
  ['admin', at, '/api/onyx/members/count'],
  ['admin', at, '/api/onyx/courses?all=1'],
  ['admin', at, '/api/onyx/sections'],
  ['admin', at, '/api/onyx/audit'],
  ['admin', at, '/api/onyx/invoices'],
  ['admin', at, '/api/onyx/fee-heads'],
  ['admin', at, '/api/onyx/employers'],
  ['admin', at, '/api/onyx/problems'],

  ['operator', pt, '/api/onyx/platform/tenants'],
  ['operator', pt, '/api/onyx/platform/tenants/798'],
  ['operator', pt, '/api/onyx/platform/tenants/798/academics'],
  ['operator', pt, '/api/onyx/platform/tenants/798/people?role=student&limit=200'],
  ['operator', pt, '/api/onyx/platform/tenants/798/banks'],
  ['operator', pt, '/api/onyx/platform/tenants/798/receipts'],
];

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows = [];

for (const [role, token, path] of ENDPOINTS) {
  const times = [];
  let bytes = 0;
  let status = 0;
  let count = null;
  for (let i = 0; i < RUNS; i += 1) {
    const t0 = Date.now();
    const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token } });
    const text = await r.text();
    times.push(Date.now() - t0);
    bytes = Math.max(bytes, Buffer.byteLength(text));
    status = r.status;
    if (count === null) {
      try {
        const d = JSON.parse(text)?.data;
        count = Array.isArray(d) ? d.length
          : (Array.isArray(d?.people) ? d.people.length
            : (Array.isArray(d?.courses) ? d.courses.length : null));
      } catch { count = null; }
    }
  }
  const ms = median(times);
  const kb = bytes / 1024;
  rows.push({ role, path, ms, kb, status, count });
  console.log(String(ms).padStart(6) + ' ms  '
    + String(kb.toFixed(1)).padStart(8) + ' KB  '
    + (count === null ? '        ' : String(count).padStart(5) + ' rows ')
    + role.padEnd(9) + path
    + (status === 200 ? '' : '   HTTP ' + status));
}

console.log('\n' + '='.repeat(76));
console.log('SLOWEST ENDPOINTS');
for (const r of [...rows].filter((x) => x.status === 200)
  .sort((a, b) => b.ms - a.ms).slice(0, 12)) {
  console.log('  ' + String(r.ms).padStart(6) + ' ms  ' + r.role.padEnd(9) + r.path
    + (r.count !== null ? '  (' + r.count + ' rows, ' + r.kb.toFixed(0) + ' KB)' : ''));
}
console.log('\nHEAVIEST RESPONSES — candidates for pagination');
for (const r of [...rows].filter((x) => x.status === 200)
  .sort((a, b) => b.kb - a.kb).slice(0, 12)) {
  console.log('  ' + String(r.kb.toFixed(0)).padStart(6) + ' KB  ' + r.role.padEnd(9) + r.path
    + (r.count !== null ? '  (' + r.count + ' rows)' : ''));
}
