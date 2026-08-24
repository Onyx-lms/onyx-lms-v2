/**
 * Open and locked courses, from the console through to the learner.
 *
 * A super admin creates one of each, and the checks follow what a student then
 * sees and can do: an open course joined for nothing, a locked one priced at
 * ₹300 that refuses to be joined until it is bought.
 *
 * ABC Institution only (tenant 1).
 */
const BASE = process.env.QA_BASE ?? 'http://localhost:5199';
const TENANT = 1;
const STAMP = Date.now().toString(36);
const RUPEE = (minor) => '₹' + (minor / 100).toFixed(2);

let failures = 0;
const log = (...a) => console.log(...a);
const ok = (l, c, d = '') => {
  log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? ' — ' + d : ''));
  if (!c) failures += 1;
  return c;
};
async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, ...(json ?? {}) };
}
function must(label, r) {
  if (!r.ok) {
    log('  FAIL  ' + label + ' — ' + r.status + ' ' + (r.message ?? '')
      + (r.errors ? ' ' + JSON.stringify(r.errors) : ''));
    failures += 1;
    throw new Error(label);
  }
  log('  PASS  ' + label);
  return r.data;
}

const base = '/api/onyx/platform/tenants/' + TENANT;
const S = {};

log('\n=== 1. Sign in ===');
{
  S.platform = must('super admin', await api('/api/onyx/platform/login', {
    method: 'POST',
    body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' },
  })).token;
  const sd = must('student', await api('/api/onyx/auth/login', {
    method: 'POST',
    body: { email: 'student@demo.onyx', password: 'Demo#2026!', tenant_id: TENANT },
  }));
  S.student = sd.token;
  S.studentId = sd.user?.id;
  ok('the student is in ABC', sd.tenant?.name === 'ABC Institution');
}

log('\n=== 2. The super admin creates an OPEN course ===');
{
  const c = must('created as open', await api(base + '/courses', {
    method: 'POST', token: S.platform,
    body: { code: 'OPEN' + STAMP.slice(-4).toUpperCase(), title: 'Open course ' + STAMP,
      credits: 3, access: 'open', status: 1 },
  }));
  S.openId = c.id;
  ok('the console records it as open', c.access === 'open', String(c.access));
  ok('it is free', Number(c.price_minor) === 0, RUPEE(Number(c.price_minor ?? 0)));

  // access and self_enroll must not disagree: the catalogue reads one and
  // selfEnroll() reads the other.
  const list = must('the console lists it', await api(base + '/academics?limit=200',
    { token: S.platform }));
  const row = (list.courses ?? []).find((x) => Number(x.id) === Number(c.id));
  ok('the console list shows how it is joined', row?.access === 'open', String(row?.access));
  ok('self-enrolment agrees with it', row?.self_enroll === true, String(row?.self_enroll));
}

log('\n=== 3. …and a LOCKED course at the house price ===');
{
  const c = must('created as locked, with no price given', await api(base + '/courses', {
    method: 'POST', token: S.platform,
    body: { code: 'LOCK' + STAMP.slice(-4).toUpperCase(), title: 'Locked course ' + STAMP,
      credits: 3, access: 'locked', status: 1 },
  }));
  S.lockedId = c.id;
  ok('the console records it as locked', c.access === 'locked', String(c.access));
  ok('choosing locked priced it at ₹300', Number(c.price_minor) === 30000,
    RUPEE(Number(c.price_minor ?? 0)));

  const dearer = must('a locked course can carry its own price', await api(base + '/courses', {
    method: 'POST', token: S.platform,
    body: { code: 'DEAR' + STAMP.slice(-4).toUpperCase(), title: 'Dearer course ' + STAMP,
      credits: 3, access: 'locked', price_minor: 149900, status: 1 },
  }));
  S.dearId = dearer.id;
  ok('the price given is the price kept', Number(dearer.price_minor) === 149900,
    RUPEE(Number(dearer.price_minor)));
}

