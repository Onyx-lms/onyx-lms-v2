import { launch, newPage, signIn, visit, verdict, BASE } from './qa-lib.mjs';
import fs from 'node:fs';

const results = { phase:'deep-links', base: BASE, checks: [] };
const add = (o) => { results.checks.push(o);
  const t = `${o.verdict}  ${o.role.padEnd(10)} ${o.path.padEnd(40)} ${o.status} -> ${o.landed}`;
  if (o.verdict !== 'PASS') console.log(t + '   ' + JSON.stringify(o.errorText) + (o.empty?' EMPTY':'') + ' ' + (o.pageerrors?.[0]??''));
};

const browser = await launch();

/** Pull ids from a list API so deep links use rows that really exist. */
async function ids(page, ep, n = 3) {
  return page.evaluate(async ([e, n]) => {
    const r = await fetch(e, { credentials: 'include' });
    const j = await r.json().catch(()=>null);
    const rows = Array.isArray(j?.data) ? j.data : (j?.data?.items ?? j?.data?.rows ?? []);
    return (Array.isArray(rows)?rows:[]).slice(0, n).map(x => x?.id).filter(x => x != null);
  }, [ep, n]);
}

const PLAN = {
  m_admin: async (page) => {
    const paths = [];
    for (const c of await ids(page, '/api/onyx/courses')) {
      paths.push('/onyx/courses/'+c, '/onyx/courses/'+c+'/lessons', '/onyx/courses/'+c+'/attendance');
    }
    for (const a of await ids(page, '/api/onyx/assessments')) {
      paths.push('/onyx/assessments/'+a, '/onyx/assessments/'+a+'/marking', '/onyx/assessments/'+a+'/results');
    }
    for (const e of await ids(page, '/api/onyx/exams')) paths.push('/onyx/exams/'+e, '/onyx/exams/'+e+'/marking');
    for (const j of await ids(page, '/api/onyx/jobs')) paths.push('/onyx/jobs/'+j);
    for (const p of await ids(page, '/api/onyx/programs')) paths.push('/onyx/programs');
    for (const d of await ids(page, '/api/onyx/domains')) paths.push('/onyx/domains/'+d);
    for (const w of await ids(page, '/api/onyx/workspaces')) paths.push('/onyx/workspaces/'+w);
    for (const t of await ids(page, '/api/onyx/tickets')) paths.push('/onyx/support/'+t);
    for (const b of await ids(page, '/api/onyx/banks')) paths.push('/onyx/banks/'+b);
    for (const c of await ids(page, '/api/onyx/contests')) paths.push('/onyx/contests/'+c);
    return paths;
  },
  m_faculty: async (page) => {
    const paths = [];
    for (const c of await ids(page, '/api/onyx/courses')) paths.push('/onyx/courses/'+c, '/onyx/courses/'+c+'/lessons');
    for (const a of await ids(page, '/api/onyx/assessments')) paths.push('/onyx/assessments/'+a);
    for (const w of await ids(page, '/api/onyx/workspaces')) paths.push('/onyx/workspaces/'+w);
    return paths;
  },
  m_student: async (page) => {
    const paths = ['/onyx/practice/results','/onyx/resume','/onyx/verify/transcript'];
    for (const c of await ids(page, '/api/onyx/courses')) paths.push('/onyx/courses/'+c, '/onyx/courses/'+c+'/lessons');
    for (const a of await ids(page, '/api/onyx/assessments')) paths.push('/onyx/assessments/'+a);
    for (const p of await ids(page, '/api/onyx/problems')) paths.push('/onyx/practice/'+p);
    for (const w of await ids(page, '/api/onyx/workspaces')) paths.push('/onyx/workspaces/'+w);
    for (const j of await ids(page, '/api/onyx/jobs')) paths.push('/onyx/jobs/'+j);
    return paths;
  },
  m_exams:  async (page) => {
    const paths = [];
    for (const e of await ids(page, '/api/onyx/exams')) paths.push('/onyx/exams/'+e, '/onyx/exams/'+e+'/marking');
    for (const a of await ids(page, '/api/onyx/assessments')) paths.push('/onyx/assessments/'+a+'/marking','/onyx/assessments/'+a+'/results');
    return paths;
  },
  m_placement: async (page) => {
    const paths = [];
    for (const j of await ids(page, '/api/onyx/jobs')) paths.push('/onyx/jobs/'+j);
    for (const i of await ids(page, '/api/onyx/interviews')) paths.push('/onyx/interviews/'+i);
    for (const d of await ids(page, '/api/onyx/drives')) paths.push('/onyx/drives/'+d);
    return paths;
  },
  m_guardian: async () => ['/onyx/family'],
  superadmin: async (page) => {
    const t = await page.evaluate(async () => {
      const r = await fetch('/api/onyx/tenants', { credentials: 'include' });
      const j = await r.json().catch(()=>null);
      const rows = Array.isArray(j?.data) ? j.data : (j?.data?.items ?? []);
      return (Array.isArray(rows)?rows:[]).slice(0,2).map(x=>x?.id).filter(x=>x!=null);
    });
    const subs = ['','/courses','/students','/staff','/faculty','/assessments','/assignments',
                  '/examinations','/fees','/grades','/grades/exams','/grades/assessments',
                  '/permissions','/settings','/timetable'];
    return t.flatMap(id => subs.map(s => '/onyx/platform/tenants/'+id+s));
  },
};

for (const [role, plan] of Object.entries(PLAN)) {
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await signIn(page, role);
  let paths = [];
  try { paths = await plan(page); } catch (e) { console.log('plan failed', role, String(e).slice(0,150)); }
  paths = [...new Set(paths)];
  for (const p of paths) {
    const r = await visit(page, p);
    add({ role, ...r, verdict: verdict(r) });
  }
  console.log(`-- ${role}: ${paths.length} deep links`);
  await ctx.close();
}
await browser.close();
fs.writeFileSync('qa-results-06-deep.json', JSON.stringify(results, null, 2));
console.log('\n=== SUMMARY ===');
for (const v of ['FAIL','WARN','PASS']) console.log(v, results.checks.filter(c=>c.verdict===v).length);
