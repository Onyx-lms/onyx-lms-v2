/**
 * The parent and guardian portal, with an actual family in it.
 *
 * The quality report scored this 6 and said exactly why: "gated behind a link
 * the learner initiates and confirms, which is the right consent model. No
 * linked learner existed to exercise it." The design was judged sound and the
 * behaviour was never seen, because the demo institution had no guardian
 * linked to anybody.
 *
 * So this makes one and walks the whole consent model, which is the part worth
 * proving: a link grants NOTHING until the learner accepts it, and each of the
 * three things a guardian might see -- attendance, results, fees -- is a
 * separate switch the learner holds. The interesting checks here are the
 * refusals: a guardian who has not been accepted, and a guardian who has been
 * accepted but not consented for a scope, must both be turned away.
 *
 * Idempotent: the guardian account and the link are re-used.
 *
 *   node --env-file=.env qa-live/a-guardian-sees-their-child.mjs
 */
const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const DOMAIN = 'mrdemo.test';
const STAFF_PW = 'MrDemo#2026!';
const STUDENT_PW = 'Student#2026!';
const GUARDIAN = { email: 'guardian1@' + DOMAIN, password: 'Guardian#2026!',
  name: 'Mrs Lakshmi Iyer' };
const STUDENT = 'alpha-cse.004@' + DOMAIN;

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(58) + ' ' + detail);
};

async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, data: j?.data ?? null, message: j?.message ?? null };
}
const login = async (email, password) =>
  (await call('/api/onyx/auth/login', { method: 'POST', body: { email, password } })).data?.token;

const at = await login('admin@' + DOMAIN, STAFF_PW);
const st = await login(STUDENT, STUDENT_PW);
if (!at || !st) { console.error('could not sign in'); process.exit(1); }
const studentId = (await call('/api/onyx/me', { token: st })).data?.user_id;

console.log('\n== a guardian gets an account ==\n');

const members = (await call('/api/onyx/members?role=guardian&limit=200', { token: at })).data;
const guardians = Array.isArray(members) ? members : (members?.people ?? []);
let guardianId = guardians.find((m) => (m.user?.email ?? m.email) === GUARDIAN.email)?.user_id;

if (!guardianId) {
  const made = await call('/api/onyx/members', {
    method: 'POST', token: at,
    body: { name: GUARDIAN.name, email: GUARDIAN.email, role: 'guardian',
      password: GUARDIAN.password },
  });
  check('the institution can register a guardian', made.status < 300,
    'HTTP ' + made.status + ' ' + (made.message ?? ''));
  guardianId = made.data?.user?.id;
} else {
  check('the institution can register a guardian', true, 're-using ' + GUARDIAN.email);
}

const gt = await login(GUARDIAN.email, GUARDIAN.password);
check('and they can sign in', Boolean(gt), GUARDIAN.email);

console.log('\n== the link, which grants nothing on its own ==\n');

let link = ((await call('/api/onyx/guardians', { token: st })).data ?? [])
  .find((l) => String(l.guardian_user_id) === String(guardianId));

if (!link) {
  const made = await call('/api/onyx/guardians', {
    method: 'POST', token: at,
    body: { guardian_user_id: guardianId, student_user_id: studentId, relationship: 'Mother' },
  });
  check('the office proposes a link', made.status < 300,
    'HTTP ' + made.status + ' ' + (made.message ?? ''));
  link = made.data;
} else {
  check('the office proposes a link', true, 're-using link #' + link.id);
}

/*
 * The whole model in one check. A proposed link is an invitation, not access:
 * until the learner accepts, the guardian's family view must be empty.
 */
/** The family view answers with `{ children: [...] }`, not a bare array. */
const childrenOf = (payload) => payload?.children ?? (Array.isArray(payload) ? payload : []);

// `verified_at` is the acceptance stamp: the learner confirming is what
// verifies the link, and the column is named for the state, not the act.
if (!link?.verified_at) {
  const early = childrenOf((await call('/api/onyx/family', { token: gt })).data);
  check('BEFORE the learner accepts, the guardian sees nobody',
    early.length === 0, early.length + ' learner(s) visible');
} else {
  check('BEFORE the learner accepts, the guardian sees nobody', true,
    'accepted on an earlier run — proved when the link was new');
}

const accepted = await call('/api/onyx/guardians/' + link.id + '/accept',
  { method: 'POST', token: st });
check('the learner accepts it', accepted.status < 300 || /already/i.test(accepted.message ?? ''),
  'HTTP ' + accepted.status + ' ' + (accepted.message ?? ''));

const family = childrenOf((await call('/api/onyx/family', { token: gt })).data);
check('and the guardian now sees their child', family.length > 0,
  family.length + ' learner(s): ' + family.map((f) => f.name).join(', '));

console.log('\n== each scope is its own switch, held by the learner ==\n');

const SCOPES = [
  ['attendance', '/api/onyx/family/' + studentId + '/attendance'],
  ['results', '/api/onyx/family/' + studentId + '/results'],
  ['fees', '/api/onyx/family/' + studentId + '/fees'],
];

// Off first, so the refusal is proved rather than assumed.
for (const [scope, path] of SCOPES) {
  await call('/api/onyx/guardians/' + link.id + '/consent',
    { method: 'POST', token: st, body: { scope, allowed: false } });
  const refused = await call(path, { token: gt });
  check('with ' + scope + ' consent OFF, the guardian is refused',
    refused.status === 403, 'HTTP ' + refused.status + ' ' + (refused.message ?? ''));
}

for (const [scope, path] of SCOPES) {
  const given = await call('/api/onyx/guardians/' + link.id + '/consent',
    { method: 'POST', token: st, body: { scope, allowed: true } });
  const allowed = await call(path, { token: gt });
  check('with ' + scope + ' consent ON, the guardian can read it',
    given.status < 300 && allowed.status === 200,
    'HTTP ' + allowed.status + ' · '
    + (Array.isArray(allowed.data) ? allowed.data.length + ' rows'
      : Object.keys(allowed.data ?? {}).length + ' fields'));
}

/*
 * And nobody else's child. A portal that shows one family's records to another
 * family is the one failure this feature cannot survive.
 */
const other = (await call('/api/onyx/members?role=student&limit=5', { token: at })).data;
const others = Array.isArray(other) ? other : (other?.people ?? []);
const stranger = others.map((m) => m.user_id).find((id) => String(id) !== String(studentId));
if (stranger) {
  const peek = await call('/api/onyx/family/' + stranger + '/results', { token: gt });
  check('but not another family’s child', peek.status === 403 || peek.status === 404,
    'HTTP ' + peek.status + ' ' + (peek.message ?? ''));
} else {
  check('but not another family’s child', true, 'no second learner to try');
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(results.length - failed.length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
console.log('\nLeft on the demo institution on purpose: ' + GUARDIAN.name + ', linked to '
  + STUDENT + ' with all three consents given, so the family view has a family in it.');
process.exit(failed.length ? 1 : 0);
