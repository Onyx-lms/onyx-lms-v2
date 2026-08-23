import { launch, newPage, signIn, visit, verdict, BASE } from './qa-lib.mjs';
import fs from 'node:fs';
const results = { phase:'platform', base: BASE, checks: [] };
const add = (o) => { results.checks.push(o);
  if (o.verdict !== 'PASS') console.log(`${o.verdict}  ${o.path.padEnd(52)} ${o.status} -> ${o.landed} ${JSON.stringify(o.errorText)}${o.empty?' EMPTY':''} ${(o.pageerrors?.[0]??'')}`); };

const browser = await launch();
const ctx = await browser.newContext();
const page = await newPage(ctx);
await signIn(page, 'superadmin');

const me = await page.evaluate(async () => (await (await fetch('/api/onyx/platform/me',{credentials:'include'})).json()));
console.log('platform me:', JSON.stringify(me).slice(0,300));

const tenants = await page.evaluate(async () => {
  const r = await fetch('/api/onyx/platform/tenants', { credentials:'include' });
  const j = await r.json().catch(()=>null);
  const rows = Array.isArray(j?.data) ? j.data : (j?.data?.items ?? j?.data?.tenants ?? []);
  return { status: r.status, total: rows.length,
           rows: rows.slice(0,3).map(t=>({id:t.id, slug:t.slug, name:t.name})) };
});
console.log('tenants:', JSON.stringify(tenants));

const SUBS = ['','/courses','/students','/staff','/faculty','/assessments','/assignments',
              '/examinations','/fees','/grades','/grades/exams','/grades/assessments',
              '/permissions','/settings','/timetable'];
const paths = ['/onyx/platform','/onyx/platform/admins','/onyx/platform/oauth-clients','/onyx/platform/audit'];
for (const t of tenants.rows) for (const s of SUBS) paths.push('/onyx/platform/tenants/'+t.id+s);

for (const p of paths) { const r = await visit(page, p); add({ ...r, verdict: verdict(r) }); }

// Platform API read surface
const API = ['/api/onyx/platform/tenants','/api/onyx/platform/admins','/api/onyx/platform/audit',
             '/api/onyx/platform/oauth-clients','/api/onyx/platform/audit/filters'];
const apiOut = await page.evaluate(async (eps) => {
  const o = {}; for (const e of eps) { const r = await fetch(e,{credentials:'include'});
    o[e] = { s: r.status, b: (await r.text()).slice(0,150) }; } return o;
}, API);
for (const [e,v] of Object.entries(apiOut)) {
  const ok = v.s === 200;
  results.checks.push({ path: e, status: v.s, body: v.b, verdict: ok?'PASS':'FAIL' });
  console.log(`${ok?'PASS':'FAIL'} API ${e.padEnd(42)} ${v.s} ${v.b.slice(0,90)}`);
}
await ctx.close();
await browser.close();
fs.writeFileSync('qa-results-07-platform.json', JSON.stringify(results, null, 2));
console.log('\n=== SUMMARY ===');
for (const v of ['FAIL','WARN','PASS']) console.log(v, results.checks.filter(c=>c.verdict===v).length);