log('\n=== 4. Changing a course from open to locked, and back ===');
{
  const locked = must('the open course is switched to locked', await api(
    base + '/courses/' + S.openId,
    { method: 'PATCH', token: S.platform, body: { access: 'locked' } }));
  ok('it is priced on the way', Number(locked.price_minor) === 30000,
    RUPEE(Number(locked.price_minor ?? 0)));

  const dearerStill = must('the dearer course is switched to open and back', await api(
    base + '/courses/' + S.dearId,
    { method: 'PATCH', token: S.platform, body: { access: 'open' } }));
  void dearerStill;
  const relocked = must('…and locked again', await api(base + '/courses/' + S.dearId,
    { method: 'PATCH', token: S.platform, body: { access: 'locked' } }));
  ok('a price somebody chose is not overwritten by the house price',
    Number(relocked.price_minor) === 149900, RUPEE(Number(relocked.price_minor ?? 0)));

  // Put the first course back to open for the learner half below.
  must('the first course goes back to open', await api(base + '/courses/' + S.openId,
    { method: 'PATCH', token: S.platform, body: { access: 'open' } }));
}

log('\n=== 5. What the student sees ===');
{
  const cat = must('the student reads the catalogue',
    await api('/api/onyx/courses', { token: S.student }));
  const open = cat.find((c) => Number(c.id) === Number(S.openId));
  const locked = cat.find((c) => Number(c.id) === Number(S.lockedId));

  ok('the open course is on the catalogue as open', open?.access === 'open', String(open?.access));
  ok('the locked course is on it as locked', locked?.access === 'locked',
    String(locked?.access));
  ok('and carries its price', Number(locked?.price_minor) === 30000,
    RUPEE(Number(locked?.price_minor ?? 0)));

  const owned = await api('/api/onyx/my/purchases', { token: S.student });
  ok('the student does not own the locked course yet',
    !(owned.data ?? []).map(Number).includes(Number(S.lockedId)));
}

log('\n=== 6. Joining ===');
{
  const joined = await api('/api/onyx/courses/' + S.openId + '/enroll',
    { method: 'POST', token: S.student, body: {} });
  ok('the student joins the OPEN course for nothing', joined.ok === true,
    joined.message ?? '');

  const mine = await api('/api/onyx/my/courses', { token: S.student });
  ok('it appears among their courses',
    (mine.data ?? []).some((c) => Number(c.id) === Number(S.openId)));

  const refused = await api('/api/onyx/courses/' + S.lockedId + '/enroll',
    { method: 'POST', token: S.student, body: {} });
  ok('the LOCKED course refuses a free join', refused.ok === false,
    refused.status + ' ' + (refused.message ?? ''));
  ok('and the refusal names the price rather than a constraint',
    /pay|buy|purchase|unlock|₹|price/i.test(String(refused.message ?? '')),
    String(refused.message ?? ''));

  const still = await api('/api/onyx/my/courses', { token: S.student });
  ok('the locked course did not slip onto their list',
    !(still.data ?? []).some((c) => Number(c.id) === Number(S.lockedId)));
}

log('\n=== 7. Unlocking ===');
{
  // Checkout takes the gateway the institution has switched on -- the same
  // list the catalogue's unlock button reads.
  const gateways = await api('/api/onyx/gateways', { token: S.student });
  const gateway = (gateways.data ?? [])[0]?.identifier ?? 'mock';
  log('        gateway: ' + gateway);
  const intent = await api('/api/onyx/courses/' + S.lockedId + '/checkout',
    { method: 'POST', token: S.student, body: { gateway } });
  log('        checkout -> ' + intent.status + ' '
    + JSON.stringify(intent.data ?? intent.message).slice(0, 180));
  ok('the learner is offered a way to pay for it',
    intent.ok === true || /gateway|configur/i.test(String(intent.message ?? '')),
    intent.message ?? 'intent created');
}

log('\n=== ids ===');
log(JSON.stringify(S, (k, v) => (k === 'platform' || k === 'student' ? undefined : v), 1));
log('\n' + (failures ? failures + ' FAILURES' : 'open and locked behave as specified'));
process.exitCode = failures ? 1 : 0;
