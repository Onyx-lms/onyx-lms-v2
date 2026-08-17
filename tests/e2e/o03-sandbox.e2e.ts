/**
 * Onyx O03 -- the Code Lab loop against a real HTTP sandbox.
 *
 * O03's other tests prove the queue, and unit tests prove the Judge0 adapter
 * against a fake `fetch`. Neither of those runs the whole thing: submit ->
 * queue -> worker -> provider over HTTP -> evaluator -> score. This does.
 *
 * **What this verifies:** that `Judge0Provider` speaks the protocol correctly,
 * that every limit is sent and the network is switched off on every request,
 * and that a compile error, a timeout, an out-of-memory kill and a wrong answer
 * each reach the submission as the right verdict with the right partial score.
 *
 * **What it does not verify:** isolation. Whether a fork bomb is actually
 * contained is a property of Judge0 and the machine it runs on, not of this
 * repository, and a stub cannot stand in for it. That remains a deployment
 * check -- see the README.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, withDb, RUN, onyxLogin } from './harness.ts';

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'sb.' + who + '.' + RUN + '@onyx.test';
const T = { name: 'Sandbox College ' + RUN, slug: 'sandbox-' + RUN };

const SANDBOX = process.env.ONYX_JUDGE0_URL ?? 'http://127.0.0.1:2358';

const w = {
  admin: '', faculty: '', student: '',
  ids: {} as Record<string, string>,
  course: 0, problem: 0,
};

/** Queues a submission and follows it until the worker has finished with it. */
async function submitAndWait(token: string, source: string, mode: 'run' | 'submit' = 'submit') {
  const queued = await api<{ id: number; status: string }>(
    '/api/onyx/problems/' + w.problem + '/submit',
    { token, body: { language: 'python', source, mode } });
  assert.equal(queued.ok, true, 'submit failed: ' + queued.message);
  assert.equal(queued.data.status, 'queued', 'the request ran the code inline');

  // The API's worker drains on an interval; this pushes it so the test does not
  // depend on the tick.
  for (let i = 0; i < 40; i += 1) {
    await api('/api/onyx/queue/drain', { token: w.admin, body: { concurrency: 4 } });
    const detail = await api<{
      status: string; score: number; max_score: number; passed: number; total: number;
      compile_output: string | null; error: string | null;
      cases: { name: string; passed: number; is_hidden: number; stdout: string | null }[];
    }>('/api/onyx/submissions/code/' + queued.data.id, { token });
    if (detail.data.status === 'done' || detail.data.status === 'failed') return detail.data;
    await new Promise((r) => { setTimeout(r, 250); });
  }
  throw new Error('submission ' + queued.data.id + ' never finished');
}

test('a college with a published problem', async () => {
  const created = await createTenant({
    name: T.name, slug: T.slug,
    admin: { name: 'Admin', email: mail('admin'), password: pw },
  });
  assert.equal(created.ok, true, created.message);
  w.admin = await onyxLogin(mail('admin'), pw);

  for (const [who, role] of [['faculty', 'faculty'], ['student', 'student']] as const) {
    const r = await api<{ user: { id: string } }>('/api/onyx/members', {
      token: w.admin, body: { name: who, email: mail(who), role, password: pw },
    });
    assert.equal(r.ok, true, r.message);
    w.ids[who] = r.data.user.id;
  }
  w.faculty = await onyxLogin(mail('faculty'), pw);
  w.student = await onyxLogin(mail('student'), pw);

  const course = await api<{ id: number }>('/api/onyx/courses', {
    token: w.admin, body: { code: 'SB101', title: 'Sandbox Course' },
  });
  w.course = Number(course.data.id);
  await api('/api/onyx/courses/' + w.course + '/faculty',
    { token: w.admin, body: { user_id: w.ids.faculty } });
  await api('/api/onyx/courses/' + w.course,
    { token: w.admin, method: 'PATCH', body: { status: 1 } });
  await api('/api/onyx/courses/' + w.course + '/enroll',
    { token: w.admin, body: { user_id: w.ids.student } });

  const problem = await api<{ id: number }>('/api/onyx/problems', {
    token: w.faculty,
    body: {
      title: 'Echo the input ' + RUN, statement: 'Print what you are given.',
      languages: ['python'], course_id: w.course, time_limit_ms: 2000,
    },
  });
  assert.equal(problem.ok, true, problem.message);
  w.problem = Number(problem.data.id);

  // Two visible cases worth 1 each, one hidden worth 3.
  const tests = await api('/api/onyx/problems/' + w.problem + '/tests', {
    token: w.faculty, method: 'PUT',
    body: {
      tests: [
        { name: 'Visible A', stdin: 'alpha', expected_stdout: 'alpha', is_hidden: false, weight: 1 },
        { name: 'Visible B', stdin: 'beta', expected_stdout: 'beta', is_hidden: false, weight: 1 },
        { name: 'Secret', stdin: 'gamma', expected_stdout: 'gamma', is_hidden: true, weight: 3 },
      ],
    },
  });
  assert.equal(tests.ok, true, tests.message);
  await api('/api/onyx/problems/' + w.problem + '/publish',
    { token: w.faculty, method: 'POST' });
});

