/**
 * Buying a course with real Razorpay credentials, against the deployed site.
 *
 * The gateway code has always been complete and has never been run against a
 * merchant account -- it was O3 in the quality report, and "untested" is not
 * a thing to discover on the day somebody's card is charged. This drives it
 * with the client's test-mode keys.
 *
 * **The keys are read from a file and never printed.** `rzp*.csv` is
 * git-ignored; nothing here logs a secret, and the one place a key id appears
 * in output is truncated. A credential in a transcript is a credential.
 *
 * **What this can and cannot prove.** It creates real orders at Razorpay and
 * checks every refusal around them, including the one that matters most: a
 * correctly-signed callback for an order Razorpay has NOT been paid leaves the
 * course locked, because the product asks Razorpay rather than believing the
 * browser. Carrying an actual card payment through needs Razorpay's own
 * checkout window, which is what `tests/browser/razorpay-purchase.spec.ts`
 * does.
 *
 *   node qa-live/pay.mjs
 */
import fs from 'node:fs';
import { createHmac } from 'node:crypto';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaPay#2026!';

const [, keyLine] = fs.readFileSync('rzp (1).csv', 'utf8').trim().split(/\r?\n/);
const [KEY_ID, KEY_SECRET] = keyLine.split(',').map((s) => s.trim());
// A webhook secret is ours to choose when the webhook is registered, so this
// run chooses one and signs with it. It is not a credential of the client's.
const WEBHOOK_SECRET = 'qa-webhook-' + RUN;

const results = [];
let phase = '';
const startPhase = (n) => { phase = n; console.log('\n== ' + n + ' =='); };
function check(label, pass, detail = '') {
  results.push({ phase, label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(54), detail);
  return pass;
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, body: parsed, data: parsed?.data, message: parsed?.message };
}
async function step(label, path, opts = {}) {
  const r = await call(path, opts);
  check(label, r.status >= 200 && r.status < 300, r.status + ' ' + (r.message ?? ''));
  return r;
}
async function refuse(label, expected, path, opts = {}) {
  const r = await call(path, opts);
  check(label, r.status === expected,
    'expected ' + expected + ', got ' + r.status + ' ' + (r.message ?? ''));
  return r;
}

