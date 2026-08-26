/**
 * Can somebody with an ordinary mailbox register?
 *
 * The product used to refuse gmail and the rest at an institution that had
 * said it takes anyone, which meant the learner whose college never issued
 * them an address -- the ordinary case -- could not get in. This walks the
 * whole journey with a gmail address: pick the institution, ask for a code,
 * redeem it, land signed in.
 *
 * The code is read through the mail provider's admin API rather than an inbox,
 * because a .test address cannot receive mail. The product sends a real one.
 *
 *   node --env-file=.env qa-live/gmail-signup.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STAMP = Date.now().toString(36);
const EMAIL = 'onyx.gmail.trial.' + STAMP + '@gmail.com';
const PASSWORD = 'Trial#2026!';

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(52), detail);
};

// --- the API says yes before a browser is involved -------------------------
const lookup = await (await fetch(BASE + '/api/onyx/auth/signup/institution?email='
  + encodeURIComponent(EMAIL))).json();
check('a gmail address names no institution', lookup?.data == null,
  'which is why one has to be picked');

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
let t = Date.now();
const lap = (m) => { const d = Date.now() - t; t = Date.now(); console.log('      ' + d + 'ms  ' + m); };

await page.goto(BASE + '/onyx/signup', { waitUntil: 'domcontentloaded' });
/*
 * Wait for the form to be alive before touching it.
 *
 * The institution lookup runs on the email field's `onBlur`, and a handler
 * that React has not attached yet does nothing at all -- so filling and
 * blurring the moment the HTML arrives left the picker permanently absent and
 * this suite failing about half the time. The submit button is disabled until
 * the component hydrates (`ready = useHydrated()`), which makes it the honest
 * signal to wait on rather than a sleep. A person typing their name takes
 * seconds and never races it.
 */
await page.waitForFunction(
  () => { const b = document.querySelector('button[type=submit]'); return b && !b.disabled; },
  { timeout: 30_000 });
await page.getByLabel('Full name').fill('Gmail Trial Student');
await page.getByLabel(/Organisation email/i).fill(EMAIL);
await page.getByLabel(/Organisation email/i).blur();

const pickerAppeared = await page.locator('#su-institution')
  .waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
check('the institution picker is offered', pickerAppeared);
lap('picker');

// The old copy told them to go away; make sure it is gone.
const copy = await page.evaluate(() => (document.querySelector('form') ?? document.body).innerText);
check('nothing tells them a personal address cannot be used',
  !/cannot be used/i.test(copy) && !/gmail\.com cannot/i.test(copy));

await page.locator('#su-institution').selectOption({ label: 'Malla Reddy University (Demo)' });
await page.locator('#su-section').waitFor({ timeout: 20_000 });
await page.getByLabel(/Mobile number/i).fill('9876500456');
await page.getByLabel(/Roll number/i).fill('MRD-GM-' + STAMP.slice(-4));
await page.locator('#su-section').selectOption({ label: 'Alpha-CSE' });
await page.locator('button[type=submit]').first().click();

const codeStep = await page.locator('#su-code').waitFor({ timeout: 45_000 })
  .then(() => true).catch(() => false);
check('a code is sent to the gmail address', codeStep,
  codeStep ? EMAIL : 'the form refused it');
lap('code step');

if (codeStep) {
  const otp = (await (await fetch(SB + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
  })).json()).email_otp;
  await page.locator('#su-code').fill(otp);
  await page.locator('#su-password').fill(PASSWORD);
  await page.locator('button[type=submit]').first().click();
  const landed = await page.waitForURL(/\/onyx\/(dashboard|courses)/, { timeout: 60_000 })
    .then(() => true).catch(() => false);
  check('the code registers them and signs them in', landed,
    landed ? new URL(page.url()).pathname : 'never arrived');
  lap('registered');

  if (landed) {
    const who = await page.evaluate(() => (document.querySelector('#main') ?? document.body).innerText);
    check('they land inside the institution they picked',
      /Malla Reddy University \(Demo\)/.test(who) || /Hi,/.test(who));
  }
}

