/**
 * Visual walkthrough of the operator (superadmin) console on the deployed
 * site, looking at the Malla Reddy Demo institution from above.
 *
 *   node --env-file=.env qa-live/_visual-operator.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const OUT = 'qa-live/_shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (path, pass, detail = '') => {
  results.push({ path, pass, detail });
  console.log((pass ? 'ok    ' : 'FAIL  ') + path.padEnd(50) + ' ' + detail);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

await page.goto(BASE + '/onyx/platform/login', { waitUntil: 'domcontentloaded' });
await page.getByLabel(/email/i).first().fill('superadmin@onyx.platform');
await page.getByLabel(/password/i).first().fill('Platform#2026!');
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30_000 });
check('/onyx/platform/login', true, 'signed in -> ' + new URL(page.url()).pathname);

// find the demo tenant's id from the operator's own institution list
await page.goto(BASE + '/onyx/platform/tenants', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + '/operator-tenants.png' }).catch(() => {});
const href = await page.evaluate(() =>
  [...document.querySelectorAll('a[href*="/onyx/platform/tenants/"]')]
    .map((a) => a.getAttribute('href'))
    .find((h) => /\/onyx\/platform\/tenants\/\d+$/.test(h ?? '')));
const tid = href ? href.match(/tenants\/(\d+)/)[1] : null;
check('/onyx/platform/tenants', Boolean(tid), 'demo tenant id = ' + tid);

const PAGES = tid ? [
  '/onyx/platform/tenants/' + tid,
  '/onyx/platform/tenants/' + tid + '/courses',
  '/onyx/platform/tenants/' + tid + '/students',
  '/onyx/platform/tenants/' + tid + '/staff',
  '/onyx/platform/tenants/' + tid + '/assessments/banks',
  '/onyx/platform/tenants/' + tid + '/examinations',
  '/onyx/platform/tenants/' + tid + '/fees',
  '/onyx/platform/tenants/' + tid + '/certificates',
  '/onyx/platform/tenants/' + tid + '/support',
  '/onyx/platform/tenants/' + tid + '/settings',
] : [];

for (const path of PAGES) {
  const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    .catch((e) => ({ error: e }));
  if (res?.error) { check(path, false, 'nav failed: ' + res.error.message); continue; }
  const status = res.status();
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() =>
    (document.querySelector('#main') ?? document.body).innerText).catch(() => '');
  const broken = /Application error|a server-side exception|Page not found/i.test(text);
  const shot = OUT + '/operator-' + path.replace(/[^a-z0-9]+/gi, '-') + '.png';
  await page.screenshot({ path: shot }).catch(() => {});
  check(path, status < 400 && !broken, 'HTTP ' + status + (broken ? ' -- broken' : ''));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log('\n' + (results.length - failed.length) + ' pass, ' + failed.length + ' fail');
process.exit(failed.length ? 1 : 0);
