import { launch, newPage, signIn, BASE } from './qa-lib.mjs';
import fs from 'node:fs';
const S = JSON.parse(fs.readFileSync('qa-lifecycle-state.json', 'utf8'));
const STAMP = S.stamp, PASSWORD = 'QaCert#2026!';
const TENANT_ID = S.created.tenant?.id, EXAM_ID = S.created.exam?.id;
const b = await launch();
async function login(email) {
  const ctx = await b.newContext(); const page = await newPage(ctx);
  await page.goto(BASE + '/onyx/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });
  return { ctx, page };
}
async function show(page, path, label) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const t = await page.locator('body').innerText().catch(() => '');
  console.log('\n===== ' + label + '  [' + path + ']  len=' + t.length);
  console.log(t.replace(/\n{2,}/g, '\n').split('\n').slice(0, 45).join('\n'));
  return t;
}

console.log('### server time vs. exam start');
console.log('now                :', new Date().toISOString());
console.log('exam starts_at     :', S.created.exam?.starts_at);
console.log('delta (days)       :', ((new Date(S.created.exam?.starts_at) - Date.now()) / 86400000).toFixed(2));

// --- STUDENT: results + timetable ---
{
  const { ctx, page } = await login('qa.s1.' + STAMP + '@onyx.test');
  await show(page, '/onyx/results', 'STUDENT results');
  await show(page, '/onyx/timetable', 'STUDENT timetable');
  const api = await page.evaluate(async () => {
    const o = {};
    for (const e of ['/api/onyx/results', '/api/onyx/timetable', '/api/onyx/my/assessments']) {
      const r = await fetch(e, { credentials: 'include' });
      o[e] = { s: r.status, b: (await r.text()).slice(0, 500) };
    }
    return o;
  });
  for (const [k, v] of Object.entries(api)) console.log('\n  API ' + k, v.s, v.b);
  await ctx.close();
}

// --- EXAMS: the "3 days ago / already sat" question ---
{
  const { ctx, page } = await login('qa.exams.' + STAMP + '@onyx.test');
  await show(page, '/onyx/exams', 'EXAMS list  <-- check relative date + section heading');
  const api = await page.evaluate(async () => {
    const r = await fetch('/api/onyx/exams', { credentials: 'include' });
    return { s: r.status, b: (await r.text()).slice(0, 700) };
  });
  console.log('\n  API /api/onyx/exams', api.s, api.b);
  await ctx.close();
}

// --- ADMIN: roll numbers ---
{
  const { ctx, page } = await login('qa.admin.' + STAMP + '@onyx.test');
  const api = await page.evaluate(async () => {
    const r = await fetch('/api/onyx/members', { credentials: 'include' });
    const j = await r.json();
    return j.data.filter((m) => m.role === 'student')
      .map((m) => ({ name: m.name, roll: m.roll_number, email: m.email }));
  });
  console.log('\n### roll numbers stored:', JSON.stringify(api));
  await show(page, '/onyx/people?role=student', 'ADMIN students roster');
  await ctx.close();
}

// --- SUPERADMIN: staff vs faculty pages ---
{
  const ctx = await b.newContext(); const page = await newPage(ctx);
  await signIn(page, 'superadmin');
  await show(page, '/onyx/platform/tenants/' + TENANT_ID + '/staff', 'PLATFORM tenant/staff');
  await show(page, '/onyx/platform/tenants/' + TENANT_ID + '/faculty', 'PLATFORM tenant/faculty');
  await ctx.close();
}

await b.close();
