/**
 * LAB-02a -- proves a deployed sandbox actually isolates.
 *
 *   ONYX_JUDGE0_URL=http://127.0.0.1:2358 node tools/onyx/verify-sandbox.mjs
 *
 * The acceptance criterion is "a fork bomb, an infinite loop and a network call
 * all fail safely inside limits", and until now nothing checked it. The unit
 * suite asserts the flags Onyx *sends* against a protocol stub; whether those
 * flags are *enforced* is a property of the container you deployed, and no test
 * that talks to a stub can tell you about it. This talks to the real endpoint
 * and submits the three programs.
 *
 * It is deliberately adversarial. Every case here is written to succeed at
 * escaping if the sandbox lets it, so a pass means the sandbox stopped
 * something rather than that nothing was tried. A run that reports OK on a
 * misconfigured host would be worse than no script at all, which is why the
 * network case checks that the fetch *failed* rather than that the program
 * merely exited.
 *
 * Exit code is 0 only if every case is contained.
 */
import { Judge0Provider } from '../../packages/core/src/onyx/execution.provider.ts';

const BASE = process.env.ONYX_JUDGE0_URL;
if (!BASE) {
  console.error('ONYX_JUDGE0_URL is not set. Start a sandbox first:');
  console.error('  docker compose -f deploy/judge0/docker-compose.yml up -d');
  process.exitCode = 2;
  process.exit();
}

const provider = new Judge0Provider({
  baseUrl: BASE,
  authToken: process.env.ONYX_JUDGE0_TOKEN ?? null,
  requestTimeoutMs: 60_000,
});

/**
 * Each case says what it tries to do and what containment looks like.
 *
 * `contained` gets the full result, not just the verdict, because some of these
 * are only safe for a reason the verdict does not carry -- a network call that
 * "succeeded" in 4ms did not reach the internet, and a fork bomb that exits 0
 * has told you nothing.
 */
const CASES = [
  {
    name: 'an infinite loop is stopped by the CPU limit',
    language: 'python',
    source: 'while True:\n    pass\n',
    contained: (r) => ['timeout', 'runtime_error'].includes(r.verdict),
    expected: 'timeout',
  },
  {
    name: 'a fork bomb cannot exhaust the host',
    language: 'python',
    source: [
      'import os',
      'while True:',
      '    try:',
      '        os.fork()',
      '    except Exception:',
      '        pass',
    ].join('\n') + '\n',
    // Any of these is containment: refused the fork, killed on processes, or
    // stopped by the clock. What must NOT happen is a clean exit having forked
    // freely, or the request never coming back at all.
    contained: (r) => ['timeout', 'runtime_error', 'memory_exceeded'].includes(r.verdict),
    expected: 'timeout or runtime_error',
  },
  {
    name: 'an allocation bomb is stopped by the memory limit',
    language: 'python',
    source: "x = []\nwhile True:\n    x.append(' ' * 10_000_000)\n",
    contained: (r) => ['memory_exceeded', 'runtime_error', 'timeout'].includes(r.verdict),
    expected: 'memory_exceeded',
  },
  {
    name: 'a network call cannot leave the sandbox',
    language: 'python',
    source: [
      'import socket',
      'socket.setdefaulttimeout(3)',
      'try:',
      "    s = socket.create_connection(('1.1.1.1', 53), 3)",
      '    s.close()',
      "    print('REACHED_NETWORK')",
      'except Exception as e:',
      "    print('BLOCKED')",
    ].join('\n') + '\n',
    // The verdict is not the assertion here. A program that catches its own
    // failure exits cleanly, and a sandbox with network would also exit
    // cleanly -- the difference is entirely in what it printed.
    contained: (r) => !r.stdout.includes('REACHED_NETWORK'),
    expected: 'the connection refused, not merely a clean exit',
  },
  {
    name: 'the filesystem outside the box is not readable',
    language: 'python',
    source: [
      'try:',
      "    print(open('/etc/shadow').read()[:20])",
      'except Exception:',
      "    print('BLOCKED')",
    ].join('\n') + '\n',
    contained: (r) => r.stdout.includes('BLOCKED') || r.verdict !== 'ok',
    expected: 'no read',
  },
  {
    name: 'an ordinary program still runs',
    language: 'python',
    // The control. Without it, a sandbox that refuses everything -- including
    // a broken one that is simply down -- would pass every case above.
    source: "print(6 * 7)\n",
    contained: (r) => r.verdict === 'ok' && r.stdout.trim() === '42',
    expected: 'ok, printing 42',
  },
];

console.log('Sandbox: ' + BASE);
console.log('');

let failed = 0;
for (const testCase of CASES) {
  const started = Date.now();
  let result;
  try {
    result = await provider.run({ language: testCase.language, source: testCase.source });
  } catch (error) {
    result = { verdict: 'internal_error', stdout: '', stderr: String(error), runtimeMs: 0, memoryKb: 0 };
  }
  const elapsed = Date.now() - started;
  const ok = testCase.contained(result);
  if (!ok) failed += 1;

  console.log((ok ? '  PASS  ' : '  FAIL  ') + testCase.name);
  console.log('        verdict=' + result.verdict
    + ' time=' + result.runtimeMs + 'ms'
    + ' memory=' + result.memoryKb + 'kB'
    + ' wall=' + elapsed + 'ms');
  if (!ok) {
    console.log('        expected: ' + testCase.expected);
    if (result.stdout) console.log('        stdout: ' + result.stdout.slice(0, 200).trim());
    if (result.stderr) console.log('        stderr: ' + result.stderr.slice(0, 200).trim());
  }
}

console.log('');
if (failed) {
  console.log(failed + ' of ' + CASES.length + ' cases were NOT contained.');
  console.log('Do not put learner code on this host. Check cgroup v1 accounting and');
  console.log('ALLOW_ENABLE_NETWORK in deploy/judge0/judge0.conf.');
  process.exitCode = 1;
} else {
  console.log('SANDBOX CONTAINED -- all ' + CASES.length + ' cases.');
  process.exitCode = 0;
}
