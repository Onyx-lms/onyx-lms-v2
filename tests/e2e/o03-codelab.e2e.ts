/**
 * Onyx O03 -- Code Lab, end to end.
 *
 * Three claims are proven here that cannot be proven anywhere else:
 *
 *   * **Hidden test inputs never reach the client** (LAB-03a's acceptance
 *     criterion), checked against the real API responses rather than a service
 *     return value.
 *   * **200 concurrent submissions all complete; none are lost or
 *     double-graded** (LAB-02b's), against a real Postgres where FOR UPDATE
 *     SKIP LOCKED actually means something.
 *   * **A snapshot restores the exact file tree it captured** (LAB-05a's).
 *
 * The sandbox itself is not exercised: Judge0 needs an endpoint this
 * environment does not have. The adapter is unit-tested against a fake fetch,
 * and everything downstream of it -- queue, evaluator, scoring -- is real here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, withDb, RUN, onyxLogin } from './harness.ts';

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'cl.' + who + '.' + RUN + '@onyx.test';
const A = { name: 'Code Institute ' + RUN, slug: 'code-a-' + RUN };
const B = { name: 'Rival Code ' + RUN, slug: 'code-b-' + RUN };

const SECRET_INPUT = 'HIDDEN-INPUT-' + RUN;
const SECRET_OUTPUT = 'HIDDEN-ANSWER-' + RUN;

const w = {
  alpha: { id: 0, admin: '', faculty: '', s1: '', s2: '' },
  beta: { id: 0, admin: '' },
  ids: {} as Record<string, string>,
  course: 0, problem: 0, workspace: 0, snapshot: 0, submission: 0,
};

test('two institutions, a course and a cohort', async () => {
  for (const [key, t] of [['alpha', A], ['beta', B]] as const) {
    const res = await createTenant({
      name: t.name, slug: t.slug,
      admin: { name: t.name, email: mail(key + '.admin'), password: pw },
    });
    assert.equal(res.ok, true, res.message);
    w[key].id = Number(res.data.tenant.id);
  }
  w.alpha.admin = await onyxLogin(mail('alpha.admin'), pw);
  w.beta.admin = await onyxLogin(mail('beta.admin'), pw);

  for (const [who, role] of [['faculty', 'faculty'], ['s1', 'student'], ['s2', 'student']] as const) {
    const r = await api<{ user: { id: string } }>('/api/onyx/members', {
      token: w.alpha.admin, body: { name: who, email: mail(who), role, password: pw },
    });
    assert.equal(r.ok, true, r.message);
    w.ids[who] = r.data.user.id;
  }
  w.alpha.faculty = await onyxLogin(mail('faculty'), pw);
  w.alpha.s1 = await onyxLogin(mail('s1'), pw);
  w.alpha.s2 = await onyxLogin(mail('s2'), pw);

  const course = await api<{ id: number }>('/api/onyx/courses', {
    token: w.alpha.admin, body: { code: 'CL101', title: 'Code Lab Course' },
  });
  w.course = Number(course.data.id);
  await api('/api/onyx/courses/' + w.course + '/faculty',
    { token: w.alpha.admin, body: { user_id: w.ids.faculty } });
  await api('/api/onyx/courses/' + w.course,
    { token: w.alpha.admin, method: 'PATCH', body: { status: 1 } });
  for (const who of ['s1', 's2'] as const) {
    await api('/api/onyx/courses/' + w.course + '/enroll',
      { token: w.alpha.admin, body: { user_id: w.ids[who] } });
  }
});

// ---------------------------------------------------------------------------
// LAB-04 -- the problem bank
// ---------------------------------------------------------------------------

test('LAB-04 a problem is authored with visible and hidden cases', async () => {
  const created = await api<{ id: number; status: string }>('/api/onyx/problems', {
    token: w.alpha.faculty,
    body: {
      title: 'Echo the input', statement: 'Print what you are given.',
      difficulty: 'easy', topic: 'strings', languages: ['python'],
      starter_code: { python: '# your code here' },
      course_id: w.course,
      solution: 'print(input())', solution_rule: 'after_attempts',
      solution_after_attempts: 2,
    },
  });
  assert.equal(created.ok, true, created.message);
  assert.equal(created.data.status, 'draft');
  w.problem = Number(created.data.id);

  // A bank with no visible case tells a learner nothing but "wrong".
  const noVisible = await api('/api/onyx/problems/' + w.problem + '/tests', {
    token: w.alpha.faculty, method: 'PUT',
    body: { tests: [{ expected_stdout: 'x', is_hidden: true }] },
  });
  assert.equal(noVisible.status, 422, noVisible.message);

  const tests = await api('/api/onyx/problems/' + w.problem + '/tests', {
    token: w.alpha.faculty, method: 'PUT',
    body: {
      tests: [
        { name: 'Example', stdin: 'hello', expected_stdout: 'hello', is_hidden: false, weight: 1 },
        { name: 'Secret', stdin: SECRET_INPUT, expected_stdout: SECRET_OUTPUT, is_hidden: true, weight: 3 },
      ],
    },
  });
  assert.equal(tests.ok, true, tests.message);

  await api('/api/onyx/problems/' + w.problem + '/hints', {
    token: w.alpha.faculty, method: 'PUT',
    body: {
      hints: [
        { body: 'Read a line first', penalty_percent: 10 },
        { body: 'Then print it', penalty_percent: 20 },
      ],
    },
  });

  // A draft is invisible to a learner.
  assert.equal((await api('/api/onyx/problems/' + w.problem, { token: w.alpha.s1 })).status, 404);

  const published = await api('/api/onyx/problems/' + w.problem + '/publish',
    { token: w.alpha.faculty, method: 'POST' });
  assert.equal(published.ok, true, published.message);

  // Frozen afterwards: changing cases regrades old submissions silently.
  assert.equal((await api('/api/onyx/problems/' + w.problem + '/tests', {
    token: w.alpha.faculty, method: 'PUT',
    body: { tests: [{ expected_stdout: 'different', is_hidden: false }] },
  })).status, 422);
});

test('LAB-03 hidden test inputs never reach the client', async () => {
  const res = await api('/api/onyx/problems/' + w.problem, { token: w.alpha.s1 });
  assert.equal(res.ok, true, res.message);

  // The acceptance criterion, checked against the wire rather than a return
  // value: nothing in the whole response contains the hidden case.
  const wire = JSON.stringify(res.data);
  assert.equal(wire.includes(SECRET_INPUT), false, 'a hidden test input reached the client');
  assert.equal(wire.includes(SECRET_OUTPUT), false, 'a hidden expected output reached the client');

  const secret = (res.data.tests as { name: string; stdin: string | null }[])
    .find((t) => t.name === 'Secret')!;
  assert.equal(secret.stdin, null);
  assert.equal(secret.expected_stdout, null);

  // The visible one is part of the statement and does arrive.
  const example = (res.data.tests as { name: string; stdin: string | null }[])
    .find((t) => t.name === 'Example')!;
  assert.equal(example.stdin, 'hello');

  // Faculty wrote it, so they see it.
  const staff = await api('/api/onyx/problems/' + w.problem, { token: w.alpha.faculty });
  assert.equal(JSON.stringify(staff.data).includes(SECRET_INPUT), true,
    'faculty could not see their own answer key');

  // And it is not reachable through PostgREST either.
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
    const { env } = await import('./harness.ts');
    process.env[k] ??= env[k];
  }
  const { onyxTenantClient } = await import('@onyx/core');
  const { data: leaked } = await onyxTenantClient(w.alpha.s1)
    .from('onyx_problem_tests').select('stdin, expected_stdout');
  assert.equal(leaked?.length ?? 0, 0, 'the answer key is readable through PostgREST');
});

test('LAB-04 hints come one at a time and the solution waits for its rule', async () => {
  const before = await api('/api/onyx/problems/' + w.problem, { token: w.alpha.s1 });
  assert.deepEqual((before.data.hints as { body: string | null }[]).map((h) => h.body),
    [null, null], 'an unrevealed hint reached the client');
  assert.equal(before.data.solution, null);
  assert.equal(before.data.solution_released, false);

  const first = await api<{ body: string; remaining: number }>(
    '/api/onyx/problems/' + w.problem + '/hint', { token: w.alpha.s1, method: 'POST' });
  assert.equal(first.data.body, 'Read a line first');
  assert.equal(first.data.remaining, 1);

  const middle = await api('/api/onyx/problems/' + w.problem, { token: w.alpha.s1 });
  assert.deepEqual((middle.data.hints as { body: string | null }[]).map((h) => h.body),
    ['Read a line first', null], 'revealing one revealed them all');

  // Another learner's reveals are their own.
  const other = await api('/api/onyx/problems/' + w.problem, { token: w.alpha.s2 });
  assert.deepEqual((other.data.hints as { revealed: boolean }[]).map((h) => h.revealed),
    [false, false]);
});

// ---------------------------------------------------------------------------
// LAB-02b -- the queue
// ---------------------------------------------------------------------------

test('LAB-02b submitting queues work and returns immediately', async () => {
  const queued = await api<{ id: number; status: string }>(
    '/api/onyx/problems/' + w.problem + '/submit',
    { token: w.alpha.s1, body: { language: 'python', source: 'print(input())' } });

  // With no sandbox configured the route refuses up front rather than queueing
  // work that can only fail. Either outcome is correct; which one depends on
  // ONYX_JUDGE0_URL, so the test accepts both and says which it saw.
  if (queued.status === 503) {
    assert.match(queued.message ?? '', /not configured/);
    return;
  }
  assert.equal(queued.ok, true, queued.message);
  assert.equal(queued.data.status, 'queued', 'the request ran the code inline');
  w.submission = Number(queued.data.id);

  const row = await api('/api/onyx/submissions/code/' + w.submission, { token: w.alpha.s1 });
  assert.equal(row.ok, true, row.message);
  // A learner may read their own and nobody else's.
  assert.equal((await api('/api/onyx/submissions/code/' + w.submission,
    { token: w.alpha.s2 })).status, 403);
});

/**
 * LAB-02b's acceptance criterion, against a real Postgres.
 *
 * Two things shape this test.
 *
 * The jobs use a kind the API's own Code Lab worker does not claim. That worker
 * is running on an interval against the same queue -- which is correct, and is
 * exactly why a test that counted its own handler calls would be flaky.
 *
 * And the guarantee is read back from the database rather than from bookkeeping
 * here: every job ends `done` with `attempts = 1`. `claim` increments attempts,
 * so 1 means claimed exactly once, which is what "none double-graded" is.
 */
