/**
 * Can the people who mark actually SEE what was handed in?
 *
 * Written after a submission went missing in the only way that matters: it was
 * never missing. Sneha Rao sat a paper, the API returned her attempt correctly
 * named and scored, and the screen that shows it answered 500 -- for every
 * paper, at every institution, for every marker. The API was healthy the whole
 * time, so any check that only asked the API would have passed.
 *
 * So this opens the PAGES, as each of the three people who look at them, and
 * insists the candidate's own name is on the one that should carry it. A 500
 * fails it; so does a 200 with nobody on it.
 *
 *   node --env-file=.env qa-live/submissions-visible.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const TENANT = 798;

/** A real submission at the demo, and who is on it. */
const PAPER = { id: 381, candidate: 'Sneha Rao', exam: null };
const SITTING = { id: 320, paper: 378, candidates: ['Divya Rao', 'Aarav Sharma', 'Meera Kumar'] };

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(54), detail);
};

const browser = await chromium.launch();

async function open(page, path) {
  const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  const text = await page.evaluate(
    () => (document.querySelector('#main') ?? document.body).innerText);
  return { status: res?.status() ?? 0, text };
}

/** Signed in as one of the institution's own people. */
async function asTenant(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/onyx\/(dashboard|courses)/, { timeout: 45_000 });
  return { ctx, page };
}

/** Signed in as the platform operator. */
async function asOperator() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/onyx/platform/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/email/i).first().fill('superadmin@onyx.platform');
  await page.getByLabel(/password/i).first().fill('Platform#2026!');
  await page.getByRole('button', { name: /sign in/i }).click();
  /*
   * Away from `/login` specifically.
   *
   * Waiting for `/onyx/platform` matches the LOGIN url too, so the wait
   * returned immediately and every page after it was the sign-in form
   * answering 200 -- which reads as "the page loaded and nobody was on it".
   * A check that cannot tell a signed-out page from an empty one is worse
   * than no check.
   */
  await page.waitForFunction(() => !location.pathname.endsWith('/login'), { timeout: 45_000 });
  return { ctx, page };
}

// --- the institution's own people -----------------------------------------
for (const [who, email] of [
  ['faculty', 'faculty1@mrdemo.test'],
  ['admin', 'admin@mrdemo.test'],
]) {
  const { ctx, page } = await asTenant(email, 'MrDemo#2026!');

  const marking = await open(page, '/onyx/assessments/' + PAPER.id + '/marking');
  check(who + ': the marking screen loads', marking.status === 200, 'HTTP ' + marking.status);
  check(who + ': and the candidate is on it',
    marking.text.includes(PAPER.candidate), PAPER.candidate);

  const sitting = await open(page, '/onyx/exams/' + SITTING.id);
  check(who + ': the sitting loads', sitting.status === 200, 'HTTP ' + sitting.status);
  const seen = SITTING.candidates.filter((n) => sitting.text.includes(n));
  check(who + ': every candidate on it is listed',
    seen.length === SITTING.candidates.length, seen.join(', ') || 'none');

  await ctx.close();
}

// --- the platform operator -------------------------------------------------
{
  const { ctx, page } = await asOperator();
  const T = '/onyx/platform/tenants/' + TENANT;

  const paper = await open(page, T + '/assessments/' + PAPER.id);
  check('superadmin: the paper loads', paper.status === 200, 'HTTP ' + paper.status);
  check('superadmin: the attempt is on it',
    paper.text.includes(PAPER.candidate), PAPER.candidate);

  const exam = await open(page, T + '/examinations/' + SITTING.id);
  check('superadmin: the sitting loads', exam.status === 200, 'HTTP ' + exam.status);
  const seen = SITTING.candidates.filter((n) => exam.text.includes(n));
  check('superadmin: every candidate on it is listed',
    seen.length === SITTING.candidates.length, seen.join(', ') || 'none');

  // The console reads its own screens rather than the institution's, so it was
  // never behind the 500 -- which is exactly why it has to be checked too:
  // "it works for the operator" was true while nobody else could mark at all.
  const list = await open(page, T + '/assessments');
  check('superadmin: the paper list loads', list.status === 200, 'HTTP ' + list.status);

  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(74));
console.log(results.filter((r) => r.pass).length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
