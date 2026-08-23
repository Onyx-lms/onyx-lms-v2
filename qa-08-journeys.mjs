import { launch, newPage, signIn, visit, BASE } from './qa-lib.mjs';
import fs from 'node:fs';
const results = { phase: 'journeys', base: BASE, steps: [] };
const step = (o) => {
  results.steps.push(o);
  console.log(o.verdict + '  ' + (o.who + '/' + o.name).padEnd(46) + ' ' + (o.detail ?? ''));
};

const browser = await launch();

// ============ STUDENT ============
{
  const ctx = await browser.newContext(); const page = await newPage(ctx);
  await signIn(page, 'm_student');
  const who = 'student';

  let r = await visit(page, '/onyx/dashboard', { snippet: true });
  step({ who, name: 'dashboard renders', verdict: r.bodyLen > 400 ? 'PASS' : 'FAIL',
         detail: 'len=' + r.bodyLen, snippet: (r.snippet || '').slice(0, 500) });

  await page.goto(BASE + '/onyx/courses', { waitUntil: 'domcontentloaded' });
  const courseLinks = await page.locator('a[href^="/onyx/courses/"]').all();
  step({ who, name: 'courses list has rows', verdict: courseLinks.length ? 'PASS' : 'FAIL',
         detail: courseLinks.length + ' course links' });
  if (courseLinks.length) {
    const href = await courseLinks[0].getAttribute('href');
    await courseLinks[0].click();
    await page.waitForLoadState('domcontentloaded');
    const body = await page.locator('body').innerText();
    step({ who, name: 'course detail opens',
           verdict: page.url().includes('/onyx/courses/') ? 'PASS' : 'FAIL',
           detail: href + ' -> ' + page.url().replace(BASE, '') + ' len=' + body.length });
    const lesson = page.locator('a[href*="/lessons/"]').first();
    if (await lesson.count()) {
      const lh = await lesson.getAttribute('href');
      const rr = await visit(page, lh, { snippet: true });
      step({ who, name: 'lesson page opens',
             verdict: rr.status === 200 && !rr.errorText.length ? 'PASS' : 'FAIL',
             detail: lh + ' status=' + rr.status + ' len=' + rr.bodyLen });
    } else step({ who, name: 'lesson page opens', verdict: 'SKIP', detail: 'no lesson links on course' });
  }

  await page.goto(BASE + '/onyx/practice', { waitUntil: 'domcontentloaded' });
  const prob = page.locator('a[href^="/onyx/practice/"]').first();
  if (await prob.count()) {
    const ph = await prob.getAttribute('href');
    await page.goto(BASE + ph, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
    const mon = await page.locator('.monaco-editor, textarea, [class*="editor"]').count();
    const body = await page.locator('body').innerText();
    step({ who, name: 'practice problem + code editor', verdict: mon > 0 ? 'PASS' : 'WARN',
           detail: ph + ' editor-nodes=' + mon + ' len=' + body.length });
  } else step({ who, name: 'practice problem + code editor', verdict: 'SKIP', detail: 'no problems listed' });

  for (const p of ['/onyx/results', '/onyx/resume', '/onyx/fees', '/onyx/timetable', '/onyx/inbox']) {
    const rr = await visit(page, p, { snippet: true });
    step({ who, name: 'renders ' + p,
           verdict: rr.status === 200 && rr.bodyLen > 300 && !rr.errorText.length ? 'PASS' : 'WARN',
           detail: 'status=' + rr.status + ' len=' + rr.bodyLen, snippet: (rr.snippet || '').slice(0, 400) });
  }
  await ctx.close();
}

// ============ FACULTY ============
{
  const ctx = await browser.newContext(); const page = await newPage(ctx);
  await signIn(page, 'm_faculty'); const who = 'faculty';
  await page.goto(BASE + '/onyx/courses', { waitUntil: 'domcontentloaded' });
  const c = page.locator('a[href^="/onyx/courses/"]').first();
  if (await c.count()) {
    const h = await c.getAttribute('href');
    const rr = await visit(page, h, { snippet: true });
    step({ who, name: 'course detail (teaching view)', verdict: rr.status === 200 ? 'PASS' : 'FAIL',
           detail: h + ' len=' + rr.bodyLen, snippet: (rr.snippet || '').slice(0, 500) });
    const att = await visit(page, h + '/attendance', { snippet: true });
    step({ who, name: 'course attendance',
           verdict: att.status === 200 && !att.errorText.length ? 'PASS' : 'WARN',
           detail: 'status=' + att.status + ' len=' + att.bodyLen });
  }
  await page.goto(BASE + '/onyx/people', { waitUntil: 'domcontentloaded' });
  const rows = await page.locator('a[href^="/onyx/p/"], table tr').count();
  step({ who, name: 'people roster lists members', verdict: rows > 1 ? 'PASS' : 'WARN', detail: rows + ' rows' });
  const asr = await visit(page, '/onyx/assessments', { snippet: true });
  step({ who, name: 'assessments list', verdict: asr.status === 200 ? 'PASS' : 'FAIL', detail: 'len=' + asr.bodyLen });
  await ctx.close();
}

// ============ GUARDIAN ============
{
  const ctx = await browser.newContext(); const page = await newPage(ctx);
  await signIn(page, 'm_guardian'); const who = 'guardian';
  const r = await visit(page, '/onyx/family', { snippet: true });
  step({ who, name: 'family page', verdict: r.status === 200 ? 'PASS' : 'FAIL',
         detail: 'len=' + r.bodyLen, snippet: (r.snippet || '').slice(0, 900) });
  const links = await page.locator('a[href*="/family/"], a[href*="student"]').count();
  step({ who, name: 'family links to a child record', verdict: links > 0 ? 'PASS' : 'WARN', detail: links + ' links' });
  const api = await page.evaluate(async () => {
    const rr = await fetch('/api/onyx/family', { credentials: 'include' });
    return { s: rr.status, b: (await rr.text()).slice(0, 400) };
  });
  step({ who, name: 'family API', verdict: api.s === 200 ? 'PASS' : 'FAIL', detail: api.s + ' ' + api.b.slice(0, 300) });
  await ctx.close();
}

// ============ PLACEMENT ============
{
  const ctx = await browser.newContext(); const page = await newPage(ctx);
  await signIn(page, 'm_placement'); const who = 'placement';
  for (const p of ['/onyx/placement', '/onyx/jobs', '/onyx/interviews', '/onyx/certificates']) {
    const r = await visit(page, p, { snippet: true });
    step({ who, name: 'renders ' + p, verdict: r.status === 200 && !r.errorText.length ? 'PASS' : 'FAIL',
           detail: 'len=' + r.bodyLen, snippet: (r.snippet || '').slice(0, 300) });
  }
  await ctx.close();
}

// ============ EXAMS ============
{
  const ctx = await browser.newContext(); const page = await newPage(ctx);
  await signIn(page, 'm_exams'); const who = 'exams';
  await page.goto(BASE + '/onyx/exams', { waitUntil: 'domcontentloaded' });
  const e = page.locator('a[href^="/onyx/exams/"]').first();
  if (await e.count()) {
    const h = await e.getAttribute('href');
    const r = await visit(page, h, { snippet: true });
    step({ who, name: 'exam detail', verdict: r.status === 200 ? 'PASS' : 'FAIL',
           detail: h + ' len=' + r.bodyLen, snippet: (r.snippet || '').slice(0, 500) });
    const m = await visit(page, h + '/marking', { snippet: true });
    step({ who, name: 'exam marking', verdict: m.status === 200 && !m.errorText.length ? 'PASS' : 'WARN',
           detail: 'status=' + m.status + ' len=' + m.bodyLen });
  }
  const inv = await visit(page, '/onyx/invigilate', { snippet: true });
  step({ who, name: 'invigilate console', verdict: inv.status === 200 ? 'PASS' : 'FAIL', detail: 'len=' + inv.bodyLen });
  await ctx.close();
}

// ============ ADMIN ============
{
  const ctx = await browser.newContext(); const page = await newPage(ctx);
  await signIn(page, 'm_admin'); const who = 'admin';
  for (const p of ['/onyx/settings', '/onyx/finance', '/onyx/audit', '/onyx/people?role=student']) {
    const r = await visit(page, p, { snippet: true });
    step({ who, name: 'renders ' + p, verdict: r.status === 200 && !r.errorText.length ? 'PASS' : 'FAIL',
           detail: 'len=' + r.bodyLen, snippet: (r.snippet || '').slice(0, 400) });
  }
  // settings page must expose the capability matrix
  await page.goto(BASE + '/onyx/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const toggles = await page.locator('input[type="checkbox"], button[role="switch"]').count();
  step({ who, name: 'settings capability matrix present', verdict: toggles > 0 ? 'PASS' : 'WARN',
         detail: toggles + ' toggles' });
  await ctx.close();
}

await browser.close();
fs.writeFileSync('qa-results-08-journeys.json', JSON.stringify(results, null, 2));
console.log('\n=== SUMMARY ===');
for (const v of ['FAIL', 'WARN', 'SKIP', 'PASS']) console.log(v, results.steps.filter((s) => s.verdict === v).length);
