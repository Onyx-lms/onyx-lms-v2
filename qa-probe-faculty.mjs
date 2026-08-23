import { launch, newPage, signIn, visit, BASE } from './qa-lib.mjs';
const browser = await launch();
for (const who of ['faculty','m_faculty']) {
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await signIn(page, who);
  // What does the app think this session is?
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/onyx/me', { credentials: 'include' });
    return { status: r.status, body: (await r.text()).slice(0, 900) };
  });
  console.log('\n===== ' + who + ' /api/onyx/me =====');
  console.log(me.status, me.body);
  const nav = await page.locator('nav').first().innerText().catch(()=> 'n/a');
  console.log('--- sidebar nav ---\n' + nav.replace(/\n+/g,' | '));
  for (const p of ['/onyx/audit','/onyx/settings','/onyx/finance','/onyx/placement','/onyx/certificates']) {
    const r = await visit(page, p, { snippet: true });
    console.log(`\n--- ${who} ${p} [${r.status}] landed=${r.landed} len=${r.bodyLen}`);
    console.log((r.snippet||'').replace(/\n{2,}/g,'\n').split('\n').slice(0,14).join(' / '));
  }
  await ctx.close();
}
await browser.close();
