/**
 * The one-click paper builder, driven in a browser as an operator would.
 *
 * `exam-day.mjs` proves the same path through the API. This proves the FORM:
 * that somebody who has never seen the console can open one dialog, type four
 * questions, press one button, and end up with a published paper an exam can
 * be scheduled against a moment later — which is the whole claim the shortcut
 * makes.
 *
 * ABC Institution only, never Malla Reddy, and everything it makes it removes.
 *
 *   node qa-live/paper-builder.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUN = Date.now().toString(36);
const TITLE = 'Builder QA paper ' + RUN;

const results = [];
function check(label, pass, detail = '') {
  results.push({ label, pass: Boolean(pass), detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(56), detail);
  return pass;
}

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

const pt = (await api('/api/onyx/platform/login', { method: 'POST',
  body: { email: 'superadmin@onyx.platform', password: 'Platform#2026!' } })).data?.token;

const tenants = (await api('/api/onyx/platform/tenants', { token: pt })).data ?? [];
const abc = tenants.find((t) => t.slug === 'abc-institution');
const forbidden = tenants.find((t) => t.slug === 'malla-reddy-university');
check('ABC Institution is the one being touched',
  Boolean(abc) && abc.id !== forbidden?.id,
  'tenant ' + abc?.id + ', never ' + forbidden?.id);
const tid = abc.id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
let paperId = null;
let examId = null;

try {
  await page.goto(BASE + '/onyx/platform/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/email/i).first().fill('superadmin@onyx.platform');
  await page.getByLabel(/password/i).first().fill('Platform#2026!');
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await page.waitForURL(/platform(?!\/login)/, { timeout: 30_000 });
  check('the operator is signed in', true);

  await page.goto(BASE + '/onyx/platform/tenants/' + tid + '/examinations',
    { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  // Clicked until it takes: the first click can land before React has
  // hydrated the button, and a click before the handler is attached does
  // nothing and reports nothing.
  const openBuilder = page.getByRole('button', { name: /^Create a paper$/ }).first();
  for (let i = 0; i < 4 && !(await page.getByRole('dialog').count()); i += 1) {
    await openBuilder.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
  }
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 15_000 });
  check('the paper builder opens as a dialog', true);

  await dialog.getByLabel('Paper title').fill(TITLE);
  await dialog.getByLabel('Duration (minutes)').fill('45');
  await dialog.getByLabel('Pass mark').fill('10');

  const QUESTIONS = [
    { prompt: 'Which data structure gives constant-time lookup on average?',
      options: ['Hash table', 'Linked list', 'Array', 'Stack'], correct: 0 },
    { prompt: 'Which sorting algorithm is stable?',
      options: ['Quicksort', 'Merge sort', 'Heapsort', 'Selection sort'], correct: 1 },
    { prompt: 'A stack is which discipline?',
      options: ['FIFO', 'LIFO', 'Random', 'Priority'], correct: 1 },
    { prompt: 'Which is impossible for comparison sorting?',
      options: ['O(n log n)', 'O(n²)', 'O(1)', 'O(n)'], correct: 2 },
  ];

  for (const [i, q] of QUESTIONS.entries()) {
    if (i > 0) {
      await dialog.getByRole('button', { name: /Add another question/ }).click();
      await page.waitForTimeout(300);
    }
    await dialog.getByLabel('Question ' + (i + 1)).fill(q.prompt);
    for (const [oi, text] of q.options.entries()) {
      const letter = ['A', 'B', 'C', 'D'][oi];
      await dialog.getByLabel('Option ' + letter, { exact: true }).nth(i).fill(text);
    }
    const letter = ['A', 'B', 'C', 'D'][q.correct];
    await dialog.getByLabel('Option ' + letter + ' is correct').nth(i).check();
  }
  check('four questions are typed, each with its answer key marked', true);

  // The guard worth having: a question with no key marked is refused rather
  // than silently marking every answer wrong.
  await dialog.getByRole('button', { name: /Add another question/ }).click();
  await page.waitForTimeout(300);
  await dialog.getByLabel('Question 5').fill('An option with no key at all');
  await dialog.getByLabel('Option A', { exact: true }).nth(4).fill('One');
  await dialog.getByLabel('Option B', { exact: true }).nth(4).fill('Two');
  await dialog.getByRole('button', { name: /Create and publish it/ }).click();
  await page.waitForTimeout(1_500);
  const complaint = await dialog.getByRole('alert').textContent().catch(() => '');
  check('a question with no answer key is refused before anything is written',
    /mark which option is correct/i.test(complaint ?? ''),
    (complaint ?? '(no alert)').slice(0, 70));

  // Nothing should have been created by that refusal.
  const afterRefusal = (await api('/api/onyx/platform/tenants/' + tid + '/banks',
    { token: pt })).data ?? [];
  check('and no half-made bank is left behind',
    !afterRefusal.some((b) => String(b.name).includes(RUN)),
    afterRefusal.filter((b) => String(b.name).includes(RUN)).length + ' stray banks');

  // Mark it, and submit for real.
  await dialog.getByLabel('Option A is correct').nth(4).check();
  await dialog.getByRole('button', { name: /Create and publish it/ }).click();
  await dialog.waitFor({ state: 'detached', timeout: 60_000 });
  check('the whole paper is built and published in one press', true);

  // What actually landed.
  const academics = (await api('/api/onyx/platform/tenants/' + tid + '/academics?limit=200',
    { token: pt })).data;
  const paper = (academics?.assessments ?? []).find((a) => a.title === TITLE);
  paperId = paper?.id ?? null;
  check('the paper exists', Boolean(paper), 'id=' + paperId);
  check('and it is published, not a draft', paper?.status === 'published',
    'status=' + paper?.status);
  check('drawing all five questions',
    (paper?.sections ?? []).reduce((n, s) => n + Number(s.take), 0) === 5,
    JSON.stringify(paper?.sections));

  const detail = (await api('/api/onyx/platform/tenants/' + tid + '/assessments/' + paperId,
    { token: pt })).data;
  check('with the duration and pass mark that were typed',
    Number(detail?.assessment?.duration_minutes) === 45
    && Number(detail?.assessment?.pass_mark) === 10,
    detail?.assessment?.duration_minutes + ' min, pass '
    + detail?.assessment?.pass_mark);

  // And the point of building it: it can be scheduled straight afterwards.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const openExam = page.getByRole('button', { name: /^Schedule an exam$/ }).first();
  for (let i = 0; i < 4 && !(await page.getByRole('dialog').count()); i += 1) {
    await openExam.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
  }
  const examDialog = page.getByRole('dialog');
  await examDialog.waitFor({ timeout: 15_000 });
  const offered = await examDialog.locator('#ce-paper option').allTextContents();
  check('the new paper is offered as the sitting’s online paper',
    offered.some((o) => o.includes(RUN)),
    offered.filter((o) => o.includes(RUN)).join('') || offered.join(' | ').slice(0, 60));
} catch (err) {
  check('the browser flow finished', false, String(err).split('\n')[0]);
  await page.screenshot({ path: 'qa-live/paper-builder-failure.png', fullPage: true })
    .catch(() => {});
} finally {
  await browser.close();
}

// ---------------------------------------------------------- put ABC back ----

if (examId) {
  await api('/api/onyx/platform/tenants/' + tid + '/exams/' + examId,
    { method: 'DELETE', token: pt });
}
if (paperId) {
  const gone = await api('/api/onyx/platform/tenants/' + tid + '/assessments/' + paperId,
    { method: 'DELETE', token: pt });
  check('the paper is removed', gone.status === 200, gone.status + ' ' + (gone.message ?? ''));
}
const { withDb } = await import('../tests/e2e/harness.ts');
await withDb(async (db) => {
  await db.query(
    'DELETE FROM public."onyx_questions" WHERE tenant_id = $1 AND bank_id IN '
    + '(SELECT id FROM public."onyx_question_banks" WHERE tenant_id = $1 AND name LIKE $2)',
    [tid, '%' + RUN + '%']);
  await db.query(
    'DELETE FROM public."onyx_question_banks" WHERE tenant_id = $1 AND name LIKE $2',
    [tid, '%' + RUN + '%']);
});
const left = (await api('/api/onyx/platform/tenants/' + tid + '/banks', { token: pt })).data ?? [];
check('and so is its question bank',
  !left.some((b) => String(b.name).includes(RUN)), left.length + ' banks remain');

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(68));
console.log(passed + ' pass, ' + failed.length + ' fail, of ' + results.length);
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