const PROBE_KIND = 'test.queue-probe';

test('LAB-02b 200 concurrent jobs all complete, none lost or double-claimed', async () => {
  const { QueueService, drain } = await import('@onyx/core');
  const { connect } = await import('../../tools/db/connect.mjs') as {
    connect: (env: Record<string, string>) => Promise<import('pg').Client>;
  };
  const { env } = await import('./harness.ts');

  // One client per worker: `pg` serialises queries on a single client, so
  // sharing one would make the concurrency this is testing disappear.
  const clients = await Promise.all(
    Array.from({ length: 8 }, () => connect(env as unknown as Record<string, string>)));
  try {
    const seeder = new QueueService(clients[0]!, 'seeder');
    const ids: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      ids.push(await seeder.enqueue({
        tenantId: w.alpha.id, kind: PROBE_KIND, payload: { n: i, probe: RUN },
      }));
    }
    assert.equal(new Set(ids).size, 200);

    const workers = clients.map((client, i) => {
      const queue = new QueueService(client, 'w' + i);
      return drain(queue, {
        [PROBE_KIND]: async () => { /* the work itself is not the point */ },
      }, { concurrency: 1, kinds: [PROBE_KIND] });
    });
    const results = await Promise.all(workers);

    // Every job finished, and each was claimed exactly once.
    const { rows } = await clients[0]!.query(
      `SELECT "status", "attempts", count(*)::int AS n FROM public."onyx_jobs"
        WHERE "id" = ANY($1) GROUP BY "status", "attempts"`, [ids]);
    assert.deepEqual(rows, [{ status: 'done', attempts: 1, n: 200 }],
      'jobs were lost or claimed twice: ' + JSON.stringify(rows));

    // And more than one worker really did claim work, so SKIP LOCKED was under
    // contention rather than merely present.
    const { rows: [distinct] } = await clients[0]!.query(
      `SELECT count(DISTINCT "locked_by")::int AS n FROM public."onyx_jobs"
        WHERE "id" = ANY($1)`, [ids]);
    assert.ok(distinct.n > 1,
      'only one worker claimed anything, so concurrency was never exercised');

    assert.equal(results.reduce((t, r) => t + r.done, 0), 200);
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
  }
});

