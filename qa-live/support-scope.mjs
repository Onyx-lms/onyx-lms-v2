/**
 * Who reads the support desk?
 *
 * Help is where somebody raises a query that is NOT about a course -- a fee
 * receipt, a timetable clash, an account they cannot get into. Course
 * questions have their own threaded Q&A inside the course, in front of the
 * lecturer who teaches it. So the queue belongs to administration, and to
 * anyone an institution has deliberately put on the rota by granting
 * `support.assign`.
 *
 * It used to belong to every lecturer, which meant every lecturer could read
 * every question anybody at the institution had ever asked. This asserts the
 * new line from all four sides, and puts back anything it changes.
 *
 *   node --env-file=.env qa-live/support-scope.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const TENANT = 798;

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(56), detail);
};
const login = async (email, password, path = '/api/onyx/auth/login') =>
  (await (await fetch(BASE + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }) })).json())?.data?.token;
const call = async (path, tok, body, method = 'GET') => {
  const r = await fetch(BASE + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const student = await login('alpha-cse.007@mrdemo.test', 'Student#2026!');
const faculty = await login('faculty1@mrdemo.test', 'MrDemo#2026!');
const admin = await login('admin@mrdemo.test', 'MrDemo#2026!');
const ops = await login('superadmin@onyx.platform', 'Platform#2026!', '/api/onyx/platform/login');
check('everyone signs in', !!student && !!faculty && !!admin && !!ops);

// A query that has nothing to do with a course.
const tag = Math.random().toString(36).slice(2, 7);
const raised = await call('/api/onyx/tickets', student, {
  subject: 'Fee receipt is wrong ' + tag,
  body: 'The amount on my receipt does not match what I paid.',
}, 'POST');
check('a learner raises a support query', raised.status === 200,
  'ticket ' + (raised.body?.data?.id ?? '?'));
const ticketId = raised.body?.data?.id;

// --- who can read it -------------------------------------------------------
const mine = (await call('/api/onyx/tickets', student)).body?.data ?? [];
check('the learner sees their own', mine.some((t) => Number(t.id) === Number(ticketId)),
  mine.length + ' of their own');

const facQueue = (await call('/api/onyx/tickets', faculty)).body?.data ?? [];
check('a lecturer does NOT see it',
  !facQueue.some((t) => Number(t.id) === Number(ticketId)),
  facQueue.length + ' tickets visible to faculty (their own only)');

const one = await call('/api/onyx/tickets/' + ticketId, faculty);
check('and is refused it by id', one.status === 403,
  'HTTP ' + one.status + ' ' + String(one.body?.message ?? '').slice(0, 40));

const admQueue = (await call('/api/onyx/tickets', admin)).body?.data ?? [];
check('the administrator sees it',
  admQueue.some((t) => Number(t.id) === Number(ticketId)),
  admQueue.length + ' in the queue');

const opsQueue = (await call('/api/onyx/platform/tenants/' + TENANT + '/tickets', ops)).body?.data ?? [];
check('the operator sees it',
  opsQueue.some((t) => Number(t.id) === Number(ticketId)),
  opsQueue.length + ' in the console queue');

// --- and an institution can still put a lecturer on the rota ---------------
const P = '/api/onyx/platform/tenants/' + TENANT + '/permissions';
const readOverrides = async () => {
  const d = (await call(P, ops)).body?.data;
  const out = {};
  for (const c of d?.capabilities ?? []) if (c.changed) out[c.key] = c.holders_now;
  return out;
};
const before = await readOverrides();
await call(P, ops, { permissions: { ...before, 'support.assign': ['admin', 'faculty'] } }, 'PUT');
const granted = (await call('/api/onyx/tickets', faculty)).body?.data ?? [];
check('granted support.assign, the lecturer sees the queue',
  granted.some((t) => Number(t.id) === Number(ticketId)),
  granted.length + ' in the queue');

await call(P, ops, { permissions: before }, 'PUT');
const after = (await call('/api/onyx/tickets', faculty)).body?.data ?? [];
check('and loses it again when it is taken back',
  !after.some((t) => Number(t.id) === Number(ticketId)),
  Object.keys(await readOverrides()).length + ' overrides, as found');

// --- clean up --------------------------------------------------------------
if (ticketId) {
  const closed = await call('/api/onyx/tickets/' + ticketId + '/resolve', admin,
    { note: 'Closing the probe.' }, 'POST');
  check('the probe ticket is closed', closed.status === 200, 'HTTP ' + closed.status);
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(76));
console.log(results.filter((r) => r.pass).length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
