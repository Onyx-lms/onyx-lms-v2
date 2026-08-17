/**
 * Boots the API and web app locally, waits for both, runs the end-to-end suite,
 * then shuts them down. Exit code is the suite's.
 */
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// One origin, because there is one server. The API used to run separately on
// :4000; it is now served by the Next app itself (docs/ADR-012), so E2E_API and
// E2E_WEB point at the same place and the suites did not have to change -- they
// already read both from the environment.
//
// 5173 rather than the 5175 the dev server uses, deliberately: `next start` here
// serves a production build, and keeping it off the dev port means the suite can
// run while a dev server is up.
const ORIGIN = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:5173';
const API = process.env.E2E_API ?? ORIGIN;
const WEB = process.env.E2E_WEB ?? ORIGIN;

const children = [];
function start(name, cmd, args, cwd) {
  const child = spawn(cmd, args, {
    cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
  });
  child.stdout.on('data', (d) => {
    if (process.env.E2E_VERBOSE) process.stdout.write('[' + name + '] ' + d);
  });
  child.stderr.on('data', (d) => process.stderr.write('[' + name + '] ' + d));
  children.push(child);
}

async function waitFor(url, label, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(label + ' did not come up at ' + url);
}

/**
 * Kill the whole tree, not just the shell.
 *
 * spawn(..., { shell: true }) starts cmd.exe, which starts node. Killing the
 * shell leaves node running and holding the port -- the next run then talks to
 * a stale server with stale in-memory state (rate-limit counters, old code).
 */
function stopAll() {
  for (const c of children) {
    try {
      if (process.platform === 'win32' && c.pid) {
        spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        c.kill('SIGKILL');
      }
    } catch { /* already gone */ }
  }
}
process.on('exit', stopAll);
process.on('SIGINT', () => { stopAll(); process.exit(130); });

// Anything left over from a previous run holds the port and its state.
if (process.platform === 'win32') {
  for (const port of [5173, Number(process.env.JUDGE0_STUB_PORT ?? 2358)]) {
    try {
      const out = execSync('netstat -ano | findstr :' + port, { encoding: 'utf8' });
      const pids = new Set(
        out.split(String.fromCharCode(10))
          .filter((l) => l.includes('LISTENING'))
          .map((l) => l.trim().split(/\s+/).pop()));
      for (const pid of pids) {
        if (pid && /^[0-9]+$/.test(pid)) {
          execSync('taskkill /pid ' + pid + ' /T /F', { stdio: 'ignore' });
          console.log('killed stale listener on :' + port + ' (pid ' + pid + ')');
        }
      }
    } catch { /* nothing listening */ }
  }
}
// `next start` serves whatever is in .next. Without this build a page added
// since the last build 404s, and the suite reports a frontend bug that is
// really a stale artefact. Skip it with E2E_SKIP_BUILD=1 when iterating on the
// API alone.
if (!process.env.E2E_SKIP_BUILD) {
  console.log('building web...');
  execSync('npm run build --workspace @onyx/web', { cwd: ROOT, stdio: 'inherit' });
}

/**
 * A stand-in for the Code Lab sandbox.
 *
 * Without it the whole submit -> queue -> evaluate -> score path is unreachable
 * in the suite, because the API refuses to queue work with no sandbox
 * configured. It speaks Judge0's protocol and nothing more: it verifies the
 * adapter and everything downstream of it, and verifies nothing about
 * isolation, which needs a real Judge0.
 */
const SANDBOX_PORT = Number(process.env.JUDGE0_STUB_PORT ?? 2358);
const SANDBOX_URL = 'http://127.0.0.1:' + SANDBOX_PORT;
process.env.ONYX_JUDGE0_URL = process.env.ONYX_JUDGE0_URL ?? SANDBOX_URL;

// The token cache exists to stay under the login rate limit within a run, not
// between them. A token left by an earlier run can be alive enough to be reused
// in the first file and expired by the last.
const { clearTokenCache } = await import('../tests/e2e/harness.ts');
clearTokenCache();

console.log('starting the sandbox stub and the app...');
start('sandbox', 'node', ['tools/judge0-stub.mjs'], ROOT);
await waitFor(SANDBOX_URL + '/__received', 'sandbox stub');

// One process. It serves the pages and the API, so /health and /login are the
// same server answering -- both are still waited on, because they exercise
// different halves of it: the route table, and the page router.
start('app', 'npx', ['next', 'start', '-p', '5173'], path.join(ROOT, 'apps/web'));

await waitFor(API + '/health', 'the API');
await waitFor(WEB + '/login', 'the pages');
console.log('the app is up\n');

// One file at a time: they share a database and a test student, so parallel
// runs interfere with each other's cart and enrolment state.
const suite = spawn('node', ['--test', '--test-concurrency=1', 'tests/e2e/*.e2e.ts'], {
  cwd: ROOT, shell: true, stdio: 'inherit', env: { ...process.env },
});
const code = await new Promise((resolve) => suite.on('close', resolve));
stopAll();
process.exit(code ?? 1);
