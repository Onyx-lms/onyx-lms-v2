/**
 * Print-media preview at true A4 geometry, sliced at the page boundary, so bad
 * breaks and overflow are visible before the PDF is handed over.
 *
 * A4 at 96dpi = 794 x 1123 px. Margins 14mm top / 16mm bottom / 13mm sides.
 */
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const PAGE_W = 794, PAGE_H = 1123;
const MT = Math.round(14 * 96 / 25.4), MB = Math.round(16 * 96 / 25.4);
const CONTENT_H = PAGE_H - MT - MB;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: PAGE_W, height: CONTENT_H } });
await p.emulateMedia({ media: 'print' });
await p.goto(pathToFileURL(path.resolve('qa-report-print.html')).href, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

const info = await p.evaluate(() => ({
  scrollH: document.documentElement.scrollHeight,
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
console.log('print-media:', JSON.stringify(info), 'content page height:', CONTENT_H);
if (info.scrollW > info.clientW + 2) console.log('!! HORIZONTAL OVERFLOW');

const pages = Math.ceil(info.scrollH / CONTENT_H);
for (let i = 0; i < pages; i++) {
  await p.evaluate((y) => window.scrollTo(0, y), i * CONTENT_H);
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'qa-print-' + (i + 1) + '.png' });
}
await b.close();
console.log('approx ' + pages + ' pages; screenshots qa-print-1..' + pages + '.png');
