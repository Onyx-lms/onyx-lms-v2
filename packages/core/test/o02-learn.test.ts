/**
 * Onyx O02 unit tests -- Onyx Learn.
 *
 * The E2E proves the flow against the real database. These cover the rules that
 * live in the services: the arithmetic, the deadlines, and the places where a
 * wrong answer would be plausible rather than obviously broken.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AcademicsService } from '../src/onyx/academics.service.ts';
import { ContentService, onyxStorageKey } from '../src/onyx/content.service.ts';
import { AttendanceService } from '../src/onyx/attendance.service.ts';
import { AssignmentsService } from '../src/onyx/assignments.service.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;      // the tenant everything below belongs to
const OTHER = 2;  // a second institution, present to be excluded

const storage = {
  signedUrl: async (path: string) => 'https://signed.example/' + path + '?token=x',
  upload: async (key: string) => key,
};

/**
 * Two institutions, each with a course. The second exists so every "scoped to
 * one tenant" claim has something to fail against.
 */
function world() {
  const db = new FakeDb({
    onyx_programs: [
      { id: 1, tenant_id: T, name: 'BSc Computing', code: 'BSCC', duration_semesters: 6, status: 1 },
      { id: 2, tenant_id: OTHER, name: 'Other Programme', code: 'OTH', duration_semesters: 4, status: 1 },
    ],
    onyx_semesters: [
      { id: 1, tenant_id: T, program_id: 1, name: 'Semester 1', number: 1, status: 1 },
      { id: 2, tenant_id: OTHER, program_id: 2, name: 'Semester 1', number: 1, status: 1 },
    ],
    onyx_batches: [
      { id: 1, tenant_id: T, program_id: 1, name: '2026', code: 'B26', year: 2026, status: 1 },
    ],
    onyx_batch_members: [
      { id: 1, tenant_id: T, batch_id: 1, user_id: 'user-10' },
      { id: 2, tenant_id: T, batch_id: 1, user_id: 'user-11' },
    ],
    onyx_courses: [
      { id: 1, tenant_id: T, program_id: 1, semester_id: 1, code: 'CS101',
        title: 'Programming', slug: 'programming', credits: 4, self_enroll: 0, status: 1 },
      { id: 2, tenant_id: T, program_id: 1, semester_id: 1, code: 'CS102',
        title: 'Open Course', slug: 'open', credits: 2, self_enroll: 1, status: 1 },
      { id: 3, tenant_id: T, program_id: 1, semester_id: 1, code: 'CS103',
        title: 'Unpublished', slug: 'draft', credits: 2, self_enroll: 1, status: 0 },
      { id: 9, tenant_id: OTHER, program_id: 2, semester_id: 2, code: 'X1',
        title: 'Somebody Else', slug: 'else', credits: 3, self_enroll: 1, status: 1 },
    ],
    onyx_course_faculty: [
      { id: 1, tenant_id: T, course_id: 1, user_id: 'user-20' },
    ],
    onyx_enrollments: [
      { id: 1, tenant_id: T, course_id: 1, user_id: 'user-10', batch_id: null, status: 1 },
      { id: 2, tenant_id: T, course_id: 1, user_id: 'user-11', batch_id: null, status: 1 },
    ],
    onyx_modules: [{ id: 1, tenant_id: T, course_id: 1, title: 'Week 1', summary: null, sort: 0 }],
    onyx_lessons: [
      { id: 1, tenant_id: T, course_id: 1, module_id: 1, title: 'Variables', type: 'video',
        path: 'onyx/1/a.mp4', body: null, duration_seconds: 600, sort: 0, is_preview: 0 },
      { id: 2, tenant_id: T, course_id: 1, module_id: 1, title: 'Taster', type: 'video',
        path: 'onyx/1/b.mp4', body: null, duration_seconds: 120, sort: 1, is_preview: 1 },
    ],
    onyx_lesson_progress: [],
    onyx_resources: [
      { id: 1, tenant_id: T, course_id: 1, lesson_id: 1, title: 'Notes',
        path: 'onyx/1/courses/1/notes.pdf', mime: 'application/pdf', size_bytes: 10 },
    ],
    onyx_attendance_sessions: [],
    onyx_attendance_records: [],
    onyx_assignments: [],
    onyx_rubric_criteria: [],
    onyx_assignment_submissions: [],
    onyx_submission_scores: [],
  }, {
    // Matches 0002_learn.sql's onyx_assignment_submissions_unique -- without
    // this the fake cannot reproduce the draft/submit footrace at all.
    onyx_assignment_submissions: [['assignment_id', 'user_id']],
  });
  const academics = new AcademicsService(db as never);
  return {
    db,
    academics,
    content: new ContentService(db as never, academics, storage),
    attendance: (now: () => number = Date.now) =>
      new AttendanceService(db as never, academics, now),
    assignments: (now: () => number = Date.now) =>
      new AssignmentsService(db as never, academics, now),
  };
}