test('LAB-02b a job that keeps failing retries, then stops as failed', async () => {
  const { QueueService, drain } = await import('@onyx/core');
  const { connect } = await import('../../tools/db/connect.mjs') as {
    connect: (env: Record<string, string>) => Promise<import('pg').Client>;
  };
  const { env } = await import('./harness.ts');
  const client = await connect(env as unknown as Record<string, string>);

  try {
    const queue = new QueueService(client, 'flaky');
    const id = await queue.enqueue({
      tenantId: w.alpha.id, kind: PROBE_KIND,
      payload: { probe: RUN, always: 'fail' }, maxAttempts: 2,
    });

    let attempts = 0;
    const handler = { [PROBE_KIND]: async () => { attempts += 1; throw new Error('sandbox down'); } };
    await drain(queue, handler, { concurrency: 1, kinds: [PROBE_KIND] });
    // The first failure schedules a retry in the future, so this pass sees
    // nothing more -- which is the backoff doing its job.
    assert.equal(attempts, 1);

    // Pull it forward and drain again to reach the last attempt.
    await client.query('UPDATE public."onyx_jobs" SET "run_after" = now() WHERE "id" = $1', [id]);
    await drain(queue, handler, { concurrency: 1, kinds: [PROBE_KIND] });
    assert.equal(attempts, 2);

    const { rows: [row] } = await client.query(
      'SELECT "status", "attempts", "last_error" FROM public."onyx_jobs" WHERE "id" = $1', [id]);
    // Failed, not deleted: an operator has to be able to see what broke.
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 2);
    assert.match(row.last_error, /sandbox down/);
  } finally {
    await client.end().catch(() => {});
  }
});

