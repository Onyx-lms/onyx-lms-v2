/**
 * Where the time actually goes, measured rather than guessed.
 *
 * Two numbers per page, because they blame different things:
 *
 *   TTFB   -- the server thinking. Database reads, waterfalls, unpaged scans.
 *   total  -- what the person waits for, including the payload and hydration.
 *
 * Three cold loads, median reported: a single sample on a serverless platform
 * measures whether the lambda happened to be warm, not whether the page is
 * fast. Also reports the transferred bytes, because a page can be quick to
 * first byte and still slow to arrive.
 *
 *   node --env-file=.env qa-live/_perf-probe.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const RUNS = 3;

const ACCOUNTS = {
  student: ['alpha-cse.001@mrdemo.test', 'Student#2026!'],
  faculty: ['faculty1@mrdemo.test', 'MrDemo#2026!'],
  admin: ['admin@mrdemo.test', 'MrDemo#2026!'],
};

/** The screens people actually live in, per role. */
const PAGES = {
  student: [
    '/onyx/dashboard', '/onyx/courses', '/onyx/timetable', '/onyx/results',
    '/onyx/profile', '/onyx/practice', '/onyx/exams', '/onyx/assessments',
  ],
  faculty: [
    '/onyx/dashboard', '/onyx/courses', '/onyx/banks', '/onyx/exams',
    '/onyx/marking', '/onyx/assessments',
  ],
  admin: [
    '/onyx/dashboard', '/onyx/people', '/onyx/courses', '/onyx/audit',
    '/onyx/finance', '/onyx/sections', '/onyx/attendance',
  ],
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const browser = await chromium.launch();
const rows = [];

for (const [role, [email, password]] of Object.entries(ACCOUNTS)) {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 }, timezoneId: 'Asia/Kolkata',
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60_000 });

  for (const path of PAGES[role]) {
    const ttfbs = [];
    const totals = [];
    let bytes = 0;
    let status = 0;
    for (let i = 0; i < RUNS; i += 1) {
      let transferred = 0;
      const onResponse = async (r) => {
        try {
          const len = Number(r.headers()['content-length'] ?? 0);
          transferred += Number.isFinite(len) ? len : 0;
        } catch { /* a redirect or an aborted request carries no length */ }
      };
      page.on('response', onResponse);
      const started = Date.now();
      const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 60_000 });
      const total = Date.now() - started;
      page.off('response', onResponse);
      status = res?.status() ?? 0;

      /*
       * `responseEnd`, not `responseStart`.
       *
       * An App Router page flushes its shell immediately and does every await
       * inside the stream, so time-to-FIRST-byte measures the shell and
       * nothing else -- it read 30-90 ms on pages that took a second and a
       * half. Time to the LAST byte of the document is the server actually
       * finishing, which is the number a data-fetching change moves.
       */
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        return nav ? { ttfb: nav.responseEnd - nav.requestStart } : null;
      });
      ttfbs.push(Math.round(timing?.ttfb ?? 0));
      totals.push(total);
      bytes = Math.max(bytes, transferred);
    }
    rows.push({
      role, path, status,
      ttfb: median(ttfbs), total: median(totals), kb: Math.round(bytes / 1024),
    });
    console.log((role + ' ' + path).padEnd(34)
      + String(median(ttfbs)).padStart(6) + ' ms server'
      + String(median(totals)).padStart(7) + ' ms total'
      + String(Math.round(bytes / 1024)).padStart(6) + ' KB'
      + (status === 200 ? '' : '   HTTP ' + status));
  }
  await ctx.close();
}

await browser.close();

console.log('\n' + '='.repeat(72));
console.log('SLOWEST BY SERVER TIME (document fully streamed) — data-fetching problems');
for (const r of [...rows].sort((a, b) => b.ttfb - a.ttfb).slice(0, 10)) {
  console.log('  ' + String(r.ttfb).padStart(6) + ' ms  ' + r.role + ' ' + r.path);
}
console.log('\nSLOWEST BY WHAT A PERSON WAITS FOR (total)');
for (const r of [...rows].sort((a, b) => b.total - a.total).slice(0, 10)) {
  console.log('  ' + String(r.total).padStart(6) + ' ms  ' + r.role + ' ' + r.path
    + '  (' + r.kb + ' KB)');
}
console.log('\nHEAVIEST PAYLOADS');
for (const r of [...rows].sort((a, b) => b.kb - a.kb).slice(0, 8)) {
  console.log('  ' + String(r.kb).padStart(6) + ' KB  ' + r.role + ' ' + r.path);
}