// ---------------------------------------------------------------------------
// LRN-01 -- structure, catalog, enrolment
// ---------------------------------------------------------------------------

test('a course in another institution is not found, not forbidden', async () => {
  const { academics } = world();
  // Course 9 is real. Its existence is simply not this tenant's business.
  await assert.rejects(academics.course(T, 9), (e: HttpError) => e.status === 404);
  await assert.rejects(academics.enroll(T, 9, 'user-10'), (e: HttpError) => e.status === 404);
});

test('a semester outside the programme length is refused', async () => {
  const { academics } = world();
  await assert.rejects(
    academics.createSemester(T, { program_id: 1, name: 'Semester 9', number: 9 }),
    (e: HttpError) => e.status === 422);
  // ...and one inside it is fine.
  const ok = await academics.createSemester(T, { program_id: 1, name: 'Semester 2', number: 2 });
  assert.equal(ok.number, 2);
});

test('a semester cannot end before it starts', async () => {
  const { academics } = world();
  await assert.rejects(academics.createSemester(T, {
    program_id: 1, name: 'Backwards', number: 3,
    starts_on: '2026-09-01', ends_on: '2026-01-01',
  }), (e: HttpError) => e.status === 422);
});

test('a course cannot borrow another programme\'s semester', async () => {
  const { academics } = world();
  await assert.rejects(academics.createCourse(T, 1, {
    code: 'CS999', title: 'Mismatched', program_id: 1, semester_id: 2,
  }), (e: HttpError) => e.status === 404);
});

test('a course starts unpublished', async () => {
  const { academics } = world();
  const course = await academics.createCourse(T, 1, { code: 'CS200', title: 'New Course' });
  // An empty course visible to a cohort is worse than no course at all.
  assert.equal(course.status, 0);
  assert.equal(course.slug, 'new-course');
});

test('self-enrolment is refused unless the course allows it, and never on a draft', async () => {
  const { academics } = world();
  await assert.rejects(academics.selfEnroll(T, 1, 'user-30'), (e: HttpError) => e.status === 403);
  await assert.rejects(academics.selfEnroll(T, 3, 'user-30'), (e: HttpError) => e.status === 403);
  const joined = await academics.selfEnroll(T, 2, 'user-30');
  assert.equal(joined.status, 1);
  // The record says they did it themselves.
  assert.equal(joined.enrolled_by, 'user-30');
});

test('bulk enrolment restores the withdrawn and skips whoever is already there', async () => {
  const { db, academics } = world();
  // Both batch members are in course 1; withdraw one of them.
  await academics.withdraw(T, 1, 'user-11');
  const result = await academics.enrollBatch(T, 1, 1, 'user-99');
  // The withdrawn one is restored -- inserting a second row would violate the
  // unique constraint and take the whole batch down with it.
  assert.deepEqual(result, { enrolled: 1, already: 1 });
  assert.equal((db.tables.onyx_enrollments as Record<string, unknown>[])
    .filter((e) => e.course_id === 1 && e.user_id === 'user-11').length, 1,
    'the withdrawn enrolment was duplicated rather than restored');
  assert.equal((await academics.roster(T, 1)).length, 2);

  // ...and into a course neither of them is in, both are new.
  const fresh = await academics.enrollBatch(T, 2, 1, 'user-99');
  assert.deepEqual(fresh, { enrolled: 2, already: 0 });
  const roster = await academics.roster(T, 2);
  assert.deepEqual(roster.map((r) => r.batch_id), [1, 1], 'the cohort is traceable');

  // Running it again changes nothing.
  assert.deepEqual(await academics.enrollBatch(T, 2, 1, 'user-99'), { enrolled: 0, already: 2 });
});

test('withdrawing keeps the record rather than deleting it', async () => {
  const { db, academics } = world();
  await academics.withdraw(T, 1, 'user-10');
  const row = (db.tables.onyx_enrollments as Record<string, unknown>[])
    .find((e) => e.user_id === 'user-10' && e.course_id === 1);
  // Their attendance and submissions still happened; deleting the enrolment
  // would orphan the record of them.
  assert.ok(row, 'the enrolment row was deleted');
  assert.equal(row!.status, 0);
  await assert.rejects(academics.assertEnrolled(T, 1, 'user-10'), (e: HttpError) => e.status === 403);
});

test('re-enrolling someone withdrawn restores them; enrolling twice does not', async () => {
  const { academics } = world();
  await academics.withdraw(T, 1, 'user-10');
  const restored = await academics.enroll(T, 1, 'user-10');
  assert.equal(restored.status, 1);
  await assert.rejects(academics.enroll(T, 1, 'user-10'), (e: HttpError) => e.status === 422);
});

