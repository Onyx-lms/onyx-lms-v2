/**
 * Onyx O03 unit tests -- Code Lab.
 *
 * The claims worth checking here are the ones a passing screenshot would not
 * reveal: that a hidden case never leaves the service, that the sandbox
 * contract is honoured, that the release rules mean what they say, and that a
 * snapshot restores exactly.
 *
 * The queue's concurrency guarantee needs a real Postgres and is proven end to
 * end (o03-codelab.e2e.ts); what is testable without one is tested here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import { CodeLabService, outputMatches } from '../src/onyx/codelab.service.ts';
import { WorkspaceService, normalisePath } from '../src/onyx/workspace.service.ts';
import { QueueService, backoffSeconds, drain, type Job } from '../src/onyx/queue.service.ts';
import { codeLabHandlers } from '../src/onyx/codelab.worker.ts';
import {
  DEFAULT_LIMITS, Judge0Provider, NoSandboxError, UnconfiguredProvider,
  executionProviderFromEnv, type ExecutionProvider, type RunRequest, type RunResult,
} from '../src/onyx/execution.provider.ts';
import { poolCandidates } from '../src/onyx/pool.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const OTHER = 2;

/** A sandbox stand-in: echoes whatever the "program" is told to echo. */
function fakeProvider(behaviour: (req: RunRequest) => Partial<RunResult> = () => ({})): ExecutionProvider {
  return {
    name: 'fake',
    supports: () => true,
    async run(req) {
      return {
        verdict: 'ok',
        // The convention the tests use: the source IS the output, unless the
        // behaviour override says otherwise.
        stdout: req.source,
        stderr: '', compileOutput: '', runtimeMs: 5, memoryKb: 1024,
        ...behaviour(req),
      };
    },
  };
}

function world(provider: ExecutionProvider = fakeProvider(), now = () => 1_800_000_000_000) {
  const db = new FakeDb({
    onyx_courses: [
      { id: 1, tenant_id: T, code: 'CS101', title: 'Programming', slug: 'p', status: 1, self_enroll: 0 },
    ],
    onyx_course_faculty: [{ id: 1, tenant_id: T, course_id: 1, user_id: 'user-20' }],
    onyx_enrollments: [{ id: 1, tenant_id: T, course_id: 1, user_id: 'user-10', status: 1 }],
    onyx_problems: [],
    onyx_problem_tests: [],
    onyx_hints: [],
    onyx_hint_reveals: [],
    onyx_code_submissions: [],
    onyx_submission_cases: [],
    onyx_workspaces: [],
    onyx_workspace_files: [],
    onyx_workspace_snapshots: [],
    onyx_workspace_comments: [],
    onyx_users: [],
    // peopleFor() reads roll numbers off the membership, so the monitoring
    // feeds need the table to exist even when nobody is in it.
    onyx_memberships: [],
  }, {
    /*
     * The constraint the address rule exists for. Without it declared, the
     * fake let two problems share a slug and the tests below proved nothing --
     * a de-duplicator has to be checked against something that actually
     * refuses duplicates, or it is checked against its own opinion.
     */
    onyx_problems: [['tenant_id', 'slug']],
  });
  const academics = new AcademicsService(db as never);
  const enqueued: { kind: string; payload: Record<string, unknown> }[] = [];
  const queue = {
    enqueue: async (input: { kind: string; payload: Record<string, unknown> }) => {
      enqueued.push(input);
      return enqueued.length;
    },
  } as unknown as QueueService;

  return {
    db, academics, enqueued,
    codelab: new CodeLabService(db as never, academics, queue, provider, now),
    workspaces: new WorkspaceService(db as never, academics, provider, now),
  };
}

/** A published problem with two visible cases and one hidden one. */
async function withProblem(w: ReturnType<typeof world>, over: Record<string, unknown> = {}) {
  const problem = await w.codelab.createProblem(T, 'user-20', {
    title: 'Echo', statement: 'Print what you are given.',
    languages: ['python'], ...over,
  });
  await w.codelab.setTests(T, Number(problem.id), [
    { name: 'Visible A', stdin: '1', expected_stdout: 'hello', is_hidden: false, weight: 1 },
    { name: 'Visible B', stdin: '2', expected_stdout: 'hello', is_hidden: false, weight: 1 },
    { name: 'Secret', stdin: 'SECRET-INPUT', expected_stdout: 'SECRET-ANSWER', is_hidden: true, weight: 2 },
  ]);
  await w.codelab.publishProblem(T, Number(problem.id));
  return Number(problem.id);
}

// ---------------------------------------------------------------------------
// LAB-02a -- the sandbox contract
// ---------------------------------------------------------------------------

test('with no sandbox configured, running code refuses rather than falling back', async () => {
  const provider = new UnconfiguredProvider();
  assert.equal(provider.supports(), false);
  // The alternative -- quietly running learner code on the API host "just in
  // development" -- is how an unsandboxed executor reaches production.
  await assert.rejects(provider.run(), (e: Error) => e instanceof NoSandboxError);
  assert.equal(executionProviderFromEnv({}).name, 'unconfigured');
  assert.equal(executionProviderFromEnv({ ONYX_JUDGE0_URL: '  ' }).name, 'unconfigured');
  assert.equal(executionProviderFromEnv({ ONYX_JUDGE0_URL: 'http://sandbox:2358' }).name, 'judge0');
});

test('every run is sent with explicit limits and the network switched off', async () => {
  let sent: Record<string, unknown> = {};
  const provider = new Judge0Provider({
    baseUrl: 'http://sandbox:2358/',
    authToken: 'secret-token',
    fetch: async (url, init) => {
      sent = { url, headers: init?.headers, body: JSON.parse(init!.body!) };
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          status: { id: 3 }, stdout: 'hi', stderr: '', time: '0.02', memory: 2048,
        }),
      };
    },
  });

  const result = await provider.run({ language: 'python', source: 'print(1)', stdin: 'x' });
  assert.equal(result.verdict, 'ok');
  assert.equal(result.runtimeMs, 20);

  const body = sent.body as Record<string, unknown>;
  // A misconfigured sandbox with generous defaults looks exactly like a working
  // one until somebody submits a fork bomb, so nothing is left to its defaults.
  assert.equal(body.cpu_time_limit, DEFAULT_LIMITS.cpuSeconds);
  assert.equal(body.wall_time_limit, DEFAULT_LIMITS.wallSeconds);
  assert.equal(body.memory_limit, DEFAULT_LIMITS.memoryKb);
  assert.equal(body.max_processes_and_or_threads, DEFAULT_LIMITS.maxProcesses);
  // The API's own database is on that network.
  assert.equal(body.enable_network, false);
  assert.equal((sent.headers as Record<string, string>)['X-Auth-Token'], 'secret-token');
  assert.match(String(sent.url), /^http:\/\/sandbox:2358\/submissions\?/);
});

