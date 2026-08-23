import { launch, newPage, signIn, visit, BASE } from './qa-lib.mjs';
const b = await launch();

// --- 1. student course-detail bounce ---
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'm_student');
  const api = await p.evaluate(async () => {
    const out = {};
    for (const e of ['/api/onyx/courses', '/api/onyx/catalogue', '/api/onyx/progress']) {
      const r = await fetch(e, { credentials: 'include' });
      out[e] = { s: r.status, b: (await r.text()).slice(0, 500) };
    }
    return out;
  });
  console.log('\n##### STUDENT course APIs');
  for (const [k, v] of Object.entries(api)) console.log(' ', k, v.s, v.b.slice(0, 380));

  await p.goto(BASE + '/onyx/courses', { waitUntil: 'domcontentloaded' });
  const hrefs = await p.locator('a[href^="/onyx/courses/"]').evaluateAll((els) =>
    els.map((e) => ({ href: e.getAttribute('href'), text: e.innerText.trim().slice(0, 60) })));
  console.log('\ncourse links on /onyx/courses:', JSON.stringify(hrefs.slice(0, 14), null, 1));
  for (const h of [...new Set(hrefs.map((x) => x.href))].slice(0, 6)) {
    const r = await visit(p, h, { snippet: true });
    console.log(`  ${h} -> status=${r.status} landed=${r.landed} len=${r.bodyLen}`);
    if (r.landed !== h) console.log('     BOUNCED. body:', (r.snippet || '').replace(/\n+/g, ' | ').slice(0, 300));
  }
  await ctx.close();
}

// --- 2. practice list ---
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'm_student');
  const r = await visit(p, '/onyx/practice', { snippet: true });
  console.log('\n##### STUDENT /onyx/practice  len=' + r.bodyLen);
  console.log((r.snippet || '').replace(/\n{2,}/g, '\n').split('\n').slice(0, 25).join(' | '));
  const links = await p.locator('a[href^="/onyx/practice/"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href')));
  console.log('practice links:', JSON.stringify(links));
  const api = await p.evaluate(async () => {
    const rr = await fetch('/api/onyx/problems', { credentials: 'include' });
    return { s: rr.status, b: (await rr.text()).slice(0, 400) };
  });
  console.log('/api/onyx/problems ->', api.s, api.b);
  await ctx.close();
}

// --- 3. guardian family page body ---
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'm_guardian');
  const r = await visit(p, '/onyx/family', { snippet: true });
  console.log('\n##### GUARDIAN /onyx/family  len=' + r.bodyLen);
  console.log((r.snippet || '').replace(/\n{2,}/g, '\n'));
  await ctx.close();
}

// --- 4. exams detail vs marking (identical lengths) ---
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'm_exams');
  for (const path of ['/onyx/exams', '/onyx/exams/8', '/onyx/exams/8/marking']) {
    const r = await visit(p, path, { snippet: true });
    console.log('\n##### EXAMS ' + path + '  status=' + r.status + ' landed=' + r.landed + ' len=' + r.bodyLen);
    console.log((r.snippet || '').replace(/\n{2,}/g, '\n').split('\n').slice(0, 22).join(' | '));
  }
  await ctx.close();
}

await b.close();