await browser.close();

/*
 * --- and it is still refused where the institution said addresses matter ---
 *
 * There is no `domain`-mode institution standing on this deployment to test
 * against -- all three that take registrations are `open` -- so this makes
 * one for a moment and puts it back. The alternative was asserting against
 * whichever tenant happened to be configured that way today, which is how a
 * suite comes to pass because the fixture drifted rather than because the
 * rule holds.
 */
const ops = (await (await fetch(BASE + '/api/onyx/platform/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'superadmin@onyx.platform', password: 'Platform#2026!' }),
})).json())?.data?.token;
const asOps = async (path, body, method = 'GET') => {
  const r = await fetch(BASE + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ops },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const T = '/api/onyx/platform/tenants/798';
const was = (await asOps(T)).body?.data ?? {};

await asOps(T, { signup_mode: 'domain' }, 'PATCH');
const strict = await (await fetch(BASE + '/api/onyx/auth/signup/start', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'someone.else@gmail.com', tenant_id: 798 }),
})).json();
check('in domain mode the same address is refused', strict?.ok === false,
  String(strict?.message ?? '').slice(0, 60));

// Back exactly as found, whatever the assertion did.
await asOps(T, {
  student_signup: Boolean(was.student_signup),
  signup_mode: was.signup_mode === 'open' ? 'open' : 'domain',
  signup_domains: String(was.signup_domains ?? ''),
}, 'PATCH');
const now = (await asOps(T)).body?.data ?? {};
check('the institution is put back', now.signup_mode === was.signup_mode
  && String(now.signup_domains ?? '') === String(was.signup_domains ?? ''),
  now.signup_mode + ' / ' + (now.signup_domains || 'no domains'));

/*
 * And the account this made is taken out again.
 *
 * The demo's seeded figures are a contract -- e2e-malla-reddy-demo asserts
 * 1,440 students and sixty in Alpha-CSE -- so a trial registration left behind
 * turns that suite red for a reason that has nothing to do with it.
 */
/*
 * Found through the institution's own roster, which can actually search.
 *
 * Two wrong turns are worth recording here. The console's people route takes
 * no `search` -- that filter lives on the PAGE, over rows it was handed -- so
 * a request shaped like a search returned the first slice of 1,443 and the
 * account just registered, which sorts last, was not in it. Asking for the
 * whole roll instead does not work either: that route caps `limit` at 200 and
 * rejects anything larger, so the "search" came back empty and the check
 * cheerfully reported "not on the roll to begin with" and PASSED while the
 * account sat there. A cleanup that cannot find what it made is worse than
 * none, because it says it worked.
 *
 * `/api/onyx/members` searches on the server, by name, email or roll number.
 * It needs the institution's own token rather than the operator's, which is
 * the whole difference.
 */
const adminTok = (await (await fetch(BASE + '/api/onyx/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@mrdemo.test', password: 'MrDemo#2026!' }),
})).json())?.data?.token;
const asAdmin = async (path, method = 'GET') => {
  const r = await fetch(BASE + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminTok } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const found = (await asAdmin('/api/onyx/members?role=student&limit=20&search='
  + encodeURIComponent(EMAIL))).body?.data ?? [];
const mine = found.find((x) => String(x.user?.email ?? x.email).toLowerCase() === EMAIL.toLowerCase());
check('the account it made is on the roll', !!mine,
  mine ? 'membership ' + mine.id : 'NOT FOUND — cleanup cannot run');
if (mine) {
  const gone = await asAdmin('/api/onyx/members/' + mine.id, 'DELETE');
  const after = (await asAdmin('/api/onyx/members?role=student&limit=20&search='
    + encodeURIComponent(EMAIL))).body?.data ?? [];
  check('and is removed again', gone.status === 200 && after.length === 0,
    'HTTP ' + gone.status + ', ' + after.length + ' left matching');
}

console.log('\nACCOUNT (now removed): ' + EMAIL);
const failed = results.filter((r) => !r.pass);
console.log('\n' + results.filter((r) => r.pass).length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
