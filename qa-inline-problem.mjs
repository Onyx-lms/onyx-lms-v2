/**
 * The console paper builder, writing a coding problem inside the paper.
 *
 * ABC Institution only. This is the flow the picker could not do before: a
 * code question had to point at a problem somebody had already authored and
 * published somewhere else. It drives the real form, then checks the database
 * through the API for what the form was supposed to have written.
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5199';
const TENANT = 1;
const STAMP = Date.now().toString(36);

let failures = 0;
const ok = (l, c, d = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? ' - ' + d : ''));
  if (!c) failures += 1;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

await page.goto(BASE + '/onyx/platform/login', { waitUntil: 'domcontentloaded' });
// The submit button stays disabled until the form has hydrated, so it is
// waited for rather than clicked at.
await page.locator('#email').waitFor({ state: 'visible', timeout: 40000 });
await page.locator('#email').fill('superadmin@onyx.platform');
await page.locator('#password').fill('Platform#2026!');
const signIn = page.getByRole('button', { name: /sign in/i });
for (let i = 0; i < 60 && !(await signIn.isEnabled()); i += 1) await page.waitForTimeout(500);
await signIn.click();
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 40000 });

// The platform cookie is a session envelope, not a bare JWT -- sending it as a
// Bearer is a 401. The token comes from the API the same way the app gets it.
const token = await fetch(BASE + '/api/onyx/platform/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'superadmin@onyx.platform', password: 'Platform#2026!' }),
}).then((r) => r.json()).then((j) => j.data.token);
const api = async (p) => (await fetch(BASE + p, {
  headers: { Authorization: 'Bearer ' + token },
}).then((r) => r.json()));

console.log('\n=== The console paper builder, with a problem written inline ===');

await page.goto(BASE + '/onyx/platform/tenants/' + TENANT + '/assessments',
  { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

await page.getByRole('button', { name: /^create a paper$/i }).first().click();
await page.waitForTimeout(900);

const title = 'UI Inline paper ' + STAMP;
await page.locator('#cp-title').fill(title);

// The question type is a set of buttons, not a menu. "Code" used to be
// disabled when the institution had no published problem -- the gate this
// change removes, since writing one on the form is now the way out of that
// empty state.
const codeBtn = page.getByRole('button', { name: /^Code$/ }).first();
ok('the Code question type is offered', await codeBtn.isEnabled());
await codeBtn.click();
await page.waitForTimeout(500);

await page.getByPlaceholder('The question').first()
  .fill('Write a program that reads an integer and prints its square.');

const problemSelect = page.locator('#cp-prob-0');
ok('the code question has a problem picker', await problemSelect.count() > 0);
const options = await problemSelect.locator('option').allInnerTexts();
ok('writing the problem here is the first thing offered',
  /write the problem here/i.test(options[0] ?? ''), options.slice(0, 3).join(' / '));
// The point of the change: choosing Code shows the description and the test
// cases immediately. Nobody should have to pick "write a new one" off a menu
// of stock problems before they can type the question they came to set.
ok('and it is already selected, so the fields are on screen',
  await page.locator('#np-title').isVisible());
ok('reusing a published problem is still available underneath',
  await problemSelect.locator('optgroup').count() > 0);
await page.waitForTimeout(300);
await page.screenshot({ path: 'qa-inline-problem-form.png', fullPage: true });

ok('the inline authoring block appears', await page.locator('#np-title').isVisible());

await page.locator('#np-title').fill('UI Square the number ' + STAMP);
await page.locator('#np-statement')
  .fill('Read one integer n and print n squared on its own line.');
await page.locator('#np-topic').fill('Arithmetic');

// Two cases: the visible one the API insists on, and a hidden one.
const caseInputs = page.locator('textarea[aria-label^="Input for case"]');
const caseOutputs = page.locator('textarea[aria-label^="Expected output for case"]');
ok('the block starts with a visible case and a hidden one',
  await caseInputs.count() === 2, (await caseInputs.count()) + ' cases');
await caseInputs.nth(0).fill('4');
await caseOutputs.nth(0).fill('16');
await caseInputs.nth(1).fill('12');
await caseOutputs.nth(1).fill('144');

await page.screenshot({ path: 'qa-inline-problem-filled.png', fullPage: true });

const submitBtn = page.getByRole('button', { name: /create and publish it|working|creating/i }).first();
console.log('        submit button:', await submitBtn.innerText().catch(() => 'NOT FOUND'));
await submitBtn.click();
await page.waitForTimeout(6000);
await page.screenshot({ path: 'qa-inline-problem-after.png', fullPage: true });
const dialogText = await page.locator('body').innerText();
const alert = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
console.log('        alert:', JSON.stringify(alert));
console.log('        tail:', dialogText.slice(-400).split(String.fromCharCode(10)).join(' | '));

// The form runs several requests in order; give it room.
let made = null;
for (let i = 0; i < 20; i += 1) {
  await page.waitForTimeout(1500);
  const probs = await api('/api/onyx/platform/tenants/' + TENANT + '/problems');
  const list = probs.data ?? [];
  if (i === 0 || i === 5) {
    console.log('        poll ' + i + ': ok=' + probs.ok + ' rows=' + list.length
      + ' titles=' + JSON.stringify(list.slice(-3).map((x) => x.title)));
  }
  made = list.find((x) => x.title === 'UI Square the number ' + STAMP);
  if (made) break;
}
ok('the problem written inside the paper exists', Boolean(made),
  made ? 'problem ' + made.id : 'never appeared in the bank');

if (made) {
  ok('it was published, not left a draft', made.status === 'published', made.status);
  ok('its description was saved', String(made.statement).includes('n squared'));

  const detail = await api('/api/onyx/platform/tenants/' + TENANT + '/problems/' + made.id);
  const tests = detail.data?.tests ?? [];
  ok('both test cases were saved', tests.length === 2, tests.length + ' cases');
  ok('one case is visible and one is hidden',
    tests.some((t) => !t.is_hidden) && tests.some((t) => t.is_hidden),
    JSON.stringify(tests.map((t) => ({ n: t.name, hidden: t.is_hidden }))));
  ok('the expected outputs are the ones typed',
    tests.some((t) => t.expected_stdout === '16') && tests.some((t) => t.expected_stdout === '144'));
}

// And the paper itself, drawing that question.
let paper = null;
for (let i = 0; i < 20; i += 1) {
  const acad = await api('/api/onyx/platform/tenants/' + TENANT + '/academics?limit=200');
  paper = (acad.data?.assessments ?? []).find((a) => a.title === title);
  if (paper) break;
  await page.waitForTimeout(1500);
}
ok('the paper was created', Boolean(paper), paper ? 'paper ' + paper.id : 'not found');
if (paper) {
  ok('it is published', paper.status === 'published', paper.status);
  ok('it draws from a bank', (paper.sections ?? []).length > 0,
    JSON.stringify(paper.sections));

  const bankId = (paper.sections ?? [])[0]?.bank_id;
  if (bankId) {
    const qs = await api('/api/onyx/platform/tenants/' + TENANT
      + '/banks/' + bankId + '/questions');
    const codeQ = (qs.data ?? []).find((q) => q.type === 'code');
    ok('the bank holds the coding question', Boolean(codeQ));
    ok('the coding question is bound to the problem written on the form',
      made && Number(codeQ?.problem_id) === Number(made.id),
      'question problem_id=' + codeQ?.problem_id + ' problem=' + made?.id);
  }
}

ok('no page errors during the whole flow', errs.length === 0, errs[0] ?? '');

await browser.close();
console.log('\n' + (failures ? failures + ' FAILURES' : 'inline problem authoring works'));
process.exitCode = failures ? 1 : 0;
