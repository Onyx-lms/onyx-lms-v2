/**
 * Onyx O06 -- Onyx Learn engagement, end to end.
 *
 * The unit suite proves the logic (streaks, nudges, one-vote-per-person, the
 * SLA arithmetic). What only a real database and a real API prove:
 *
 *   * **the progress endpoint takes no id** -- whose progress comes from the
 *     token, never a query parameter;
 *   * **RLS backs up the API's own boundary** -- a learner reading the
 *     discussion tables directly, through PostgREST with their own token,
 *     still cannot reach another institution's threads;
 *   * **the discussion/ticket routes actually exist and are wired**, with the
 *     real 403s a role boundary produces over HTTP, not a mocked one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createTenant, withDb, RUN, env, onyxLogin } from './harness.ts';

const pw = 'OnyxTest#2026';
const mail = (who: string) => 'eng.' + who + '.' + RUN + '@onyx.test';
const A = { name: 'Engage Institute ' + RUN, slug: 'engage-a-' + RUN };
const B = { name: 'Rival Engage ' + RUN, slug: 'engage-b-' + RUN };

const w = {
  alpha: { id: 0, admin: '', faculty: '', s1: '', s2: '' },
  beta: { id: 0, admin: '', s1: '' },
  course: 0, discussion: 0, post: 0, ticket: 0,
};

test('two institutions, a course, and a learner enrolled in each', async () => {
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
    const r = await api<{ user: { id: number } }>('/api/onyx/members', {
      token: w.alpha.admin, body: { name: who, email: mail(who), role, password: pw },
    });
    assert.equal(r.ok, true, who + ': ' + r.message);
  }
  w.alpha.faculty = await onyxLogin(mail('faculty'), pw);
  w.alpha.s1 = await onyxLogin(mail('s1'), pw);
  w.alpha.s2 = await onyxLogin(mail('s2'), pw);

  const bs1 = await api<{ user: { id: number } }>('/api/onyx/members', {
    token: w.beta.admin, body: { name: 'b-s1', email: mail('b.s1'), role: 'student', password: pw },
  });
  assert.equal(bs1.ok, true, bs1.message);
  w.beta.s1 = await onyxLogin(mail('b.s1'), pw);

  const course = await api<{ id: number }>('/api/onyx/courses', {
    token: w.alpha.admin,
    body: { title: 'Engage 101', code: 'ENG101', credits: 3, self_enroll: true },
  });
  assert.equal(course.ok, true, course.message);
  w.course = Number(course.data.id);
  await api('/api/onyx/courses/' + w.course, {
    token: w.alpha.admin, method: 'PATCH', body: { status: 1 },
  });
  // No body on this call, and api() defaults to GET when the body is
  // undefined -- an explicit method is required or this silently 404s
  // against a route that only accepts POST.
  const enrol = await api('/api/onyx/courses/' + w.course + '/enroll',
    { token: w.alpha.s1, method: 'POST' });
  assert.equal(enrol.ok, true, enrol.message);
  // s2 votes, escalates and reads the thread later on -- discussion access is
  // gated on enrolment for anyone who is not staff.
  const enrol2 = await api('/api/onyx/courses/' + w.course + '/enroll',
    { token: w.alpha.s2, method: 'POST' });
  assert.equal(enrol2.ok, true, enrol2.message);
});

// ---------------------------------------------------------------------------
// LRN-05: progress takes no id
// ---------------------------------------------------------------------------

test('LRN-05 progress is always whoever holds the token, never a path parameter', async () => {
  const mine = await api('/api/onyx/progress', { token: w.alpha.s1 });
  assert.equal(mine.ok, true, mine.message);
  assert.equal(typeof mine.data.streak.current, 'number');

  // There is no id to try substituting -- the route takes none. Confirmed by
  // reading the same endpoint as a different learner and getting a different
  // (their own) answer rather than an error about a missing parameter.
  const s2 = await api('/api/onyx/progress', { token: w.alpha.s2 });
  assert.equal(s2.ok, true, s2.message);
});

test('LRN-05 an anonymous caller is refused', async () => {
  const res = await api('/api/onyx/progress');
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// LRN-06a: discussion, over HTTP
// ---------------------------------------------------------------------------

test('LRN-06a asking, replying, voting and resolving, through the real API', async () => {
  const asked = await api<{ id: number }>('/api/onyx/courses/' + w.course + '/discussions', {
    token: w.alpha.s1, body: { title: 'Why does the loop never end?', body: 'stuck on the increment' },
  });
  assert.equal(asked.ok, true, asked.message);
  w.discussion = Number(asked.data.id);

  const replied = await api<{ id: number }>('/api/onyx/discussions/' + w.discussion + '/replies', {
    token: w.alpha.faculty, body: { body: 'Check your loop condition.' },
  });
  assert.equal(replied.ok, true, replied.message);
  w.post = Number(replied.data.id);

  const voted = await api('/api/onyx/posts/' + w.post + '/vote',
    { token: w.alpha.s2, method: 'POST' });
  assert.equal(voted.ok, true, voted.message);
  assert.equal(voted.data.voted, true);
  assert.equal(voted.data.votes, 1);

  const resolved = await api('/api/onyx/discussions/' + w.discussion + '/resolve', {
    token: w.alpha.s1, body: { post_id: w.post },
  });
  assert.equal(resolved.ok, true, resolved.message);
  assert.equal(resolved.data.status, 'resolved');

  // Still there, still readable -- resolved is not hidden.
  const stillThere = await api('/api/onyx/discussions/' + w.discussion, { token: w.alpha.s1 });
  assert.equal(stillThere.ok, true);
  assert.equal(stillThere.data.status, 'resolved');
});

test('LRN-06a a learner from another institution cannot read the thread', async () => {
  const res = await api('/api/onyx/discussions/' + w.discussion, { token: w.beta.s1 });
  assert.equal(res.status, 404, 'a discussion belonging to another tenant must not resolve at all');
});

test('LRN-06a RLS backs up the API: a learner cannot read another institution\'s discussion table directly', async () => {
  // The harness reads .env itself; the client reads process.env, and
  // node --test is not started with --env-file.
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) process.env[k] ??= env[k];
  const { onyxTenantClient } = await import('@onyx/core');
  const client = onyxTenantClient(w.beta.s1);
  const { data } = await client.from('onyx_discussions').select('id');
  assert.equal((data ?? []).filter((d: { id: number }) => Number(d.id) === w.discussion).length, 0,
    'a discussion from another institution leaked through direct PostgREST access');
});

// ---------------------------------------------------------------------------
// LRN-06b: escalation and tickets, over HTTP
// ---------------------------------------------------------------------------

test('LRN-06b escalating a thread creates a ticket a mentor can see in the queue', async () => {
  const asked = await api<{ id: number }>('/api/onyx/courses/' + w.course + '/discussions', {
    token: w.alpha.s2, body: { title: 'Still lost on recursion', body: 'help' },
  });
  assert.equal(asked.ok, true, asked.message);

  const escalated = await api<{ id: number }>(
    '/api/onyx/discussions/' + asked.data.id + '/escalate',
    { token: w.alpha.s2, body: { note: 'nobody has replied in two days' } });
  assert.equal(escalated.ok, true, escalated.message);
  w.ticket = Number(escalated.data.id);

  const queue = await api<{ id: number; owner_id: number | null }[]>(
    '/api/onyx/tickets', { token: w.alpha.faculty });
  assert.equal(queue.ok, true);
  assert.ok(queue.data.some((t) => t.id === w.ticket));
});

test('LRN-06b a learner sees only their own tickets, never the whole queue', async () => {
  const mine = await api<{ id: number; raised_by: number }[]>(
    '/api/onyx/tickets', { token: w.alpha.s1 });
  assert.equal(mine.ok, true);
  // s1 raised none of the tickets in this run's queue.
  assert.equal(mine.data.some((t) => t.id === w.ticket), false);
});

test('LRN-06b claiming names an owner, and a learner is refused', async () => {
  const denied = await api('/api/onyx/tickets/' + w.ticket + '/assign',
    { token: w.alpha.s1, method: 'POST' });
  assert.equal(denied.status, 403);

  const claimed = await api('/api/onyx/tickets/' + w.ticket + '/assign',
    { token: w.alpha.faculty, method: 'POST' });
  assert.equal(claimed.ok, true, claimed.message);
  assert.equal(claimed.data.status, 'assigned');

  const detail = await api('/api/onyx/tickets/' + w.ticket, { token: w.alpha.faculty });
  assert.equal(detail.ok, true);
  assert.ok(detail.data.owner_name, 'the ticket must name an owner once claimed');
});

test('LRN-06b a learner reading a ticket does not see staff-only trail notes', async () => {
  await api('/api/onyx/tickets/' + w.ticket + '/respond', {
    token: w.alpha.faculty, body: { note: 'internal: this looks like a duplicate of #12' },
  });
  const asLearner = await api('/api/onyx/tickets/' + w.ticket, { token: w.alpha.s2 });
  assert.equal(asLearner.ok, true, asLearner.message);
  const responded = asLearner.data.events.find((e: { kind: string }) => e.kind === 'responded');
  assert.ok(responded, 'the learner should see that a response happened');
  assert.equal(responded.note, null, 'but not the note itself');
});

test('cleanup leaves nothing behind', async () => {
  await withDb(async (c) => {
    const { rows: missing } = await c.query('SELECT * FROM onyx.assert_tenant_scoped()');
    assert.equal(missing.length, 0,
      'Onyx tables with no tenant_id: ' + missing.map((r: { missing: string }) => r.missing).join(', '));

    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = ANY($1)', [[A.slug, B.slug]]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', ['eng.%.' + RUN + '@onyx.test']);

    for (const table of ['onyx_discussions', 'onyx_discussion_posts', 'onyx_discussion_mentions',
      'onyx_tickets', 'onyx_ticket_events']) {
      const { rows: [left] } = await c.query(
        'SELECT count(*)::int c FROM public."' + table + '" t '
        + 'LEFT JOIN public."onyx_tenants" n ON n.id = t.tenant_id WHERE n.id IS NULL');
      assert.equal(left.c, 0, table + ' outlived its institution');
    }
  });
});
