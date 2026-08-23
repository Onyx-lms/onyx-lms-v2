import { launch, newPage, signIn, visit, BASE } from './qa-lib.mjs';
import fs from 'node:fs';
const results = { phase: 'interactive', base: BASE, steps: [] };
const step = (o) => { results.steps.push(o); console.log(o.verdict + '  ' + o.name.padEnd(50) + ' ' + (o.detail ?? '')); };
const b = await launch();

// --- client-side navigation actually works (proper waits) ---
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'm_student');
  await p.goto(BASE + '/onyx/courses', { waitUntil: 'domcontentloaded' });
  const link = p.getByRole('link', { name: 'Data Structures' }).first();
  await link.click();
  let ok = true, detail = '';
  try { await p.waitForURL('**/onyx/courses/54', { timeout: 15000 }); }
  catch { ok = false; detail = 'stayed at ' + p.url().replace(BASE, ''); }
  const body = await p.locator('body').innerText();
  step({ name: 'student: click course row -> detail', verdict: ok ? 'PASS' : 'FAIL',
         detail: detail || 'landed ' + p.url().replace(BASE, '') + ' len=' + body.length });

  // lesson navigation from the course
  const lessonLinks = await p.locator('a[href*="/lessons/"]').evaluateAll((e) => e.map((x) => x.getAttribute('href')));
  step({ name: 'student: course exposes lesson links', verdict: lessonLinks.length ? 'PASS' : 'WARN',
         detail: lessonLinks.length + ' links; first=' + (lessonLinks[0] ?? 'n/a') });
  if (lessonLinks.length) {
    const r = await visit(p, lessonLinks[0], { snippet: true });
    step({ name: 'student: lesson page renders', verdict: r.status === 200 && !r.errorText.length ? 'PASS' : 'FAIL',
           detail: 'status=' + r.status + ' landed=' + r.landed + ' len=' + r.bodyLen,
           snippet: (r.snippet || '').replace(/\n{2,}/g, ' | ').slice(0, 400) });
  }

  // --- Code Lab: does the Monaco IDE actually mount and run? ---
  await p.goto(BASE + '/onyx/practice/18', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(10000);
  const monaco = await p.locator('.monaco-editor').count();
  const runBtn = await p.getByRole('button', { name: /run|submit/i }).count();
  const bodyTxt = await p.locator('body').innerText();
  step({ name: 'student: code IDE mounts (Monaco)', verdict: monaco > 0 ? 'PASS' : 'FAIL',
         detail: 'monaco-nodes=' + monaco + ' run/submit buttons=' + runBtn + ' len=' + bodyTxt.length });
  if (monaco > 0) {
    // type a solution and run it
    await p.locator('.monaco-editor').first().click();
    await p.keyboard.press('Control+A');
    await p.keyboard.type('a,b=map(int,input().split())\nprint(a+b)');
    const run = p.getByRole('button', { name: /^run/i }).first();
    if (await run.count()) {
      await run.click();
      await p.waitForTimeout(20000);
      const after = await p.locator('body').innerText();
      const ran = /passed|failed|output|result|test|error/i.test(after.slice(0, 6000));
      step({ name: 'student: code Run produces a verdict', verdict: ran ? 'PASS' : 'WARN',
             detail: (after.match(/.{0,90}(passed|failed|tests?|output).{0,90}/i) ?? ['no verdict text'])[0].replace(/\n/g, ' ') });
    } else step({ name: 'student: code Run produces a verdict', verdict: 'WARN', detail: 'no Run button found' });
  }
  await ctx.close();
}

// --- admin: does the settings capability matrix persist a change? (read-only check) ---
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'm_admin');
  const perms = await p.evaluate(async () => {
    const r = await fetch('/api/onyx/tenant/settings', { credentials: 'include' });
    return { s: r.status, b: (await r.text()).slice(0, 600) };
  });
  step({ name: 'admin: tenant settings API', verdict: perms.s === 200 ? 'PASS' : 'FAIL',
         detail: perms.s + ' ' + perms.b.slice(0, 300) });

  // audit log is populated and scoped
  const audit = await p.evaluate(async () => {
    const r = await fetch('/api/onyx/audit?limit=5', { credentials: 'include' });
    const j = await r.json().catch(() => null);
    return { s: r.status, n: Array.isArray(j?.data) ? j.data.length : null,
             tenantIds: [...new Set((j?.data ?? []).map((x) => x.tenant_id))] };
  });
  step({ name: 'admin: audit log scoped to own tenant', verdict: audit.s === 200 && audit.tenantIds.every((t) => t === 190 || t == null) ? 'PASS' : 'FAIL',
         detail: 'status=' + audit.s + ' rows=' + audit.n + ' tenant_ids=' + JSON.stringify(audit.tenantIds) });
  await ctx.close();
}

// --- session lifecycle: sign out really invalidates ---
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'm_student');
  await p.goto(BASE + '/onyx/dashboard', { waitUntil: 'domcontentloaded' });
  const out = p.getByRole('button', { name: /sign out/i }).first();
  const hasBtn = await out.count();
  if (hasBtn) {
    await out.click();
    await p.waitForTimeout(6000);
  }
  const r = await visit(p, '/onyx/dashboard');
  step({ name: 'sign out invalidates the session', verdict: /login/.test(r.landed) ? 'PASS' : 'FAIL',
         detail: 'sign-out button=' + hasBtn + ' -> after: ' + r.landed });
  const apiAfter = await p.evaluate(async () => {
    const rr = await fetch('/api/onyx/me', { credentials: 'include' });
    return { s: rr.status, b: (await rr.text()).slice(0, 160) };
  });
  step({ name: 'API rejects the signed-out cookie', verdict: apiAfter.s === 401 || apiAfter.s === 403 ? 'PASS' : 'FAIL',
         detail: apiAfter.s + ' ' + apiAfter.b });
  await ctx.close();
}

// --- responsive: phone viewport keeps the tab bar and no horizontal scroll ---
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await newPage(ctx);
  await signIn(p, 'm_student');
  for (const path of ['/onyx/dashboard', '/onyx/courses', '/onyx/results']) {
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    const m = await p.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    const overflow = m.scrollW > m.clientW + 2;
    step({ name: 'mobile 390px no h-overflow: ' + path, verdict: overflow ? 'FAIL' : 'PASS',
           detail: 'scrollW=' + m.scrollW + ' clientW=' + m.clientW });
  }
  const tabs = await p.locator('nav a, [role="tablist"] a').count();
  step({ name: 'mobile: bottom tab bar present', verdict: tabs > 0 ? 'PASS' : 'WARN', detail: tabs + ' nav links' });
  await ctx.close();
}

await b.close();
fs.writeFileSync('qa-results-09-interactive.json', JSON.stringify(results, null, 2));
console.log('\n=== SUMMARY ===');
for (const v of ['FAIL', 'WARN', 'PASS']) console.log(v, results.steps.filter((s) => s.verdict === v).length);