test('LAB-02b a worker that dies mid-job leaves work that is picked up again', async () => {
  const { QueueService } = await import('@onyx/core');
  const { connect } = await import('../../tools/db/connect.mjs') as {
    connect: (env: Record<string, string>) => Promise<import('pg').Client>;
  };
  const { env } = await import('./harness.ts');
  const client = await connect(env as unknown as Record<string, string>);

  try {
    const queue = new QueueService(client, 'doomed');
    const id = await queue.enqueue({
      tenantId: w.alpha.id, kind: PROBE_KIND, payload: { probe: RUN, orphan: true },
    });
    const [claimed] = await queue.claim(1, [PROBE_KIND]);
    assert.equal(claimed!.id, id);

    // The process dies here: the row sits at `running` and nothing notices.
    await client.query(
      `UPDATE public."onyx_jobs" SET "locked_at" = now() - interval '1 hour' WHERE "id" = $1`, [id]);
    assert.equal(await queue.claim(1, [PROBE_KIND]).then((j) => j.length), 0,
      'a running job was claimed by someone else');

    // The API's own worker sweeps on an interval too, so it may have got there
    // first. What matters is the outcome -- the job is claimable again -- not
    // which sweeper did it, so this asserts the outcome.
    await queue.requeueStale(300);
    const [again] = await queue.claim(1, [PROBE_KIND]);
    assert.equal(again?.id, id, 'the orphaned job was never picked up again');
    await queue.complete(id);
  } finally {
    await client.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// LAB-05 -- workspaces
// ---------------------------------------------------------------------------

test('LAB-05 a snapshot restores the exact file tree it captured', async () => {
  const created = await api<{ id: number }>('/api/onyx/workspaces', {
    token: w.alpha.s1,
    body: {
      title: 'Term project', language: 'python', entry_path: 'main.py',
      course_id: w.course,
    },
  });
  assert.equal(created.ok, true, created.message);
  w.workspace = Number(created.data.id);

  await api('/api/onyx/workspaces/' + w.workspace + '/files', {
    token: w.alpha.s1, method: 'PUT',
    body: {
      files: [
        { path: 'main.py', content: 'print("v1")' },
        { path: 'lib/util.py', content: 'X = 1' },
      ],
    },
  });

  const snapshot = await api<{ id: number; file_count: number }>(
    '/api/onyx/workspaces/' + w.workspace + '/snapshots',
    { token: w.alpha.s1, body: { label: 'Working version' } });
  assert.equal(snapshot.ok, true, snapshot.message);
  assert.equal(snapshot.data.file_count, 2);
  w.snapshot = Number(snapshot.data.id);

  // Edit, add, delete.
  await api('/api/onyx/workspaces/' + w.workspace + '/files', {
    token: w.alpha.s1, method: 'PUT',
    body: {
      files: [
        { path: 'main.py', content: 'print("v2")' },
        { path: 'extra.py', content: 'added later' },
      ],
    },
  });
  await api('/api/onyx/workspaces/' + w.workspace + '/files?path=lib/util.py',
    { token: w.alpha.s1, method: 'DELETE' });

  const restored = await api<{ path: string; content: string }[]>(
    '/api/onyx/workspaces/' + w.workspace + '/restore/' + w.snapshot,
    { token: w.alpha.s1, method: 'POST' });
  assert.equal(restored.ok, true, restored.message);

  // Exactly: the edit is undone, the deletion is undone, and the addition is
  // gone. A restore that only overwrote would leave extra.py behind.
  assert.deepEqual(restored.data.map((f) => f.path).sort(), ['lib/util.py', 'main.py']);
  assert.equal(restored.data.find((f) => f.path === 'main.py')!.content, 'print("v1")');
  assert.equal(restored.data.find((f) => f.path === 'lib/util.py')!.content, 'X = 1');
});

test('LAB-05 a mentor reviews through the course, and never by editing', async () => {
  const opened = await api<{ can_review: boolean }>('/api/onyx/workspaces/' + w.workspace,
    { token: w.alpha.faculty });
  assert.equal(opened.ok, true, opened.message);
  assert.equal(opened.data.can_review, true);

  const comment = await api('/api/onyx/workspaces/' + w.workspace + '/comments', {
    token: w.alpha.faculty,
    body: { body: 'Consider a dictionary here.', file_path: 'main.py', line: 1 },
  });
  assert.equal(comment.ok, true, comment.message);

  // Reviewing is commenting. Nobody edits somebody else's project.
  const edited = await api('/api/onyx/workspaces/' + w.workspace + '/files', {
    token: w.alpha.faculty, method: 'PUT',
    body: { files: [{ path: 'main.py', content: 'hijacked' }] },
  });
  assert.equal(edited.status, 403, 'a mentor rewrote a learner\'s project');

  // Another learner reaches neither.
  assert.equal((await api('/api/onyx/workspaces/' + w.workspace,
    { token: w.alpha.s2 })).status, 403);

  // A workspace with no course is private even to faculty.
  const priv = await api<{ id: number }>('/api/onyx/workspaces',
    { token: w.alpha.s1, body: { title: 'Private', entry_path: 'main.py' } });
  assert.equal((await api('/api/onyx/workspaces/' + priv.data.id,
    { token: w.alpha.faculty })).status, 403);

  const listed = await api<{ id: number }[]>('/api/onyx/courses/' + w.course + '/workspaces',
    { token: w.alpha.faculty });
  assert.equal(listed.data.some((x) => Number(x.id) === w.workspace), true);
  assert.equal(listed.data.some((x) => Number(x.id) === Number(priv.data.id)), false,
    'a private workspace appeared in the mentor list');
});

test('LAB-05 a path cannot climb out of its workspace', async () => {
  const saved = await api<{ path: string }[]>('/api/onyx/workspaces/' + w.workspace + '/files', {
    token: w.alpha.s1, method: 'PUT',
    body: { files: [{ path: '../../escaped.py', content: 'nope' }] },
  });
  assert.equal(saved.ok, true, saved.message);
  // Stored flattened, inside the workspace, rather than refused -- a learner
  // typing a path with dots in it is not an attacker.
  assert.equal(saved.data.some((f) => f.path === 'escaped.py'), true, JSON.stringify(saved.data));
  assert.equal(saved.data.some((f) => f.path.includes('..')), false, 'a traversal was stored');
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

test('nothing added in O03 crosses between institutions', async () => {
  const reads = [
    '/api/onyx/problems/' + w.problem,
    '/api/onyx/problems/' + w.problem + '/attempts',
    '/api/onyx/workspaces/' + w.workspace,
    '/api/onyx/courses/' + w.course + '/workspaces',
  ];
  for (const path of reads) {
    const res = await api(path, { token: w.beta.admin });
    assert.ok(res.status === 404 || res.status === 403,
      'beta reached ' + path + ' (' + res.status + ')');
  }

  const writes: [string, unknown][] = [
    ['/api/onyx/problems/' + w.problem + '/publish', {}],
    ['/api/onyx/problems/' + w.problem + '/hint', {}],
    ['/api/onyx/problems/' + w.problem + '/submit', { language: 'python', source: 'x' }],
    ['/api/onyx/workspaces/' + w.workspace + '/snapshots', { label: 'theirs' }],
    ['/api/onyx/workspaces/' + w.workspace + '/comments', { body: 'theirs' }],
  ];
  for (const [path, body] of writes) {
    const res = await api(path, { token: w.beta.admin, body });
    assert.ok(res.status === 404 || res.status === 403 || res.status === 503,
      'beta wrote to ' + path + ' (' + res.status + ')');
  }

  // Beta's own queue view shows Beta's jobs only.
  const stats = await api<{ count: number }[]>('/api/onyx/queue', { token: w.beta.admin });
  assert.equal(stats.ok, true, stats.message);
  assert.equal(stats.data.reduce((t, s) => t + s.count, 0), 0,
    'beta saw another institution\'s queue');
});

test('RLS confines the O03 tables at the database', async () => {
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
    const { env } = await import('./harness.ts');
    process.env[k] ??= env[k];
  }
  const { onyxTenantClient } = await import('@onyx/core');
  const learner = onyxTenantClient(w.alpha.s1);
  const rival = onyxTenantClient(w.beta.admin);

  // A published problem is readable inside the institution.
  const { data: problems } = await learner.from('onyx_problems').select('id, tenant_id');
  assert.ok(problems!.length > 0, 'RLS hid the caller\'s own problem bank');
  for (const p of problems!) assert.equal(Number(p.tenant_id), w.alpha.id);
  assert.equal((await rival.from('onyx_problems').select('id')).data?.length ?? 0, 0,
    'another institution read the problem bank');

  // The answer key, the hints and the queue have no read policy at all.
  for (const table of ['onyx_problem_tests', 'onyx_hints', 'onyx_jobs', 'onyx_submission_cases'] as const) {
    const { data } = await learner.from(table).select('id');
    assert.equal(data?.length ?? 0, 0, table + ' is readable through PostgREST');
  }

  // Submissions and workspaces are the caller's own.
  const { data: mine } = await learner.from('onyx_code_submissions').select('user_id');
  for (const s of mine!) assert.equal(s.user_id, w.ids.s1);
  assert.equal((await onyxTenantClient(w.alpha.s2)
    .from('onyx_workspaces').select('id')).data?.length ?? 0, 0,
    'one learner read another\'s workspaces');

  // And a tenant token cannot write.
  const { error } = await learner.from('onyx_hint_reveals')
    .insert({ tenant_id: w.alpha.id, hint_id: 1, problem_id: w.problem, user_id: w.ids.s1 });
  assert.ok(error, 'a tenant token wrote to onyx_hint_reveals');
});

test('every O03 table is tenant-scoped, and cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    const { rows: missing } = await c.query('SELECT * FROM onyx.assert_tenant_scoped()');
    assert.equal(missing.length, 0,
      'Onyx tables with no tenant_id: ' + missing.map((r) => r.missing).join(', '));

    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = ANY($1)', [[A.slug, B.slug]]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['cl.%.' + RUN + '@onyx.test']);

    for (const table of [
      'onyx_jobs', 'onyx_problems', 'onyx_problem_tests', 'onyx_hints', 'onyx_hint_reveals',
      'onyx_code_submissions', 'onyx_submission_cases',
      'onyx_workspaces', 'onyx_workspace_files', 'onyx_workspace_snapshots',
      'onyx_workspace_comments',
    ]) {
      const { rows: [left] } = await c.query(
        'SELECT count(*)::int c FROM public."' + table + '" t '
        + 'LEFT JOIN public."onyx_tenants" n ON n.id = t.tenant_id WHERE n.id IS NULL');
      assert.equal(left.c, 0, table + ' outlived its institution');
    }
  });
});
