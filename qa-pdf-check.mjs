import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1240, height: 1754 } });
await p.goto(pathToFileURL(path.resolve('qa-report-print.html')).href, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

const f = await p.evaluate(() => ({
  h1family: getComputedStyle(document.querySelector('h1')).fontFamily,
  serif: document.fonts.check('16px "IBM Plex Serif"'),
  sans: document.fonts.check('16px "IBM Plex Sans"'),
  mono: document.fonts.check('16px "IBM Plex Mono"'),
  bodyScrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
console.log('fonts/overflow:', JSON.stringify(f));

const h = await p.evaluate(() => document.documentElement.scrollHeight);
console.log('doc height px:', h);
const n = Math.ceil(h / 1754);
for (let i = 0; i < n; i++) {
  await p.evaluate((y) => window.scrollTo(0, y), i * 1754);
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'qa-pdf-page-' + (i + 1) + '.png' });
}
await b.close();
console.log('wrote ' + n + ' screenshots');
