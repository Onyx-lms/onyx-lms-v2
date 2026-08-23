import { launch, newPage, signIn, visit, verdict, BASE, ACCOUNTS } from './qa-lib.mjs';
import fs from 'node:fs';

const results = { phase: 'auth', base: BASE, checks: [] };
const add = (o) => { results.checks.push(o); console.log(JSON.stringify(o)); };

const browser = await launch();

// --- A. Public reachability -------------------------------------------------
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  for (const p of ['/', '/onyx/login', '/onyx/platform/login', '/onyx/signup', '/health']) {
    const r = await visit(page, p);
    add({ id: 'PUB-' + p, group: 'public', ...r, verdict: verdict(r) });
  }
  // Unauthenticated protected route -> must not leak
  for (const p of ['/onyx/dashboard', '/onyx/people', '/onyx/settings', '/onyx/audit',
                   '/onyx/platform/tenants', '/onyx/platform/admins']) {
    const r = await visit(page, p);
    const leaked = !/login/i.test(r.landed);
    add({ id: 'ANON-' + p, group: 'anon-guard', ...r, leaked,
          verdict: leaked ? 'FAIL' : 'PASS' });
  }
  // Open redirect guard
  await page.goto(BASE + '/onyx/login?next=https://evil.example/x', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(ACCOUNTS.student.email);
  await page.locator('#password').fill(ACCOUNTS.student.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(6000);
  const u = page.url();
  add({ id: 'SEC-open-redirect', group: 'security', landed: u,
        verdict: u.startsWith(BASE) ? 'PASS' : 'FAIL' });
  await ctx.close();
}

// --- B. Bad credentials -----------------------------------------------------
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill('student@demo.onyx');
  await page.locator('#password').fill('WrongPassword!1');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(6000);
  const body = await page.locator('body').innerText();
  const stayed = /login/.test(new URL(page.url()).pathname);
  const shows = /incorrect|invalid|wrong|could not|not match|try again/i.test(body);
  add({ id: 'SEC-bad-password', group: 'security', stayed, shows,
        msg: (body.match(/.{0,120}(incorrect|invalid|wrong|could not).{0,120}/i) ?? [''])[0],
        verdict: stayed ? (shows ? 'PASS' : 'WARN') : 'FAIL' });

  // Institution account at the platform door
  await page.goto(BASE + '/onyx/platform/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill('admin@demo.onyx');
  await page.locator('#password').fill('Demo#2026!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(6000);
  const p2 = new URL(page.url()).pathname;
  add({ id: 'SEC-tenant-admin-at-platform-door', group: 'security', landed: p2,
        verdict: p2.includes('/platform/login') ? 'PASS' : 'FAIL' });
  await ctx.close();
}

// --- C. Every credential in the CSV signs in --------------------------------
for (const key of Object.keys(ACCOUNTS)) {
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  const t0 = Date.now();
  try {
    const landed = await signIn(page, key);
    add({ id: 'LOGIN-' + key, group: 'login', email: ACCOUNTS[key].email,
          landed, ms: Date.now() - t0, verdict: 'PASS' });
  } catch (e) {
    let body = ''; try { body = (await page.locator('body').innerText()).slice(0, 500); } catch {}
    add({ id: 'LOGIN-' + key, group: 'login', email: ACCOUNTS[key].email,
          landed: page.url().replace(BASE, ''), ms: Date.now() - t0,
          error: String(e).slice(0, 200), body, verdict: 'FAIL' });
  }
  await ctx.close();
}

await browser.close();
fs.writeFileSync('qa-results-01-auth.json', JSON.stringify(results, null, 2));
console.log('\n=== SUMMARY ===');
for (const v of ['FAIL', 'WARN', 'PASS']) {
  console.log(v, results.checks.filter((c) => c.verdict === v).length);
}