test('the sandbox verdicts a learner needs to tell apart are distinct', async () => {
  const reply = (payload: Record<string, unknown>) => new Judge0Provider({
    baseUrl: 'http://sandbox',
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) }),
  });

  // An infinite loop.
  assert.equal((await reply({ status: { id: 5 } })
    .run({ language: 'python', source: 'while 1: pass' })).verdict, 'timeout');
  // Something that does not compile.
  assert.equal((await reply({ status: { id: 6 }, compile_output: 'oops' })
    .run({ language: 'c', source: 'int main(' })).verdict, 'compile_error');
  // An allocation bomb, which Judge0 reports as a plain runtime error --
  // telling a learner "runtime error" when they allocated a terabyte is not
  // useful.
  assert.equal((await reply({ status: { id: 11 }, stderr: 'MemoryError' })
    .run({ language: 'python', source: 'x = [0]*10**12' })).verdict, 'memory_exceeded');
  // A fork bomb hits the process limit and dies as a runtime error.
  assert.equal((await reply({ status: { id: 11 }, stderr: 'fork failed' })
    .run({ language: 'python', source: 'import os\nwhile 1: os.fork()' })).verdict, 'runtime_error');
});

test('a sandbox that is down is an internal error, never a wrong answer', async () => {
  const down = new Judge0Provider({
    baseUrl: 'http://sandbox',
    fetch: async () => { throw new Error('ECONNREFUSED'); },
  });
  const result = await down.run({ language: 'python', source: 'print(1)' });
  assert.equal(result.verdict, 'internal_error');
  assert.match(result.stderr, /unreachable/);

  const rubbish = new Judge0Provider({
    baseUrl: 'http://sandbox',
    fetch: async () => ({ ok: true, status: 200, text: async () => '<html>gateway</html>' }),
  });
  assert.equal((await rubbish.run({ language: 'python', source: 'x' })).verdict, 'internal_error');

  const refused = new Judge0Provider({
    baseUrl: 'http://sandbox',
    fetch: async () => ({ ok: false, status: 502, text: async () => '' }),
  });
  assert.equal((await refused.run({ language: 'python', source: 'x' })).verdict, 'internal_error');
});

test('runaway output is truncated rather than returned whole', async () => {
  const huge = 'x'.repeat(2 * 1024 * 1024);
  const provider = new Judge0Provider({
    baseUrl: 'http://sandbox',
    fetch: async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ status: { id: 3 }, stdout: huge }),
    }),
  });
  const result = await provider.run({ language: 'python', source: 'print("x"*10**9)' });
  assert.equal(result.verdict, 'output_exceeded');
  assert.equal(result.stdout.length, DEFAULT_LIMITS.stdoutKb * 1024);
});

// ---------------------------------------------------------------------------
// LAB-02b -- the queue
// ---------------------------------------------------------------------------

test('retries back off and then stop', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(backoffSeconds), [10, 20, 40, 80, 160]);
  // Capped, so a permanently broken job does not schedule itself into next week.
  assert.equal(backoffSeconds(20), 300);
});

test('the claim goes through the function that holds the SKIP LOCKED guarantee', async () => {
  // This used to assert on SQL text, because QueueService built the statement
  // itself. It no longer does: the statement moved into Postgres (migration 0019)
  // so that no request path has to open a `pg` connection -- every warm serverless
  // instance would otherwise hold its own pool and exhaust Supabase's pooler.
  //
  // So the assertion splits in two. Here: that the service calls the right
  // function with the right arguments. Below: that the function still contains
  // SKIP LOCKED, read from the migration itself -- because losing that would not
  // fail anything, it would double-grade under load, occasionally.
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const queue = new QueueService({
    from: (() => { throw new Error('claim must not touch a table directly'); }) as never,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args: args ?? {} });
      return { data: [], error: null };
    },
  }, 'worker-1');

  await queue.claim(5, ['code.grade']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.fn, 'onyx_claim_jobs');
  assert.equal(calls[0]!.args['p_limit'], 5);
  assert.equal(calls[0]!.args['p_worker'], 'worker-1', 'the worker name is recorded on the row');
  assert.deepEqual(calls[0]!.args['p_kinds'], ['code.grade']);

  // No kinds must mean "any kind", not "no kinds" -- an empty array would match
  // nothing and the worker would silently starve.
  calls.length = 0;
  await queue.claim(1);
  assert.equal(calls[0]!.args['p_kinds'], null);
});

test('migration 0019 still pins FOR UPDATE SKIP LOCKED into onyx_claim_jobs', async () => {
  // Reading the migration rather than the database, so this holds in CI with no
  // Supabase project attached. The guarantee is one line and it is the line the
  // queue's correctness rests on.
  const fs = await import('node:fs');
  const sql = fs.readFileSync(
    new URL('../../../supabase/onyx/migrations/0019_job_queue_rpc.sql', import.meta.url),
    'utf8');
  const fn = sql.slice(sql.indexOf('FUNCTION public.onyx_claim_jobs'));
  const body = fn.slice(0, fn.indexOf('$$;')).replace(/\s+/g, ' ');

  assert.match(body, /FOR UPDATE SKIP LOCKED/);
  assert.match(body, /SET "status" = 'running'/);
  assert.match(body, /"attempts" = t\."attempts" \+ 1/);
  assert.match(body, /WHERE j\."status" = 'queued'/);
  assert.match(body, /j\."run_after" <= now\(\)/);
});

test('a failed job retries until its attempts run out, then stops as failed', async () => {
  const updates: Record<string, unknown>[] = [];
  const queue = new QueueService({
    from: () => ({
      insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 1 }, error: null }) }) }),
      update: (values: Record<string, unknown>) => {
        updates.push(values);
        return { eq: async () => ({ error: null }) };
      },
    }),
    rpc: async () => ({ data: null, error: null }),
  } as never);

  const job: Job = {
    id: 7, tenant_id: T, kind: 'code.grade', payload: {}, attempts: 1, max_attempts: 3,
  };
  assert.equal(await queue.fail(job, new Error('sandbox down')), 'retry');
  assert.equal(updates[0]!['status'], 'queued');
  // backoffSeconds(1) is 10, so the retry is scheduled about ten seconds out.
  const delay = Date.parse(String(updates[0]!['run_after'])) - Date.now();
  assert.ok(delay > 8_000 && delay < 12_000, 'about ten seconds, got ' + delay + 'ms');

  assert.equal(await queue.fail({ ...job, attempts: 3 }, new Error('still down')), 'failed');
  // Failed is a state, not a deletion: a queue that empties itself on failure
  // looks healthy while losing work.
  assert.equal(updates[1]!['status'], 'failed');
  assert.equal(updates[1]!['last_error'], 'still down');
});