/** Razorpay's own API, so the product's claims can be checked against theirs. */
const rzp = async (path) => {
  const res = await fetch('https://api.razorpay.com/v1' + path, {
    headers: { Authorization: 'Basic ' + Buffer.from(KEY_ID + ':' + KEY_SECRET).toString('base64') },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// ---------------------------------------------------------------------------

startPhase('1. an institution with a merchant account');

const pt = (await call('/api/onyx/platform/login', { method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' } })).data?.token;
check('platform operator signs in', Boolean(pt));

const slug = 'qp-' + RUN;
const adminEmail = 'qp.' + RUN + '.admin@onyx.test';
const studentEmail = 'qp.' + RUN + '.stu@onyx.test';

await step('institution created', '/api/onyx/tenants', {
  method: 'POST', token: pt,
  body: { name: 'Pay QA ' + RUN, slug, admin: { name: 'Ada', email: adminEmail, password: PW } },
});
const login = async (email) => (await call('/api/onyx/auth/login',
  { method: 'POST', body: { email, password: PW } })).data?.token;
const at = await login(adminEmail);

await step('a learner is added', '/api/onyx/members', {
  method: 'POST', token: at,
  body: { name: 'Sam Student', email: studentEmail, role: 'student', password: PW },
});
const st = await login(studentEmail);

const saved = await step('Razorpay configured with the client’s test keys',
  '/api/onyx/admin/gateways', {
    method: 'PUT', token: at,
    body: {
      identifier: 'razorpay', title: 'Razorpay', currency: 'INR', test_mode: true, status: true,
      keys: {
        razorpay_key: KEY_ID,
        razorpay_secret: KEY_SECRET,
        razorpay_webhook_secret: WEBHOOK_SECRET,
      },
    },
  });
// 1 and 0, as the column stores them -- a flag is a flag whichever way it is
// spelled, and pinning the test to `=== true` would be testing the driver.
check('and it is in test mode, switched on',
  Boolean(saved.data?.test_mode) && Boolean(saved.data?.status),
  'test_mode=' + saved.data?.test_mode + ' status=' + saved.data?.status);

// The one thing a gateway record must never do.
const readBack = await step('an administrator reads the configuration back',
  '/api/onyx/admin/gateways', { token: at });
const serialised = JSON.stringify(readBack.body);
check('no secret comes back out of it, ever',
  !serialised.includes(KEY_SECRET) && !serialised.includes(WEBHOOK_SECRET),
  'names only: ' + JSON.stringify(readBack.data?.[0]?.configured_keys ?? []));

await refuse('a learner cannot read the merchant configuration', 403,
  '/api/onyx/admin/gateways', { token: st });

const offered = await step('the learner is told which gateway to use',
  '/api/onyx/gateways', { token: st });
check('Razorpay is offered to them',
  JSON.stringify(offered.data ?? []).includes('razorpay'), JSON.stringify(offered.data));

// ---------------------------------------------------------------------------

startPhase('2. a locked course costs ₹300 unless somebody says otherwise');

const defaulted = await step('a locked course created with no price at all',
  '/api/onyx/courses', {
    method: 'POST', token: at,
    body: { code: 'PAY' + RUN.slice(-4), title: 'Paid course ' + RUN, credits: 3,
      access: 'locked' },
  });
check('is priced at ₹300, not refused by the database',
  Number(defaulted.data?.price_minor) === 30_000,
  'price_minor=' + defaulted.data?.price_minor + ' (₹'
  + Number(defaulted.data?.price_minor ?? 0) / 100 + ')');

const chosen = await step('a price somebody typed still wins', '/api/onyx/courses', {
  method: 'POST', token: at,
  body: { code: 'PYX' + RUN.slice(-4), title: 'Dearer course ' + RUN, credits: 3,
    access: 'locked', price_minor: 149_900 },
});
check('and is stored as typed', Number(chosen.data?.price_minor) === 149_900,
  'price_minor=' + chosen.data?.price_minor);

const wasFree = await step('an open course starts free', '/api/onyx/courses', {
  method: 'POST', token: at,
  body: { code: 'FRE' + RUN.slice(-4), title: 'Free course ' + RUN, credits: 3, access: 'open' },
});
// A second one, kept open, because the first is locked a few lines below and
// phase 4 needs a course that is genuinely still free to be refused a sale.
const staysFree = await step('and another that stays that way', '/api/onyx/courses', {
  method: 'POST', token: at,
  body: { code: 'FR2' + RUN.slice(-4), title: 'Still free ' + RUN, credits: 3, access: 'open' },
});
check('at no price', Number(wasFree.data?.price_minor) === 0,
  'price_minor=' + wasFree.data?.price_minor);

const locked = await step('locking it afterwards prices it too',
  '/api/onyx/courses/' + wasFree.data?.id, {
    method: 'PATCH', token: at, body: { access: 'locked' },
  });
check('at the same ₹300', Number(locked.data?.price_minor) === 30_000,
  'price_minor=' + locked.data?.price_minor);

const dear = await step('a course that already has a price keeps it',
  '/api/onyx/courses/' + chosen.data?.id, {
    method: 'PATCH', token: at, body: { access: 'locked' },
  });
check('₹1,499 is not quietly made ₹300', Number(dear.data?.price_minor) === 149_900,
  'price_minor=' + dear.data?.price_minor);

const courseId = defaulted.data?.id;
await step('the ₹300 course is published', '/api/onyx/courses/' + courseId + '/publish',
  { method: 'POST', token: at });

// ---------------------------------------------------------------------------

startPhase('3. the door is shut before paying');

// Enrolment IS entry for a self-service course; buying is what unlocks it.
await refuse('the learner cannot enrol without paying', 402,
  '/api/onyx/courses/' + courseId + '/enroll', { method: 'POST', token: st, body: {} });
const outline = await call('/api/onyx/courses/' + courseId, { token: st });
check('and the catalogue says so rather than pretending',
  outline.data?.access === 'locked' && !outline.data?.purchased,
  'access=' + outline.data?.access + ' purchased=' + outline.data?.purchased);

// ---------------------------------------------------------------------------

startPhase('4. a real order at Razorpay');

const checkout = await step('the learner opens a checkout',
  '/api/onyx/courses/' + courseId + '/checkout', {
    method: 'POST', token: st, body: { gateway: 'razorpay' },
  });
const orderId = checkout.data?.provider_ref;
const reference = checkout.data?.reference;
const payload = checkout.data?.client_payload ?? {};

check('Razorpay gave us an order', String(orderId ?? '').startsWith('order_'),
  'order=' + orderId);
check('for ₹300 exactly', Number(checkout.data?.amount_minor) === 30_000
  && Number(payload.amount) === 30_000,
'amount_minor=' + checkout.data?.amount_minor + ' payload=' + payload.amount);
check('in rupees', checkout.data?.currency === 'INR' && payload.currency === 'INR');
check('the widget gets the PUBLIC key and nothing else',
  payload.key === KEY_ID && !JSON.stringify(payload).includes(KEY_SECRET),
  'key=' + String(payload.key ?? '').slice(0, 14) + '…');

const atRazorpay = await rzp('/orders/' + orderId);
check('and Razorpay agrees the order exists, unpaid',
  atRazorpay.status === 200 && atRazorpay.body.amount === 30_000
  && atRazorpay.body.status === 'created',
'amount=' + atRazorpay.body.amount + ' status=' + atRazorpay.body.status);
check('carrying our reference back to us, so a webhook can find it',
  atRazorpay.body?.notes?.reference === reference);

// Published first, or the refusal is "not open" and says nothing about price.
await step('the free course is published',
  '/api/onyx/courses/' + staysFree.data?.id + '/publish', { method: 'POST', token: at });
await refuse('a free course cannot be sold', 422,
  '/api/onyx/courses/' + staysFree.data?.id + '/checkout', {
    method: 'POST', token: st, body: { gateway: 'razorpay' },
  });

// ---------------------------------------------------------------------------

startPhase('5. what a forged callback gets');

const forged = await call('/api/onyx/payments/confirm', {
  method: 'POST', token: st,
  body: {
    reference, provider_ref: orderId,
    query: { razorpay_payment_id: 'pay_forged', razorpay_signature: 'deadbeef' },
  },
});
check('a made-up signature is refused',
  forged.data?.status === 'failed' || forged.status >= 400,
  'status=' + (forged.data?.status ?? forged.status) + ' ' + (forged.data?.reason ?? ''));

// Correctly signed, by the real secret -- exactly what Razorpay's own widget
// hands back. It is still not enough, and that is the point of this check.
const honest = createHmac('sha256', KEY_SECRET)
  .update(orderId + '|pay_notreallypaid').digest('hex');
const unpaid = await call('/api/onyx/payments/confirm', {
  method: 'POST', token: st,
  body: {
    reference, provider_ref: orderId,
    query: { razorpay_payment_id: 'pay_notreallypaid', razorpay_signature: honest },
  },
});
check('a correctly signed callback for an UNPAID order is not a payment',
  unpaid.data?.status === 'pending',
  'status=' + unpaid.data?.status);
check('because the product asks Razorpay rather than believing the browser',
  unpaid.data?.status !== 'captured');

await refuse('and the course is still locked', 402,
  '/api/onyx/courses/' + courseId + '/enroll', { method: 'POST', token: st, body: {} });

// ---------------------------------------------------------------------------

startPhase('6. a captured payment, and the door opens');

/*
 * The webhook path, signed with the webhook secret this run registered.
 *
 * This is how a payment settles when the learner's browser never comes back --
 * closed laptop, dead battery, a train going into a tunnel -- and it is the
 * only path that does not depend on the person still being there. Razorpay
 * sends `order.paid`; we verify the signature over the raw body, read our own
 * reference out of the order's notes, and settle.
 */
const event = JSON.stringify({
  event: 'order.paid',
  payload: {
    order: { entity: { id: orderId, amount: 30_000, currency: 'INR',
      status: 'paid', notes: { reference } } },
    payment: { entity: { id: 'pay_' + RUN, amount: 30_000, currency: 'INR', status: 'captured' } },
  },
});
const tenantId = (await call('/api/onyx/me', { token: at })).data?.tenant?.id
  ?? (await call('/api/onyx/me', { token: at })).data?.tenant_id;

const hook = await fetch(BASE + '/api/onyx/payments/webhook/' + tenantId + '/razorpay', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(event).digest('hex'),
  },
  body: event,
});
const hookBody = await hook.json().catch(() => ({}));
check('Razorpay’s webhook is accepted', hook.status === 200,
  hook.status + ' ' + JSON.stringify(hookBody?.data ?? hookBody).slice(0, 120));

const started = await call('/api/onyx/courses/' + courseId + '/enroll',
  { method: 'POST', token: st, body: {} });
check('and the learner can now enter the course they paid for',
  started.status === 200, started.status + ' ' + (started.message ?? ''));

const outlineNow = await call('/api/onyx/courses/' + courseId + '/outline', { token: st });
check('the lessons behind the paywall are readable', outlineNow.status === 200,
  outlineNow.status + ' ' + (outlineNow.message ?? ''));

const after = await call('/api/onyx/courses/' + courseId, { token: st });
check('the course reads as theirs', after.data?.purchased === true || after.data?.enrolled === true,
  'purchased=' + after.data?.purchased + ' enrolled=' + after.data?.enrolled);

const replay = await fetch(BASE + '/api/onyx/payments/webhook/' + tenantId + '/razorpay', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(event).digest('hex'),
  },
  body: event,
});
check('a replayed webhook is not a second sale', replay.status === 200, replay.status);

const purchases = await call('/api/onyx/my/purchases', { token: st });
const mine = (purchases.data ?? []).filter((p) => Number(p.course_id) === Number(courseId));
check('exactly one purchase is on record', mine.length === 1,
  mine.length + ' rows, amount=' + (mine[0]?.amount_minor ?? '?'));
check('for the ₹300 that was charged, not a figure from the request',
  Number(mine[0]?.amount_minor) === 30_000, 'amount_minor=' + mine[0]?.amount_minor);

const forgedHook = await fetch(BASE + '/api/onyx/payments/webhook/' + tenantId + '/razorpay', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'not-a-signature' },
  body: event,
});
const forgedBody = await forgedHook.json().catch(() => ({}));
check('a webhook nobody signed changes nothing, and is not an error',
  forgedHook.status === 200 && forgedBody?.data?.handled === false,
  'answered ' + forgedHook.status + ' ' + JSON.stringify(forgedBody?.data ?? {})
  + ' -- an error here is a retry schedule');

// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(66));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const f of failed) console.log('  FAIL [' + f.phase + '] ' + f.label + ' -- ' + f.detail);
console.log('SLUG ' + slug + '  COURSE ' + courseId);

fs.writeFileSync('qa-live/pay.json', JSON.stringify({
  base: BASE, slug, run: RUN, passed, failed: failed.length, results,
}, null, 2));
process.exit(failed.length ? 1 : 0);