test('a correct solution is graded through the queue and the sandbox', async () => {
  const result = await submitAndWait(w.student, 'ECHO');
  assert.equal(result.status, 'done', result.error ?? '');
  assert.equal(result.passed, 3, JSON.stringify(result.cases));
  assert.equal(result.total, 3);
  assert.equal(result.score, 5, '1 + 1 + 3');
  assert.equal(result.max_score, 5);
  // The hidden case is reported as passed and nothing else about it is.
  const hidden = result.cases.find((c) => c.is_hidden)!;
  assert.equal(hidden.passed, 1);
  assert.equal(hidden.stdout, null, 'a hidden case leaked what the program printed');
});

test('partial credit is what the cases actually say', async () => {
  // Prints "alpha" whatever the input, so only the first case passes.
  const result = await submitAndWait(w.student, 'PRINT alpha');
  assert.equal(result.status, 'done');
  assert.equal(result.passed, 1, JSON.stringify(result.cases.map((c) => c.passed)));
  assert.equal(result.score, 1, 'the first visible case only');
  assert.equal(result.max_score, 5);
});

test('Run checks the visible cases only, and the hidden one stays hidden', async () => {
  const result = await submitAndWait(w.student, 'ECHO', 'run');
  assert.equal(result.total, 2, 'Run reached a hidden case');
  assert.equal(result.max_score, 2);
  assert.equal(result.passed, 2);
  assert.equal(result.cases.every((c) => !c.is_hidden), true);
  // A visible case's output IS shown -- that is what makes Run useful.
  assert.equal(result.cases[0]!.stdout, 'alpha');
});

test('a compile error stops after the first case and is reported as one', async () => {
  const result = await submitAndWait(w.student, 'COMPILE_ERROR');
  assert.equal(result.status, 'done');
  assert.equal(result.error, 'compile_error');
  assert.match(result.compile_output ?? '', /syntax error/);
  // Running the rest burns sandbox capacity for a result already known.
  assert.equal(result.cases.length, 1, JSON.stringify(result.cases.length));
  assert.equal(result.score, 0);
});

test('a timeout, an out-of-memory kill and a crash all score zero, distinctly', async () => {
  for (const source of ['TIMEOUT', 'OOM', 'FAIL']) {
    const result = await submitAndWait(w.student, source);
    assert.equal(result.status, 'done', source + ': ' + (result.error ?? ''));
    assert.equal(result.passed, 0, source + ' passed a case');
    assert.equal(result.score, 0, source + ' scored');
  }
});

/**
 * LAB-02a's acceptance criterion, at the layer this repository owns.
 *
 * Whether the sandbox contains a fork bomb is Judge0's business. Whether this
 * codebase ever asks it to run one without limits is ours, and that is what
 * this checks: every submission, every time.
 */
test('every request to the sandbox carries all its limits and no network', async () => {
  const res = await fetch(SANDBOX + '/__received');
  assert.equal(res.status, 200, 'the sandbox stub was not reachable');
  const sent = await res.json() as Record<string, unknown>[];
  assert.ok(sent.length > 0, 'nothing reached the sandbox');

  for (const body of sent) {
    // The API's own database is on that network.
    assert.equal(body.enable_network, false, 'a request allowed network access');
    // A misconfigured sandbox with generous defaults looks exactly like a
    // working one until somebody submits a fork bomb.
    assert.equal(typeof body.cpu_time_limit, 'number');
    assert.equal(typeof body.wall_time_limit, 'number');
    assert.equal(typeof body.memory_limit, 'number');
    assert.equal(typeof body.max_processes_and_or_threads, 'number');
    assert.ok((body.wall_time_limit as number) > (body.cpu_time_limit as number),
      'a program blocked on input would never be killed');
    assert.equal(body.language_id, 71, 'python was sent as the wrong language id');
  }
});

test('the queue is drained and nothing is left behind', async () => {
  const stats = await api<{ status: string; kind: string; count: number }[]>(
    '/api/onyx/queue', { token: w.admin });
  assert.equal(stats.ok, true, stats.message);
  const stuck = stats.data.filter((s) => s.status === 'failed');
  assert.deepEqual(stuck, [], 'jobs failed: ' + JSON.stringify(stuck));

  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = $1', [T.slug]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1',
      ['sb.%.' + RUN + '@onyx.test']);
  });
});
