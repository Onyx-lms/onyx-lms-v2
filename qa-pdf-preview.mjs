/** Screenshots of the print HTML, so the report can be read before it is signed. */
import { chromium } from '@playwright/test';
import path from 'node:path';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 1273 } });
const file = path.resolve('qa-report-print.html').split(path.sep).join('/');
await p.goto('file:///' + file, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(900);
const h = await p.evaluate(() => document.body.scrollHeight);
const screens = Math.ceil(h / 1273);
console.log('rendered height', h, '≈', screens, 'screens');
for (let i = 0; i < Math.min(screens, 10); i += 1) {
  await p.evaluate((y) => window.scrollTo(0, y), i * 1273);
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'qa-preview-' + String(i).padStart(2, '0') + '.png' });
}
await b.close();
