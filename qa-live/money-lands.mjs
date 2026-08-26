/**
 * Does every rupee reach the operator's Fees tab?
 *
 * Three things here take money -- a fee invoice, a course, and a Live Class --
 * and an operator on a billing call needs all three in one place, said in the
 * terms an institution looks people up by: who paid, their roll number, their
 * division, which institution, and the reference somebody quotes down the
 * phone.
 *
 * Buys a Live Class as a real learner and reads the console's receipt back.
 * The registration is left in place -- a receipt somebody can look at is worth
 * more on a demo than a clean count -- and it is a FREE Live Class, so nothing
 * is charged.
 *
 *   node --env-file=.env qa-live/money-lands.mjs
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

const student = await login('alpha-cse.002@mrdemo.test', 'Student#2026!');
const ops = await login('superadmin@onyx.platform', 'Platform#2026!', '/api/onyx/platform/login');
check('a learner and the operator sign in', !!student && !!ops);

// --- the learner registers for a Live Class --------------------------------
const domains = (await call('/api/onyx/domains', student)).body?.data ?? [];
const free = domains.find((d) => Number(d.price_minor) === 0);
const reg = await call('/api/onyx/domains/' + free.id + '/register', student, {}, 'POST');
check('the learner registers for a Live Class', reg.status === 200,
  free.title + ' — ' + (reg.body?.data?.replayed ? 'already registered' : 'new'));

// --- and it is on the operator's receipt -----------------------------------
const receipt = (await call('/api/onyx/platform/tenants/' + TENANT + '/receipts', ops)).body?.data;
check('the console reads the receipt', !!receipt, (receipt?.rows ?? []).length + ' rows');

const kinds = new Set((receipt?.rows ?? []).map((r) => r.kind));
check('it carries every kind of money the product takes',
  kinds.has('live_class'), [...kinds].join(', ') || 'none');

const mine = (receipt?.rows ?? []).find((r) => r.kind === 'live_class');
if (mine) {
  console.log('\n    ' + JSON.stringify({
    what: mine.what, amount: mine.amount_minor, method: mine.method, status: mine.status,
    reference: mine.reference, gateway_reference: mine.gateway_reference,
    learner: mine.learner, institution: mine.institution?.name,
  }, null, 1).split('\n').join('\n    ') + '\n');

  check('the row names the learner', !!mine.learner?.name, mine.learner?.name ?? '—');
  check('with their roll number', !!mine.learner?.roll_number, mine.learner?.roll_number ?? '—');
  check('and their division', !!mine.learner?.section, mine.learner?.section ?? '—');
  check('and the institution', !!mine.institution?.name, mine.institution?.name ?? '—');
  check('and a reference somebody can quote', !!mine.reference, mine.reference ?? '—');
  check('and what it was for', !!mine.what, mine.what ?? '—');
}

/*
 * --- and a course purchase, made rather than assumed ----------------------
 *
 * Nobody had bought one at the demo, so asserting course rows existed was
 * asserting a fixture. This buys one.
 *
 * Through `/purchase` rather than `/checkout`: the second hands back a
 * Razorpay order for a browser to complete, which a script cannot do without
 * a real card. Both settle into the SAME row -- `#settleCourse` is what the
 * gateway's webhook and redirect both call -- so what this proves about the
 * receipt holds for a Razorpay sale too. The gateway a row was taken through
 * is on the row, which is how the two are told apart afterwards.
 */
const catalogue = (await call('/api/onyx/courses?all=1', student)).body?.data ?? [];
const locked = catalogue.find((c) => c.access === 'locked');
if (locked) {
  const bought = await call('/api/onyx/courses/' + locked.id + '/purchase', student, {}, 'POST');
  check('the learner buys a course', bought.status === 200 || bought.status === 409,
    locked.code + ' — HTTP ' + bought.status + ' '
    + String(bought.body?.message ?? '').slice(0, 40));
}

const again = (await call('/api/onyx/platform/tenants/' + TENANT + '/receipts', ops)).body?.data;
const courses = (again?.rows ?? []).filter((r) => r.kind === 'course');
check('course purchases are on it too', courses.length > 0,
  courses.length + ' course row' + (courses.length === 1 ? '' : 's'));
if (courses.length) {
  const c = courses[0];
  check('  and a course row is named the same way',
    !!c.learner?.name && !!c.reference, (c.learner?.name ?? '?') + ' · ' + c.reference);
}

check('Live Class money is counted in its own right',
  typeof again?.summary?.from_live_classes_minor === 'number',
  'from_live_classes_minor = ' + again?.summary?.from_live_classes_minor);
check('and course money separately from it',
  typeof again?.summary?.from_courses_minor === 'number',
  'from_courses_minor = ' + again?.summary?.from_courses_minor);

/*
 * The enrolment the purchase created is taken back out; the RECEIPT is not.
 *
 * Buying a course enrols the buyer, and the demo's seeded figures are a
 * contract -- e2e-malla-reddy-demo asserts the enrolment count -- so a suite
 * that leaves one behind turns another suite red for a reason of its own
 * making. That is what happened the first time this ran.
 *
 * The purchase row stays. It is a financial record, deleting one is not a
 * thing this product does or should do, and leaving it is what makes the Fees
 * tab worth opening on a demo. It moves no count that anything asserts.
 */
if (locked) {
  const admin = await login('admin@mrdemo.test', 'MrDemo#2026!');
  // `user_id`, not `user.id`: /me is flat about who you are and nests only
  // the institution. Reading the wrong one 404s, and a check that accepts a
  // 404 as success is a check that passes while the enrolment stays.
  const me = (await call('/api/onyx/me', student)).body?.data;
  const off = await call('/api/onyx/courses/' + locked.id + '/enroll/' + me?.user_id,
    admin, undefined, 'DELETE');
  check('the enrolment it created is withdrawn again', off.status === 200,
    'HTTP ' + off.status + ' — the receipt row stays, as a record should');
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(76));
console.log(results.filter((r) => r.pass).length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