test('faculty may act on their own courses only; an admin on any', async () => {
  const { academics } = world();
  assert.equal((await academics.assertCanTeach(T, 1, 'user-20', 'faculty')).id, 1);
  await assert.rejects(academics.assertCanTeach(T, 2, 'user-20', 'faculty'),
    (e: HttpError) => e.status === 403);
  // Otherwise "faculty" would be a tenant-wide key to every roster and grade.
  assert.equal((await academics.assertCanTeach(T, 2, 'user-99', 'admin')).id, 2);
});

// ---------------------------------------------------------------------------
// LRN-02 -- content, progress, resources
// ---------------------------------------------------------------------------

test('a lesson with nothing to play is refused at authoring time', async () => {
  const { content } = world();
  await assert.rejects(content.createLesson(T, 1, { title: 'Empty', type: 'video' }),
    (e: HttpError) => e.status === 422);
  await assert.rejects(content.createLesson(T, 1, { title: 'Empty', type: 'text' }),
    (e: HttpError) => e.status === 422);
  await assert.rejects(
    content.createLesson(T, 1, { title: 'Nonsense', type: 'hologram' as never, path: 'x' }),
    (e: HttpError) => e.status === 422);
});

test('a lesson inherits its course from the module', async () => {
  const { content } = world();
  const lesson = await content.createLesson(T, 1, {
    title: 'Loops', type: 'video', path: 'onyx/1/c.mp4',
  });
  // Denormalised so every access check is one read rather than two.
  assert.equal(lesson.course_id, 1);
});

test('an outline hides sources from someone not enrolled, but not the shape', async () => {
  const { content } = world();
  const outsider = await content.outline(T, 1, 'user-999', 'student');
  assert.equal(outsider.enrolled, false);
  const [locked, preview] = outsider.modules[0]!.lessons;
  assert.equal(locked!.locked, true);
  assert.equal(locked!.path, null, 'a locked lesson leaked its source');
  assert.equal(locked!.title, 'Variables', 'the catalog needs the title');
  // A preview lesson is what makes a catalog worth reading.
  assert.equal(preview!.locked, false);
  assert.equal(preview!.path, 'onyx/1/b.mp4');
});

test('exams and placement are not staff for the purpose of course content', async () => {
  const { content } = world();
  // Testing `role === 'student'` instead of naming the staff roles would let
  // both of these read every lesson in the institution.
  for (const role of ['exams', 'placement'] as const) {
    const view = await content.outline(T, 1, 'user-999', role);
    assert.equal(view.enrolled, false, role + ' was treated as enrolled');
    assert.equal(view.modules[0]!.lessons[0]!.locked, true);
    await assert.rejects(content.lesson(T, 1, 'user-999', role), (e: HttpError) => e.status === 403);
  }
  // Faculty and admin do see it.
  assert.equal((await content.outline(T, 1, 'user-20', 'faculty')).enrolled, true);
  assert.equal((await content.outline(T, 1, 'user-99', 'admin')).enrolled, true);
});

test('progress only ever moves forward', async () => {
  const { content } = world();
  await content.recordProgress(T, 1, 'user-10', { position_seconds: 300 });
  const back = await content.recordProgress(T, 1, 'user-10', { position_seconds: 12 });
  // Scrubbing back to check something must not lose the five minutes watched.
  assert.equal(back.position_seconds, 300);
  const on = await content.recordProgress(T, 1, 'user-10', { position_seconds: 480 });
  assert.equal(on.position_seconds, 480);
});

test('completion is sticky and a position past the end is refused', async () => {
  const { content } = world();
  await content.recordProgress(T, 1, 'user-10', { position_seconds: 600, completed: true });
  const again = await content.recordProgress(T, 1, 'user-10', { position_seconds: 5 });
  assert.ok(again.completed_at, 'rewatching un-finished the lesson');
  await assert.rejects(content.recordProgress(T, 1, 'user-10', { position_seconds: 9_999 }),
    (e: HttpError) => e.status === 422);
});

test('someone not enrolled cannot record progress', async () => {
  const { content } = world();
  await assert.rejects(content.recordProgress(T, 1, 'user-999', { position_seconds: 5 }),
    (e: HttpError) => e.status === 403);
});

