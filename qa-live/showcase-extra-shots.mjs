/**
 * Extra marketing/positioning screens for the final showcase PDF -- the
 * public landing and storefront (revenue story), the two sign-in doors
 * (multi-tenant story), and the operator's create-institution flow
 * (onboard-a-university story). Captured live, same as client-report-shots.mjs.
 *
 *   node qa-live/showcase-extra-shots.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';
const OUT = 'reports/client-shots';
fs.mkdirSync(OUT, { recursive: true });
const log = (m, ok, d = '') => console.log((ok ? 'ok    ' : 'FAIL  ') + m.padEnd(34) + ' ' + d);

const browser = await chromium.launch();

async function shootPublic(path, name, label, full = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Kolkata' });
  const p = await ctx.newPage();
  try {
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 40_000 });
    await p.waitForTimeout(2200);
    await p.screenshot({ path: OUT + '/' + name + '.png', fullPage: full });
    log(label, true, name + '.png');
  } catch (e) { log(label, false, e.message); }
  await ctx.close();
}

// public, signed-out
await shootPublic('/', 'm1-landing', 'public landing (revenue story)');
await shootPublic('/courses', 'm2-store', 'public course storefront');
await shootPublic('/onyx/login', 'm3-door-tenant', 'institution sign-in door');
await shootPublic('/onyx/platform/login', 'm4-door-platform', 'platform operator door');

// operator: create-institution modal
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  try {
    await p.goto(BASE + '/onyx/platform/login', { waitUntil: 'domcontentloaded' });
    await p.getByLabel('Email address').fill('superadmin@onyx.platform');
    await p.getByLabel('Password', { exact: true }).fill('Platform#2026!');
    await p.getByRole('button', { name: /sign in/i }).click();
    await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30_000 });
    await p.goto(BASE + '/onyx/platform', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /create an institution/i }).first().click({ timeout: 6000 });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: OUT + '/m5-onboard.png' });
    log('operator: onboard a university', true, 'm5-onboard.png');
  } catch (e) { log('operator: onboard a university', false, e.message); }
  await ctx.close();
}

await browser.close();
console.log('\nExtra showcase screenshots in ' + OUT + '/');
