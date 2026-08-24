/**
 * Onyx O06 unit tests -- Onyx Learn engagement.
 *
 * The claims worth checking without a database: a nudge always changes when
 * its signal does (nothing here is cached), a streak counts today-or-yesterday
 * but never both, a vote is a person not a number, only the asker or staff can
 * mark an answer, and an escalation cannot be raised twice for the same
 * thread.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import { AuditService } from '../src/onyx/audit.service.ts';
import { EngageService } from '../src/onyx/engage.service.ts';
import { SupportService, SLA_MINUTES } from '../src/onyx/support.service.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const START = 1_800_000_000_000; // a Wednesday
const DAY = 86_400_000;

function clock(at = START) {
  let t = at;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function world(c = clock()) {
  const db = new FakeDb({
    onyx_tenants: [{ id: T, name: 'Engage University', slug: 'engage', status: 1 }],
    onyx_users: [
      { id: 'user-10', name: 'Ada', email: 'ada@onyx.test' },
      { id: 'user-11', name: 'Grace', email: 'grace@onyx.test' },
      { id: 'user-20', name: 'Faculty', email: 'faculty@onyx.test' },
    ],
    onyx_memberships: [
      { id: 1, tenant_id: T, user_id: 'user-10', role: 'student', status: 1 },
      { id: 2, tenant_id: T, user_id: 'user-11', role: 'student', status: 1 },
      { id: 3, tenant_id: T, user_id: 'user-20', role: 'faculty', status: 1 },
    ],
    onyx_programs: [{ id: 1, tenant_id: T, name: 'CS', code: 'CS' }],
    onyx_courses: [
      { id: 1, tenant_id: T, code: 'CS101', title: 'Programming', slug: 'p', status: 1 },
    ],
    onyx_enrollments: [{ id: 1, tenant_id: T, course_id: 1, user_id: 'user-10', status: 1 }],
    onyx_lessons: [], onyx_lesson_progress: [],
    onyx_assignments: [], onyx_assignment_submissions: [],
    onyx_attendance_sessions: [], onyx_attendance_records: [],
    onyx_code_submissions: [],
    onyx_discussions: [], onyx_discussion_posts: [], onyx_discussion_mentions: [],
    onyx_tickets: [], onyx_ticket_events: [],
    onyx_audit_logs: [],
  });
  const audit = new AuditService(db, () => {});
  const academics = new AcademicsService(db);
  const engage = new EngageService(db, academics, audit, c.now);
  const support = new SupportService(db, audit, c.now);
  return { db, academics, engage, support, c };
}

const student = { userId: 'user-10', role: 'student' as const };
const other = { userId: 'user-11', role: 'student' as const };
const faculty = { userId: 'user-20', role: 'faculty' as const };

// ---------------------------------------------------------------------------
// LRN-05: progress and nudges
// ---------------------------------------------------------------------------

test('LRN-05 an enrolled learner with no activity is nudged toward the catalogue only if unenrolled, otherwise to continue', async () => {
  const { engage } = world();
  const summary = await engage.summary(T, 'user-10');
  assert.equal(summary.courses.enrolled, 1);
  // Nothing completed yet -- the streak nudge fires, not the enrol nudge.
  assert.ok(summary.nudges.some((n) => n.kind === 'streak'));
});

test('LRN-05 a learner enrolled in nothing is told to enrol, and nothing else', async () => {
  const { engage } = world();
  const summary = await engage.summary(T, 'user-11'); // not enrolled anywhere
  assert.equal(summary.nudges.length, 1);
  assert.equal(summary.nudges[0]?.kind, 'enrol');
});

test('LRN-05 an overdue assignment produces a high-urgency nudge naming it', async () => {
  const { db, engage, c } = world();
  db.tables.onyx_assignments = [{
    id: 1, tenant_id: T, course_id: 1, title: 'Essay', status: 'published',
    due_at: new Date(c.now() - DAY).toISOString(),
  }];
  const summary = await engage.summary(T, 'user-10');
  const nudge = summary.nudges.find((n) => n.kind === 'assignment-overdue');
  assert.ok(nudge, 'expected an overdue nudge');
  assert.equal(nudge!.urgency, 'high');
  assert.match(nudge!.message, /Essay/);
});

test('LRN-05 the nudge changes when the signal changes -- nothing is cached', async () => {
  const { db, engage, c } = world();
  db.tables.onyx_assignments = [{
    id: 1, tenant_id: T, course_id: 1, title: 'Essay', status: 'published',
    due_at: new Date(c.now() - DAY).toISOString(),
  }];
  const before = await engage.summary(T, 'user-10');
  assert.ok(before.nudges.some((n) => n.kind === 'assignment-overdue'));

  // Submitting is the signal. Re-reading the summary must reflect it without
  // anything being invalidated on purpose -- there is nothing to invalidate.
  db.tables.onyx_assignment_submissions = [{
    id: 1, tenant_id: T, assignment_id: 1, user_id: 'user-10',
    submitted_at: new Date(c.now()).toISOString(),
  }];
  const after = await engage.summary(T, 'user-10');
  assert.equal(after.nudges.some((n) => n.kind === 'assignment-overdue'), false);
});

test('LRN-05 a streak counts today or yesterday, never requires both', async () => {
  const { db, engage, c } = world();
  // Active yesterday, nothing today yet -- still an unbroken streak.
  db.tables.onyx_lesson_progress = [
    { id: 1, tenant_id: T, user_id: 'user-10', lesson_id: 1, completed_at: new Date(c.now() - DAY).toISOString() },
  ];
  const summary = await engage.summary(T, 'user-10');
  assert.equal(summary.streak.current, 1);
  assert.equal(summary.streak.active_today, false);
});

test('LRN-05 a gap of one day breaks the streak', async () => {
  const { db, engage, c } = world();
  db.tables.onyx_lesson_progress = [
    { id: 1, tenant_id: T, user_id: 'user-10', lesson_id: 1, completed_at: new Date(c.now() - 3 * DAY).toISOString() },
  ];
  const summary = await engage.summary(T, 'user-10');
  assert.equal(summary.streak.current, 0);
  assert.equal(summary.streak.longest, 1);
});

test('LRN-05 low attendance produces a warning nudge with no href to click', async () => {
  const { db, engage } = world();
  db.tables.onyx_attendance_sessions = [1, 2, 3, 4].map((n) => (
    { id: n, tenant_id: T, course_id: 1 }));
  db.tables.onyx_attendance_records = [1, 2, 3, 4].map((n) => (
    { id: n, tenant_id: T, session_id: n, user_id: 'user-10', status: n <= 2 ? 'present' : 'absent' }));
  const summary = await engage.summary(T, 'user-10');
  const nudge = summary.nudges.find((n) => n.kind === 'attendance-low');
  assert.ok(nudge, 'expected an attendance nudge at 50%');
  assert.equal(nudge!.href, null);
});

// ---------------------------------------------------------------------------
// LRN-06a: discussion
// ---------------------------------------------------------------------------

test('LRN-06a a learner not enrolled cannot ask in the course', async () => {
  const { engage } = world();
  await assert.rejects(
    () => engage.ask(T, 1, other, { title: 'Help please', body: 'stuck on loops' }),
    (e: unknown) => e instanceof HttpError && e.status === 403);
});

test('LRN-06a asking, replying, and the reply count staying in sync', async () => {
  const { engage } = world();
  const q = await engage.ask(T, 1, student, { title: 'Why does this loop forever?', body: 'help' });
  assert.equal(q.reply_count, 0);

  await engage.reply(T, Number(q.id), faculty, { body: 'Check your increment.' });
  const thread = await engage.discussion(T, Number(q.id), student);
  assert.equal(thread.reply_count, 1);
  assert.equal(thread.posts.length, 1);
});

test('LRN-06a a vote is a person, not a counter -- voting twice removes it', async () => {
  const { engage } = world();
  const q = await engage.ask(T, 1, student, { title: 'A question', body: 'b' });
  const reply = await engage.reply(T, Number(q.id), faculty, { body: 'answer' });

  const first = await engage.vote(T, Number(reply.id), 'user-10', 'student');
  assert.deepEqual(first, { votes: 1, voted: true });
  const second = await engage.vote(T, Number(reply.id), 'user-10', 'student');
  assert.deepEqual(second, { votes: 0, voted: false });
});

test('LRN-06a a resolved thread stays visible and searchable, not hidden', async () => {
  const { engage } = world();
  const q = await engage.ask(T, 1, student, { title: 'Loop question', body: 'stuck' });
  const reply = await engage.reply(T, Number(q.id), faculty, { body: 'try this' });
  await engage.resolve(T, Number(q.id), Number(reply.id), student);

  const resolved = await engage.discussions(T, 1, student, { status: 'resolved' });
  assert.equal(resolved.length, 1);
  const found = await engage.discussions(T, 1, student, { q: 'Loop' });
  assert.equal(found.length, 1, 'a resolved thread must still be searchable');
});

test('LRN-06a only the asker or staff may mark an answer, not a third learner', async () => {
  const { engage } = world();
  const q = await engage.ask(T, 1, student, { title: 'A question', body: 'b' });
  const reply = await engage.reply(T, Number(q.id), faculty, { body: 'a' });
  await assert.rejects(
    () => engage.resolve(T, Number(q.id), Number(reply.id), other),
    (e: unknown) => e instanceof HttpError && e.status === 403);
});

test('LRN-06a a closed thread refuses new replies', async () => {
  const { db, engage } = world();
  const q = await engage.ask(T, 1, student, { title: 'A question', body: 'b' });
  await db.from('onyx_discussions').update({ status: 'closed' }).eq('id', Number(q.id));
  await assert.rejects(
    () => engage.reply(T, Number(q.id), student, { body: 'still stuck' }),
    (e: unknown) => e instanceof HttpError && e.status === 409);
});

// ---------------------------------------------------------------------------
// LRN-06b: escalation and SLA
// ---------------------------------------------------------------------------

test('LRN-06b escalating stamps the SLA for the priority, and the thread keeps its replies', async () => {
  const { engage, support } = world();
  const q = await engage.ask(T, 1, student, { title: 'Still stuck', body: 'b' });
  const ticket = await support.escalate(T, Number(q.id), 'user-10');
  assert.equal(ticket.priority, 'high');
  assert.equal(ticket.sla_minutes, SLA_MINUTES.high);

  const thread = await engage.discussion(T, Number(q.id), student);
  assert.equal(thread.status, 'open', 'escalating must not close or move the thread');
});

test('LRN-06b escalating the same thread twice is refused, not duplicated', async () => {
  const { engage, support } = world();
  const q = await engage.ask(T, 1, student, { title: 'A question', body: 'b' });
  await support.escalate(T, Number(q.id), 'user-10');
  await assert.rejects(
    () => support.escalate(T, Number(q.id), 'user-10'),
    (e: unknown) => e instanceof HttpError && e.status === 409);
});

test('LRN-06b an escalated question cannot be re-escalated once already answered', async () => {
  const { engage, support } = world();
  const q = await engage.ask(T, 1, student, { title: 'A question', body: 'b' });
  const reply = await engage.reply(T, Number(q.id), faculty, { body: 'a' });
  await engage.resolve(T, Number(q.id), Number(reply.id), student);
  await assert.rejects(
    () => support.escalate(T, Number(q.id), 'user-10'),
    (e: unknown) => e instanceof HttpError && e.status === 409);
});

test('LRN-06b the unowned queue lists tickets with no owner first, by how close to breach', async () => {
  const { support, c } = world();
  const a = await support.raise(T, 'user-10', { subject: 'Ticket A', body: 'b', priority: 'low' });
  c.advance(1000);
  const b = await support.raise(T, 'user-11', { subject: 'Ticket B', body: 'b', priority: 'urgent' });
  const queue = await support.queue(T, faculty, {});
  assert.equal(queue[0]!.id, Number(b.id), 'the more urgent unowned ticket sorts first');
  assert.ok(queue.every((t) => t.owner_id === null));
  void a;
});

test('LRN-06b claiming a ticket names an owner, and a learner cannot claim one', async () => {
  const { support } = world();
  const ticket = await support.raise(T, 'user-10', { subject: 'A question', body: 'b' });
  await assert.rejects(
    () => support.claim(T, Number(ticket.id), student),
    (e: unknown) => e instanceof HttpError && e.status === 403);

  const claimed = await support.claim(T, Number(ticket.id), faculty);
  assert.equal(claimed!.owner_id, 'user-20');
  assert.equal(claimed!.status, 'assigned');
});

test('LRN-06b a ticket cannot be assigned to a learner -- only a mentor may own one', async () => {
  const { support } = world();
  const ticket = await support.raise(T, 'user-10', { subject: 'A question', body: 'b' });
  await assert.rejects(
    () => support.assign(T, Number(ticket.id), 'user-11', faculty),
    (e: unknown) => e instanceof HttpError && e.status === 422);
});

test('LRN-06b reopening does not reset the SLA clock', async () => {
  const { support, c } = world();
  const ticket = await support.raise(T, 'user-10', { subject: 'Urgent Q', body: 'b', priority: 'urgent' });
  const createdAt = ticket.created_at;
  await support.resolve(T, Number(ticket.id), student);
  c.advance(10 * 60_000);
  const reopened = await support.reopen(T, Number(ticket.id), student);
  assert.equal(reopened!.created_at, createdAt, 'the original raise time is untouched');
  assert.equal(reopened!.due_at, ticket.due_at, 'the promised deadline does not move');
});

test('LRN-06b breaches lists only what has passed its due_at and is still open', async () => {
  const { support, c } = world();
  const urgent = await support.raise(T, 'user-10', { subject: 'Urgent ticket', body: 'b', priority: 'urgent' });
  c.advance(SLA_MINUTES.urgent * 60_000 + 60_000); // past the two-hour SLA
  const { breached, unowned } = await support.breaches(T, faculty);
  assert.equal(breached.length, 1);
  assert.equal(breached[0]!.id, Number(urgent.id));
  assert.equal(unowned, 1);
});

test('LRN-06b a learner cannot see the mentor breach report', async () => {
  const { support } = world();
  await assert.rejects(
    () => support.breaches(T, student),
    (e: unknown) => e instanceof HttpError && e.status === 403);
});

test('LRN-06b a learner asking for their tickets never sees another learner\'s', async () => {
  const { support } = world();
  await support.raise(T, 'user-10', { subject: 'My ticket', body: 'b' });
  await support.raise(T, 'user-11', { subject: 'Not mine ticket', body: 'b' });
  const mine = await support.queue(T, student, {});
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.subject, 'My ticket');
});

test('LRN-06b the answer reaches the learner who asked, and the staff notes do not', async () => {
  /*
   * The defect this exists for was silent and complete.
   *
   * A learner's view stripped the note off EVERY event, which is right for the
   * notes staff write to each other and exactly wrong for the one event whose
   * whole purpose is to be read by the person who asked. So a learner watched
   * their ticket turn from "open" to "answered" and never saw the answer:
   * staff wrote a reply into the void and the queue reported it delivered.
   */
  const { support } = world();
  const raised = await support.raise(T, student.userId, {
    subject: 'My video will not play', body: 'It sits at nought per cent.',
  });
  const id = Number(raised.id);

  await support.respond(T, id, faculty, 'Re-encoded — try it again.');
  // A note between staff, which the learner is not party to.
  await support.assign(T, id, faculty.userId, faculty);

  const theirs = await support.ticket(T, id, student);
  const answer = theirs.events.find((e) => e.kind === 'responded');
  assert.equal(answer?.note, 'Re-encoded — try it again.',
    'the reply never reached the person who asked');

  for (const e of theirs.events) {
    if (e.kind === 'responded') continue;
    assert.equal(e.note, null, 'a staff note leaked to the learner: ' + e.kind);
  }

  // Staff still see the whole trail.
  const staff = await support.ticket(T, id, faculty);
  assert.ok(staff.events.length >= theirs.events.length);
});

test('LRN-06b the queue carries the question, not only its subject', async () => {
  // Somebody deciding whether they can answer has to read the problem. The
  // queue returned a title and nothing else, so any screen listing tickets
  // showed a subject line with an empty space under it.
  const { support } = world();
  await support.raise(T, student.userId, {
    subject: 'My video will not play', body: 'It sits at nought per cent.',
  });
  const queue = await support.queue(T, faculty, {});
  assert.equal(queue[0]?.body, 'It sits at nought per cent.');
});
