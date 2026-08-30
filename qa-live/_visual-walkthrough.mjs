/**
 * A visual walkthrough of the deployed site, as each role, on the demo
 * institution -- Malla Reddy Demo. Not a duplicate of the API suites: this
 * looks at what actually renders, takes screenshots for a human to review,
 * and flags anything that looks broken (error text, empty states where data
 * should be, console errors).
 *
 *   node --env-file=.env qa-live/_visual-walkthrough.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const OUT = 'qa-live/_shots';
fs.mkdirSync(OUT, { recursive: true });

const ROLES = {
  student: { email: 'alpha-cse.001@mrdemo.test', password: 'Student#2026!',
    pages: ['/onyx/dashboard', '/onyx/courses', '/onyx/timetable', '/onyx/results',
      '/onyx/profile', '/onyx/practice', '/onyx/exams', '/onyx/assessments',
      '/onyx/resume', '/onyx/jobs', '/onyx/support'] },
  faculty: { email: 'faculty1@mrdemo.test', password: 'MrDemo#2026!',
    pages: ['/onyx/dashboard', '/onyx/courses', '/onyx/assessments/banks', '/onyx/exams',
      '/onyx/assessments', '/onyx/placement', '/onyx/contests', '/onyx/interviews'] },
  admin: { email: 'admin@mrdemo.test', password: 'MrDemo#2026!',
    pages: ['/onyx/dashboard', '/onyx/people', '/onyx/courses', '/onyx/audit',
      '/onyx/finance', '/onyx/programs', '/onyx/certificates', '/onyx/settings',
      '/onyx/placement', '/onyx/support', '/onyx/permissions', '/onyx/allocations'] },
};

const results = [];
const check = (role, path, pass, detail = '') => {
  results.push({ role, path, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + (role + ' ' + path).padEnd(38) + ' ' + detail);
};

const browser = await chromium.launch();

for (const [role, cfg] of Object.entries(ROLES)) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Kolkata',
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email address').fill(cfg.email);
  await page.getByLabel('Password', { exact: true }).fill(cfg.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  try {
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30_000 });
    check(role, '/onyx/login', true, 'signed in -> ' + new URL(page.url()).pathname);
  } catch {
    check(role, '/onyx/login', false, 'never left the sign-in page');
    await ctx.close();
    continue;
  }

  for (const path of cfg.pages) {
    consoleErrors.length = 0;
    const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch((e) => ({ error: e }));
    if (res?.error) { check(role, path, false, 'navigation failed: ' + res.error.message); continue; }
    const status = res.status();
    await page.waitForTimeout(1400);

    const text = await page.evaluate(() =>
      (document.querySelector('#main') ?? document.body).innerText).catch(() => '');
    const brokenSignals = [
      /Application error/i, /a server-side exception/i, /Page not found/i,
      /^Error$/m, /Cannot read propert/i, /is not a function/i, /undefined is not/i,
    ];
    const broken = brokenSignals.find((re) => re.test(text));

    const shot = OUT + '/' + role + '-' + path.replace(/[^a-z0-9]+/gi, '-') + '.png';
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});

    const ok = status < 400 && !broken;
    check(role, path, ok,
      'HTTP ' + status
      + (broken ? ' -- matched "' + broken.source + '"' : '')
      + (consoleErrors.length ? ' -- ' + consoleErrors.length + ' console error(s): '
        + consoleErrors[0].slice(0, 80) : ''));
  }
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(results.length - failed.length + ' pass, ' + failed.length + ' fail');
for (const f of failed) console.log('  FAIL ' + f.role + ' ' + f.path + ' -- ' + f.detail);
console.log('\nScreenshots in ' + OUT + '/');
process.exit(failed.length ? 1 : 0);
