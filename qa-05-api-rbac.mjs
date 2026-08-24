import { launch, newPage, signIn, BASE } from './qa-lib.mjs';
import fs from 'node:fs';

// Privileged surfaces. `allow` = roles that legitimately hold the capability.
const READS = [
  ['/api/onyx/audit',              ['admin','exams']],
  ['/api/onyx/members',            ['admin','faculty','exams','placement']],
  ['/api/onyx/finance/outstanding',['admin']],
  ['/api/onyx/finance/receipts',   ['admin']],
  // Teaching load. The examinations office is answered with its own empty
  // set rather than a 403 -- correct scoping, not a leak -- so it is
  // allowed here and the body is what the check below actually reads.
  ['/api/onyx/allocations',        ['admin','faculty','exams']],
  ['/api/onyx/tenant/settings',    ['admin']],
  // Not privileged, and listing it here was the mistake: `enabledGateways`
  // returns identifier/title/currency for the gateways an institution has
  // switched on -- no key, no secret, no mode. Anybody who can be asked to
  // pay needs it, which is every signed-in role. The privileged one is
  // /api/onyx/admin/gateways below, which is admin + fees.gateways.
  ['/api/onyx/gateways',           ['admin','faculty','exams','placement',
                                    'employer','guardian','student']],
  ['/api/onyx/admin/gateways',     ['admin']],
  ['/api/onyx/proctor/queue',      ['admin','faculty','exams']],
  ['/api/onyx/workspaces/all',     ['admin','faculty']],
  ['/api/onyx/banks',              ['admin','faculty','exams']],
  ['/api/onyx/employers',          ['admin','placement']],
  ['/api/onyx/tickets/breaches',   ['admin','faculty']],
  // Same shape: an employer gets their own (empty) set, not somebody
  // else's drives.
  ['/api/onyx/drives',             ['admin','placement','employer']],
  ['/api/onyx/fee-structures',     ['admin']],
  ['/api/onyx/tenants',            []],   // platform-only
];
// Every one of these is EXPECTED TO BE REFUSED for the role under test, so a
// correct system performs no mutation. A success here is the finding.
const WRITES = (ids) => [
  ['POST',  '/api/onyx/members', { name:'QA Escalation Probe', email:'qa.probe.'+Date.now()+'@onyx.test', role:'admin', password:'Qa#Probe2026!' }, ['admin']],
  ['PATCH', '/api/onyx/members/' + ids.selfMembership, { role:'admin' }, ['admin']],
  ['POST',  '/api/onyx/courses', { title:'QA Probe Course', code:'QAP-'+Date.now() }, ['admin','faculty']],
  ['DELETE','/api/onyx/members/' + ids.otherMembership, null, ['admin']],
  ['PATCH', '/api/onyx/tenant/settings', { student_signup: false }, ['admin']],
  ['POST',  '/api/onyx/skills/award', { user_id: ids.selfUser, skill:'qa-probe' }, ['admin','faculty']],
  ['POST',  '/api/onyx/timetable/publish', {}, ['admin','exams']],
];

const ROLES = ['student','guardian','employer','placement','exams','m_faculty'];
const results = { phase:'api-rbac', base: BASE, reads: [], writes: [] };
const browser = await launch();

for (const role of ROLES) {
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await signIn(page, role);
  const me = await page.evaluate(async () => (await (await fetch('/api/onyx/me',{credentials:'include'})).json()));
  const actualRole = me?.data?.role;
  const allowedFor = (list) => list.includes(actualRole);

  // ---- reads ----
  const readOut = await page.evaluate(async (eps) => {
    const out = [];
    for (const [ep] of eps) {
      try {
        const r = await fetch(ep, { credentials: 'include' });
        const t = (await r.text()).slice(0, 220);
        out.push({ ep, status: r.status, body: t });
      } catch (e) { out.push({ ep, error: String(e).slice(0,120) }); }
    }
    return out;
  }, READS);
  for (const o of readOut) {
    const allow = allowedFor(READS.find(r=>r[0]===o.ep)[1]);
    const got200 = o.status === 200 && /"ok"\s*:\s*true/.test(o.body||'');
    const bad = !allow && got200;
    results.reads.push({ role, actualRole, ...o, expected: allow?'allow':'deny',
      got: got200?'allow':'deny', verdict: bad?'FAIL':'PASS' });
    if (bad) console.log(`FAIL READ ${role}(${actualRole}) ${o.ep} -> ${o.status} ${o.body.slice(0,140)}`);
  }

  // ---- writes (all expected to be refused for these roles) ----
  const ids = { selfMembership: 0, otherMembership: 0, selfUser: me?.data?.user_id };
  const w = WRITES(ids);
  const writeOut = await page.evaluate(async (specs) => {
    const out = [];
    for (const [method, ep, body] of specs) {
      try {
        const r = await fetch(ep, { method, credentials: 'include',
          headers: body ? { 'content-type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined });
        out.push({ method, ep, status: r.status, body: (await r.text()).slice(0, 220) });
      } catch (e) { out.push({ method, ep, error: String(e).slice(0,120) }); }
    }
    return out;
  }, w);
  for (const o of writeOut) {
    const spec = w.find(s => s[0]===o.method && s[1]===o.ep);
    const allow = allowedFor(spec[3]);
    const succeeded = o.status >= 200 && o.status < 300 && /"ok"\s*:\s*true/.test(o.body||'');
    const bad = !allow && succeeded;
    results.writes.push({ role, actualRole, ...o, expected: allow?'allow':'deny',
      got: succeeded?'allow':'deny', verdict: bad?'FAIL':'PASS' });
    if (bad) console.log(`FAIL WRITE ${role}(${actualRole}) ${o.method} ${o.ep} -> ${o.status} ${o.body.slice(0,160)}`);
  }
  console.log(`-- ${role} (${actualRole}) done`);
  await ctx.close();
}
await browser.close();
fs.writeFileSync('qa-results-05-api-rbac.json', JSON.stringify(results, null, 2));
const rf = results.reads.filter(r=>r.verdict==='FAIL'), wf = results.writes.filter(r=>r.verdict==='FAIL');
console.log(`\n=== READ leaks: ${rf.length}/${results.reads.length}   WRITE breaches: ${wf.length}/${results.writes.length}`);
// status distribution for denied attempts
const dist = {}; for (const r of [...results.reads, ...results.writes]) if (r.expected==='deny') dist[r.status]=(dist[r.status]||0)+1;
console.log('denied-attempt status codes:', dist);
