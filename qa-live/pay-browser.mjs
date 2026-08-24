/**
 * The whole purchase, in a browser, with a card.
 *
 * `pay.mjs` proves everything around the payment: the order Razorpay really
 * created, the refusals, the webhook, the ledger. The one thing it cannot do
 * is the payment itself, because a card is entered in Razorpay's own checkout
 * window and nothing on our side can stand in for that. This drives it.
 *
 * The test card is Razorpay's published test-mode number -- it charges nothing
 * and exists for exactly this. The flow it walks is the learner's:
 *
 *   sign in → a locked course → Buy for ₹300 → Razorpay's window → card →
 *   the bank's simulated page → Success → back to the course, open.
 *
 * **This one depends on somebody else's user interface.** Razorpay may
 * redesign their checkout tomorrow and this will fail while the product is
 * perfectly sound -- which is why the checks that must never go quiet live in
 * `pay.mjs`, and this one reports what it saw rather than being the gate.
 *
 *   node qa-live/pay-browser.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const PW = 'QaCard#2026!';

const [, keyLine] = fs.readFileSync('rzp (1).csv', 'utf8').trim().split(/\r?\n/);
const [KEY_ID, KEY_SECRET] = keyLine.split(',').map((s) => s.trim());

const say = (ok, label, detail = '') =>
  console.log((ok ? 'ok    ' : 'FAIL  ') + label.padEnd(50), detail);

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, data: parsed?.data, message: parsed?.message };
}

// ---------------------------------------------------------- the institution

const pt = (await api('/api/onyx/platform/login', { method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' } })).data?.token;

const slug = 'qc-' + RUN;
const adminEmail = 'qc.' + RUN + '.admin@onyx.test';
const studentEmail = 'qc.' + RUN + '.stu@onyx.test';

await api('/api/onyx/tenants', { method: 'POST', token: pt,
  body: { name: 'Card QA ' + RUN, slug, admin: { name: 'Ada', email: adminEmail, password: PW } } });
const login = async (email) => (await api('/api/onyx/auth/login',
  { method: 'POST', body: { email, password: PW } })).data?.token;
const at = await login(adminEmail);

await api('/api/onyx/members', { method: 'POST', token: at,
  body: { name: 'Sam Student', email: studentEmail, role: 'student', password: PW } });

await api('/api/onyx/admin/gateways', { method: 'PUT', token: at,
  body: {
    identifier: 'razorpay', title: 'Razorpay', currency: 'INR', test_mode: true, status: true,
    keys: { razorpay_key: KEY_ID, razorpay_secret: KEY_SECRET },
  } });

// No price given: the house price is what a locked course costs.
const course = await api('/api/onyx/courses', { method: 'POST', token: at,
  body: { code: 'CRD' + RUN.slice(-4), title: 'Card course ' + RUN, credits: 3,
    access: 'locked' } });
const courseId = course.data?.id;
say(Number(course.data?.price_minor) === 30_000, 'a locked course at the house price',
  '₹' + Number(course.data?.price_minor ?? 0) / 100);
await api('/api/onyx/courses/' + courseId + '/publish', { method: 'POST', token: at });

// --------------------------------------------------------------- the browser

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('      [console] ' + m.text()); });

try {
  await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/email/i).first().fill(studentEmail);
  await page.getByLabel(/password/i).first().fill(PW);
  await page.getByRole('button', { name: /sign in|log in/i }).first().click();
  await page.waitForURL(/\/onyx\/(dashboard|courses)/, { timeout: 30_000 });
  say(true, 'the learner is signed in');

  await page.goto(BASE + '/onyx/courses/' + courseId, { waitUntil: 'domcontentloaded' });
  const buy = page.getByRole('button', { name: /Buy for/i }).first();
  await buy.waitFor({ timeout: 20_000 });
  say(true, 'the course offers to be bought', (await buy.textContent())?.trim());

  await buy.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 15_000 });
  say(true, 'the buy dialog opened',
    (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 90));
  // The dialog's own button, which says "Pay ₹300.00".
  await dialog.getByRole('button', { name: /^Pay/i }).first().click();

  /*
   * Razorpay's window is an iframe of theirs, and everything below is their
   * markup rather than ours. It is addressed by role and accessible name so
   * a class rename on their side does not break it, and every wait is
   * generous: a test-mode bank page is still a network round trip.
   */
  const rzpFrame = page.frameLocator('iframe.razorpay-checkout-frame');
  await rzpFrame.locator('body').waitFor({ timeout: 40_000 });
  say(true, 'Razorpay’s checkout window opened');

  const amountShown = await rzpFrame.locator('body').innerText().catch(() => '');
  say(/300/.test(amountShown), 'and it is asking for ₹300',
    (amountShown.match(/₹\s?[\d,.]+/) ?? ['(not found)'])[0]);

  const card = rzpFrame.getByText(/^Card$/).first();
  await card.click({ timeout: 30_000 });
  await rzpFrame.getByPlaceholder(/card number/i).fill('4111 1111 1111 1111');
  await rzpFrame.getByPlaceholder(/MM ?\/ ?YY/i).fill('12/30');
  await rzpFrame.getByPlaceholder(/CVV/i).fill('123');
  const holder = rzpFrame.getByPlaceholder(/name on card|card holder/i).first();
  if (await holder.count()) await holder.fill('Sam Student');
  say(true, 'the test card is entered');

  await rzpFrame.getByRole('button', { name: /pay|continue/i }).first().click();

  // The simulated bank page: Razorpay's test mode asks whether this payment
  // should succeed. It is a separate frame or a new page depending on flow.
  const success = page.frameLocator('iframe').getByRole('button', { name: /^success$/i }).first();
  await success.click({ timeout: 60_000 });
  say(true, 'the simulated bank was told to approve it');

  // Back on our page: the button is gone and the course is theirs.
  await page.waitForTimeout(6_000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const stillForSale = await page.getByRole('button', { name: /Buy for/i }).count();
  say(stillForSale === 0, 'the course no longer asks to be bought');

  const owned = await api('/api/onyx/my/purchases', { token: await login(studentEmail) });
  say((owned.data ?? []).map(Number).includes(Number(courseId)),
    'and the purchase is on record', JSON.stringify(owned.data));
} catch (err) {
  say(false, 'the browser flow did not finish', String(err).split('\n')[0]);
  await page.screenshot({ path: 'qa-live/pay-browser-failure.png', fullPage: true })
    .catch(() => {});
  console.log('      a screenshot is at qa-live/pay-browser-failure.png');
} finally {
  await browser.close();
  console.log('SLUG ' + slug + '  COURSE ' + courseId);
}
