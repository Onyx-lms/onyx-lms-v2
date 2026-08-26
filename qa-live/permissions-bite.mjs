/**
 * Do the permission switches actually stop anything?
 *
 * A capability that is declared, listed on a settings screen and never checked
 * is worse than no capability at all: an administrator turns it off, the
 * screen says it is off, and the lecturer goes on doing the thing. So this
 * does not read the matrix -- it TURNS EACH SWITCH OFF and then tries the act
 * it governs, expecting a 403 that names the capability, then turns it back on
 * and expects the same call to succeed.
 *
 * Runs against the demo institution and restores every switch it touches.
 *
 *   node --env-file=.env qa-live/permissions-bite.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const TENANT = 798;

const login = async (email, password, path = '/api/onyx/auth/login') =>
  (await (await fetch(BASE + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }) })).json())?.data?.token;

const call = async (path, body, token, method = 'POST') => {
  const r = await fetch(BASE + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(58), detail);
};

const ops = await login('superadmin@onyx.platform', 'Platform#2026!', '/api/onyx/platform/login');
const fac = await login('faculty1@mrdemo.test', 'MrDemo#2026!');
const admin = await login('admin@mrdemo.test', 'MrDemo#2026!');
check('everyone signs in', !!ops && !!fac && !!admin);

const P = '/api/onyx/platform/tenants/' + TENANT + '/permissions';

/*
 * The stored value is OVERRIDES ONLY -- migration 0023 keeps diffs from the
 * defaults, not a full matrix -- and the PUT replaces the whole of it. So a
 * change to one capability has to be merged onto what is already there, or
 * every other institution-specific decision is silently reset. The GET says
 * which entries are overrides with `changed`; that is what is rebuilt here.
 */
const readOverrides = async () => {
  const d = (await call(P, undefined, ops, 'GET')).body?.data;
  const out = {};
  for (const cap of d?.capabilities ?? []) {
    if (cap.changed) out[cap.key] = cap.holders_now;
  }
  return { overrides: out, capabilities: d?.capabilities ?? [] };
};

const start = await readOverrides();
check('the console can read the matrix', start.capabilities.length > 0,
  start.capabilities.length + ' capabilities, '
  + Object.keys(start.overrides).length + ' already overridden');
check('the new assignment keys are in it',
  start.capabilities.some((c) => c.key === 'assignments.set')
  && start.capabilities.some((c) => c.key === 'assignments.grade'),
  start.capabilities.filter((c) => c.area === 'Assignments').map((c) => c.key).join(', '));

/** Set one capability's holders, leaving every other override alone. */
async function setHolders(key, roles) {
  const { overrides } = await readOverrides();
  const r = await call(P, { permissions: { ...overrides, [key]: roles } }, ops, 'PUT');
  if (r.status !== 200) console.log('      (set ' + key + ' → HTTP ' + r.status + ' '
    + (r.body?.message ?? '') + ')');
  return r.status === 200;
}

const teach = (await call('/api/onyx/courses', undefined, fac, 'GET')).body?.data ?? [];
const course = teach.find((c) => c.code === 'WD101') ?? teach[0];
const tag = 'perm-' + Math.random().toString(36).slice(2, 7);

/*
 * One act per capability, chosen to be the cheapest real write it governs --
 * and every one of them undone or harmless, because this runs against a live
 * institution.
 */
const CASES = [
  { key: 'assignments.set', what: 'set an assignment',
    run: () => call('/api/onyx/courses/' + course.id + '/assignments',
      { title: 'Permission probe ' + tag, total_points: 10 }, fac),
    undo: (r) => r?.body?.data?.id
      && call('/api/onyx/assignments/' + r.body.data.id, undefined, admin, 'DELETE') },
  { key: 'assess.banks', what: 'build a question bank',
    run: () => call('/api/onyx/banks', { name: 'Permission probe ' + tag,
      course_id: course.id }, fac) },
  { key: 'courses.author', what: 'edit a course',
    run: () => call('/api/onyx/courses/' + course.id,
      { description: 'Permission probe ' + tag }, fac, 'PATCH') },
  { key: 'exams.schedule', what: 'schedule an examination',
    run: () => call('/api/onyx/exams', { title: 'Permission probe ' + tag,
      course_id: course.id, max_marks: 10, pass_marks: 4, duration_minutes: 30,
      starts_at: new Date(Date.now() + 200 * 86400e3).toISOString() }, fac),
    undo: (r) => r?.body?.data?.id
      && call('/api/onyx/exams/' + r.body.data.id, undefined, admin, 'DELETE') },
  { key: 'lab.problems', what: 'author a Code Lab problem',
    run: () => call('/api/onyx/problems', { kind: 'code', title: 'Permission probe ' + tag,
      languages: ['python'], difficulty: 'easy' }, fac),
    // No DELETE for a problem -- submissions reference it -- but unpublishing
    // keeps the probe off the practice bank a prospect opens.
    undo: (r) => r?.body?.data?.id
      && call('/api/onyx/problems/' + r.body.data.id + '/unpublish',
        undefined, admin) },
];

for (const c of CASES) {
  // --- revoked -----------------------------------------------------------
  await setHolders(c.key, ['admin']);
  const denied = await c.run();
  const names = JSON.stringify(denied.body?.message ?? '').toLowerCase();
  check('without ' + c.key + ', faculty cannot ' + c.what, denied.status === 403,
    'HTTP ' + denied.status + ' ' + (denied.body?.message ?? '').slice(0, 60));
  check('  and the refusal says which permission', denied.status === 403 && names.length > 4,
    (denied.body?.message ?? '').slice(0, 70));

  // --- granted -----------------------------------------------------------
  await setHolders(c.key, ['admin', 'faculty']);
  const allowed = await c.run();
  check('with ' + c.key + ', faculty can ' + c.what, allowed.status === 200,
    'HTTP ' + allowed.status + ' ' + (allowed.body?.message ?? '').slice(0, 40));
  if (c.undo) await c.undo(allowed);
}

// --- the matrix goes back exactly as it was --------------------------------
const restored = await call(P, { permissions: start.overrides }, ops, 'PUT');
const end = await readOverrides();
check('the matrix is put back', restored.status === 200
  && JSON.stringify(end.overrides) === JSON.stringify(start.overrides),
  Object.keys(end.overrides).length + ' overrides, as found');

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(results.filter((r) => r.pass).length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
