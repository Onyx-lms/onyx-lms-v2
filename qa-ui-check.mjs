/**
 * The screens, in a real browser, against the local build.
 *
 * ABC Institution only. Nothing here writes; it opens each page that was added
 * or changed, checks it rendered rather than erroring, and looks for the one
 * thing on it that proves the change is live.
 */
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5199';
const SC = process.env.SC;
const S = JSON.parse(fs.readFileSync(SC + '/state.json', 'utf8'));
const SHOTS = SC + '/shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (l, c, d = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? ' - ' + d : ''));
  if (!c) failures += 1;
};

const ERRORS = [
  /Application error: a (server|client)-side exception/i,
  /Internal Server Error/i,
  /This page could not be found/i,
];

async function signIn(page, door, email, password) {
  await page.goto(BASE + door, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 40000 });
}

async function open(page, path, shot) {
  const errs = [];
  const onErr = (e) => errs.push(String(e).slice(0, 200));
  page.on('pageerror', onErr);
  const resp = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  const body = await page.locator('body').innerText().catch(() => '');
  page.off('pageerror', onErr);
  if (shot) await page.screenshot({ path: SHOTS + '/' + shot + '.png', fullPage: true });
  return { status: resp?.status() ?? 0, body, errs, url: page.url().replace(BASE, '') };
}

function healthy(label, r, mustContain = []) {
  const broken = ERRORS.filter((rx) => rx.test(r.body));
  ok(label + ' renders', r.status < 400 && !broken.length && !r.errs.length,
    'status ' + r.status + (broken.length ? ' ' + broken.join() : '')
    + (r.errs.length ? ' pageerror: ' + r.errs[0] : ''));
  const flat = r.body.toLowerCase();
  for (const needle of mustContain) {
    ok(label + ' shows "' + needle + '"', flat.includes(needle.toLowerCase()),
      r.body.slice(0, 160).split(String.fromCharCode(10)).join(" | "));
  }
  return r;
}

const browser = await chromium.launch();

// ---------------------------------------------- the institution's own screens
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await signIn(page, '/onyx/login', 'admin@demo.onyx', 'Demo#2026!');
  console.log('\n=== ABC administrator ===');

  healthy('Practice (the bank, as staff)', await open(page, '/onyx/practice', 'tenant-practice'),
    ['Add a problem', 'Submissions', 'Learner progress']);

  const feed = healthy('Practice submissions',
    await open(page, '/onyx/practice/submissions', 'tenant-submissions'),
    ['Practice submissions', 'Hand-ins', 'Learner', 'Language']);
  ok('the feed lists the hand-in from the exam', feed.body.includes('Sam Student'),
    feed.body.slice(0, 160).replace(/\n/g, ' | '));

  const filtered = await open(page, '/onyx/practice/submissions?status=failed&mode=submit',
    'tenant-submissions-filtered');
  healthy('Practice submissions, filtered', filtered, ['Clear']);

  const ws = healthy('Workspaces (with the monitor filters)',
    await open(page, '/onyx/workspaces', 'tenant-workspaces'),
    ['Every project at', 'Owner', 'Show these']);
  ok('the monitor lists the projects just created',
    ws.body.includes('E2E student project') && ws.body.includes('E2E personal notebook'));

  const wsFiltered = await open(page, '/onyx/workspaces?language=python',
    'tenant-workspaces-filtered');
  ok('the workspace language filter narrows the table',
    wsFiltered.body.includes('E2E student project')
    && !wsFiltered.body.includes('E2E personal notebook'),
    'python-only view still showed the javascript project');

  // The bank builder, where a coding question can now be written from scratch.
  const banks = await fetch(BASE + '/api/onyx/banks', {
    headers: { Authorization: 'Bearer ' + S.adminToken },
  }).then((r) => r.json());
  const bankId = (banks.data ?? []).find((b) => Number(b.id) === Number(S.bankId))?.id
    ?? (banks.data ?? [])[0]?.id;
  if (bankId) {
    const bank = healthy('Question bank', await open(page, '/onyx/banks/' + bankId, 'tenant-bank'),
      ['Add a question']);
    await page.getByRole('button', { name: /add a question/i }).click();
    await page.waitForTimeout(400);
    await page.locator('#q-type').selectOption('code');
    await page.waitForTimeout(400);
    const options = await page.locator('#q-problem option').allInnerTexts();
    ok('the code question offers writing a new problem',
      options.some((t) => /write a new problem/i.test(t)), options.join(' / ').slice(0, 200));
    await page.locator('#q-problem').selectOption({ label: '+ Write a new problem…' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: SHOTS + '/tenant-bank-new-problem.png', fullPage: true });
    ok('the inline problem form appears with a description and test cases',
      await page.locator('#np-title').isVisible()
      && await page.locator('#np-statement').isVisible()
      && (await page.getByText(/Test cases/).count()) > 0);
    void bank;
  } else {
    ok('a question bank exists to open', false, 'none found');
  }

  await ctx.close();
}

// ------------------------------------------------------------- the console
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await signIn(page, '/onyx/platform/login', 'superadmin@onyx.platform', 'Platform#2026!');
  console.log('\n=== Platform console (ABC, tenant 1) ===');

  const bank = healthy('Code Lab (the problem bank)',
    await open(page, '/onyx/platform/tenants/1/problems', 'console-problems'),
    ['Add a problem', 'Difficulty', 'Published']);
  ok('the bank lists the problem the test authored',
    bank.body.toLowerCase().includes('e2e double the number'), bank.body.slice(0, 200).replace(/\n/g, ' | '));

  const detail = healthy('One coding problem',
    await open(page, '/onyx/platform/tenants/1/problems/' + S.problemId, 'console-problem'),
    ['Description', 'Test cases', 'Publishing', 'Submissions']);
  ok('the description written by the operator is on the page',
    detail.body.toLowerCase().includes('twice its value'));
  ok('a published problem says its cases are fixed',
    detail.body.toLowerCase().includes('published, so its test cases are fixed'));

  healthy('Practice activity',
    await open(page, '/onyx/platform/tenants/1/practice', 'console-practice'),
    ['Practice submissions', 'Project workspaces', 'Sam Student']);

  const exams = healthy('Examinations',
    await open(page, '/onyx/platform/tenants/1/examinations', 'console-examinations'),
    ['Schedule an exam']);
  await page.getByRole('button', { name: /schedule an exam/i }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOTS + '/console-schedule-exam.png', fullPage: true });
  const dialog = await page.locator('body').innerText();
  ok('the scheduling form no longer asks for a semester',
    !/semester/i.test(dialog),
    (dialog.match(/.{0,40}semester.{0,40}/i) ?? ['?'])[0]);
  ok('it still asks for the course, the time and the marks',
    /Course/.test(dialog) && /Starts/.test(dialog) && /Pass mark/.test(dialog));
  void exams;

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const papers = healthy('Assessments',
    await open(page, '/onyx/platform/tenants/1/assessments', 'console-assessments'),
    ['paper']);
  void papers;

  await ctx.close();
}

await browser.close();
console.log('\n' + (failures ? failures + ' FAILURES' : 'all page checks passed'));
process.exitCode = failures ? 1 : 0;
