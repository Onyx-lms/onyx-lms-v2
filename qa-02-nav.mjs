import { launch, newPage, signIn, visit, verdict, BASE } from './qa-lib.mjs';
import fs from 'node:fs';

// Nav routes per role, mirrored from apps/web/src/lib/onyx-nav.ts
const NAV = {
  student: ['/onyx/dashboard','/onyx/courses','/onyx/domains','/onyx/practice','/onyx/workspaces',
            '/onyx/assessments','/onyx/exams','/onyx/results','/onyx/contests',
            '/onyx/timetable','/onyx/fees','/onyx/support',
            '/onyx/jobs','/onyx/interviews','/onyx/resume','/onyx/profile','/onyx/inbox'],
  faculty: ['/onyx/dashboard','/onyx/courses','/onyx/domains','/onyx/practice','/onyx/workspaces',
            '/onyx/assessments','/onyx/exams','/onyx/invigilate',
            '/onyx/programs','/onyx/timetable','/onyx/allocations','/onyx/people',
            '/onyx/support','/onyx/inbox','/onyx/profile'],
  exams:   ['/onyx/assessments','/onyx/invigilate','/onyx/exams','/onyx/timetable',
            '/onyx/certificates','/onyx/inbox','/onyx/profile'],
  placement:['/onyx/placement','/onyx/jobs','/onyx/interviews','/onyx/contests',
            '/onyx/certificates','/onyx/inbox','/onyx/profile'],
  employer:['/onyx/jobs','/onyx/interviews','/onyx/inbox','/onyx/profile'],
  guardian:['/onyx/family','/onyx/inbox','/onyx/profile'],
  admin:   ['/onyx/dashboard','/onyx/courses','/onyx/domains','/onyx/workspaces',
            '/onyx/assessments','/onyx/invigilate','/onyx/exams','/onyx/contests','/onyx/certificates',
            '/onyx/programs','/onyx/timetable','/onyx/people?role=student','/onyx/people?role=faculty',
            '/onyx/finance','/onyx/placement','/onyx/jobs',
            '/onyx/settings','/onyx/profile','/onyx/audit','/onyx/inbox',
            '/onyx/allocations','/onyx/support','/onyx/banks','/onyx/discussions',
            '/onyx/attendance','/onyx/submissions','/onyx/drives','/onyx/attempts','/onyx/fees'],
  superadmin: ['/onyx/platform','/onyx/platform/admins','/onyx/platform/oauth-clients',
               '/onyx/platform/audit','/onyx/platform/tenants'],
};

const results = { phase: 'nav', base: BASE, checks: [] };
const add = (o) => {
  results.checks.push(o);
  const v = o.verdict;
  if (v !== 'PASS') console.log(`${v}  ${o.role.padEnd(11)} ${o.path.padEnd(34)} ${o.status} -> ${o.landed}  ${JSON.stringify(o.errorText)}${o.empty?' EMPTY':''} ${o.pageerrors?.[0]??''}`);
};

const browser = await launch();
const roles = Object.keys(NAV);
for (const role of roles) {
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  try { await signIn(page, role); } catch (e) {
    console.log('LOGIN FAILED', role, String(e).slice(0,120)); await ctx.close(); continue;
  }
  for (const p of NAV[role]) {
    const r = await visit(page, p);
    add({ role, ...r, verdict: verdict(r) });
  }
  console.log(`-- ${role}: done (${NAV[role].length} routes)`);
  await ctx.close();
}
await browser.close();
fs.writeFileSync('qa-results-02-nav.json', JSON.stringify(results, null, 2));
console.log('\n=== SUMMARY ===');
for (const v of ['FAIL','WARN','PASS']) console.log(v, results.checks.filter(c=>c.verdict===v).length);