test('drain runs handlers, records failures and never lets one job stop another', async () => {
  const jobs: Job[] = [
    { id: 1, tenant_id: T, kind: 'code.grade', payload: { n: 1 }, attempts: 1, max_attempts: 3 },
    { id: 2, tenant_id: T, kind: 'code.grade', payload: { n: 2 }, attempts: 3, max_attempts: 3 },
    { id: 3, tenant_id: T, kind: 'nonsense' as never, payload: {}, attempts: 1, max_attempts: 3 },
  ];
  const completed: number[] = [];
  const failed: number[] = [];
  const queue = {
    claim: async () => jobs.splice(0, 3),
    complete: async (id: number) => { completed.push(id); },
    fail: async (job: Job) => {
      failed.push(job.id);
      return job.attempts >= job.max_attempts ? 'failed' as const : 'retry' as const;
    },
  } as unknown as QueueService;

  const seen: string[] = [];
  const result = await drain(queue, {
    'code.grade': async (job) => {
      seen.push('grade:' + job.id);
      if (job.id === 2) throw new Error('boom');
    },
  }, { concurrency: 3 });

  assert.deepEqual(completed, [1]);
  assert.deepEqual(failed.sort(), [2, 3]);
  // An unknown kind is a deployment mistake, not a transient fault.
  assert.equal(result.failed, 2);
  assert.equal(result.done, 1);
});

test('the worker marks a submission failed only on the last attempt', async () => {
  const marked: { id: number; message: string }[] = [];
  const codelab = {
    evaluate: async () => { throw new Error('sandbox unreachable'); },
    markFailed: async (_t: number, id: number, message: string) => { marked.push({ id, message }); },
  } as unknown as import('../src/onyx/codelab.service.ts').CodeLabService;
  const handlers = codeLabHandlers(codelab, {} as never);

  // Attempt 1 of 3: leave it queued, a retry may well succeed.
  await assert.rejects(handlers['code.grade']!({
    id: 1, tenant_id: T, kind: 'code.grade', payload: { submission_id: 5 },
    attempts: 1, max_attempts: 3,
  }));
  assert.deepEqual(marked, []);

  // Last attempt: stop the spinner and say why.
  await assert.rejects(handlers['code.grade']!({
    id: 1, tenant_id: T, kind: 'code.grade', payload: { submission_id: 5 },
    attempts: 3, max_attempts: 3,
  }));
  assert.equal(marked.length, 1);
  assert.match(marked[0]!.message, /unreachable/);
});

test('the queue tries the direct host first, then the IPv4 pooler', () => {
  const candidates = poolCandidates({
    SUPABASE_DB_URL: 'postgresql://postgres:pw@db.abcdefg.supabase.co:5432/postgres',
    SUPABASE_REGION: 'ap-northeast-1',
  });
  assert.equal(candidates[0]!.label, 'direct');
  // The direct host is IPv6-only; on an IPv4 network it fails with ENOTFOUND,
  // which looks like a dead database but is only a dead route.
  assert.match(candidates[1]!.label, /aws-0-ap-northeast-1\.pooler\.supabase\.com/);
  assert.equal(candidates[1]!.config.user, 'postgres.abcdefg');
  assert.equal(candidates[1]!.config.password, 'pw');
  assert.ok(candidates.length >= 3, 'both pooler prefixes should be tried');

  // Nothing to derive from is not a crash.
  assert.deepEqual(poolCandidates({}), []);
});

// ---------------------------------------------------------------------------
// LAB-03 -- the evaluator
// ---------------------------------------------------------------------------

test('output comparison forgives whitespace but not a wrong answer', () => {
  assert.equal(outputMatches('hello\n', 'hello'), true);
  assert.equal(outputMatches('hello\r\n', 'hello\n'), true);
  assert.equal(outputMatches('hello   \nworld', 'hello\nworld'), true);
  assert.equal(outputMatches('hello\n\n\n', 'hello'), true);
  // Failing a correct solution over a line ending is the fastest way to lose a
  // learner's trust in the grader; passing a wrong one is worse.
  assert.equal(outputMatches('hello world', 'hello  world'), false);
  assert.equal(outputMatches('Hello', 'hello'), false);
  assert.equal(outputMatches('', 'hello'), false);
});

test('a problem needs at least one visible case, before and at publishing', async () => {
  const w = world();
  const problem = await w.codelab.createProblem(T, 'user-20', { title: 'Hidden only' });
  const id = Number(problem.id);
  await assert.rejects(w.codelab.setTests(T, id, [
    { expected_stdout: 'x', is_hidden: true },
  ]), (e: HttpError) => e.status === 422);
  // Otherwise a learner cannot tell what the problem wants, only that they got
  // it wrong.
  await assert.rejects(w.codelab.publishProblem(T, id), (e: HttpError) => e.status === 422);
});

test('test cases are frozen once a problem is published', async () => {
  const w = world();
  const id = await withProblem(w);
  await assert.rejects(w.codelab.setTests(T, id, [
    { expected_stdout: 'different', is_hidden: false },
  ]), (e: HttpError) => e.status === 422);
});

test('a hidden case never reaches a learner, in the problem or in the result', async () => {
  const w = world(fakeProvider(() => ({ stdout: 'hello' })));
  const id = await withProblem(w);

  const asLearner = await w.codelab.problem(T, id, 'user-10', 'student');
  const secret = asLearner.tests.find((t) => t.name === 'Secret')!;
  // All three of these reveal the answer.
  assert.equal(secret.stdin, null, 'a hidden case leaked its input');
  assert.equal(secret.expected_stdout, null, 'a hidden case leaked its expected output');
  assert.equal(JSON.stringify(asLearner).includes('SECRET-INPUT'), false);
  assert.equal(JSON.stringify(asLearner).includes('SECRET-ANSWER'), false);

  // Faculty do see it -- they wrote it.
  const asFaculty = await w.codelab.problem(T, id, 'user-20', 'faculty');
  assert.equal(asFaculty.tests.find((t) => t.name === 'Secret')!.stdin, 'SECRET-INPUT');

  const submission = await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'hello' });
  await w.codelab.evaluate(T, Number(submission.id));
  const detail = await w.codelab.submissionDetail(T, Number(submission.id), 'user-10', 'student');
  const hiddenCase = detail.cases.find((c) => c.name === 'Secret')!;
  assert.equal(hiddenCase.passed, 0, 'the fake echoes "hello", so the secret case fails');
  assert.equal(hiddenCase.stdout, null, 'a hidden case leaked what the program printed');
  assert.equal(JSON.stringify(detail).includes('SECRET-ANSWER'), false);
});

