/**
 * The institution's own question bank, writing a coding problem inside the
 * question -- the same thing qa-inline-problem.mjs proves for the console,
 * through the other builder and the other session.
 *
 * ABC Institution only.
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5199';
const TENANT = 1;
const STAMP = Date.now().toString(36);
const NAME = 'Bank inline problem ' + STAMP;

let failures = 0;
const ok = (l, c, d = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? ' - ' + d : ''));
  if (!c) failures += 1;
};

const token = await fetch(BASE + '/api/onyx/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@demo.onyx', password: 'Demo#2026!', tenant_id: TENANT,
  }),
}).then((r) => r.json()).then((j) => j.data.token);

const api = async (p) => fetch(BASE + p, { headers: { Authorization: 'Bearer ' + token } })
  .then((r) => r.json());

const banks = await api('/api/onyx/banks');
const bank = (banks.data ?? [])[0];
ok('this institution has a question bank to author into', Boolean(bank),
  bank ? bank.name : 'none');
if (!bank) process.exit(1);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
await page.locator('#email').waitFor({ state: 'visible', timeout: 40000 });
await page.locator('#email').fill('admin@demo.onyx');
await page.locator('#password').fill('Demo#2026!');
const signIn = page.getByRole('button', { name: /sign in/i });
for (let i = 0; i < 60 && !(await signIn.isEnabled()); i += 1) await page.waitForTimeout(500);
await signIn.click();
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 40000 });

console.log('\n=== The question bank, writing a coding problem inside the question ===');

await page.goto(BASE + '/onyx/banks/' + bank.id, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

await page.getByRole('button', { name: /add a question/i }).click();
await page.waitForTimeout(600);
await page.locator('#q-prompt').fill('Write a program that prints the larger of two integers.');
await page.locator('#q-type').selectOption('code');
await page.waitForTimeout(400);
await page.locator('#q-points').fill('10');

// No menu step: choosing Code puts the description and the test cases on
// screen straight away, which is what somebody adding a coding question came
// to fill in.
ok('choosing Code shows the authoring block without picking anything',
  await page.locator('#np-title').isVisible());
ok('reusing a published problem is still offered underneath',
  await page.locator('#q-problem optgroup').count() > 0);

await page.locator('#np-title').fill(NAME);
await page.locator('#np-statement').fill('Read two integers on one line and print the larger.');
const ins = page.locator('textarea[aria-label^="Input for case"]');
const outs = page.locator('textarea[aria-label^="Expected output for case"]');
await ins.nth(0).fill('3 9');
await outs.nth(0).fill('9');
await ins.nth(1).fill('40 12');
await outs.nth(1).fill('40');
await page.screenshot({ path: 'qa-inline-bank-filled.png', fullPage: true });

// A draft with no visible case must be refused by the form before anything is
// written -- the rule that keeps a half-made problem out of the bank.
await page.locator('input[type="checkbox"]').first().check();
await page.getByRole('button', { name: /^(add|save|create)/i }).last().click();
await page.waitForTimeout(1500);
const refusal = (await page.locator('[role="alert"]').allInnerTexts().catch(() => []))
  .join(' ');
ok('an all-hidden key is refused before anything is written',
  /visible/i.test(refusal), refusal.slice(0, 120) || '(no alert shown)');
await page.locator('input[type="checkbox"]').first().uncheck();

await page.getByRole('button', { name: /^(add|save|create)/i }).last().click();

let made = null;
for (let i = 0; i < 25; i += 1) {
  await page.waitForTimeout(1500);
  const probs = await api('/api/onyx/problems');
  made = (probs.data ?? []).find((p) => p.title === NAME);
  if (made) break;
}
ok('the problem written inside the question exists', Boolean(made),
  made ? 'problem ' + made.id : 'never appeared');

if (made) {
  ok('it was published', made.status === 'published', made.status);
  const detail = await api('/api/onyx/problems/' + made.id);
  const tests = detail.data?.tests ?? [];
  ok('its two cases were saved, one visible and one hidden',
    tests.length === 2 && tests.some((t) => !t.is_hidden) && tests.some((t) => t.is_hidden),
    JSON.stringify(tests.map((t) => ({ n: t.name, h: t.is_hidden }))));

  const qs = await api('/api/onyx/banks/' + bank.id + '/questions');
  const q = (qs.data ?? []).find((x) => Number(x.problem_id) === Number(made.id));
  ok('the question is bound to it', Boolean(q),
    q ? 'question ' + q.id + ' type ' + q.type : 'no question points at it');
}

ok('no page errors', errs.length === 0, errs[0] ?? '');

await browser.close();
console.log('\n' + (failures ? failures + ' FAILURES' : 'bank inline authoring works'));
process.exitCode = failures ? 1 : 0;
