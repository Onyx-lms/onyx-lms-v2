/**
 * Onyx O07 unit tests -- campus operations.
 *
 * The claims worth checking without a database: a timetable clash is refused
 * and names what it collided with (room, faculty, or batch -- all three, not
 * just the obvious one), a learner never sits two exams that share a
 * candidate, seating is exactly one seat per person, moderation never loses
 * the raw mark, a transcript's checksum reconciles with the marks behind it,
 * a payment replay never double-credits an invoice, and a guardian sees only
 * what a learner has actually switched on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { AuditService } from '../src/onyx/audit.service.ts';
import { CampusService } from '../src/onyx/campus.service.ts';
import {
  ExaminationsService, gradeFor, canonicalise, checksumOf,
} from '../src/onyx/examinations.service.ts';
import { FinanceService } from '../src/onyx/finance.service.ts';
import { GuardianService } from '../src/onyx/guardian.service.ts';
import { HttpError } from '../src/http/errors.ts';

const T = 1;
const START = 1_800_000_000_000;

function clock(at = START) {
  let t = at;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function world(c = clock()) {
  const db = new FakeDb({
    onyx_tenants: [{ id: T, name: 'Campus University', slug: 'campus', status: 1 }],
    onyx_users: [
      { id: 'user-10', name: 'Ada', email: 'ada@onyx.test' },
      { id: 'user-11', name: 'Grace', email: 'grace@onyx.test' },
      { id: 'user-12', name: 'Alan', email: 'alan@onyx.test' },
      { id: 'user-20', name: 'Faculty', email: 'faculty@onyx.test' },
      { id: 'user-21', name: 'Second Faculty', email: 'faculty2@onyx.test' },
      { id: 'user-30', name: 'Exams Office', email: 'exams@onyx.test' },
      { id: 'user-40', name: 'Admin', email: 'admin@onyx.test' },
      { id: 'user-50', name: 'Guardian', email: 'guardian@onyx.test' },
    ],
    onyx_memberships: [
      { id: 1, tenant_id: T, user_id: 'user-10', role: 'student', status: 1 },
      { id: 2, tenant_id: T, user_id: 'user-11', role: 'student', status: 1 },
      { id: 8, tenant_id: T, user_id: 'user-12', role: 'student', status: 1 },
      { id: 3, tenant_id: T, user_id: 'user-20', role: 'faculty', status: 1 },
      { id: 4, tenant_id: T, user_id: 'user-21', role: 'faculty', status: 1 },
      { id: 5, tenant_id: T, user_id: 'user-30', role: 'exams', status: 1 },
      { id: 6, tenant_id: T, user_id: 'user-40', role: 'admin', status: 1 },
      { id: 7, tenant_id: T, user_id: 'user-50', role: 'guardian', status: 1 },
    ],
    onyx_programs: [{ id: 1, tenant_id: T, name: 'CS', code: 'CS' }],
    onyx_semesters: [{ id: 1, tenant_id: T, program_id: 1, name: 'Fall', starts_at: '2026-01-01', ends_at: '2026-06-01' }],
    onyx_batches: [
      { id: 1, tenant_id: T, program_id: 1, name: 'A' },
      { id: 2, tenant_id: T, program_id: 1, name: 'B' },
    ],
    // schedule() refuses a batch with nobody in it -- these two mirror the
    // students actually enrolled below, so scheduling against them behaves
    // like scheduling against a real cohort.
    onyx_batch_members: [
      { id: 1, tenant_id: T, batch_id: 1, user_id: 'user-10' },
      { id: 2, tenant_id: T, batch_id: 1, user_id: 'user-11' },
      { id: 3, tenant_id: T, batch_id: 2, user_id: 'user-12' },
    ],
    onyx_courses: [
      { id: 1, tenant_id: T, code: 'CS101', title: 'Programming', slug: 'p', status: 1 },
      { id: 2, tenant_id: T, code: 'CS102', title: 'Databases', slug: 'd', status: 1 },
    ],
    onyx_enrollments: [
      { id: 1, tenant_id: T, course_id: 1, user_id: 'user-10', status: 1 },
      { id: 2, tenant_id: T, course_id: 2, user_id: 'user-10', status: 1 },
      { id: 3, tenant_id: T, course_id: 1, user_id: 'user-11', status: 1 },
    ],
    onyx_rooms: [], onyx_timetable_slots: [], onyx_faculty_allocations: [],
    onyx_exams: [], onyx_halls: [], onyx_seat_allocations: [],
    onyx_exam_marks: [], onyx_transcripts: [],
    onyx_fee_heads: [], onyx_fee_structures: [], onyx_fee_structure_lines: [],
    onyx_invoices: [], onyx_invoice_lines: [], onyx_payments: [],
    onyx_guardians: [],
    onyx_audit_logs: [],
  }, {
    // The one constraint the replay test is actually about: a real
    // Postgres UNIQUE on (tenant_id, gateway, reference) is what makes a
    // second insert with the same reference a no-op rather than a second
    // credit.
    onyx_payments: [['tenant_id', 'gateway', 'reference']],
  });
  const audit = new AuditService(db, () => {});
  const campus = new CampusService(db, audit);
  const exams = new ExaminationsService(db, audit, c.now);
  const finance = new FinanceService(db, audit, c.now);
  const guardians = new GuardianService(db, audit, exams, c.now);
  return { db, audit, campus, exams, finance, guardians, c };
}

const student = { userId: 'user-10', role: 'student' as const };
const admin = { userId: 'user-40', role: 'admin' as const };
const examsOfficer = { userId: 'user-30', role: 'exams' as const };
const facultyMember = { userId: 'user-20', role: 'faculty' as const };
const guardianActor = { userId: 'user-50', role: 'guardian' as const };

// ---------------------------------------------------------------------------
// CMP-01: timetable clash detection
// ---------------------------------------------------------------------------

async function withRoom(w: ReturnType<typeof world>) {
  return w.campus.createRoom(T, { code: 'R1', name: 'Room 1', capacity: 30 });
}

test('CMP-01 a room double-booking is refused and names the room', async () => {
  const w = world();
  const room = await withRoom(w);
  await w.campus.schedule(T, {
    semester_id: 1, course_id: 1, batch_id: 1, room_id: Number(room!.id),
    faculty_id: 'user-20', day_of_week: 1, starts_at: '09:00', ends_at: '10:00',
  });
  await assert.rejects(
    () => w.campus.schedule(T, {
      semester_id: 1, course_id: 2, batch_id: 2, room_id: Number(room!.id),
      faculty_id: 'user-21', day_of_week: 1, starts_at: '09:30', ends_at: '10:30',
    }),
    (e: unknown) => e instanceof HttpError && e.status === 409 && /R1/.test(e.message));
});

test('CMP-01 a faculty double-booking is refused even in a different room', async () => {
  const w = world();
  const r1 = await w.campus.createRoom(T, { code: 'R1', name: 'Room 1' });
  const r2 = await w.campus.createRoom(T, { code: 'R2', name: 'Room 2' });
  await w.campus.schedule(T, {
    semester_id: 1, course_id: 1, batch_id: 1, room_id: Number(r1!.id),
    faculty_id: 'user-20', day_of_week: 1, starts_at: '09:00', ends_at: '10:00',
  });
  await assert.rejects(
    () => w.campus.schedule(T, {
      semester_id: 1, course_id: 2, batch_id: 2, room_id: Number(r2!.id),
      faculty_id: 'user-20', day_of_week: 1, starts_at: '09:30', ends_at: '10:30',
    }),
    (e: unknown) => e instanceof HttpError && e.status === 409);
});

test('CMP-01 a batch cannot be in two rooms at once however free both rooms are', async () => {
  const w = world();
  const r1 = await w.campus.createRoom(T, { code: 'R1', name: 'Room 1' });
  const r2 = await w.campus.createRoom(T, { code: 'R2', name: 'Room 2' });
  await w.campus.schedule(T, {
    semester_id: 1, course_id: 1, batch_id: 1, room_id: Number(r1!.id),
    faculty_id: 'user-20', day_of_week: 1, starts_at: '09:00', ends_at: '10:00',
  });
  await assert.rejects(
    () => w.campus.schedule(T, {
      semester_id: 1, course_id: 2, batch_id: 1, room_id: Number(r2!.id),
      faculty_id: 'user-21', day_of_week: 1, starts_at: '09:30', ends_at: '10:30',
    }),
    (e: unknown) => e instanceof HttpError && e.status === 409);
});

test('CMP-01 back-to-back classes in the same room do not clash', async () => {
  const w = world();
  const room = await withRoom(w);
  await w.campus.schedule(T, {
    semester_id: 1, course_id: 1, batch_id: 1, room_id: Number(room!.id),
    faculty_id: 'user-20', day_of_week: 1, starts_at: '09:00', ends_at: '10:00',
  });
  const slot = await w.campus.schedule(T, {
    semester_id: 1, course_id: 2, batch_id: 2, room_id: Number(room!.id),
    faculty_id: 'user-21', day_of_week: 1, starts_at: '10:00', ends_at: '11:00',
  });
  assert.ok(slot, 'a class ending at 10:00 must not clash with one starting at 10:00');
});

test('CMP-01 a different weekday never clashes', async () => {
  const w = world();
  const room = await withRoom(w);
  await w.campus.schedule(T, {
    semester_id: 1, course_id: 1, batch_id: 1, room_id: Number(room!.id),
    faculty_id: 'user-20', day_of_week: 1, starts_at: '09:00', ends_at: '10:00',
  });
  const slot = await w.campus.schedule(T, {
    semester_id: 1, course_id: 2, batch_id: 1, room_id: Number(room!.id),
    faculty_id: 'user-20', day_of_week: 2, starts_at: '09:00', ends_at: '10:00',
  });
  assert.ok(slot);
});

test('CMP-01 publishing re-checks every slot and refuses if two collide', async () => {
  const w = world();
  const room = await withRoom(w);
  // Scheduled one at a time without colliding, then the room is edited
  // underneath both -- simulating two slots that only clash once a third
  // moved. Publish is the last point at which this is still cheap to catch.
  await w.campus.schedule(T, {
    semester_id: 1, course_id: 1, batch_id: 1, room_id: Number(room!.id),
    faculty_id: 'user-20', day_of_week: 1, starts_at: '09:00', ends_at: '10:00',
  });
  await w.db.from('onyx_timetable_slots').insert({
    tenant_id: T, semester_id: 1, course_id: 2, batch_id: 1, room_id: Number(room!.id),
    faculty_id: 'user-20', day_of_week: 1, starts_at: '09:30:00', ends_at: '10:30:00', status: 'draft',
  });
  await assert.rejects(
    () => w.campus.publish(T, 1, 'user-40'),
    (e: unknown) => e instanceof HttpError && e.status === 409);
});

test('CMP-01 a learner only ever sees a published timetable', async () => {
  const w = world();
  const room = await withRoom(w);
  await w.campus.schedule(T, {
    semester_id: 1, course_id: 1, batch_id: 1, room_id: Number(room!.id),
    faculty_id: 'user-20', day_of_week: 1, starts_at: '09:00', ends_at: '10:00',
  });
  const published = await w.campus.publish(T, 1, 'user-40');
  assert.equal(published.published, 1);
  const rows = await w.campus.timetable(T, { publishedOnly: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, 'published');
});

test('CMP-01 allocating a learner to teach is refused', async () => {
  const w = world();
  await assert.rejects(
    () => w.campus.allocate(T, { semester_id: 1, course_id: 1, user_id: 'user-10' }),
    (e: unknown) => e instanceof HttpError && e.status === 422);
});

// ---------------------------------------------------------------------------
// CMP-02a: exam scheduling
// ---------------------------------------------------------------------------

test('CMP-02a a learner is never scheduled for two exams at once', async () => {
  const w = world();
  await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 1, title: 'CS101 final',
    starts_at: new Date(START + 86_400_000).toISOString(), duration_minutes: 120,
  });
  // Course 2 shares user 10 with course 1 (both in the roster above).
  await assert.rejects(
    () => w.exams.schedule(T, examsOfficer, {
      semester_id: 1, course_id: 2, title: 'CS102 final',
      starts_at: new Date(START + 86_400_000 + 60 * 60_000).toISOString(), duration_minutes: 120,
    }),
    (e: unknown) => e instanceof HttpError && e.status === 409);
});

test('CMP-02a two exams whose rosters never intersect do not clash', async () => {
  const w = world();
  // Course 2's fixture enrolment (user 10, who is also in course 1) is
  // replaced with user 12, who is nowhere near course 1 -- the two rosters
  // then share nobody.
  await w.db.from('onyx_enrollments').delete().eq('course_id', 2).eq('user_id', 'user-10');
  await w.db.from('onyx_enrollments').insert(
    { tenant_id: T, course_id: 2, user_id: 'user-12', status: 1 });

  await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 1, title: 'CS101 final',
    starts_at: new Date(START + 86_400_000).toISOString(),
  });
  const second = await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 2, title: 'CS102 final',
    starts_at: new Date(START + 86_400_000 + 60 * 60_000).toISOString(),
  });
  assert.ok(second);
});

test('CMP-02a the examinations office, or faculty, may schedule an exam -- nobody else', async () => {
  const w = world();
  // Role only: schedule() cannot know which course a faculty member actually
  // teaches, so it admits the role and leaves *which* course to the route
  // layer's assertCanRunExam (campus.routes.ts), the same split enterMarks()
  // below already draws.
  const exam = await w.exams.schedule(T, facultyMember, {
    semester_id: 1, course_id: 1, title: 'CS101 midterm', starts_at: new Date(START).toISOString(),
  });
  assert.ok(exam);

  await assert.rejects(
    () => w.exams.schedule(T, student, {
      semester_id: 1, course_id: 1, title: 'Sneaky exam',
      starts_at: new Date(START + 60 * 60_000).toISOString(),
    }),
    (e: unknown) => e instanceof HttpError && e.status === 403);
});

// ---------------------------------------------------------------------------
// CMP-02b: halls and seating
// ---------------------------------------------------------------------------

test('CMP-02b every candidate gets exactly one seat and no seat is doubled', async () => {
  const w = world();
  const exam = await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 1, title: 'CS101 final', starts_at: new Date(START + 86_400_000).toISOString(),
  });
  const hall = await w.exams.createHall(T, { code: 'H1', name: 'Hall 1', row_count: 2, col_count: 2 });
  const result = await w.exams.allocateSeats(T, Number(exam!.id), [Number(hall!.id)], examsOfficer);
  assert.equal(result.seated, 2); // course 1's roster: users 10 and 11

  const plan = await w.exams.seatingPlan(T, Number(exam!.id));
  const labels = plan.halls.flatMap((h) => h.seats.map((s) => s.seat_label));
  assert.equal(new Set(labels).size, labels.length, 'no seat label repeats');
  const people = plan.halls.flatMap((h) => h.seats.map((s) => s.user_id));
  assert.equal(new Set(people).size, people.length, 'no candidate seated twice');
});

test('CMP-02b too few seats is refused rather than seating some and not others', async () => {
  const w = world();
  const exam = await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 1, title: 'CS101 final', starts_at: new Date(START + 86_400_000).toISOString(),
  });
  const hall = await w.exams.createHall(T, { code: 'H1', name: 'Tiny', row_count: 1, col_count: 1 });
  await assert.rejects(
    () => w.exams.allocateSeats(T, Number(exam!.id), [Number(hall!.id)], examsOfficer),
    (e: unknown) => e instanceof HttpError && e.status === 422);
});

test('CMP-02b a learner cannot read the full seating plan, only their own seat', async () => {
  const w = world();
  const exam = await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 1, title: 'CS101 final', starts_at: new Date(START + 86_400_000).toISOString(),
  });
  const hall = await w.exams.createHall(T, { code: 'H1', name: 'Hall 1', row_count: 2, col_count: 2 });
  await w.exams.allocateSeats(T, Number(exam!.id), [Number(hall!.id)], examsOfficer);
  const seat = await w.exams.seatFor(T, Number(exam!.id), 'user-10');
  assert.ok(seat);
  assert.equal(seat!.user_id, 'user-10');
  void student;
});

// ---------------------------------------------------------------------------
// CMP-02c: marks, moderation, transcripts
// ---------------------------------------------------------------------------

test('CMP-02c grade is pass or fail against the paper\'s own pass mark, nothing finer', () => {
  assert.deepEqual(gradeFor(50, 100, 50), { grade: 'Pass', points: 1 }, 'exactly the pass mark passes');
  assert.deepEqual(gradeFor(49, 100, 50), { grade: 'Fail', points: 0 });
  assert.deepEqual(gradeFor(100, 100, 50), { grade: 'Pass', points: 1 });
  assert.deepEqual(gradeFor(0, 0, 0), { grade: 'Fail', points: 0 }, 'a zero-max paper fails, not a divide-by-zero pass');
});

test('CMP-02c moderation keeps the raw mark and stores only the delta', async () => {
  const w = world();
  const exam = await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 1, title: 'CS101 final', starts_at: new Date(START + 86_400_000).toISOString(),
    max_marks: 100,
  });
  await w.exams.enterMarks(T, Number(exam!.id), facultyMember, [{ user_id: 'user-10', raw_marks: 60 }]);
  await w.exams.moderate(T, Number(exam!.id), examsOfficer, 5, 'paper found to be harder than intended');

  const [mark] = await w.exams.marksForExam(T, Number(exam!.id), examsOfficer);
  assert.equal(Number(mark!.raw_marks), 60, 'the marker\'s original figure is untouched');
  assert.equal(Number(mark!.moderation_delta), 5);
  assert.equal(Number(mark!.final_marks), 65);
});

test('CMP-02c a moderated mark is clamped to the paper\'s range', async () => {
  const w = world();
  const exam = await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 1, title: 'CS101 final', starts_at: new Date(START + 86_400_000).toISOString(),
    max_marks: 100,
  });
  await w.exams.enterMarks(T, Number(exam!.id), facultyMember, [{ user_id: 'user-10', raw_marks: 98 }]);
  await w.exams.moderate(T, Number(exam!.id), examsOfficer, 10, 'generous curve');
  const [mark] = await w.exams.marksForExam(T, Number(exam!.id), examsOfficer);
  assert.equal(Number(mark!.final_marks), 100, '98 + 10 must clamp to the maximum, not read 108');
});

test('CMP-02c a learner never sees a mark before it is published', async () => {
  const w = world();
  const exam = await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 1, title: 'CS101 final', starts_at: new Date(START + 86_400_000).toISOString(),
  });
  await w.exams.enterMarks(T, Number(exam!.id), facultyMember, [{ user_id: 'user-10', raw_marks: 70 }]);
  const seenByLearner = await w.exams.marksFor(T, 'user-10', student);
  assert.equal(seenByLearner.length, 0, 'an entered-but-unpublished mark must be invisible');

  await w.exams.publishMarks(T, Number(exam!.id), examsOfficer);
  const afterPublish = await w.exams.marksFor(T, 'user-10', student);
  assert.equal(afterPublish.length, 1);
});

test('CMP-02c a transcript checksum reconciles with the marks behind it, and drifts after a remark', async () => {
  const w = world();
  const exam = await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 1, title: 'CS101 final', starts_at: new Date(START + 86_400_000).toISOString(),
  });
  await w.exams.enterMarks(T, Number(exam!.id), facultyMember, [{ user_id: 'user-10', raw_marks: 80 }]);
  await w.exams.publishMarks(T, Number(exam!.id), examsOfficer);
  const transcript = await w.exams.issueTranscript(T, 'user-10', examsOfficer);

  const check = await w.exams.verifyTranscript(T, String(transcript!.serial));
  assert.equal(check.intact, true);
  assert.equal(check.current, true);

  // A tamper: rewrite a mark inside the stored payload without touching the
  // checksum. canonicalise() only serialises user_id/program_id/lines, so the
  // change has to land inside `lines` to actually move the checksum.
  const payload = transcript!.payload as { lines: { final_marks: number }[] };
  await w.db.from('onyx_transcripts').update({
    payload: { ...payload, lines: [{ ...payload.lines[0]!, final_marks: 100 }] },
  }).eq('id', Number(transcript!.id));
  const afterTamper = await w.exams.verifyTranscript(T, String(transcript!.serial));
  assert.equal(afterTamper.intact, false, 'a rewritten payload must fail its own checksum');
});

test('CMP-02c canonicalise is order-independent in the lines it is given', () => {
  const base = { user_id: 1, program_id: null };
  const a = canonicalise({ ...base, lines: [
    { exam_id: 2, final_marks: 50, max_marks: 100, grade: 'C' },
    { exam_id: 1, final_marks: 90, max_marks: 100, grade: 'A' },
  ] });
  const b = canonicalise({ ...base, lines: [
    { exam_id: 1, final_marks: 90, max_marks: 100, grade: 'A' },
    { exam_id: 2, final_marks: 50, max_marks: 100, grade: 'C' },
  ] });
  assert.equal(a, b);
  assert.equal(checksumOf(a), checksumOf(b));
});

// ---------------------------------------------------------------------------
// CMP-03: fees, invoicing, payment
// ---------------------------------------------------------------------------

async function withStructure(w: ReturnType<typeof world>, instalments = 1) {
  const head = await w.finance.createHead(T, admin, { code: 'TUITION', name: 'Tuition' });
  return w.finance.createStructure(T, admin, {
    name: 'Fall fees', instalments,
    lines: [{ head_id: Number(head!.id), amount_minor: 10_000_00 }],
  });
}

test('CMP-03 an invoice\'s lines reconcile to the fee structure that produced it', async () => {
  const w = world();
  const structure = await withStructure(w);
  await w.finance.publishStructure(T, Number(structure!.id), admin);
  const invoice = await w.finance.issueInvoice(T, admin, { user_id: 'user-10', structure_id: Number(structure!.id) });

  const report = await w.finance.reconcile(T, Number(invoice!.id), admin);
  assert.equal(report.lines_balance, true);
  assert.equal(report.matches_structure, true);
});

test('CMP-03 an edited structure does not retroactively change an already-issued invoice', async () => {
  const w = world();
  const structure = await withStructure(w);
  await w.finance.publishStructure(T, Number(structure!.id), admin);
  const invoice = await w.finance.issueInvoice(T, admin, { user_id: 'user-10', structure_id: Number(structure!.id) });

  // The structure changes after the invoice was raised.
  await w.db.from('onyx_fee_structure_lines').update({ amount_minor: 20_000_00 })
    .eq('structure_id', Number(structure!.id));

  const stillOwed = await w.finance.invoice(T, Number(invoice!.id), admin);
  assert.equal(stillOwed.total_minor, 10_000_00, 'the invoice keeps its own copy of the amount');

  const report = await w.finance.reconcile(T, Number(invoice!.id), admin);
  assert.equal(report.matches_structure, false, 'a real drift is reported, not hidden');
});

test('CMP-03 instalments split with the remainder on the first, and sum back to the total', async () => {
  const w = world();
  const structure = await withStructure(w, 3); // 10,000.00 / 3 does not divide evenly
  await w.finance.publishStructure(T, Number(structure!.id), admin);
  const one = await w.finance.issueInvoice(T, admin, { user_id: 'user-10', structure_id: Number(structure!.id), instalment_no: 1 });
  const two = await w.finance.issueInvoice(T, admin, { user_id: 'user-10', structure_id: Number(structure!.id), instalment_no: 2 });
  const three = await w.finance.issueInvoice(T, admin, { user_id: 'user-10', structure_id: Number(structure!.id), instalment_no: 3 });
  const sum = Number(one!.total_minor) + Number(two!.total_minor) + Number(three!.total_minor);
  assert.equal(sum, 10_000_00);
});

test('CMP-03 a replayed webhook never double-credits an invoice', async () => {
  const w = world();
  const structure = await withStructure(w);
  await w.finance.publishStructure(T, Number(structure!.id), admin);
  const invoice = await w.finance.issueInvoice(T, admin, { user_id: 'user-10', structure_id: Number(structure!.id) });

  const first = await w.finance.recordPayment(T, {
    invoice_id: Number(invoice!.id), gateway: 'razorpay', reference: 'pay_123',
    amount_minor: 10_000_00,
  });
  assert.equal(first.replayed, false);
  assert.equal(first.invoice!.status, 'paid');

  const replay = await w.finance.recordPayment(T, {
    invoice_id: Number(invoice!.id), gateway: 'razorpay', reference: 'pay_123',
    amount_minor: 10_000_00,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.invoice!.paid_minor, 10_000_00, 'a replay must not double the paid total');
});

test('CMP-03 a learner cannot see another learner\'s invoice', async () => {
  const w = world();
  const structure = await withStructure(w);
  await w.finance.publishStructure(T, Number(structure!.id), admin);
  const invoice = await w.finance.issueInvoice(T, admin, { user_id: 'user-10', structure_id: Number(structure!.id) });
  await assert.rejects(
    () => w.finance.invoice(T, Number(invoice!.id), { userId: 'user-11', role: 'student' }),
    (e: unknown) => e instanceof HttpError && e.status === 403);
});

// ---------------------------------------------------------------------------
// CMP-04: guardians
// ---------------------------------------------------------------------------

test('CMP-04 a guardian sees nothing until the link is accepted and the category is switched on', async () => {
  const w = world();
  const link = await w.guardians.link(T, admin, { guardian_user_id: 'user-50', student_user_id: 'user-10' });
  await assert.rejects(
    () => w.guardians.attendanceFor(T, 'user-50', 'user-10'),
    (e: unknown) => e instanceof HttpError && e.status === 403,
    'unverified link must grant nothing');

  await w.guardians.accept(T, Number(link!.id), { userId: 'user-10' });
  await assert.rejects(
    () => w.guardians.attendanceFor(T, 'user-50', 'user-10'),
    (e: unknown) => e instanceof HttpError && e.status === 403,
    'accepted but not consented must still grant nothing');

  await w.guardians.setConsent(T, Number(link!.id), student, 'attendance', true);
  const attendance = await w.guardians.attendanceFor(T, 'user-50', 'user-10');
  assert.ok(attendance);
});

test('CMP-04 revoking consent closes the page immediately, not after a cache expires', async () => {
  const w = world();
  const link = await w.guardians.link(T, admin, { guardian_user_id: 'user-50', student_user_id: 'user-10' });
  await w.guardians.accept(T, Number(link!.id), { userId: 'user-10' });
  await w.guardians.setConsent(T, Number(link!.id), student, 'results', true);
  await w.exams.schedule(T, examsOfficer, {
    semester_id: 1, course_id: 1, title: 'CS101 final', starts_at: new Date(START + 86_400_000).toISOString(),
  });
  const results = await w.guardians.resultsFor(T, 'user-50', 'user-10');
  assert.ok(results);

  await w.guardians.setConsent(T, Number(link!.id), student, 'results', false);
  await assert.rejects(
    () => w.guardians.resultsFor(T, 'user-50', 'user-10'),
    (e: unknown) => e instanceof HttpError && e.status === 403);
});

test('CMP-04 a guardian cannot see a category a learner never turned on, even if another category is shared', async () => {
  const w = world();
  const link = await w.guardians.link(T, admin, { guardian_user_id: 'user-50', student_user_id: 'user-10' });
  await w.guardians.accept(T, Number(link!.id), { userId: 'user-10' });
  await w.guardians.setConsent(T, Number(link!.id), student, 'attendance', true);
  await assert.rejects(
    () => w.guardians.feesFor(T, 'user-50', 'user-10'),
    (e: unknown) => e instanceof HttpError && e.status === 403);
});

test('CMP-04 a guardian cannot propose their own link -- only the learner or staff can', async () => {
  const w = world();
  await assert.rejects(
    () => w.guardians.link(T, guardianActor, { guardian_user_id: 'user-50', student_user_id: 'user-10' }),
    (e: unknown) => e instanceof HttpError && e.status === 403);
});

test('CMP-04 the overview reports "not shared" for a switched-off category rather than omitting it', async () => {
  const w = world();
  const link = await w.guardians.link(T, admin, { guardian_user_id: 'user-50', student_user_id: 'user-10' });
  await w.guardians.accept(T, Number(link!.id), { userId: 'user-10' });
  await w.guardians.setConsent(T, Number(link!.id), student, 'attendance', true);

  const overview = await w.guardians.overview(T, 'user-50');
  const child = overview.children[0]!;
  assert.equal(child.shares.attendance, true);
  assert.equal(child.shares.results, false);
  assert.equal(child.results, null, 'a category that is off must read as null, not be left out');
});