test('partial scoring counts the weight of each case that passed', async () => {
  // Echoes the stdin, so the two visible cases (expecting "hello") fail and the
  // hidden one (expecting "SECRET-ANSWER" for input "SECRET-INPUT") also fails.
  const w = world(fakeProvider((req) => ({ stdout: req.stdin ?? '' })));
  const id = await withProblem(w);
  const partial = await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'echo' });
  await w.codelab.evaluate(T, Number(partial.id));
  let detail = await w.codelab.submissionDetail(T, Number(partial.id), 'user-10', 'student');
  assert.equal(detail.score, 0);
  assert.equal(detail.max_score, 4, 'two cases worth 1 and one worth 2');

  // Now one that gets the visible cases right and the hidden one wrong.
  const w2 = world(fakeProvider(() => ({ stdout: 'hello' })));
  const id2 = await withProblem(w2);
  const half = await w2.codelab.submit(T, id2, 'user-10', { language: 'python', source: 'x' });
  await w2.codelab.evaluate(T, Number(half.id));
  detail = await w2.codelab.submissionDetail(T, Number(half.id), 'user-10', 'student');
  assert.equal(detail.passed, 2);
  assert.equal(detail.score, 2, 'partial credit for the two visible cases');
  assert.equal(detail.max_score, 4);
});

test('Run checks only the visible cases; Submit checks everything', async () => {
  const w = world(fakeProvider(() => ({ stdout: 'hello' })));
  const id = await withProblem(w);

  const run = await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'x', mode: 'run' });
  assert.equal(run.total, 2);
  assert.equal(run.max_score, 2);
  await w.codelab.evaluate(T, Number(run.id));
  const runDetail = await w.codelab.submissionDetail(T, Number(run.id), 'user-10', 'student');
  assert.equal(runDetail.cases.length, 2, 'Run reached a hidden case');
  assert.equal(runDetail.score, 2);

  const submit = await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'x' });
  assert.equal(submit.total, 3);
  assert.equal(submit.max_score, 4);
});

test('submitting queues rather than running inline', async () => {
  const w = world();
  const id = await withProblem(w);
  const submission = await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'x' });
  // That indirection IS the answer to a class of 200: the request never waits
  // on a sandbox.
  assert.equal(submission.status, 'queued');
  assert.deepEqual(w.enqueued, [{
    tenantId: T, kind: 'code.grade', payload: { submission_id: Number(submission.id) },
  }]);

  await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'x', mode: 'run' });
  assert.equal(w.enqueued[1]!.kind, 'code.run');
});

test('a compile error stops after the first case', async () => {
  const w = world(fakeProvider(() => ({
    verdict: 'compile_error', stdout: '', compileOutput: 'line 1: syntax error',
  })));
  const id = await withProblem(w);
  const submission = await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'x(' });
  await w.codelab.evaluate(T, Number(submission.id));
  const detail = await w.codelab.submissionDetail(T, Number(submission.id), 'user-10', 'student');
  // Running the rest burns sandbox capacity a class of 200 needs, for a result
  // that is already known.
  assert.equal(detail.cases.length, 1);
  assert.equal(detail.error, 'compile_error');
  assert.match(detail.compile_output!, /syntax error/);
});

test('a sandbox failure is not recorded as a wrong answer', async () => {
  const broken: ExecutionProvider = {
    name: 'broken', supports: () => true,
    run: async () => { throw new Error('sandbox unreachable'); },
  };
  const w = world(broken);
  const id = await withProblem(w);
  const submission = await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'x' });
  // It throws, so the queue retries it. Marking it "0 of 3 passed" would be a
  // lie the learner cannot distinguish from their own bug.
  await assert.rejects(w.codelab.evaluate(T, Number(submission.id)), /unreachable/);
});

test('one learner cannot read another learner\'s submission', async () => {
  const w = world();
  const id = await withProblem(w);
  const submission = await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'x' });
  await assert.rejects(
    w.codelab.submissionDetail(T, Number(submission.id), 'user-11', 'student'),
    (e: HttpError) => e.status === 403);
  // Faculty may, and see the hidden cases too.
  assert.ok(await w.codelab.submissionDetail(T, Number(submission.id), 'user-20', 'faculty'));
});

test('a language the problem does not accept is refused', async () => {
  const w = world();
  const id = await withProblem(w);
  await assert.rejects(w.codelab.submit(T, id, 'user-10', { language: 'rust', source: 'x' }),
    (e: HttpError) => e.status === 422);
  await assert.rejects(
    w.codelab.submit(T, id, 'user-10', { language: 'brainfuck' as never, source: 'x' }),
    (e: HttpError) => e.status === 422);
  await assert.rejects(w.codelab.submit(T, id, 'user-10', { language: 'python', source: '  ' }),
    (e: HttpError) => e.status === 422);
});

test('a draft problem does not exist as far as a learner is concerned', async () => {
  const w = world();
  const problem = await w.codelab.createProblem(T, 'user-20', { title: 'Not ready' });
  const id = Number(problem.id);
  await assert.rejects(w.codelab.problem(T, id, 'user-10', 'student'), (e: HttpError) => e.status === 404);
  await assert.rejects(w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'x' }),
    (e: HttpError) => e.status === 404);
  assert.ok(await w.codelab.problem(T, id, 'user-20', 'faculty'));
});

test('a problem in another institution is not found', async () => {
  const w = world();
  const id = await withProblem(w);
  await assert.rejects(w.codelab.problem(OTHER, id, 'user-10', 'admin'), (e: HttpError) => e.status === 404);
  await assert.rejects(w.codelab.submit(OTHER, id, 'user-10', { language: 'python', source: 'x' }),
    (e: HttpError) => e.status === 404);
});

// ---------------------------------------------------------------------------
// LAB-04 -- hints and worked solutions
// ---------------------------------------------------------------------------

