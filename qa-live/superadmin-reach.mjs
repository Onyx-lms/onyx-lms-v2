/**
 * Does the platform operator actually control everything, administrators
 * included?
 *
 * "Superadmin holds every capability" is easy to assert and easy to get
 * wrong in the direction that matters: the operator is not a member of the
 * institution, so every guard written as "admin or the course's own faculty"
 * excludes them by construction unless somebody remembered. This walks the
 * reach that has to hold -- read and set the institution's permission matrix,
 * override one person's permissions, change an administrator's role, suspend
 * and restore an administrator -- and puts everything back.
 *
 *   node --env-file=.env qa-live/superadmin-reach.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const TENANT = 798;

const call = async (path, body, token, method = 'GET') => {
  const r = await fetch(BASE + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(56), detail);
};

const ops = (await (await fetch(BASE + '/api/onyx/platform/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'superadmin@onyx.platform', password: 'Platform#2026!' }) })).json())?.data?.token;
check('the operator signs in', !!ops);
const T = '/api/onyx/platform/tenants/' + TENANT;

// --- 1. the institution's matrix ------------------------------------------
const perms = (await call(T + '/permissions', undefined, ops)).body?.data;
check('reads the whole capability matrix', (perms?.capabilities ?? []).length > 40,
  (perms?.capabilities ?? []).length + ' capabilities across '
  + (perms?.areas ?? []).length + ' areas');
check('every capability says who holds it now',
  (perms?.capabilities ?? []).every((c) => Array.isArray(c.holders_now)),
  (perms?.capabilities ?? []).find((c) => c.key === 'assignments.set')?.holders_now?.join('/'));

// --- 2. one administrator, by name ----------------------------------------
const people = (await call(T + '/people?role=admin', undefined, ops)).body?.data;
const admins = people?.people ?? people ?? [];
const target = admins.find((p) => p.email === 'admin@mrdemo.test') ?? admins[0];
/*
 * The MEMBERSHIP id, not the user id.
 *
 * A person is one account and can belong to several institutions, so what the
 * console acts on is their membership OF THIS ONE -- which is what makes
 * "change their role" mean something. Sending the user id gets a truthful 404:
 * there is no membership with that id here.
 */
const member = target?.membership_id ?? target?.id;
check('finds an administrator to act on', !!target && !!member,
  target?.email + ' (membership ' + member + ')');

// --- 3. their own permission overrides ------------------------------------
const MP = T + '/members/' + member + '/permissions';
const mineBefore = (await call(MP, undefined, ops)).body?.data;
check('reads one person’s own permissions', !!mineBefore,
  (mineBefore?.capabilities ?? []).length + ' capabilities');
const grant = await call(MP, { permissions: { 'assignments.grade': false } }, ops, 'PUT');
check('can take a capability off one administrator', grant.status === 200,
  'HTTP ' + grant.status + ' ' + (grant.body?.message ?? ''));
const restoreMine = await call(MP, { permissions: {} }, ops, 'PUT');
check('  and give it back', restoreMine.status === 200);

// --- 4. the last administrator is protected FROM the operator too ---------
/*
 * Not a gap in the operator's reach -- the point of it.
 *
 * Demoting an institution's only administrator would leave it with nobody who
 * can add one, which is unrecoverable from inside and is exactly the mistake a
 * console makes easy. The same guard the institution's own changeRole applies
 * internally applies here, so "the operator controls everything" stops short
 * of "the operator can strand an institution by accident".
 */
const lastOne = await call(T + '/members/' + member, { role: 'faculty' }, ops, 'PATCH');
check('the LAST administrator cannot be demoted, even by the operator',
  lastOne.status === 422,
  'HTTP ' + lastOne.status + ' ' + (lastOne.body?.message ?? '').slice(0, 60));

// --- 4b. with a second administrator, the role does change ----------------
const tag = 'reach-' + Math.random().toString(36).slice(2, 7);
const made = await call(T + '/members', {
  name: 'Reach Probe ' + tag, email: 'reach.' + tag + '@mrdemo.test',
  role: 'admin', password: 'Probe#2026!',
}, ops, 'POST');
check('can add a second administrator', made.status === 200,
  'HTTP ' + made.status + ' ' + (made.body?.message ?? ''));
const second = ((await call(T + '/people?role=admin', undefined, ops)).body?.data?.people ?? [])
  .find((p) => String(p.email).startsWith('reach.' + tag));
const secondId = second?.membership_id ?? second?.id;

const demote = await call(T + '/members/' + secondId, { role: 'faculty' }, ops, 'PATCH');
check('can change an administrator’s role', demote.status === 200,
  'admin → faculty, HTTP ' + demote.status);
const promote = await call(T + '/members/' + secondId, { role: 'admin' }, ops, 'PATCH');
check('  and change it back', promote.status === 200, 'faculty → admin');
const removed = await call(T + '/members/' + secondId, undefined, ops, 'DELETE');
check('can remove an administrator', removed.status === 200,
  'HTTP ' + removed.status + ' ' + (removed.body?.message ?? ''));

const suspend = await call(T + '/members/' + member, { account_status: 0 }, ops, 'PATCH');
check('can suspend an administrator', suspend.status === 200, 'HTTP ' + suspend.status);
const revive = await call(T + '/members/' + member, { account_status: 1 }, ops, 'PATCH');
check('  and restore them', revive.status === 200);

// --- 5. and they are as they were -----------------------------------------
const after = ((await call(T + '/people?role=admin', undefined, ops)).body?.data?.people ?? [])
  .find((p) => p.user_id === target.user_id);
check('the administrator is exactly as found',
  after?.role === 'admin' && Number(after?.account_status) === 1,
  'role=' + after?.role + ' account_status=' + after?.account_status);

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(results.filter((r) => r.pass).length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
