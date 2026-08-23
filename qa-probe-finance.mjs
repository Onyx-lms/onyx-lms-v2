import { launch, newPage, signIn } from './qa-lib.mjs';
const EPS = ['/api/onyx/fee-structures','/api/onyx/admin/gateways','/api/onyx/allocations',
             '/api/onyx/drives','/api/onyx/finance/outstanding','/api/onyx/semesters'];
const browser = await launch();
for (const who of ['m_admin','m_faculty','m_exams','m_student','m_placement','m_guardian']) {
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await signIn(page, who);
  const out = await page.evaluate(async (eps) => {
    const o = {};
    for (const e of eps) { const r = await fetch(e,{credentials:'include'});
      o[e] = { s: r.status, b: (await r.text()).slice(0,260) }; }
    return o;
  }, EPS);
  console.log('\n##### ' + who);
  for (const [e,v] of Object.entries(out)) console.log(`  ${e.padEnd(34)} ${v.s}  ${v.b}`);
  await ctx.close();
}
await browser.close();
