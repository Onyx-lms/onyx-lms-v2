import { launch, newPage, signIn, BASE, ACCOUNTS } from './qa-lib.mjs';
import fs from 'node:fs';

const CSV_ROLE = { superadmin:'(platform)', admin:'admin', faculty:'faculty', exams:'exams',
  placement:'placement', employer:'employer', guardian:'guardian', student:'student',
  m_admin:'admin', m_faculty:'faculty', m_student:'student', m_placement:'placement',
  m_guardian:'guardian', m_exams:'exams' };

const results = { phase:'roles+isolation', base: BASE, roleCheck: [], isolation: [] };
const browser = await launch();

// --- A. Does each account's actual role match the credentials CSV? ----------
const sessions = {};
for (const key of Object.keys(CSV_ROLE)) {
  if (key === 'superadmin') continue;
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await signIn(page, key);
  const me = await page.evaluate(async () => (await (await fetch('/api/onyx/me',{credentials:'include'})).json()));
  const actual = me?.data?.role, tenant = me?.data?.tenant?.slug, tid = me?.data?.tenant?.id;
  const ok = actual === CSV_ROLE[key];
  results.roleCheck.push({ key, email: ACCOUNTS[key].email, csv_role: CSV_ROLE[key],
    actual_role: actual, tenant, tenant_id: tid, verdict: ok ? 'PASS':'FAIL' });
  console.log(`${ok?'PASS':'FAIL'} ${key.padEnd(12)} csv=${String(CSV_ROLE[key]).padEnd(10)} actual=${String(actual).padEnd(10)} tenant=${tenant}(${tid})`);
  sessions[key] = { ctx, page, tid, tenant };
}

// --- B. Harvest object IDs from each tenant as its admin --------------------
const ENDPOINTS = ['/api/onyx/courses','/api/onyx/members','/api/onyx/assessments',
                   '/api/onyx/exams','/api/onyx/programs','/api/onyx/jobs'];
async function harvest(page) {
  return page.evaluate(async (eps) => {
    const out = {};
    for (const e of eps) {
      try {
        const r = await fetch(e, { credentials: 'include' });
        const j = await r.json().catch(()=>null);
        const rows = Array.isArray(j?.data) ? j.data : (j?.data?.items ?? j?.data?.rows ?? j?.data?.courses ?? []);
        out[e] = { status: r.status, count: Array.isArray(rows)?rows.length:null,
                   ids: (Array.isArray(rows)?rows:[]).slice(0,5).map(x=>x?.id).filter(x=>x!=null) };
      } catch (err) { out[e] = { error: String(err).slice(0,120) }; }
    }
    return out;
  }, ENDPOINTS);
}
const abc = await harvest(sessions.admin.page);
const mer = await harvest(sessions.m_admin.page);
console.log('\nABC   :', JSON.stringify(abc));
console.log('MERID :', JSON.stringify(mer));
fs.writeFileSync('qa-harvest.json', JSON.stringify({ abc, mer, sessions: Object.fromEntries(
  Object.entries(sessions).map(([k,v])=>[k,{tid:v.tid,tenant:v.tenant}])) }, null, 2));

// --- C. Cross-tenant read: Meridian admin reaching ABC objects --------------
async function crossRead(page, label, targets) {
  for (const [ep, ids] of Object.entries(targets)) {
    for (const id of (ids.ids ?? [])) {
      const url = ep + '/' + id;
      const res = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        const t = (await r.text()).slice(0, 300);
        return { status: r.status, body: t };
      }, url);
      const leaked = res.status === 200 && /"ok"\s*:\s*true/.test(res.body);
      results.isolation.push({ actor: label, url, status: res.status, leaked,
        body: res.body.slice(0,200), verdict: leaked ? 'FAIL':'PASS' });
      if (leaked) console.log(`FAIL LEAK ${label} -> ${url}  ${res.body.slice(0,160)}`);
    }
  }
}
console.log('\n-- cross-tenant: Meridian admin reading ABC objects --');
await crossRead(sessions.m_admin.page, 'meridian-admin->abc', abc);
console.log('-- cross-tenant: ABC admin reading Meridian objects --');
await crossRead(sessions.admin.page, 'abc-admin->meridian', mer);
console.log('-- cross-tenant: ABC student reading Meridian objects --');
await crossRead(sessions.student.page, 'abc-student->meridian', mer);

for (const s of Object.values(sessions)) await s.ctx.close();
await browser.close();
fs.writeFileSync('qa-results-04-roles-isolation.json', JSON.stringify(results, null, 2));
console.log('\n=== ROLE MISMATCHES:', results.roleCheck.filter(r=>r.verdict==='FAIL').length,
            ' ISOLATION LEAKS:', results.isolation.filter(r=>r.verdict==='FAIL').length,
            ' isolation checks run:', results.isolation.length);
