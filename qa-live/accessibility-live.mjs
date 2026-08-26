/**
 * axe-core over the deployed product, on the screens people actually live in.
 *
 * The quality report audited eleven pages and found one serious failure -- two
 * contrast violations in the Code Lab chrome -- plus a duplicated `main`
 * landmark on the not-found page. This is the standing check that neither
 * comes back, and that nothing joins them.
 *
 *   node --env-file=.env qa-live/accessibility-live.mjs
 */
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + label.padEnd(46) + ' ' + detail);
};

const browser = await chromium.launch();
const page = await (await browser.newContext({
  viewport: { width: 1400, height: 1000 }, timezoneId: 'Asia/Kolkata',
})).newPage();

await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
await page.getByLabel('Email address').fill('alpha-cse.001@mrdemo.test');
await page.getByLabel('Password', { exact: true }).fill('Student#2026!');
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60_000 });

/** The Code Lab problem is found rather than pinned: ids move. */
await page.goto(BASE + '/onyx/practice', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const problem = await page.evaluate(() =>
  [...document.querySelectorAll('a[href*="/onyx/practice/"]')]
    .map((a) => a.getAttribute('href'))
    .find((h) => /\/onyx\/practice\/\d+/.test(h ?? '')) ?? null);

const PAGES = [
  ['the dashboard', '/onyx/dashboard'],
  ['the course list', '/onyx/courses'],
  ['the timetable', '/onyx/timetable'],
  ['results', '/onyx/results'],
  ['the jobs board', '/onyx/jobs'],
  ['examinations', '/onyx/exams'],
  ['the profile', '/onyx/profile'],
  ['practice', '/onyx/practice'],
  ...(problem ? [['a Code Lab problem', problem]] : []),
  ['a page that is not there', '/onyx/courses/99999999'],
];

let serious = 0;
for (const [label, path] of PAGES) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  // Monaco mounts late; everything else is quick.
  await page.waitForTimeout(path.match(/practice\/\d/) ? 6000 : 2200);
  const scan = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  serious += bad.length;
  check(label, bad.length === 0,
    bad.length
      ? bad.map((v) => v.id + ' ×' + v.nodes.length).join(', ')
      : scan.violations.length
        ? 'clean of serious; ' + scan.violations.length + ' minor'
        : 'clean');
  for (const v of bad) {
    for (const n of v.nodes.slice(0, 3)) {
      console.log('        ' + n.target.join(' '));
      console.log('        ' + (n.failureSummary ?? '').split('\n')
        .filter((l) => l.trim()).slice(1, 2).join(''));
    }
  }
}

/*
 * The landmark. A page with two `main` regions sends screen-reader landmark
 * navigation to whichever comes first, which was the one wrapping the whole
 * document rather than the content of the page.
 */
await page.goto(BASE + '/onyx/courses/99999999', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const landmarks = await page.evaluate(() =>
  document.querySelectorAll('main, [role="main"]').length);
check('one main landmark on the not-found page', landmarks === 1, landmarks + ' found');

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(78));
console.log(results.length - failed.length + ' pass, ' + failed.length + ' fail · '
  + serious + ' serious/critical violation(s) across ' + PAGES.length + ' pages');
for (const f of failed) console.log('  FAIL ' + f.label + ' -- ' + f.detail);
process.exit(failed.length ? 1 : 0);