test('hints come one at a time, in order, and are not sent before they are asked for', async () => {
  const w = world();
  const id = await withProblem(w);
  await w.codelab.setHints(T, id, [
    { body: 'Try a loop', penalty_percent: 10 },
    { body: 'Then a dictionary', penalty_percent: 20 },
  ]);

  const before = await w.codelab.problem(T, id, 'user-10', 'student');
  assert.deepEqual(before.hints.map((h) => h.body), [null, null],
    'an unrevealed hint reached the browser');
  assert.deepEqual(before.hints.map((h) => h.revealed), [false, false]);
  // The penalty is stated before it is paid.
  assert.deepEqual(before.hints.map((h) => h.penalty_percent), [10, 20]);

  const first = await w.codelab.revealHint(T, id, 'user-10');
  assert.equal(first.body, 'Try a loop');
  assert.equal(first.remaining, 1);

  const middle = await w.codelab.problem(T, id, 'user-10', 'student');
  assert.deepEqual(middle.hints.map((h) => h.body), ['Try a loop', null],
    'revealing one revealed them all');

  assert.equal((await w.codelab.revealHint(T, id, 'user-10')).body, 'Then a dictionary');
  await assert.rejects(w.codelab.revealHint(T, id, 'user-10'), (e: HttpError) => e.status === 422);

  // And one learner's reveals are not another's.
  const other = await w.codelab.problem(T, id, 'user-11', 'student');
  assert.deepEqual(other.hints.map((h) => h.revealed), [false, false]);
});

test('a worked solution is released only when its rule is met', async () => {
  // never
  {
    const w = world(fakeProvider(() => ({ stdout: 'hello' })));
    const id = await withProblem(w, { solution: 'the answer', solution_rule: 'never' });
    const view = await w.codelab.problem(T, id, 'user-10', 'student');
    assert.equal(view.solution, null);
    assert.equal(view.solution_released, false);
  }

  // after_solve
  {
    const w = world(fakeProvider((req) => ({ stdout: req.source === 'correct' ? req.stdin ?? '' : 'wrong' })));
    const id = await withProblem(w, { solution: 'the answer', solution_rule: 'after_solve' });
    assert.equal((await w.codelab.problem(T, id, 'user-10', 'student')).solution, null);

    // A failing attempt does not release it.
    const bad = await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'wrong' });
    await w.codelab.evaluate(T, Number(bad.id));
    assert.equal((await w.codelab.problem(T, id, 'user-10', 'student')).solution, null,
      'a failed attempt released the solution');
  }

  // after_attempts
  {
    const w = world(fakeProvider(() => ({ stdout: 'nope' })));
    const id = await withProblem(w, {
      solution: 'the answer', solution_rule: 'after_attempts', solution_after_attempts: 2,
    });
    await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'a' });
    assert.equal((await w.codelab.problem(T, id, 'user-10', 'student')).solution, null);
    await w.codelab.submit(T, id, 'user-10', { language: 'python', source: 'b' });
    assert.equal((await w.codelab.problem(T, id, 'user-10', 'student')).solution, 'the answer');
  }

  // after_date
  {
    const now = 1_800_000_000_000;
    const w = world(fakeProvider(), () => now);
    const id = await withProblem(w, {
      solution: 'the answer', solution_rule: 'after_date',
      solution_after: new Date(now + 60_000).toISOString(),
    });
    assert.equal((await w.codelab.problem(T, id, 'user-10', 'student')).solution, null);

    const later = world(fakeProvider(), () => now + 120_000);
    // Rebuild the same problem in a world whose clock has moved past the date.
    const id2 = await withProblem(later, {
      solution: 'the answer', solution_rule: 'after_date',
      solution_after: new Date(now + 60_000).toISOString(),
    });
    assert.equal((await later.codelab.problem(T, id2, 'user-10', 'student')).solution, 'the answer');
  }
});

test('a date rule without a date is refused at authoring time', async () => {
  const w = world();
  await assert.rejects(
    w.codelab.createProblem(T, 'user-20', { title: 'x', solution_rule: 'after_date' }),
    (e: HttpError) => e.status === 422);
  await assert.rejects(
    w.codelab.createProblem(T, 'user-20', { title: 'x', solution_rule: 'whenever' as never }),
    (e: HttpError) => e.status === 422);
});

// ---------------------------------------------------------------------------
// LAB-05 -- workspaces
// ---------------------------------------------------------------------------

test('a workspace path cannot climb out of its workspace', () => {
  assert.equal(normalisePath('../../etc/passwd'), 'etc/passwd');
  assert.equal(normalisePath('..\\..\\secret.txt'), 'secret.txt');
  assert.equal(normalisePath('./src/./main.py'), 'src/main.py');
  assert.equal(normalisePath('/absolute/path.py'), 'absolute/path.py');
  assert.equal(normalisePath('src/app/main.py'), 'src/app/main.py');
  assert.throws(() => normalisePath('../..'), (e: HttpError) => e.status === 422);
  assert.throws(() => normalisePath('   '), (e: HttpError) => e.status === 422);
});

test('a snapshot restores exactly the tree it captured', async () => {
  const w = world();
  const workspace = await w.workspaces.create(T, 'user-10', {
    title: 'Project', language: 'python', entry_path: 'main.py',
  });
  const id = Number(workspace.id);

  await w.workspaces.writeFiles(T, id, 'user-10', 'student', [
    { path: 'main.py', content: 'print(1)' },
    { path: 'lib/util.py', content: 'X = 1' },
  ]);
  const snapshot = await w.workspaces.snapshot(T, id, 'user-10', 'student', 'Working');
  assert.equal(snapshot.file_count, 2);

  // Edit one, add one, delete one.
  await w.workspaces.writeFiles(T, id, 'user-10', 'student', [
    { path: 'main.py', content: 'print(2)' },
    { path: 'extra.py', content: 'added later' },
  ]);
  await w.workspaces.deleteFile(T, id, 'user-10', 'student', 'lib/util.py');
  assert.deepEqual((await w.workspaces.files(T, id)).map((f) => f.path).sort(),
    ['extra.py', 'main.py']);

  const restored = await w.workspaces.restore(T, id, Number(snapshot.id), 'user-10', 'student');
  // Exactly means exactly: a restore that only overwrites is a merge, and would
  // quietly fail the one thing this feature promises.
  assert.deepEqual(restored.map((f) => f.path).sort(), ['lib/util.py', 'main.py']);
  assert.equal(restored.find((f) => f.path === 'main.py')!.content, 'print(1)');
  assert.equal(restored.find((f) => f.path === 'lib/util.py')!.content, 'X = 1');
  assert.equal(restored.some((f) => f.path === 'extra.py'), false,
    'a file added after the snapshot survived the restore');
});

test('a snapshot is immutable once taken', async () => {
  const w = world();
  const workspace = await w.workspaces.create(T, 'user-10', { title: 'P', entry_path: 'main.py' });
  const id = Number(workspace.id);
  await w.workspaces.writeFiles(T, id, 'user-10', 'student', [{ path: 'main.py', content: 'v1' }]);
  const snapshot = await w.workspaces.snapshot(T, id, 'user-10', 'student', 'v1');

  await w.workspaces.writeFiles(T, id, 'user-10', 'student', [{ path: 'main.py', content: 'v2' }]);
  const again = await w.workspaces.restore(T, id, Number(snapshot.id), 'user-10', 'student');
  assert.equal(again[0]!.content, 'v1', 'the snapshot drifted with the live files');
});

