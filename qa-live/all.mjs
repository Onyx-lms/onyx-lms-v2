/**
 * Everything, as all four people who use it.
 *
 * Runs every read-only or self-restoring live suite against the deployed
 * product in one go and prints one table. Suites that SEED or MUTATE the demo
 * on purpose are excluded by name below -- they are tools, not checks, and
 * running them here would change the figures the checks assert.
 *
 *   node --env-file=.env qa-live/all.mjs
 */
import { spawn } from 'node:child_process';

const BASE_URL = process.env.QA_BASE ?? 'https://onyx-lms-v2.vercel.app';

const SUITES = [
  // --- the whole institution, all roles ---------------------------------
  ['every role, end to end', 'e2e-malla-reddy-demo.mjs'],
  // --- student ----------------------------------------------------------
  ['a learner’s own screens', 'learner-surfaces.mjs'],
  ['signing up with any mailbox', 'gmail-signup.mjs'],
  ['sitting a web-development paper', 'web-demo-mallareddy.mjs'],
  // --- faculty ----------------------------------------------------------
  ['a lecturer sets papers', 'faculty-authoring.mjs'],
  ['a lecturer builds a course', 'faculty-authoring-parity.mjs'],
  // --- admin ------------------------------------------------------------
  ['permissions actually bite', 'permissions-bite.mjs'],
  ['the support desk is administration’s', 'support-scope.mjs'],
  // --- superadmin -------------------------------------------------------
  ['the operator’s reach over admins', 'superadmin-reach.mjs'],
  // --- everyone ---------------------------------------------------------
  ['submissions reach every marker', 'submissions-visible.mjs'],
  ['every screen works on a phone', 'responsive-live.mjs'],
];

const run = (file) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['--env-file=.env', 'qa-live/' + file],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ code, out }));
});

/*
 * Are the demo's examinations open?
 *
 * A sitting is pinned to its slot, which is right for a real examination and
 * means the demo goes stale by the clock: the windows seeded on Monday have
 * passed by Wednesday, and every suite that sits a paper then fails with "This
 * assessment has closed". That is seventeen red lines whose cause is one line,
 * and reading it out of them takes a while -- so it is checked first and said
 * plainly.
 */
const openExams = await (async () => {
  const login = await (await fetch(BASE_URL + '/api/onyx/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@mrdemo.test', password: 'MrDemo#2026!' }),
  })).json().catch(() => null);
  const token = login?.data?.token;
  if (!token) return null;
  const papers = (await (await fetch(BASE_URL + '/api/onyx/assessments', {
    headers: { Authorization: 'Bearer ' + token },
  })).json().catch(() => null))?.data ?? [];
  const now = Date.now();
  const exam = papers.filter((a) => /examination|Mid-term|Coding/i.test(String(a.title)));
  return exam.filter((a) => !a.closes_at || Date.parse(a.closes_at) > now).length;
})();

if (openExams === 0) {
  console.log('' + '!'.repeat(78));
  console.log("The demo's examinations have all closed, so every suite that sits a");
  console.log('paper is about to fail with "This assessment has closed". That is stale');
  console.log('fixture data rather than a defect -- a sitting is pinned to its slot.');
  console.log('');
  console.log('    node --env-file=.env qa-live/reopen-demo-exams.mjs');
  console.log('');
  console.log('!'.repeat(78));
}

const rows = [];
for (const [label, file] of SUITES) {
  process.stdout.write('running ' + file.padEnd(34));
  const started = Date.now();
  const { code, out } = await run(file);
  const tally = out.match(/(\d+) pass, (\d+) fail/);
  const pass = tally ? Number(tally[1]) : 0;
  const fail = tally ? Number(tally[2]) : (code === 0 ? 0 : -1);
  const detail = out.split('\n').filter((l) => l.startsWith('  FAIL')).slice(0, 3);
  rows.push({ label, file, pass, fail, code, detail, ms: Date.now() - started });
  console.log((fail === 0 && code === 0 ? 'ok  ' : 'FAIL') + '  '
    + pass + ' pass, ' + Math.max(0, fail) + ' fail   '
    + ((Date.now() - started) / 1000).toFixed(0) + 's');
}

console.log('\n' + '='.repeat(78));
console.log('WHAT WAS CHECKED');
console.log('='.repeat(78));
let pass = 0, fail = 0;
for (const r of rows) {
  pass += r.pass; fail += Math.max(0, r.fail);
  console.log((r.fail === 0 && r.code === 0 ? '  ok    ' : '  FAIL  ')
    + r.label.padEnd(38) + String(r.pass).padStart(3) + ' checks');
  for (const d of r.detail) console.log('          ' + d.trim());
}
console.log('='.repeat(78));
console.log(pass + ' checks passed, ' + fail + ' failed, across ' + rows.length + ' suites');
process.exit(fail ? 1 : 0);
