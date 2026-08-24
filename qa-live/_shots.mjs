import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'https://onyx-lms-v2.vercel.app';
const OUT = process.argv[2];
const rows = fs.readFileSync('onyx-v2-credentials.csv', 'utf8')
  .trim().split(/\r?\n/).slice(1).map((r) => r.split(','));
const admin = rows.find((r) => r[1] === 'abc-institution' && r[2] === 'admin');

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
await page.getByLabel(/email/i).first().fill(admin[4]);
await page.getByLabel(/password/i).first().fill(admin[5]);
await page.getByRole('button', { name: /sign in|log in/i }).first().click();
await page.waitForURL(/\/onyx\/(dashboard|courses|people)/, { timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
console.log('signed in at', page.url());

async function shot(path, name, opener) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (opener) {
    const btn = page.getByRole('button', { name: opener }).first();
    for (let i = 0; i < 4 && !(await page.getByRole('dialog').count()); i += 1) {
      await btn.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
  }
  await page.screenshot({ path: OUT + '/' + name + '.png', fullPage: !opener });
  console.log('shot', name, opener ? '(dialog: ' + (await page.getByRole('dialog').count()) + ')' : '');
}

await shot('/onyx/assessments', 'assessments-list');
await shot('/onyx/assessments', 'assessments-compose', /Create a paper/i);
await shot('/onyx/exams', 'exams-list');
await shot('/onyx/exams', 'exams-schedule', /Schedule an exam/i);
await shot('/onyx/people', 'people');
await b.close();