test('the entry file cannot be deleted', async () => {
  const w = world();
  const workspace = await w.workspaces.create(T, 'user-10', { title: 'P', entry_path: 'main.py' });
  await assert.rejects(
    w.workspaces.deleteFile(T, Number(workspace.id), 'user-10', 'student', 'main.py'),
    (e: HttpError) => e.status === 422);
});

test('nobody edits somebody else\'s workspace, not even an admin', async () => {
  const w = world();
  const workspace = await w.workspaces.create(T, 'user-10', { title: 'P', entry_path: 'main.py' });
  const id = Number(workspace.id);
  for (const [user, role] of [['user-11', 'student'], ['user-20', 'faculty'], ['user-99', 'admin']] as const) {
    await assert.rejects(
      w.workspaces.writeFiles(T, id, user, role, [{ path: 'main.py', content: 'hijacked' }]),
      (e: HttpError) => e.status === 403, role + ' edited another learner\'s project');
  }
});

test('a mentor reaches a workspace only through a course they teach', async () => {
  const w = world();
  // Not attached to a course: private, even to faculty.
  const priv = await w.workspaces.create(T, 'user-10', { title: 'Private', entry_path: 'main.py' });
  await assert.rejects(w.workspaces.open(T, Number(priv.id), 'user-20', 'faculty'),
    (e: HttpError) => e.status === 403);

  const shared = await w.workspaces.create(T, 'user-10', {
    title: 'For review', entry_path: 'main.py', course_id: 1,
  });
  const id = Number(shared.id);
  // Faculty of course 1 may read it and comment.
  const opened = await w.workspaces.open(T, id, 'user-20', 'faculty');
  assert.equal(opened.can_review, true);
  const comment = await w.workspaces.comment(T, id, 'user-20', 'faculty', {
    body: 'Consider a dictionary here.', file_path: 'main.py', line: 3,
  });
  assert.equal(comment.author_id, 'user-20');

  // Faculty who do not teach it may not.
  await assert.rejects(w.workspaces.open(T, id, 'user-21', 'faculty'), (e: HttpError) => e.status === 403);
  // Another learner may not either.
  await assert.rejects(w.workspaces.open(T, id, 'user-11', 'student'), (e: HttpError) => e.status === 403);
});

test('a course workspace requires the learner to be in that course', async () => {
  const w = world();
  await assert.rejects(
    w.workspaces.create(T, 'user-999', { title: 'Sneaky', entry_path: 'main.py', course_id: 1 }),
    (e: HttpError) => e.status === 403);
});

test('a comment can be resolved, and an empty one is refused', async () => {
  const w = world();
  const workspace = await w.workspaces.create(T, 'user-10', { title: 'P', entry_path: 'main.py' });
  const id = Number(workspace.id);
  await assert.rejects(w.workspaces.comment(T, id, 'user-10', 'student', { body: '   ' }),
    (e: HttpError) => e.status === 422);

  const comment = await w.workspaces.comment(T, id, 'user-10', 'student', { body: 'note to self' });
  const resolved = await w.workspaces.resolveComment(T, id, Number(comment.id), 'user-10', 'student');
  assert.ok(resolved.resolved_at);
});

test('running a workspace file answers with the sandbox result, not a queued row', async () => {
  const w = world();
  const workspace = await w.workspaces.create(T, 'user-10', {
    title: 'P', language: 'python', entry_path: 'main.py',
  });
  const id = Number(workspace.id);
  await w.workspaces.writeFiles(T, id, 'user-10', 'student', [{ path: 'main.py', content: 'print(1)' }]);

  const result = await w.workspaces.run(T, id, 'user-10', 'student', {});
  assert.equal(result.path, 'main.py', 'did not default to the entry file');
  assert.equal(result.verdict, 'ok');
  assert.equal(result.stdout, 'print(1)', 'the fake provider echoes the source');
  assert.equal(w.enqueued.length, 0, 'a workspace run must not go through the grading queue');
});

test('run picks the file asked for, not always the entry file', async () => {
  const w = world();
  const workspace = await w.workspaces.create(T, 'user-10', {
    title: 'P', language: 'python', entry_path: 'main.py',
  });
  const id = Number(workspace.id);
  await w.workspaces.writeFiles(T, id, 'user-10', 'student', [
    { path: 'main.py', content: 'print("main")' },
    { path: 'scratch.py', content: 'print("scratch")' },
  ]);

  const result = await w.workspaces.run(T, id, 'user-10', 'student', { path: 'scratch.py' });
  assert.equal(result.path, 'scratch.py');
  assert.equal(result.stdout, 'print("scratch")');
});

test('run refuses an empty file rather than asking the sandbox to do nothing', async () => {
  const w = world();
  const workspace = await w.workspaces.create(T, 'user-10', { title: 'P', entry_path: 'main.py' });
  const id = Number(workspace.id);
  await w.workspaces.writeFiles(T, id, 'user-10', 'student', [{ path: 'main.py', content: '   ' }]);
  await assert.rejects(w.workspaces.run(T, id, 'user-10', 'student', {}),
    (e: HttpError) => e.status === 422);
});

test('nobody runs somebody else\'s workspace, not even a mentor of the course', async () => {
  const w = world();
  const workspace = await w.workspaces.create(T, 'user-10', {
    title: 'P', entry_path: 'main.py', course_id: 1,
  });
  const id = Number(workspace.id);
  await w.workspaces.writeFiles(T, id, 'user-10', 'student', [{ path: 'main.py', content: 'print(1)' }]);
  await assert.rejects(w.workspaces.run(T, id, 'user-20', 'faculty', {}),
    (e: HttpError) => e.status === 403, 'faculty executed a learner\'s code, not just reviewed it');
});

test('run refuses loudly when no sandbox is configured, same as submitting a problem', async () => {
  const w = world(new UnconfiguredProvider());
  const workspace = await w.workspaces.create(T, 'user-10', { title: 'P', entry_path: 'main.py' });
  const id = Number(workspace.id);
  await w.workspaces.writeFiles(T, id, 'user-10', 'student', [{ path: 'main.py', content: 'print(1)' }]);
  await assert.rejects(w.workspaces.run(T, id, 'user-10', 'student', {}),
    (e: HttpError) => e.status === 503);
});

// ---------------------------------------------------------------------------
// LAB-04 -- the practice record
// ---------------------------------------------------------------------------

