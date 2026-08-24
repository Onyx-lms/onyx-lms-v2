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

// Their own number, on their own record. Razorpay's contact screen is skipped
// for a learner who has one -- which is the point of sending it -- so this is
// also what makes the card steps below reachable without typing it again.
const studentToken = await login(studentEmail);
await api('/api/onyx/my/profile-details', { method: 'PATCH', token: studentToken,
  body: { phone: '9845127384' } });

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

  /*
   * Clicked until it takes, because the first click may land before React has
   * hydrated the page -- the markup arrives from the server with the button
   * already drawn, and a click on it before the handler is attached does
   * nothing at all and reports no error. A person hitting the same window
   * simply clicks again, and so does this.
   */
  await page.waitForLoadState('networkidle').catch(() => {});
  const dialog = page.getByRole('dialog');
  for (let attempt = 1; attempt <= 4 && !(await dialog.count()); attempt += 1) {
    await buy.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
  }
  await dialog.waitFor({ timeout: 15_000 });
  say(true, 'the buy dialog opened',
    (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 90));
  // The dialog's own button, which says "Pay ₹300.00".
  await dialog.getByRole('button', { name: /^Pay/i }).first().click();

  /*
   * Everything below is Razorpay's own interface, not ours.
   *
   * It is addressed by what a person sees -- a heading, a placeholder, a
   * button's words -- rather than by their class names, so a restyle on their
   * side does not break it. It is still somebody else's UI: if they change the
   * steps, this fails while the product is perfectly sound, which is why the
   * checks that must never go quiet live in pay.mjs.
   *
   * Their checkout nests frames several deep, so each field is looked for
   * across every frame on the page rather than in one named iframe.
   */
  const anyFrame = async (find, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const locator = find(frame);
        if (await locator.count().catch(() => 0)) {
          if (await locator.first().isVisible().catch(() => false)) return locator.first();
        }
      }
      await page.waitForTimeout(500);
    }
    throw new Error('never appeared: ' + find.toString().slice(0, 80));
  };

  await anyFrame((f) => f.locator('text=/Price Summary|Payment Options/i'), 45_000);
  say(true, 'Razorpay’s checkout window opened');

  const shown = (await Promise.all(page.frames().map((f) =>
    f.locator('body').innerText().catch(() => '')))).join(' ');
  say(/₹\s?300/.test(shown), 'and it is asking for ₹300',
    (shown.match(/₹\s?[\d,]+/) ?? ['(not found)'])[0]);
  say(/test mode/i.test(shown), 'in test mode, which it says on the window');

  // Contact details first: a mobile number, and the email it already has.
  const mobile = await anyFrame((f) => f.getByPlaceholder(/mobile number/i), 30_000)
    .catch(() => null);
  if (mobile) {
    /*
     * Typed, not filled. `fill()` sets the value and fires one input event;
     * their validator listens for the keystrokes, so a filled field stayed
     * "Please enter a valid mobile number" with a perfectly valid number
     * sitting in it. Typing is also what a person does.
     */
    await mobile.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await mobile.pressSequentially('9845127384', { delay: 80 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1_000);
    const complaint = (await Promise.all(page.frames().map((f) =>
      f.locator('body').innerText().catch(() => '')))).join(' ');
    say(!/valid mobile number/i.test(complaint), 'the number was accepted',
      /valid mobile number/i.test(complaint) ? 'still complaining' : '');
    const proceed = await anyFrame((f) =>
      f.getByRole('button', { name: /continue|proceed|next/i }), 10_000).catch(() => null);
    if (proceed) await proceed.click();
    say(true, 'contact details given');
  }

  const cards = await anyFrame((f) => f.locator('text=/^Cards?$/i'), 30_000);
  await cards.click();
  say(true, 'Cards chosen as the method');

  const number = await anyFrame((f) => f.getByPlaceholder(/card number/i), 30_000);
  // Razorpay's published test card. It charges nothing and exists for this.
  await number.click();
  await number.pressSequentially('4111111111111111', { delay: 40 });
  const expiry = await anyFrame((f) => f.getByPlaceholder(/MM ?\/ ?YY/i), 15_000);
  await expiry.click();
  await expiry.pressSequentially('1230', { delay: 60 });
  const cvv = await anyFrame((f) => f.getByPlaceholder(/CVV/i), 15_000);
  await cvv.click();
  await cvv.pressSequentially('123', { delay: 60 });
  const holder = await anyFrame((f) =>
    f.getByPlaceholder(/name on card|card holder|cardholder/i), 5_000).catch(() => null);
  if (holder) await holder.pressSequentially('Sam Student', { delay: 30 });
  say(true, 'the test card is entered');

  // Their card form says "Continue", and the amount button says "Pay ₹300".
  // Both are the same step depending on which layout they serve.
  const pay = await anyFrame((f) =>
    f.getByRole('button', { name: /^(continue|pay.*)$/i }), 20_000);
  await pay.click();
  say(true, 'the card is submitted');

  // "Save your card for future payments?" -- declined, because saving a card
  // is a decision a person makes and not one a test should make for them.
  const maybeLater = await anyFrame((f) =>
    f.getByRole('button', { name: /maybe later|skip/i }), 15_000).catch(() => null);
  if (maybeLater) {
    await maybeLater.click();
    say(true, 'declined to save the card');
  }

  /*
   * A fee breakup, on this merchant account: ₹300 plus a convenience charge
   * the BUYER pays. That is an account setting of the client's rather than
   * anything this product decides -- but it means a learner buying a ₹300
   * course is charged more than ₹300, and the course page says ₹300. Recorded
   * here so the number is on the record either way.
   */
  const feeBreakup = await anyFrame((f) => f.locator('text=/Fee Breakup/i'), 10_000)
    .catch(() => null);
  if (feeBreakup) {
    const text = (await Promise.all(page.frames().map((f) =>
      f.locator('body').innerText().catch(() => '')))).join(' ');
    const total = (text.match(/Total Charges\s*₹\s?([\d,.]+)/i) ?? [])[1];
    say(true, 'the merchant account adds a convenience charge',
      '₹300 course → ₹' + (total ?? '?') + ' charged');
    // By its exact words. A looser match also finds the card form's own
    // "Continue" sitting behind this dialog -- visible to the DOM, covered on
    // screen, and a click on it goes nowhere.
    const proceed = await anyFrame((f) =>
      f.getByRole('button', { name: /continue\s*&\s*pay/i }), 15_000);
    await proceed.click();
  }

  // Razorpay's test mode then asks whether this payment should succeed.
  const success = await anyFrame((f) =>
    f.getByRole('button', { name: /^success$/i }), 90_000);
  await success.click();
  say(true, 'the simulated bank was told to approve it');

  // Back on our page. The widget's handler posts to our confirm route, so this
  // waits for the product rather than for the browser.
  const token = await login(studentEmail);
  let owned = [];
  for (let i = 0; i < 30 && !owned.includes(Number(courseId)); i += 1) {
    await page.waitForTimeout(2_000);
    owned = ((await api('/api/onyx/my/purchases', { token })).data ?? []).map(Number);
  }
  say(owned.includes(Number(courseId)), 'the purchase is on record',
    'owns ' + JSON.stringify(owned));

  const mine = await api('/api/onyx/my/courses', { token });
  say((mine.data ?? []).some((c) => Number(c.id ?? c.course_id) === Number(courseId)),
    'and the course is one of theirs now');

  await page.goto(BASE + '/onyx/courses/' + courseId, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  say(await page.getByRole('button', { name: /Buy for/i }).count() === 0,
    'the course no longer asks to be bought');
  await page.screenshot({ path: 'qa-live/pay-browser-paid.png', fullPage: true }).catch(() => {});
} catch (err) {
  say(false, 'the browser flow did not finish', String(err).split('\n')[0]);
  await page.screenshot({ path: 'qa-live/pay-browser-failure.png', fullPage: true })
    .catch(() => {});
  console.log('      a screenshot is at qa-live/pay-browser-failure.png');
} finally {
  await browser.close();
  console.log('SLUG ' + slug + '  COURSE ' + courseId);
}
