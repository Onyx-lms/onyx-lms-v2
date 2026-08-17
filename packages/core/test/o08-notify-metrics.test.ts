/**
 * The notification channel and the metrics behind SCL-03's alerts.
 *
 * Both are the kind of code that fails silently by design -- notifying never
 * throws, and a counter that is not incremented looks exactly like a quiet
 * afternoon. So the assertions here are the ones an end-to-end test cannot
 * make: that a failure is *swallowed and counted* rather than raised, and that
 * the text `/metrics` emits is the format a scraper will actually parse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NotifyService } from '../src/onyx/notify.service.ts';
import { increment, observe, renderMetrics, resetMetrics, health } from '../src/onyx/metrics.ts';
import { FakeDb } from './fake-db.ts';

const T = 1;

function world(opts: { mail?: { send: (m: unknown) => Promise<unknown> } } = {}) {
  const db = new FakeDb({ onyx_notifications: [] });
  const errors: string[] = [];
  const notify = new NotifyService(db as never, {
    mail: opts.mail ?? null,
    onError: (m) => errors.push(m),
    now: () => 1_800_000_000_000,
  });
  return { db, notify, errors };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test('a notification is written, and comes back in that person\'s inbox', async () => {
  const { notify } = world();
  await notify.notify(T, {
    userId: 10, kind: 'membership.invited',
    title: 'You have been added', link: '/onyx/dashboard',
  });

  const inbox = await notify.inbox(T, 10);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]!.kind, 'membership.invited');
  assert.equal(inbox[0]!.link, '/onyx/dashboard');
  assert.equal(inbox[0]!.read_at, null);
});

test('an inbox is one person\'s, never anybody else\'s', async () => {
  const { notify } = world();
  await notify.notify(T, { userId: 10, kind: 'ticket.assigned', title: 'Yours' });
  await notify.notify(T, { userId: 11, kind: 'ticket.assigned', title: 'Theirs' });

  assert.deepEqual((await notify.inbox(T, 10)).map((n) => n.title), ['Yours']);
  assert.equal(await notify.unreadCount(T, 10), 1);
  assert.equal(await notify.unreadCount(T, 11), 1);
});

test('marking read clears the badge, and only the caller\'s own', async () => {
  const { notify } = world();
  await notify.notify(T, { userId: 10, kind: 'results.published', title: 'A' });
  await notify.notify(T, { userId: 10, kind: 'results.published', title: 'B' });
  await notify.notify(T, { userId: 11, kind: 'results.published', title: 'C' });

  await notify.markRead(T, 10);
  assert.equal(await notify.unreadCount(T, 10), 0);
  // Somebody else clearing theirs must not clear yours.
  assert.equal(await notify.unreadCount(T, 11), 1);
});

test('a write that fails is reported, not thrown', async () => {
  // The rule this shares with AuditService: the row describes work that has
  // already happened, so raising here would roll back the thing being
  // announced. A ticket that was assigned is assigned either way.
  const { notify, errors } = world();
  const broken = new NotifyService({
    from: () => { throw new Error('database is gone'); },
  } as never, { onError: (m) => errors.push(m) });

  const result = await broken.notify(T, {
    userId: 10, kind: 'ticket.assigned', title: 'Still assigned',
  });

  assert.equal(result, null, 'a failed notification should report null, not throw');
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /notification write failed/);
  void notify;
});

test('email is a copy: a mailer that throws costs the copy, not the notification', async () => {
  const errors: string[] = [];
  const notify = new NotifyService(new FakeDb({ onyx_notifications: [] }) as never, {
    mail: { send: async () => { throw new Error('smtp refused'); } },
    onError: (m) => errors.push(m),
  });

  const row = await notify.notify(T, {
    userId: 10, kind: 'membership.invited', title: 'Welcome',
    email: { to: 'someone@example.test' },
  });

  assert.ok(row, 'the notification itself should still exist');
  assert.equal((await notify.inbox(T, 10)).length, 1);
  assert.match(errors.join(' '), /notification email failed/);
});

test('no email address means no attempt, and no failure', async () => {
  let sends = 0;
  const notify = new NotifyService(new FakeDb({ onyx_notifications: [] }) as never, {
    mail: { send: async () => { sends += 1; return { sent: true }; } },
  });
  await notify.notify(T, { userId: 10, kind: 'ticket.assigned', title: 'No address' });
  assert.equal(sends, 0);
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

test('counters render in the format a scraper parses', () => {
  resetMetrics();
  increment('onyx_grading_runs_total', undefined, 3);
  increment('onyx_grading_failures_total');
  increment('onyx_payments_total', { gateway: 'razorpay', replayed: 'false' });

  const text = renderMetrics();
  assert.match(text, /# TYPE onyx_grading_runs_total counter/);
  assert.match(text, /^onyx_grading_runs_total 3$/m);
  assert.match(text, /^onyx_grading_failures_total 1$/m);
  // Labels sorted, so the same series always renders the same way.
  assert.match(text, /^onyx_payments_total\{gateway="razorpay",replayed="false"\} 1$/m);
  // Every counter carries a HELP line: it is what somebody reading a dashboard
  // at 3am uses to decide whether the number matters.
  assert.match(text, /# HELP onyx_grading_failures_total .*Alert/);
});

test('a histogram is cumulative, which is what Prometheus expects', () => {
  resetMetrics();
  observe('onyx_http_duration_ms', 30, { route: '/x' });
  observe('onyx_http_duration_ms', 300, { route: '/x' });
  observe('onyx_http_duration_ms', 90_000, { route: '/x' });

  const text = renderMetrics();
  // 30ms falls in the first bucket, and every wider bucket must include it.
  assert.match(text, /onyx_http_duration_ms_bucket\{route="\/x",le="50"\} 1/);
  assert.match(text, /onyx_http_duration_ms_bucket\{route="\/x",le="500"\} 2/);
  assert.match(text, /onyx_http_duration_ms_bucket\{route="\/x",le="\+Inf"\} 3/);
  assert.match(text, /onyx_http_duration_ms_count\{route="\/x"\} 3/);
  assert.match(text, /onyx_http_duration_ms_sum\{route="\/x"\} 90330/);
});

test('a label cannot break the line protocol', () => {
  resetMetrics();
  // A gateway identifier is caller-influenced; a quote or a newline in a label
  // would produce a line no scraper can read.
  increment('onyx_payments_total', { gateway: 'ev"il\nthing' });
  const text = renderMetrics();
  assert.doesNotMatch(text, /ev"il/);
  assert.equal(text.split('\n').filter((l) => l.startsWith('onyx_payments_total')).length, 1);
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

test('health is up only when every probe passes', async () => {
  const ok = await health([{ name: 'database', run: async () => 'fine' }]);
  assert.equal(ok.status, 'up');
  assert.equal(ok.checks[0]!.ok, true);

  const bad = await health([
    { name: 'database', run: async () => { throw new Error('connection refused'); } },
  ]);
  // Degraded, never "down": a process cannot report its own death, and a load
  // balancer wants the difference.
  assert.equal(bad.status, 'degraded');
  assert.equal(bad.checks[0]!.ok, false);
  assert.match(bad.checks[0]!.detail!, /connection refused/);
});