/** A published problem with one visible case, authored by `by`. */
async function aProblem(w: ReturnType<typeof world>, title: string, by = 'user-20') {
  const p = await w.codelab.createProblem(T, by, { title, difficulty: 'easy' });
  await w.codelab.setTests(T, Number(p.id), [
    { name: 'v', stdin: '1\n', expected_stdout: '1', is_hidden: false, weight: 1 },
  ]);
  await w.codelab.publishProblem(T, Number(p.id));
  return Number(p.id);
}

/** Writes a graded submission directly -- the worker's output, not its path. */
function graded(w: ReturnType<typeof world>, problemId: number, userId: string,
  fields: Record<string, unknown>) {
  (w.db.tables.onyx_code_submissions as Record<string, unknown>[]).push({
    id: (w.db.tables.onyx_code_submissions as unknown[]).length + 1,
    tenant_id: T, problem_id: problemId, user_id: userId, language: 'python',
    source: 'x', mode: 'submit', status: 'done', score: 0, max_score: 1,
    passed: 0, total: 1, queued_at: new Date().toISOString(),
    graded_at: new Date().toISOString(), ...fields,
  });
}

test('a practice record counts hand-ins, and a full score is solved', async () => {
  const w = world();
  const solvedId = await aProblem(w, 'Solved one');
  const triedId = await aProblem(w, 'Tried one');

  graded(w, solvedId, 'user-10', { score: 0, max_score: 1 });      // failed first
  graded(w, solvedId, 'user-10', { score: 1, max_score: 1 });      // then got it
  graded(w, triedId, 'user-10', { score: 0, max_score: 1 });

  const rows = await w.codelab.practiceResults(T, 'user-10');
  const byTitle = new Map(rows.map((r) => [r.title, r]));

  assert.equal(byTitle.get('Solved one')!.solved, true);
  assert.equal(byTitle.get('Solved one')!.attempts, 2, 'both hand-ins should count');
  assert.equal(byTitle.get('Tried one')!.solved, false);

  // Unsolved first: this page is read to find what is left to do.
  assert.equal(rows[0]!.title, 'Tried one');
});

test('a test Run is not an attempt, and a queued hand-in is not yet a verdict', async () => {
  const w = world();
  const id = await aProblem(w, 'Only run');

  // A Run checks the visible cases while you work. Counting it makes a careful
  // learner who tests before submitting look like a struggling one.
  graded(w, id, 'user-10', { mode: 'run', score: 1, max_score: 1 });
  assert.deepEqual(await w.codelab.practiceResults(T, 'user-10'), []);

  // Queued is neither a pass nor a failure yet.
  graded(w, id, 'user-10', { status: 'queued', score: 0, max_score: 0, graded_at: null });
  const [row] = await w.codelab.practiceResults(T, 'user-10');
  assert.equal(row!.solved, false, 'an ungraded hand-in was counted as solved');
  assert.equal(row!.pending, true);
});

test('a full score of zero out of zero is not a pass', async () => {
  const w = world();
  const id = await aProblem(w, 'No cases');
  // score >= max_score is true for 0 >= 0, which would mark an unmarkable
  // submission solved. The rule requires marks to have been available.
  graded(w, id, 'user-10', { score: 0, max_score: 0 });
  assert.equal((await w.codelab.practiceResults(T, 'user-10'))[0]!.solved, false);
});

test('staff see who set each problem; a learner is not told', async () => {
  const w = world();
  (w.db.tables.onyx_users as Record<string, unknown>[]).push(
    { id: 'user-20', tenant_id: T, name: 'Dr. Arun Menon', email: 'a@x.test' });
  const id = await aProblem(w, 'Authored', 'user-20');
  graded(w, id, 'user-10', { score: 1, max_score: 1 });

  const staffView = await w.codelab.practiceResultsFor(T, 'user-10');
  assert.equal(staffView.results[0]!.author, 'Dr. Arun Menon');
  // And who the learner is, by the institution's own number where it has one.
  assert.ok(staffView.learner, 'the staff view did not say whose record it is');

  // The learner's own read must not carry it at all -- omitted by the server,
  // not hidden by the page.
  const ownView = await w.codelab.practiceResults(T, 'user-10');
  assert.equal(ownView[0]!.author, undefined);
  assert.doesNotMatch(JSON.stringify(ownView), /Arun Menon/);
});

test('a problem whose author has left still names something readable', async () => {
  const w = world();
  const id = await aProblem(w, 'Orphaned', 'user-20');
  // created_by is ON DELETE SET NULL, so this is a real state, not a contrived
  // one -- and a blank column would read as a rendering bug.
  const rows = w.db.tables.onyx_problems as Record<string, unknown>[];
  rows.find((p) => Number(p.id) === id)!.created_by = null;
  graded(w, id, 'user-10', { score: 1, max_score: 1 });

  const [row] = (await w.codelab.practiceResultsFor(T, 'user-10')).results;
  assert.equal(row!.author, 'No longer at the institution');
});

test('a practice record stops at the institution boundary', async () => {
  const w = world();
  const id = await aProblem(w, 'Ours');
  graded(w, id, 'user-10', { score: 1, max_score: 1 });
  assert.equal((await w.codelab.practiceResults(OTHER, 'user-10')).length, 0);
});

// ---------------------------------------------------------------------------
// The cohort-wide submission feed, and the monitoring filters on workspaces.
//
// These two reads are what the console and the staff screens are built on, and
// both are filters over other people's work -- so what they are asked to
// EXCLUDE matters at least as much as what they return.
// ---------------------------------------------------------------------------

test('the submission feed names the problem and the person, and never ships the source', async () => {
  const w = world();
  (w.db.tables.onyx_users as Record<string, unknown>[]).push(
    { id: 'user-10', tenant_id: T, name: 'Priya Nair', email: 'p@x.test' });
  const id = await aProblem(w, 'Two Sum');
  graded(w, id, 'user-10', { score: 1, max_score: 1, source: 'print(42)' });

  const feed = await w.codelab.allSubmissions(T);
  assert.equal(feed.submissions.length, 1);
  const [row] = feed.submissions;
  assert.equal(row!.problem_title, 'Two Sum');
  assert.equal(row!.learner, 'Priya Nair');
  // A monitoring table never renders a program. Shipping every learner's code
  // to draw a status chip is bandwidth spent on something the page discards.
  assert.equal((row as Record<string, unknown>).source, undefined);
  assert.doesNotMatch(JSON.stringify(feed), /print\(42\)/);
});

