import { launch, newPage, signIn, visit, BASE } from './qa-lib.mjs';
import fs from 'node:fs';

// Guard matrix read off requireOnyxPageRole() calls in the page sources.
const GUARDED = {
  '/onyx/allocations':  ['admin','faculty'],
  '/onyx/audit':        ['admin'],
  '/onyx/certificates': ['admin','exams','placement'],
  '/onyx/family':       ['guardian'],
  '/onyx/finance':      ['admin'],
  '/onyx/invigilate':   ['admin','faculty','exams'],
  '/onyx/people':       ['admin','faculty'],
  '/onyx/placement':    ['admin','placement'],
  '/onyx/programs':     ['admin','faculty'],
  '/onyx/settings':     ['admin'],
};
// Platform console: no tenant role may enter.
const PLATFORM = ['/onyx/platform','/onyx/platform/admins','/onyx/platform/audit',
                  '/onyx/platform/oauth-clients'];
// Unguarded pages worth probing for data leakage to roles they aren't meant for.
const UNGUARDED_PROBE = ['/onyx/results','/onyx/fees','/onyx/practice','/onyx/workspaces',
                         '/onyx/resume','/onyx/courses','/onyx/timetable','/onyx/exams',
                         '/onyx/assessments','/onyx/contests','/onyx/domains','/onyx/support'];

const ROLES = ['student','faculty','exams','placement','employer','guardian','admin'];
const results = { phase: 'rbac', base: BASE, checks: [] };
const add = (o) => { results.checks.push(o); if (o.verdict !== 'PASS') console.log(
  `${o.verdict}  ${o.role.padEnd(10)} ${o.path.padEnd(28)} exp=${o.expected.padEnd(6)} got=${o.got.padEnd(7)} -> ${o.landed}`); };

const denied = (r) => /\/onyx\/denied/.test(r.landed) || r.status === 403;
const bounced = (r) => r.landed.replace(/\?.*/,'') !== r.path.replace(/\?.*/,'');

const browser = await launch();
for (const role of ROLES) {
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  try { await signIn(page, role); } catch (e) { console.log('LOGIN FAIL', role); await ctx.close(); continue; }

  for (const [p, allowed] of Object.entries(GUARDED)) {
    const r = await visit(page, p);
    const expected = allowed.includes(role) ? 'allow' : 'deny';
    const got = denied(r) ? 'deny' : (bounced(r) ? 'bounce' : 'allow');
    const ok = expected === 'deny' ? (got === 'deny') : (got === 'allow');
    add({ role, path: p, expected, got, landed: r.landed, status: r.status,
          h1: r.h1, verdict: ok ? 'PASS' : 'FAIL' });
  }
  for (const p of PLATFORM) {
    const r = await visit(page, p);
    // A tenant session must NOT see the platform console.
    const inConsole = r.landed.startsWith('/onyx/platform') && !r.landed.includes('login') && r.status === 200;
    add({ role, path: p, expected: 'deny', got: inConsole ? 'allow' : 'deny',
          landed: r.landed, status: r.status, h1: r.h1,
          verdict: inConsole ? 'FAIL' : 'PASS' });
  }
  for (const p of UNGUARDED_PROBE) {
    const r = await visit(page, p, { snippet: true });
    add({ role, path: p, expected: 'probe', got: denied(r) ? 'deny' : (bounced(r) ? 'bounce' : 'allow'),
          landed: r.landed, status: r.status, h1: r.h1, bodyLen: r.bodyLen,
          snippet: r.snippet, verdict: 'PASS', probe: true });
  }
  console.log('-- ' + role + ' done');
  await ctx.close();
}
await browser.close();
fs.writeFileSync('qa-results-03-rbac.json', JSON.stringify(results, null, 2));
const f = results.checks.filter(c=>c.verdict==='FAIL');
console.log('\n=== SUMMARY === FAIL', f.length, ' PASS', results.checks.filter(c=>c.verdict==='PASS').length);
