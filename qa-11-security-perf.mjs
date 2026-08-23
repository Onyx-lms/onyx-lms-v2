import { launch, newPage, signIn, visit, BASE, ACCOUNTS } from './qa-lib.mjs';
import fs from 'node:fs';
const results = { phase: 'security+perf', base: BASE, steps: [], perf: [] };
const step = (o) => { results.steps.push(o); console.log(o.verdict + '  ' + o.name.padEnd(46) + ' ' + (o.detail ?? '')); };
const b = await launch();

// ---------- security response headers ----------
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  const resp = await p.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  const h = resp.headers();
  results.headers = h;
  const want = {
    'strict-transport-security': /max-age=\d+/,
    'x-content-type-options': /nosniff/i,
    'x-frame-options': /deny|sameorigin/i,
    'content-security-policy': /./,
    'referrer-policy': /./,
    'permissions-policy': /./,
  };
  for (const [k, re] of Object.entries(want)) {
    const v = h[k];
    const ok = v && re.test(v);
    step({ name: 'header ' + k, verdict: ok ? 'PASS' : 'WARN', detail: v ? v.slice(0, 130) : 'ABSENT' });
  }

  // ---------- session cookie flags ----------
  await p.locator('#email').fill(ACCOUNTS.m_student.email);
  await p.locator('#password').fill(ACCOUNTS.m_student.password);
  await p.getByRole('button', { name: /sign in/i }).click();
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });
  const cookies = await ctx.cookies();
  results.cookies = cookies.map((c) => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, path: c.path, expires: c.expires }));
  for (const c of cookies) {
    const ok = c.httpOnly && c.secure && (c.sameSite === 'Lax' || c.sameSite === 'Strict');
    step({ name: 'cookie ' + c.name, verdict: ok ? 'PASS' : 'WARN',
           detail: `httpOnly=${c.httpOnly} secure=${c.secure} sameSite=${c.sameSite} path=${c.path}` });
  }
  // JWT must not be reachable from JS
  const js = await p.evaluate(() => ({ cookie: document.cookie, ls: Object.keys(localStorage), ss: Object.keys(sessionStorage) }));
  const leak = /token|jwt|session|onyx/i.test(js.cookie) || js.ls.some((k) => /token|jwt|auth/i.test(k));
  step({ name: 'session token not exposed to JS', verdict: leak ? 'FAIL' : 'PASS',
         detail: 'document.cookie="' + js.cookie + '" localStorage=' + JSON.stringify(js.ls) });
  await ctx.close();
}

// ---------- tampered / forged token ----------
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'm_student');
  const cookies = await ctx.cookies();
  const sess = cookies.find((c) => /onyx|session|token/i.test(c.name));
  if (sess) {
    // flip the signature
    const parts = sess.value.split('.');
    const tampered = parts.length === 3 ? parts[0] + '.' + parts[1] + '.' + 'x'.repeat(parts[2].length) : sess.value.slice(0, -6) + 'AAAAAA';
    await ctx.clearCookies();
    await ctx.addCookies([{ ...sess, value: tampered }]);
    const r = await visit(p, '/onyx/dashboard');
    step({ name: 'tampered session cookie rejected', verdict: /login/.test(r.landed) ? 'PASS' : 'FAIL',
           detail: 'cookie=' + sess.name + ' -> ' + r.landed });
    const api = await p.evaluate(async () => {
      const rr = await fetch('/api/onyx/me', { credentials: 'include' });
      return { s: rr.status, b: (await rr.text()).slice(0, 120) };
    });
    step({ name: 'tampered cookie rejected by API', verdict: api.s === 401 || api.s === 403 ? 'PASS' : 'FAIL', detail: api.s + ' ' + api.b });
  } else step({ name: 'tampered session cookie rejected', verdict: 'WARN', detail: 'no session cookie identified: ' + cookies.map((c) => c.name).join(',') });
  await ctx.close();
}

// ---------- employer journey (the role not yet exercised) ----------
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'employer');
  for (const path of ['/onyx/jobs', '/onyx/interviews', '/onyx/inbox', '/onyx/profile']) {
    const r = await visit(p, path, { snippet: true });
    step({ name: 'employer renders ' + path, verdict: r.status === 200 && !r.errorText.length && !r.empty ? 'PASS' : 'FAIL',
           detail: 'status=' + r.status + ' len=' + r.bodyLen });
  }
  // an employer must not see the institution's people or finance
  for (const path of ['/onyx/people', '/onyx/finance', '/onyx/audit', '/onyx/settings']) {
    const r = await visit(p, path);
    step({ name: 'employer denied ' + path, verdict: /denied|login/.test(r.landed) ? 'PASS' : 'FAIL', detail: '-> ' + r.landed });
  }
  const emp = await p.evaluate(async () => {
    const out = {};
    for (const e of ['/api/onyx/members', '/api/onyx/employers', '/api/onyx/employers/mine', '/api/onyx/results']) {
      const r = await fetch(e, { credentials: 'include' });
      out[e] = { s: r.status, b: (await r.text()).slice(0, 150) };
    }
    return out;
  });
  for (const [e, v] of Object.entries(emp)) {
    console.log('     employer API ' + e.padEnd(30) + ' ' + v.s + ' ' + v.b.slice(0, 110));
    results.steps.push({ name: 'employer API ' + e, status: v.s, body: v.b, verdict: 'INFO' });
  }
  await ctx.close();
}

// ---------- performance ----------
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'm_admin');
  for (const path of ['/onyx/dashboard', '/onyx/courses', '/onyx/people?role=student', '/onyx/finance', '/onyx/audit', '/onyx/settings']) {
    const t0 = Date.now();
    await p.goto(BASE + path, { waitUntil: 'load' });
    const wall = Date.now() - t0;
    const nav = await p.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null;
    });
    results.perf.push({ path, wall, ...nav });
    const slow = wall > 4000;
    console.log((slow ? 'WARN' : 'PASS') + '  perf ' + path.padEnd(30) + ' wall=' + wall + 'ms ttfb=' + (nav?.ttfb ?? '?') + 'ms load=' + (nav?.load ?? '?') + 'ms');
  }
  await ctx.close();
}

await b.close();
fs.writeFileSync('qa-results-11-security-perf.json', JSON.stringify(results, null, 2));
console.log('\n=== SUMMARY ===');
for (const v of ['FAIL', 'WARN', 'PASS']) console.log(v, results.steps.filter((s) => s.verdict === v).length);