test('the feed filters by state, by kind and by person', async () => {
  const w = world();
  const id = await aProblem(w, 'Filterable');
  graded(w, id, 'user-10', { score: 1, max_score: 1 });
  graded(w, id, 'user-11', { status: 'failed', score: 0, max_score: 1 });
  graded(w, id, 'user-10', { mode: 'run', score: 1, max_score: 1 });

  // 'done' is what the grader writes. 'graded' is only ever a label on a chip,
  // and filtering on it would silently return nothing.
  assert.equal((await w.codelab.allSubmissions(T, { status: 'done' })).submissions.length, 2,
    'the graded hand-in and the graded run are both done');
  assert.equal((await w.codelab.allSubmissions(T, { status: 'failed' })).submissions.length, 1);
  // Unlike the learner-facing reads, a Run is included by default -- "did
  // their code even execute" is what somebody watching the queue wants -- so
  // hand-ins are a filter rather than the only thing here.
  assert.equal((await w.codelab.allSubmissions(T, { mode: 'submit' })).submissions.length, 2);
  assert.equal((await w.codelab.allSubmissions(T, { mode: 'run' })).submissions.length, 1);
  assert.equal(
    (await w.codelab.allSubmissions(T, { status: 'done', mode: 'submit' })).submissions.length, 1);
  assert.equal((await w.codelab.allSubmissions(T, { user_id: 'user-11' })).submissions.length, 1);
});

test('a course filter with no problem on that course answers empty, not everything', async () => {
  const w = world();
  const id = await aProblem(w, 'Standalone');       // course_id is null
  graded(w, id, 'user-10', { score: 1, max_score: 1 });

  // `.in()` on an empty list is an error in PostgREST, not an empty result --
  // so the empty case is answered before the query is built. Getting this
  // wrong returns the whole institution's submissions under a course filter.
  const feed = await w.codelab.allSubmissions(T, { course_id: 1 });
  assert.deepEqual(feed.submissions, []);
  assert.equal(feed.total, 0);
});

test('the feed searches names, roll numbers and problem titles together', async () => {
  const w = world();
  (w.db.tables.onyx_users as Record<string, unknown>[]).push(
    { id: 'user-10', tenant_id: T, name: 'Priya Nair', email: 'p@x.test' });
  (w.db.tables.onyx_memberships as Record<string, unknown>[]).push(
    { id: 1, tenant_id: T, user_id: 'user-10', role: 'student', status: 1,
      roll_number: 'CS-2024-014' });
  const id = await aProblem(w, 'Binary Search');
  graded(w, id, 'user-10', { score: 1, max_score: 1 });

  for (const needle of ['priya', 'CS-2024', 'binary']) {
    assert.equal((await w.codelab.allSubmissions(T, { search: needle })).submissions.length, 1,
      'searching for ' + needle + ' found nothing');
  }
  assert.equal((await w.codelab.allSubmissions(T, { search: 'nobody' })).submissions.length, 0);
});

test('a truncated feed says so, rather than looking complete', async () => {
  const w = world();
  const id = await aProblem(w, 'Popular');
  for (let i = 0; i < 5; i += 1) graded(w, id, 'user-10', { score: 1, max_score: 1 });

  const capped = await w.codelab.allSubmissions(T, { limit: 3 });
  assert.equal(capped.submissions.length, 3);
  assert.equal(capped.truncated, true, 'a partial list must not read as a whole one');

  const whole = await w.codelab.allSubmissions(T, { limit: 50 });
  assert.equal(whole.truncated, false);
});

test('the feed stops at the institution boundary', async () => {
  const w = world();
  const id = await aProblem(w, 'Ours');
  graded(w, id, 'user-10', { score: 1, max_score: 1 });
  assert.equal((await w.codelab.allSubmissions(OTHER)).submissions.length, 0);
});

test('workspace monitoring filters narrow, and never widen, what faculty may see', async () => {
  const w = world();
  await w.workspaces.create(T, 'user-10', { title: 'Course project', course_id: 1 });
  await w.workspaces.create(T, 'user-10', { title: 'Personal thing' });

  // An administrator sees both, and can ask for the personal one specifically.
  assert.equal((await w.workspaces.listAll(T)).length, 2);
  assert.equal((await w.workspaces.listAll(T, { course_id: null })).length, 1);
  assert.equal((await w.workspaces.listAll(T, { search: 'personal' })).length, 1);

  // A lecturer's list is course-attached work by definition. Asking for a
  // course they do not teach is an empty list, not somebody else's class; and
  // asking for "no course" is empty rather than every class they teach.
  assert.equal((await w.workspaces.listForCourses(T, [1])).length, 1);
  assert.equal((await w.workspaces.listForCourses(T, [1], { course_id: 2 })).length, 0);
  assert.equal((await w.workspaces.listForCourses(T, [1], { course_id: null })).length, 0);
});

test('two problems may share a title; the address is made unique for them', async () => {
  const w = world();

  /*
   * The defect this pins. `onyx_problems` is unique on (tenant_id, slug), the
   * slug is derived from the title, and the author never sees it -- so adding
   * a second coding or web question with a title somebody had used before was
   * refused with "That address is already in use", about a value the lecturer
   * had not typed and could not change.
   *
   * `slugify` strips case and punctuation, so every obvious workaround --
   * retyping it differently -- collapsed to the same address and hit the same
   * message.
   */
  const first = await w.codelab.createProblem(T, 'user-20', { title: 'Two Sum' });
  assert.equal(first.slug, 'two-sum');

  for (const [title, expected] of [
    ['Two Sum', 'two-sum-2'],
    ['two sum', 'two-sum-3'],
    ['Two  Sum!', 'two-sum-4'],
  ] as const) {
    const next = await w.codelab.createProblem(T, 'user-20', { title });
    assert.equal(next.slug, expected, title + ' should land on ' + expected);
    assert.equal(next.title, title.trim());
  }

  // A retired or unpublished problem still holds its address, which is why the
  // collision could happen against something nobody was looking at.
  const drafts = await w.codelab.createProblem(T, 'user-20', { title: 'Two-Sum' });
  assert.equal(drafts.slug, 'two-sum-5');
});

test('an address the author typed themselves is not silently changed', async () => {
  const w = world();

  /*
   * The other half of the rule. We resolve what we DERIVED; we do not quietly
   * move what somebody chose. An author who typed an address and got a
   * different one would find their link broken with nothing said.
   */
  await w.codelab.createProblem(T, 'user-20', { title: 'Anything', slug: 'mine' });
  await assert.rejects(
    () => w.codelab.createProblem(T, 'user-20', { title: 'Something else', slug: 'mine' }),
    (e: { status?: number; message?: string }) =>
      e.status === 422 && /already used by another problem/.test(String(e.message)),
  );
});