test('a resource link is issued to the enrolled and refused to everyone else', async () => {
  const { content } = world();
  const issued = await content.resourceUrl(T, 1, 'user-10', 'student');
  assert.match(issued.url, /^https:\/\/signed\.example\//);
  // The acceptance criterion for LRN-02b, checked where the boundary is.
  assert.equal(issued.expires_in, 300);
  await assert.rejects(content.resourceUrl(T, 1, 'user-999', 'student'), (e: HttpError) => e.status === 403);
  // Faculty of a course they do not teach get nothing either.
  await assert.rejects(content.resourceUrl(T, 1, 'user-21', 'faculty'), (e: HttpError) => e.status === 403);
  assert.ok((await content.resourceUrl(T, 1, 'user-20', 'faculty')).url);
});

test('stored keys are namespaced by tenant and never trust the filename', () => {
  const key = onyxStorageKey(7, 3, '../../etc/passwd');
  assert.ok(key.startsWith('onyx/7/courses/3/'), key);
  assert.ok(!key.includes('..'), 'a traversal survived the filename');
  assert.ok(!key.includes('/etc/'), key);
  // Two people uploading "notes.pdf" to the same course must not collide.
  assert.notEqual(onyxStorageKey(7, 3, 'notes.pdf'), 'onyx/7/courses/3/notes.pdf');
});

// ---------------------------------------------------------------------------
// LRN-03 -- attendance
// ---------------------------------------------------------------------------

/** A fixed clock, so a rotating code can be reasoned about. */
function clock(start = 1_800_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

async function withSession(overrides: { duration_minutes?: number } = {}) {
  const w = world();
  const c = clock();
  const attendance = w.attendance(c.now);
  const session = await attendance.createSession(T, 1, 'user-20', {
    title: 'Lecture 1',
    scheduled_at: new Date(c.now()).toISOString(),
    duration_minutes: overrides.duration_minutes ?? 60,
  });
  return { ...w, attendance, session, clock: c };
}

test('a session gets a secret, and the secret never comes back', async () => {
  const { db, session } = await withSession();
  const stored = (db.tables.onyx_attendance_sessions as Record<string, unknown>[])[0]!;
  assert.equal(typeof stored.qr_secret, 'string');
  assert.ok((stored.qr_secret as string).length >= 32);
  // Both the selected columns and the service strip it, so a careless edit to
  // one of them cannot turn into a leaked secret.
  assert.equal((session as Record<string, unknown>).qr_secret, undefined);
});

test('the check-in code rotates, and dies two windows after it appeared', async () => {
  const { attendance, session, clock: c } = await withSession();
  const first = await attendance.currentCode(T, Number(session.id));
  assert.match(first.code, /^[0-9A-F]{8}$/);
  assert.equal(first.window_seconds, 15);

  // Same window, same code.
  c.advance(5_000);
  assert.equal((await attendance.currentCode(T, Number(session.id))).code, first.code);

  // Two windows on, the code is gone. Not one window: the window after the one
  // a code was issued in still accepts it, which is what stops a learner who
  // read the code at the end of a window being refused for arriving a moment
  // late. Thirty seconds is the same life the old 30-second single window gave.
  c.advance(35_000);
  const second = await attendance.currentCode(T, Number(session.id));
  assert.notEqual(second.code, first.code);
  await assert.rejects(attendance.checkIn(T, Number(session.id), 'user-10', first.code),
    (e: HttpError) => e.status === 422);
  const marked = await attendance.checkIn(T, Number(session.id), 'user-10', second.code);
  assert.equal(marked.status, 'present');
});

test('a code read at the end of its window still works just over the boundary', async () => {
  const { attendance, session, clock: c } = await withSession();
  const shown = await attendance.currentCode(T, Number(session.id));

  // Step exactly past the boundary the learner was racing: the projector has
  // rotated, the learner is typing the code they read a second ago.
  c.advance(shown.expires_in_seconds * 1000 + 1_000);
  const rotated = await attendance.currentCode(T, Number(session.id));
  assert.notEqual(rotated.code, shown.code, 'the code did not rotate');

  const marked = await attendance.checkIn(T, Number(session.id), 'user-10', shown.code);
  assert.equal(marked.method, 'qr');
});

test('the countdown says how long the code on screen has left', async () => {
  const { attendance, session, clock: c } = await withSession();
  const at = await attendance.currentCode(T, Number(session.id));
  c.advance(10_000);
  const later = await attendance.currentCode(T, Number(session.id));
  assert.equal(later.expires_in_seconds, at.expires_in_seconds - 10);
});

test('a wrong code, a closed session and a stranger are all refused', async () => {
  const { attendance, session } = await withSession();
  await assert.rejects(attendance.checkIn(T, Number(session.id), 'user-10', 'DEADBEEF'),
    (e: HttpError) => e.status === 422);

  const code = await attendance.currentCode(T, Number(session.id));
  // Not enrolled in this course.
  await assert.rejects(attendance.checkIn(T, Number(session.id), 'user-999', code.code),
    (e: HttpError) => e.status === 403);

  await attendance.closeSession(T, Number(session.id));
  await assert.rejects(attendance.checkIn(T, Number(session.id), 'user-10', code.code),
    (e: HttpError) => e.status === 422);
  await assert.rejects(attendance.currentCode(T, Number(session.id)),
    (e: HttpError) => e.status === 422);
});

test('a second check-in is refused, and the record says who marked it', async () => {
  const { attendance, session } = await withSession();
  const code = await attendance.currentCode(T, Number(session.id));
  const first = await attendance.checkIn(T, Number(session.id), 'user-10', code.code);
  assert.equal(first.method, 'qr');
  // For QR the actor is the learner themselves, and saying so is the difference
  // between a record and an assertion.
  assert.equal(first.marked_by, 'user-10');
  await assert.rejects(attendance.checkIn(T, Number(session.id), 'user-10', code.code),
    (e: HttpError) => e.status === 422);
});

test('checking in late is recorded as late, not as present', async () => {
  const { attendance, session, clock: c } = await withSession({ duration_minutes: 60 });
  // A quarter of an hour into a one-hour session is the grace boundary.
  c.advance(16 * 60_000);
  const code = await attendance.currentCode(T, Number(session.id));
  const record = await attendance.checkIn(T, Number(session.id), 'user-10', code.code);
  assert.equal(record.status, 'late');
});

test('marking the roster refuses a status that is not one, and a learner who is not enrolled', async () => {
  const { attendance, session } = await withSession();
  await assert.rejects(attendance.mark(T, Number(session.id), 'user-20',
    [{ user_id: 'user-10', status: 'maybe' as never }]), (e: HttpError) => e.status === 422);
  await assert.rejects(attendance.mark(T, Number(session.id), 'user-20',
    [{ user_id: 'user-999', status: 'present' }]), (e: HttpError) => e.status === 422);
});

test('marking twice amends rather than duplicating', async () => {
  const { attendance, session } = await withSession();
  const first = await attendance.mark(T, Number(session.id), 'user-20',
    [{ user_id: 'user-10', status: 'absent' }, { user_id: 'user-11', status: 'present' }]);
  assert.deepEqual(first, { created: 2, amended: 0 });

  const second = await attendance.mark(T, Number(session.id), 'user-20',
    [{ user_id: 'user-10', status: 'present', note: 'arrived, was in the wrong room' }]);
  assert.deepEqual(second, { created: 0, amended: 1 });
  const records = await attendance.records(T, Number(session.id));
  assert.equal(records.length, 2);
  assert.equal(records.find((r) => r.user_id === 'user-10')!.status, 'present');
});

test('attendance percentages match a hand calculation', async () => {
  const w = world();
  const c = clock();
  const attendance = w.attendance(c.now);

  // Four sessions. Learner 10: present, present, late, unmarked.
  // Learner 11: present, excused, absent, unmarked.
  const sessions = [];
  for (let i = 0; i < 4; i += 1) {
    c.advance(86_400_000);
    sessions.push(await attendance.createSession(T, 1, 'user-20', {
      title: 'Lecture ' + (i + 1), scheduled_at: new Date(c.now()).toISOString(),
    }));
  }
  const mark = (i: number, entries: { user_id: string; status: string }[]) =>
    attendance.mark(T, Number(sessions[i]!.id), 'user-20', entries as never);

  await mark(0, [{ user_id: 'user-10', status: 'present' }, { user_id: 'user-11', status: 'present' }]);
  await mark(1, [{ user_id: 'user-10', status: 'present' }, { user_id: 'user-11', status: 'excused' }]);
  await mark(2, [{ user_id: 'user-10', status: 'late' }, { user_id: 'user-11', status: 'absent' }]);
  // Session 4 is marked for nobody.

  const analytics = await attendance.courseAnalytics(T, 1, 75);
  const a10 = analytics.learners.find((l) => l.user_id === 'user-10')!;
  const a11 = analytics.learners.find((l) => l.user_id === 'user-11')!;

  // Late counts as attended: 3 of 4 held, none excused.
  assert.equal(a10.attended, 3);
  assert.equal(a10.percent, 75);
  assert.equal(a10.below_threshold, false, '75 is not below a threshold of 75');

  // Excused leaves the denominator: 1 attended of 3 counted. The unmarked
  // fourth session counts against them -- treating it as "no data" would make
  // every figure flattering.
  assert.equal(a11.excused, 1);
  assert.equal(a11.attended, 1);
  assert.equal(a11.percent, 33.3);
  assert.equal(a11.absent, 2);
  assert.equal(a11.below_threshold, true);

  assert.equal(analytics.cohort.below, 1);
  assert.equal(analytics.cohort.percent, 54.2);
});

test('a learner with no sessions at all is not reported as failing', async () => {
  const { attendance } = world();
  const empty = await attendance().courseAnalytics(T, 2, 75);
  assert.deepEqual(empty.learners, []);
  assert.equal(empty.sessions, 0);
});

test('the export gives one row per learner per session, absences included', async () => {
  const { attendance, session } = await withSession();
  await attendance.mark(T, Number(session.id), 'user-20', [{ user_id: 'user-10', status: 'present' }]);
  const rows = await attendance.exportRows(T, 1);
  assert.equal(rows.length, 2, 'two enrolled learners, one session');
  assert.equal(rows.find((r) => r.user_id === 'user-10')!.status, 'present');
  // Consistently with the percentages: unmarked is absent.
  assert.equal(rows.find((r) => r.user_id === 'user-11')!.status, 'absent');
  assert.equal(rows.find((r) => r.user_id === 'user-11')!.method, null);
});

// ---------------------------------------------------------------------------
// LRN-04 -- assignments
// ---------------------------------------------------------------------------

async function withAssignment(overrides: Record<string, unknown> = {}) {
  const w = world();
  const c = clock();
  const assignments = w.assignments(c.now);
  const assignment = await assignments.create(T, 1, 'user-20', {
    title: 'Essay 1',
    total_points: 100,
    due_at: new Date(c.now() + 3_600_000).toISOString(),
    ...overrides,
  });
  return { ...w, assignments, assignment, clock: c };
}

test('an assignment is created as a draft and a draft is invisible to a learner', async () => {
  const { assignments, assignment } = await withAssignment();
  assert.equal(assignment.status, 'draft');
  await assert.rejects(assignments.saveDraft(T, Number(assignment.id), 'user-10', 'x'),
    (e: HttpError) => e.status === 404);
  await assert.rejects(assignments.submit(T, Number(assignment.id), 'user-10', { body: 'x' }),
    (e: HttpError) => e.status === 404);
});

test('a penalty policy needs a penalty, and a percentage has to be one', async () => {
  const { assignments } = world();
  await assert.rejects(
    assignments().create(T, 1, 'user-20', { title: 'x', late_policy: 'penalty' }),
    (e: HttpError) => e.status === 422);
  await assert.rejects(
    assignments().create(T, 1, 'user-20', { title: 'x', late_penalty_percent: 150 }),
    (e: HttpError) => e.status === 422);
  await assert.rejects(
    assignments().create(T, 1, 'user-20', { title: 'x', total_points: 0 }),
    (e: HttpError) => e.status === 422);
});

test('a rubric has to add up to the assignment total', async () => {
  const { assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assert.rejects(assignments.setRubric(T, id, [
    { title: 'Structure', points: 40 }, { title: 'Argument', points: 30 },
  ]), (e: HttpError) => /add up to 70/.test((e as HttpError).message));

  const saved = await assignments.setRubric(T, id, [
    { title: 'Structure', points: 40 }, { title: 'Argument', points: 60 },
  ]);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved.map((c) => c.sort), [0, 1]);
});

test('a rubric is refused empty, with a worthless criterion, or after publishing', async () => {
  const { assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assert.rejects(assignments.setRubric(T, id, []), (e: HttpError) => e.status === 422);
  await assert.rejects(assignments.setRubric(T, id, [{ title: 'Nothing', points: 0 }]),
    (e: HttpError) => e.status === 422);

  await assignments.setRubric(T, id, [{ title: 'All of it', points: 100 }]);
  await assignments.publish(T, id);
  // Changing the weights under work already submitted regrades it silently.
  await assert.rejects(assignments.setRubric(T, id, [{ title: 'Different', points: 100 }]),
    (e: HttpError) => e.status === 422);
});

test('replacing a rubric leaves no orphans behind', async () => {
  const { db, assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assignments.setRubric(T, id, [
    { title: 'A', points: 50 }, { title: 'B', points: 50 },
  ]);
  await assignments.setRubric(T, id, [{ title: 'One', points: 100 }]);
  assert.equal((db.tables.onyx_rubric_criteria as unknown[]).length, 1);
});

test('a draft is saved, restored, and is not a submission', async () => {
  const { assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assignments.publish(T, id);

  await assignments.saveDraft(T, id, 'user-10', 'half an ans');
  await assignments.saveDraft(T, id, 'user-10', 'half an answer');
  const restored = await assignments.mySubmission(T, id, 'user-10');
  assert.equal(restored!.body, 'half an answer');
  // The acceptance criterion is that a dropped connection costs nothing --
  // not that it submits early.
  assert.equal(restored!.status, 'draft');
  assert.ok(!restored!.submitted_at, 'a draft looked submitted');
});

test('a draft-save racing its own submit does not fail with a database error', async () => {
  // Reproduces a real sequence: the browser saves a draft on blur, and
  // clicking Submit blurs the textarea a moment before the click lands, so
  // both requests can reach the service within milliseconds of each other.
  // Both read "no submission yet" before either has written one, and the
  // loser's insert used to surface a raw Postgres unique-violation message on
  // an entirely ordinary click.
  const { db, assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assignments.publish(T, id);

  const [draftResult, submitResult] = await Promise.all([
    assignments.saveDraft(T, id, 'user-10', 'typed just before clicking submit'),
    assignments.submit(T, id, 'user-10', { body: 'typed just before clicking submit' }),
  ]);
  assert.ok(draftResult, 'the draft save threw instead of folding into the submit');
  assert.ok(submitResult, 'the submit threw instead of folding into the draft');

  const final = await assignments.mySubmission(T, id, 'user-10');
  assert.equal(final!.status, 'submitted', 'the race left the submission stuck as a draft');
  assert.equal(final!.body, 'typed just before clicking submit');

  // Exactly one row -- the loser updated the winner's row rather than a
  // second one slipping in under a different identity.
  const rows = (db.tables.onyx_assignment_submissions as { assignment_id: number; user_id: string }[])
    .filter((r) => Number(r.assignment_id) === id && r.user_id === 'user-10');
  assert.equal(rows.length, 1, 'the race produced two submission rows for the same person');
});

test('an empty submission is refused', async () => {
  const { assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assignments.publish(T, id);
  await assert.rejects(assignments.submit(T, id, 'user-10', { body: '   ' }),
    (e: HttpError) => e.status === 422);
});

test('a draft cannot be edited once it has been submitted', async () => {
  const { assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assignments.publish(T, id);
  await assignments.submit(T, id, 'user-10', { body: 'done' });
  await assert.rejects(assignments.saveDraft(T, id, 'user-10', 'sneaky edit'),
    (e: HttpError) => e.status === 422);
});

test('the late policies behave differently, and only at the deadline', async () => {
  for (const [policy, expectation] of [
    ['reject', 'refused'], ['accept', 'flagged'], ['penalty', 'flagged'],
  ] as const) {
    const { assignments, assignment, clock: c } = await withAssignment({
      late_policy: policy,
      late_penalty_percent: policy === 'penalty' ? 10 : 0,
    });
    const id = Number(assignment.id);
    await assignments.publish(T, id);

    const onTime = await assignments.submit(T, id, 'user-10', { body: 'in time' });
    assert.equal(onTime!.is_late, 0, policy + ': flagged late before the deadline');

    c.advance(7_200_000);
    if (expectation === 'refused') {
      await assert.rejects(assignments.submit(T, id, 'user-11', { body: 'too late' }),
        (e: HttpError) => e.status === 422);
    } else {
      const late = await assignments.submit(T, id, 'user-11', { body: 'late' });
      assert.equal(late!.is_late, 1, policy + ': a late submission was not flagged');
    }
  }
});

test('a late penalty is applied once, to the stored score', async () => {
  const { assignments, assignment, clock: c } = await withAssignment({
    late_policy: 'penalty', late_penalty_percent: 10,
  });
  const id = Number(assignment.id);
  await assignments.publish(T, id);
  c.advance(7_200_000);
  await assignments.submit(T, id, 'user-10', { body: 'late work' });

  const [queued] = await assignments.submissions(T, id);
  const graded = await assignments.grade(T, Number(queued!.id), 'user-20', { score: 80 });
  // 80 less 10%, computed here rather than by whatever reads it next.
  assert.equal(Number(graded.score), 72);
});

test('grading by rubric sums the criteria and refuses anything that does not fit', async () => {
  const { assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  const rubric = await assignments.setRubric(T, id, [
    { title: 'Structure', points: 40 }, { title: 'Argument', points: 60 },
  ]);
  await assignments.publish(T, id);
  await assignments.submit(T, id, 'user-10', { body: 'an answer' });
  const [queued] = await assignments.submissions(T, id);
  const sid = Number(queued!.id);

  // Two numbers meant to agree eventually will not, so a bare score is refused.
  await assert.rejects(assignments.grade(T, sid, 'user-20', { score: 90 }),
    (e: HttpError) => e.status === 422);
  await assert.rejects(assignments.grade(T, sid, 'user-20', {
    scores: [{ criterion_id: Number(rubric[0]!.id), points: 41 },
      { criterion_id: Number(rubric[1]!.id), points: 50 }],
  }), (e: HttpError) => e.status === 422);
  await assert.rejects(assignments.grade(T, sid, 'user-20', {
    scores: [{ criterion_id: Number(rubric[0]!.id), points: 10 }],
  }), (e: HttpError) => e.status === 422);
  await assert.rejects(assignments.grade(T, sid, 'user-20', {
    scores: [{ criterion_id: Number(rubric[0]!.id), points: 10 },
      { criterion_id: Number(rubric[0]!.id), points: 10 }],
  }), (e: HttpError) => e.status === 422);
  await assert.rejects(assignments.grade(T, sid, 'user-20', {
    scores: [{ criterion_id: 9_999, points: 10 },
      { criterion_id: Number(rubric[1]!.id), points: 10 }],
  }), (e: HttpError) => e.status === 422);

  const graded = await assignments.grade(T, sid, 'user-20', {
    feedback: 'Solid.',
    scores: [{ criterion_id: Number(rubric[0]!.id), points: 35 },
      { criterion_id: Number(rubric[1]!.id), points: 50 }],
  });
  assert.equal(Number(graded.score), 85);
});

test('a grade is invisible to the learner until it is returned', async () => {
  const { assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assignments.publish(T, id);
  await assignments.submit(T, id, 'user-10', { body: 'an answer' });
  const [queued] = await assignments.submissions(T, id);
  const sid = Number(queued!.id);
  await assignments.grade(T, sid, 'user-20', { score: 91, feedback: 'Good.' });

  const before = await assignments.mySubmission(T, id, 'user-10');
  // A cohort is graded over a week and released at once; a score that leaks the
  // moment it is entered turns marking into a live broadcast.
  assert.equal(before!.score, null);
  assert.equal(before!.feedback, null);
  assert.equal(before!.status, 'submitted', 'the learner could tell it had been graded');

  await assignments.returnToLearner(T, sid);
  const after = await assignments.mySubmission(T, id, 'user-10');
  assert.equal(Number(after!.score), 91);
  assert.equal(after!.feedback, 'Good.');
  assert.equal(after!.status, 'returned');
});

test('returning something that has not been graded is refused', async () => {
  const { assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assignments.publish(T, id);
  await assignments.submit(T, id, 'user-10', { body: 'an answer' });
  const [queued] = await assignments.submissions(T, id);
  await assert.rejects(assignments.returnToLearner(T, Number(queued!.id)),
    (e: HttpError) => e.status === 422);
});

test('resubmission raises the attempt and clears the grade with it', async () => {
  const { db, assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  const rubric = await assignments.setRubric(T, id, [{ title: 'All', points: 100 }]);
  await assignments.publish(T, id);
  await assignments.submit(T, id, 'user-10', { body: 'first go' });

  const [queued] = await assignments.submissions(T, id);
  const sid = Number(queued!.id);
  await assignments.grade(T, sid, 'user-20', {
    scores: [{ criterion_id: Number(rubric[0]!.id), points: 60 }],
  });
  await assignments.returnToLearner(T, sid);

  const again = await assignments.submit(T, id, 'user-10', { body: 'second go' });
  assert.equal(again!.attempt, 2);
  assert.equal(again!.status, 'submitted');
  // A score attached to work that has since been replaced is worse than none.
  assert.equal(again!.score, null);
  assert.equal(again!.returned_at, null);
  assert.equal((db.tables.onyx_submission_scores as unknown[]).length, 0,
    'the old rubric breakdown survived a resubmission');
  // And there is still exactly one submission, not two.
  assert.equal((await assignments.submissions(T, id)).length, 1);
});

test('resubmission is refused when the assignment does not allow it', async () => {
  const { assignments, assignment } = await withAssignment({ allow_resubmission: false });
  const id = Number(assignment.id);
  await assignments.publish(T, id);
  await assignments.submit(T, id, 'user-10', { body: 'only go' });
  await assert.rejects(assignments.submit(T, id, 'user-10', { body: 'again' }),
    (e: HttpError) => e.status === 422);
});

test('the marking queue excludes drafts, and returning all releases only what is graded', async () => {
  const { assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assignments.publish(T, id);
  await assignments.submit(T, id, 'user-10', { body: 'handed in' });
  await assignments.saveDraft(T, id, 'user-11', 'still writing');

  const queue = await assignments.submissions(T, id);
  assert.equal(queue.length, 1, 'a draft appeared in the marking queue');

  assert.deepEqual(await assignments.returnAll(T, id), { returned: 0 });
  await assignments.grade(T, Number(queue[0]!.id), 'user-20', { score: 70 });
  assert.deepEqual(await assignments.returnAll(T, id), { returned: 1 });
});

test('someone not enrolled cannot submit at all', async () => {
  const { assignments, assignment } = await withAssignment();
  const id = Number(assignment.id);
  await assignments.publish(T, id);
  await assert.rejects(assignments.submit(T, id, 'user-999', { body: 'let me in' }),
    (e: HttpError) => e.status === 403);
  await assert.rejects(assignments.saveDraft(T, id, 'user-999', 'let me in'),
    (e: HttpError) => e.status === 403);
});
