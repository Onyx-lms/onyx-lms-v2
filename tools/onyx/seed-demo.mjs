/**
 * The demo institution and one account per role -- reproducibly.
 *
 * v1 had no equivalent. Its demo tenant was assembled ad hoc over a working
 * session through the running API, which meant the only record of how to get a
 * usable database was a scrollback buffer: standing up a fresh project left you
 * with 141 empty tables, a platform admin, and no way to sign in as anybody
 * else. It also meant v1's data accumulated test debris nobody could
 * distinguish from real seed (twelve leftover QA courses, at one point).
 *
 * This goes through the HTTP API rather than writing rows, deliberately. The
 * service layer is where the invariants live -- createTenant() composes a
 * tenant insert, a GoTrue account and an admin membership, and PlatformService
 * enforces slug uniqueness and role validity. Seeding underneath it would
 * reproduce those rules by hand and drift from them silently. The one thing
 * that cannot go through the API is the FIRST platform admin (nobody holds a
 * token yet); that stays in grant-platform-admin.mjs.
 *
 * Usage
 *   node tools/onyx/seed-demo.mjs [--api http://localhost:5175]
 *
 * Idempotent: an institution whose slug already exists is reused, and a member
 * who already exists is left alone. Safe to re-run after a partial failure.
 */
const API = (() => {
  const i = process.argv.indexOf('--api');
  return i === -1 ? 'http://localhost:5175' : process.argv[i + 1];
})();

const PLATFORM = { email: 'superadmin@onyx.platform', password: 'Platform#2026!' };
const PW = 'Demo#2026!';

/** The institution, and every role the product has a screen for. */
const TENANT = { name: 'ABC Institution', slug: 'abc-institution', plan: 'standard' };
const ADMIN = { name: 'Ada Admin', email: 'admin@demo.onyx', password: PW };
const MEMBERS = [
  { role: 'faculty',   name: 'Dr. Fiona Faculty',  email: 'faculty@demo.onyx' },
  { role: 'student',   name: 'Sam Student',        email: 'student@demo.onyx' },
  { role: 'exams',     name: 'Eli Examiner',       email: 'exams@demo.onyx' },
  { role: 'placement', name: 'Pia Placement',      email: 'placement@demo.onyx' },
  { role: 'employer',  name: 'Evan Employer',      email: 'employer@demo.onyx' },
  { role: 'guardian',  name: 'Gita Guardian',      email: 'guardian@demo.onyx' },
];

async function call(path, { method, body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok && json.ok !== false, body: json };
}

function die(what, r) {
  console.error('FAILED: ' + what + ' -> HTTP ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
  process.exit(1);
}

// ---- 1. the operator's token -------------------------------------------------
const login = await call('/api/onyx/platform/login', { body: PLATFORM });
if (!login.ok) die('platform login (run grant-platform-admin.mjs first)', login);
const platformToken = login.body.data.token;
console.log('signed in as ' + PLATFORM.email);

// ---- 2. the institution -----------------------------------------------------
// Reuse rather than recreate: createTenant() 422s on a duplicate slug, and a
// re-run should be a no-op, not a failure.
const existing = await call('/api/onyx/platform/tenants?search=' + encodeURIComponent(TENANT.name),
  { token: platformToken });
let tenant = (existing.body?.data ?? []).find((t) => t.slug === TENANT.slug) ?? null;

if (tenant) {
  console.log('institution already present: ' + tenant.name + ' (id ' + tenant.id + ')');
} else {
  const created = await call('/api/onyx/platform/tenants',
    { body: { ...TENANT, admin: ADMIN }, token: platformToken });
  if (!created.ok) die('create institution', created);
  tenant = created.body.data.tenant ?? created.body.data;
  console.log('created institution: ' + TENANT.name + ' (id ' + tenant.id + ') with admin ' + ADMIN.email);
}

// ---- 3. one member per role -------------------------------------------------
// As the institution's own administrator, not as the operator: adding a member
// is a tenant-scoped act, and doing it with a platform token would exercise a
// path no real administrator uses.
const adminLogin = await call('/api/onyx/auth/login', { body: { email: ADMIN.email, password: PW } });
if (!adminLogin.ok) die('admin login', adminLogin);
const adminToken = adminLogin.body.data.token;

const roster = await call('/api/onyx/members', { token: adminToken });
const already = new Set((roster.body?.data ?? []).map((m) => (m.user?.email ?? '').toLowerCase()));

let added = 0;
for (const m of MEMBERS) {
  if (already.has(m.email)) { console.log('  = ' + m.role.padEnd(10) + m.email + ' (already a member)'); continue; }
  const r = await call('/api/onyx/members',
    { body: { name: m.name, email: m.email, password: PW, role: m.role }, token: adminToken });
  if (!r.ok) die('add ' + m.role + ' ' + m.email, r);
  console.log('  + ' + m.role.padEnd(10) + m.email);
  added += 1;
}

// ---- 4. one Code Lab problem ------------------------------------------------
// Seeded because the grading path is the one part of this product that cannot be
// exercised without content: a submission needs a published problem with at least
// one visible test case. Without this, verifying that queue draining works means
// hand-building a problem first -- which is how the original project ended up with
// test debris nobody could tell apart from seed data.
const problems = await call('/api/onyx/problems?all=1', { token: adminToken });
const existingProblem = (problems.body?.data ?? []).find((p) => p.slug === 'echo-the-input');

if (existingProblem) {
  console.log('  = problem   echo-the-input (already present)');
} else {
  const created = await call('/api/onyx/problems', {
    token: adminToken,
    body: {
      title: 'Echo the input',
      difficulty: 'easy',
      languages: ['python'],
      statement: 'Read one line from standard input and print it back unchanged.',
    },
  });
  if (!created.ok) die('create the demo problem', created);
  const problemId = created.body.data.id;

  // `is_hidden: false` on purpose -- publishing refuses a problem whose every
  // case is hidden ("At least one case has to be visible"), because a learner
  // needs something to check their work against before submitting.
  const tests = await call('/api/onyx/problems/' + problemId + '/tests', {
    method: 'PUT',
    token: adminToken,
    body: {
      tests: [{ name: 'echo', stdin: 'hello\n', expected_stdout: 'hello', is_hidden: false, weight: 1 }],
    },
  });
  if (!tests.ok) die('add the demo test case', tests);

  const published = await call('/api/onyx/problems/' + problemId + '/publish', { token: adminToken });
  if (!published.ok) die('publish the demo problem', published);
  console.log('  + problem   echo-the-input (published, 1 visible test)');
}

console.log('\nseeded ' + TENANT.name + ': ' + (MEMBERS.length + 1) + ' accounts ('
  + added + ' new this run)');
console.log('every *@demo.onyx password is ' + PW + '; platform is ' + PLATFORM.password);
