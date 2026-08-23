/**
 * CMP-02 -- exam scheduling, halls and seating, marks and transcripts.
 *
 * This is the part of the system whose output leaves the building. A seating
 * plan is printed and pinned to a door; a transcript is posted to an employer.
 * Once paper exists, "the database was right at the time" stops being a defence,
 * and three decisions follow:
 *
 *   * **A learner is never scheduled for two exams at once.** That is the
 *     acceptance criterion, and it is checked against the people actually
 *     enrolled in each course rather than against the courses -- two exams on
 *     unrelated courses are fine until one person is taking both.
 *   * **Seating is enforced by the database.** Two unique constraints say every
 *     candidate has one seat and no seat has two candidates. A service-level
 *     check would be equally correct and one careless import away from being
 *     skipped, and by then the plan is on the door.
 *   * **A transcript is a snapshot with a checksum.** It stores the marks as
 *     they stood and a hash of them, so a copy in somebody's hand can be
 *     reconciled against the record rather than trusted.
 *
 * Marks move entered -> moderated -> published, and a learner sees nothing
 * before the last step. Moderation keeps the raw mark and the delta separately,
 * because "what did the marker give" and "what did the board award" are
 * different questions and a moderated paper has to be able to answer both.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { OnyxDb } from './db.ts';
import type { Role, MarkStatus } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import { peopleFor } from './directory.ts';
import { pdfTable } from '../format/pdf.ts';
import type { AuditService } from './audit.service.ts';

const EXAM_COLUMNS = 'id, tenant_id, semester_id, course_id, assessment_id, title, starts_at, duration_minutes, max_marks, pass_marks, status, created_by, created_at, updated_at';
const HALL_COLUMNS = 'id, tenant_id, code, name, row_count, col_count, capacity, status, created_at';
const SEAT_COLUMNS = 'id, tenant_id, exam_id, hall_id, user_id, seat_label, created_at';
const MARK_COLUMNS = 'id, tenant_id, exam_id, user_id, raw_marks, moderation_delta, final_marks, grade, grade_points, status, entered_by, moderated_by, moderated_at, published_at, created_at, updated_at';
const TRANSCRIPT_COLUMNS = 'id, tenant_id, user_id, program_id, serial, payload, gpa, credits_earned, checksum, issued_by, issued_at, revoked_at';

const EXAM_STAFF: Role[] = ['admin', 'exams'];
const canRunExams = (role: Role) => EXAM_STAFF.includes(role);

/**
 * Pass or fail, against the paper's own pass mark -- nothing finer than that.
 * Kept as a function, not an inline comparison at each call site, for the
 * same reason it was one before: one place decides what a mark means, so
 * entering, moderating and overriding can never quietly disagree with each
 * other. `points` stays because a transcript's GPA line sums it (see
 * issueTranscript) -- 1 for a pass, 0 for a fail, so that GPA now reads as a
 * pass rate rather than a letter-grade average.
 */
export function gradeFor(marks: number, maxMarks: number, passMarks: number): { grade: string; points: number } {
  const passed = maxMarks > 0 && marks >= passMarks;
  return { grade: passed ? 'Pass' : 'Fail', points: passed ? 1 : 0 };
}

/**
 * A stable string for a transcript payload, so the same marks always hash the
 * same way. JSON.stringify orders keys by insertion, which is not a promise --
 * building the string by hand is.
 */
export function canonicalise(payload: {
  user_id: string; program_id: number | null;
  lines: { exam_id: number; final_marks: number; max_marks: number; grade: string }[];
}): string {
  const lines = [...payload.lines]
    .sort((a, b) => a.exam_id - b.exam_id)
    .map((l) => [l.exam_id, l.final_marks.toFixed(2), l.max_marks, l.grade].join(':'))
    .join('|');
  return [payload.user_id, payload.program_id ?? 0, lines].join('#');
}

export const checksumOf = (canonical: string) =>
  createHash('sha256').update(canonical).digest('hex');

export class ExaminationsService {
  #db: OnyxDb;
  #audit: AuditService;
  #now: () => number;

  constructor(db: OnyxDb, audit: AuditService, now: () => number = Date.now) {
    this.#db = db;
    this.#audit = audit;
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // CMP-02a: the exam calendar
  // -------------------------------------------------------------------------

  /**
   * Everyone taking this course, which is who the clash check is about.
   *
   * Two exams on different courses are not a clash. Two exams whose rosters
   * intersect are, for exactly the people in the intersection.
   */
  async #candidates(tenantId: number, courseId: number): Promise<Set<string>> {
    // `status` is a smallint (1 = active), same as everywhere else in Onyx
    // Learn -- see academics.service.ts. It is not the string 'active'.
    const { data } = await this.#db.from('onyx_enrollments').select('user_id')
      .eq('tenant_id', tenantId).eq('course_id', courseId).eq('status', 1);
    return new Set((data ?? []).map((e) => String(e.user_id)));
  }

  async schedule(tenantId: number, actor: { userId: string; role: Role }, input: {
    semester_id: number; course_id: number; title: string; starts_at: string;
    duration_minutes?: number; max_marks?: number; pass_marks?: number;
    assessment_id?: number | null;
  }) {
    // Course-scoping (only this course's own faculty, not faculty tenant-wide)
    // is the route layer's job -- assertCanRunExam in campus.routes.ts -- the
    // same split enterMarks() below already draws between "which roles" and
    // "which course".
    if (!canRunExams(actor.role) && actor.role !== 'faculty') {
      throw new HttpError(403, 'Only the examinations office or the course’s own faculty '
        + 'can schedule an exam.');
    }
    const { data: course } = await this.#db.from('onyx_courses').select('id, title')
      .eq('tenant_id', tenantId).eq('id', input.course_id).maybeSingle();
    if (!course) throw new HttpError(404, 'No such course.');

    const start = Date.parse(input.starts_at);
    if (!Number.isFinite(start)) throw new HttpError(422, 'That is not a valid start time.');
    const duration = input.duration_minutes ?? 180;
    const end = start + duration * 60_000;

    const clash = await this.#candidateClash(tenantId, input.course_id, start, end, null);
    if (clash) throw new HttpError(409, clash);

    const maxMarks = input.max_marks ?? 100;
    const passMarks = input.pass_marks ?? 40;
    if (passMarks > maxMarks) {
      throw new HttpError(422, 'The pass mark cannot be above the maximum.');
    }

    const { data, error } = await this.#db.from('onyx_exams').insert({
      tenant_id: tenantId,
      semester_id: input.semester_id,
      course_id: input.course_id,
      assessment_id: input.assessment_id ?? null,
      title: input.title.trim(),
      starts_at: new Date(start).toISOString(),
      duration_minutes: duration,
      max_marks: maxMarks,
      pass_marks: passMarks,
      status: 'scheduled',
      created_by: actor.userId,
    }).select(EXAM_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not schedule the exam: ' + error.message);

    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'exam.scheduled', entityType: 'exam', entityId: Number(data!.id),
        after: { title: data!.title, starts_at: data!.starts_at } });
    return data;
  }

  /**
   * Correct a scheduled exam, or cancel it. The clash check schedule() runs
   * is deliberately not repeated here: an administrator fixing a mistaken
   * time is already looking at the reason to change it, and re-refusing the
   * same clash they are trying to resolve would be the check working against
   * the person using it.
   */
  async updateExam(tenantId: number, examId: number, actor: { userId: string; role: Role },
    patch: {
      title?: string; starts_at?: string | null; duration_minutes?: number;
      max_marks?: number; pass_marks?: number; status?: string;
    }) {
    if (!canRunExams(actor.role) && actor.role !== 'faculty') {
      throw new HttpError(403, 'Only the examinations office or the course’s own faculty '
        + 'can change an exam.');
    }
    const exam = await this.exam(tenantId, examId);

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of
      ['title', 'starts_at', 'duration_minutes', 'max_marks', 'pass_marks', 'status'] as const) {
      const value = patch[key];
      if (value !== undefined && value !== exam[key]) { before[key] = exam[key]; after[key] = value; }
    }
    if (!Object.keys(after).length) return exam;

    const { data, error } = await this.#db.from('onyx_exams')
      .update({ ...after, updated_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('id', examId).select(EXAM_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not update the exam: ' + error.message);

    await this.#audit.record({ tenant_id: tenantId, user_id: actor.userId },
      { action: 'exam.updated', entityType: 'exam', entityId: examId, before, after });
    return data;
  }

  /**
   * Removes an exam outright -- not the same as cancelling it (updateExam's
   * `status: 'cancelled'`), which keeps the row as a record of what was
   * scheduled and then called off. This is for the case that record
   * shouldn't exist at all: a mis-scheduled paper, a duplicate, a test.
   *
   * Seating and marks cascade at the database (onyx_seat_allocations.exam_id
   * and onyx_exam_marks.exam_id are both ON DELETE CASCADE -- confirmed
   * against 0008_campus.sql). The linked assessment, if there is one, is
   * NOT touched: the paper and its bank are the course's, independent of any
   * one exam slot that happened to draw on them.
   *
   * Same authorization as updateExam -- the route applies the course-scoped
   * check (assertCanRunExam) before this runs; this is the role-only
   * backstop, same redundancy updateExam already has.
   */
  async remove(tenantId: number, examId: number, actor: { userId: string; role: Role }): Promise<void> {
    if (!canRunExams(actor.role) && actor.role !== 'faculty') {
      throw new HttpError(403, 'Only the examinations office or the course’s own faculty '
        + 'can remove an exam.');
    }
    const exam = await this.exam(tenantId, examId);
    const { error } = await this.#db.from('onyx_exams')
      .delete().eq('tenant_id', tenantId).eq('id', examId);
    if (error) throw new HttpError(500, 'Could not remove the exam: ' + error.message);

    await this.#audit.record({ tenant_id: tenantId, user_id: actor.userId }, {
      action: 'exam.updated', entityType: 'exam', entityId: examId,
      before: { title: exam.title, starts_at: exam.starts_at, status: exam.status },
      after: { removed: true },
    });
  }

  /**
   * Whether any one person would end up sitting two papers at the same time.
   *
   * Returns a sentence naming the collision, or null. The message names the
   * other exam and how many people are caught by it -- "3 learners are already
   * sitting Databases then" is actionable in a way that "clash" is not.
   */
  async #candidateClash(tenantId: number, courseId: number, start: number, end: number,
    excludeExamId: number | null): Promise<string | null> {
    const mine = await this.#candidates(tenantId, courseId);
    if (!mine.size) return null;

    // Any exam whose window could overlap. A day either side is a generous net
    // that keeps the query simple; the overlap itself is checked exactly.
    const { data: others } = await this.#db.from('onyx_exams')
      .select('id, course_id, title, starts_at, duration_minutes, status')
      .eq('tenant_id', tenantId)
      .in('status', ['scheduled', 'draft'])
      .gte('starts_at', new Date(start - 86_400_000).toISOString())
      .lte('starts_at', new Date(end + 86_400_000).toISOString());

    for (const other of others ?? []) {
      if (excludeExamId !== null && Number(other.id) === excludeExamId) continue;
      const otherStart = Date.parse(String(other.starts_at));
      const otherEnd = otherStart + Number(other.duration_minutes ?? 180) * 60_000;
      if (!(start < otherEnd && otherStart < end)) continue;

      const theirs = await this.#candidates(tenantId, Number(other.course_id));
      const caught = [...mine].filter((id) => theirs.has(id));
      if (caught.length) {
        return caught.length + ' learner' + (caught.length === 1 ? ' is' : 's are')
          + ' already sitting "' + other.title + '" at that time.';
      }
    }
    return null;
  }

  async exams(tenantId: number, filters: { semester_id?: number; course_id?: number } = {}) {
    let q = this.#db.from('onyx_exams').select(EXAM_COLUMNS).eq('tenant_id', tenantId);
    if (filters.semester_id) q = q.eq('semester_id', filters.semester_id);
    if (filters.course_id) q = q.eq('course_id', filters.course_id);
    const { data } = await q.order('starts_at', { ascending: true });
    return data ?? [];
  }

  async exam(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_exams').select(EXAM_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such exam.');
    return data;
  }

  // -------------------------------------------------------------------------
  // CMP-02b: halls and seating
  // -------------------------------------------------------------------------

  async createHall(tenantId: number, input: {
    code: string; name: string; row_count: number; col_count: number; capacity?: number;
  }) {
    const code = input.code.trim().toUpperCase();
    if (!code) throw new HttpError(422, 'A hall needs a code.');
    if (input.row_count < 1 || input.col_count < 1) {
      throw new HttpError(422, 'A hall needs at least one row and one column.');
    }
    const grid = input.row_count * input.col_count;
    const capacity = input.capacity ?? grid;
    if (capacity > grid) {
      throw new HttpError(422, 'That is more seats than the grid holds ('
        + grid + ').');
    }

    const { data, error } = await this.#db.from('onyx_halls').insert({
      tenant_id: tenantId, code, name: input.name.trim(),
      row_count: input.row_count, col_count: input.col_count, capacity, status: 1,
    }).select(HALL_COLUMNS).maybeSingle();
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw new HttpError(409, 'A hall with the code ' + code + ' already exists.');
      }
      throw new HttpError(500, 'Could not create the hall: ' + error.message);
    }
    return data;
  }

  async halls(tenantId: number) {
    const { data } = await this.#db.from('onyx_halls').select(HALL_COLUMNS)
      .eq('tenant_id', tenantId).order('code', { ascending: true });
    return data ?? [];
  }

  /**
   * Seat every candidate for an exam across the halls given.
   *
   * Allocation is deterministic -- candidates sorted by id, halls in the order
   * supplied, seats filled row by row. Two runs of the same exam produce the
   * same plan, which matters when somebody reprints it.
   *
   * Re-running replaces the plan rather than adding to it: the common reason to
   * run it twice is that the roster changed.
   */
  async allocateSeats(tenantId: number, examId: number, hallIds: number[],
    actor: { userId: string; role: Role }) {
    if (!canRunExams(actor.role)) {
      throw new HttpError(403, 'Only the examinations office can allocate seating.');
    }
    const exam = await this.exam(tenantId, examId);
    if (!hallIds.length) throw new HttpError(422, 'Pick at least one hall.');

    const halls = [];
    for (const id of hallIds) {
      const { data } = await this.#db.from('onyx_halls').select(HALL_COLUMNS)
        .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
      if (!data) throw new HttpError(404, 'No such hall: ' + id + '.');
      halls.push(data);
    }

    // Sorted lexicographically now that a candidate is named by their auth
    // uuid rather than a sequential id -- still deterministic, which is the
    // property this needs, not numeric order.
    const candidates = [...await this.#candidates(tenantId, Number(exam.course_id))].sort();
    if (!candidates.length) throw new HttpError(422, 'Nobody is enrolled in that course.');

    const seats = halls.reduce((sum, h) => sum + Number(h.capacity), 0);
    if (seats < candidates.length) {
      throw new HttpError(422, candidates.length + ' candidates and ' + seats
        + ' seats. Add another hall.');
    }

    const rows: { tenant_id: number; exam_id: number; hall_id: number; user_id: string; seat_label: string }[] = [];
    let index = 0;
    for (const hall of halls) {
      const capacity = Number(hall.capacity);
      const cols = Number(hall.col_count);
      for (let seat = 0; seat < capacity && index < candidates.length; seat += 1) {
        rows.push({
          tenant_id: tenantId,
          exam_id: examId,
          hall_id: Number(hall.id),
          user_id: candidates[index]!,
          seat_label: 'R' + (Math.floor(seat / cols) + 1) + 'C' + ((seat % cols) + 1),
        });
        index += 1;
      }
    }

    await this.#db.from('onyx_seat_allocations').delete()
      .eq('tenant_id', tenantId).eq('exam_id', examId);
    const { error } = await this.#db.from('onyx_seat_allocations').insert(rows);
    if (error) throw new HttpError(500, 'Could not allocate seats: ' + error.message);

    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'seating.allocated', entityType: 'exam', entityId: examId,
        after: { seated: rows.length, halls: hallIds } });
    return { seated: rows.length, halls: halls.length };
  }

  /** The plan, hall by hall -- what gets printed and pinned to the door. */
  async seatingPlan(tenantId: number, examId: number) {
    await this.exam(tenantId, examId);
    const { data } = await this.#db.from('onyx_seat_allocations').select(SEAT_COLUMNS)
      .eq('tenant_id', tenantId).eq('exam_id', examId)
      .order('hall_id', { ascending: true }).order('seat_label', { ascending: true });
    const seats = data ?? [];

    // A seating plan is pinned to a door and read against a hall ticket, and a
    // hall ticket carries a number. Names alone meant an invigilator matching
    // spellings under time pressure.
    const people = await peopleFor(this.#db, tenantId, seats.map((s) => s.user_id));

    const byHall = new Map<number, { hall_id: number; hall: string; seats: unknown[] }>();
    for (const seat of seats) {
      const hallId = Number(seat.hall_id);
      if (!byHall.has(hallId)) byHall.set(hallId, { hall_id: hallId, hall: '', seats: [] });
      byHall.get(hallId)!.seats.push({
        seat_label: seat.seat_label,
        user_id: String(seat.user_id),
        name: people.get(String(seat.user_id))?.name ?? null,
        roll_number: people.get(String(seat.user_id))?.roll_number ?? null,
      });
    }

    for (const hallId of byHall.keys()) {
      const { data: hall } = await this.#db.from('onyx_halls').select('code, name')
        .eq('tenant_id', tenantId).eq('id', hallId).maybeSingle();
      if (hall) byHall.get(hallId)!.hall = String(hall.code) + ' -- ' + String(hall.name);
    }

    return { exam_id: examId, total: seats.length, halls: [...byHall.values()] };
  }

  /**
   * The seating plan and the attendance sheet, as paper.
   *
   * CMP-02b's words are "printable seating plans and attendance sheets", and
   * the emphasis is the point: this is the one artefact in the product whose
   * destination is a door and an invigilator's clipboard, not a screen. An HTML
   * table is not that, which is why it needed a real document.
   *
   * One document per hall, because that is how it is used -- the sheet for Main
   * Hall goes to Main Hall. The signature column is empty on purpose: it is
   * what an invigilator writes in, and it is the reason the sheet exists rather
   * than the roster already on the screen.
   */
  async seatingPdf(tenantId: number, examId: number, opts: {
    issuer?: string | null; issuedAt?: number;
  } = {}): Promise<Buffer> {
    const exam = await this.exam(tenantId, examId);
    const plan = await this.seatingPlan(tenantId, examId);

    const rows: (string | number)[][] = [];
    for (const hall of plan.halls) {
      for (const seat of hall.seats as { seat_label: string; user_id: string; name: string | null }[]) {
        rows.push([
          hall.hall,
          seat.seat_label,
          seat.name ?? 'User ' + seat.user_id,
          String(seat.user_id),
          // Two empty columns: present, and a signature. Paper that cannot be
          // written on is a printout, not an attendance sheet.
          '',
          '',
        ]);
      }
    }

    return pdfTable({
      title: exam.title,
      subtitle: 'Seating plan and attendance sheet',
      meta: [
        new Date(String(exam.starts_at)).toUTCString()
          + ' · ' + exam.duration_minutes + ' minutes',
        plan.total + (plan.total === 1 ? ' candidate' : ' candidates')
          + ' across ' + plan.halls.length + (plan.halls.length === 1 ? ' hall' : ' halls'),
        'Invigilator __________________________   Signed __________________________',
      ],
      columns: [
        { header: 'Hall', width: 180 },
        { header: 'Seat', width: 70 },
        { header: 'Candidate', width: 220 },
        { header: 'Id', width: 60, align: 'right' },
        { header: 'Present', width: 70 },
        { header: 'Signature', width: 170 },
      ],
      rows,
      footer: (opts.issuer ?? 'Onyx LMS')
        + ' · generated ' + new Date(opts.issuedAt ?? this.#now()).toISOString().slice(0, 10),
    });
  }

  /** Where one candidate sits. What the learner's own page asks for. */
  async seatFor(tenantId: number, examId: number, userId: string) {
    const { data } = await this.#db.from('onyx_seat_allocations').select(SEAT_COLUMNS)
      .eq('tenant_id', tenantId).eq('exam_id', examId).eq('user_id', userId).maybeSingle();
    return data ?? null;
  }

  // -------------------------------------------------------------------------
  // CMP-02c: marks, moderation, transcripts
  // -------------------------------------------------------------------------

  async enterMarks(tenantId: number, examId: number, actor: { userId: string; role: Role },
    entries: { user_id: string; raw_marks: number }[]) {
    if (!canRunExams(actor.role) && actor.role !== 'faculty') {
      throw new HttpError(403, 'Only faculty or the examinations office can enter marks.');
    }
    const exam = await this.exam(tenantId, examId);
    const maxMarks = Number(exam.max_marks);
    const passMarks = Number(exam.pass_marks);

    const roster = await this.#candidates(tenantId, Number(exam.course_id));
    const written: string[] = [];

    for (const entry of entries) {
      if (!roster.has(String(entry.user_id))) {
        throw new HttpError(422, 'User ' + entry.user_id + ' is not enrolled in that course.');
      }
      if (entry.raw_marks < 0 || entry.raw_marks > maxMarks) {
        throw new HttpError(422, 'A mark has to be between 0 and ' + maxMarks
          + '; got ' + entry.raw_marks + ' for user ' + entry.user_id + '.');
      }

      const band = gradeFor(entry.raw_marks, maxMarks, passMarks);
      const { data: existing } = await this.#db.from('onyx_exam_marks').select('id, status')
        .eq('tenant_id', tenantId).eq('exam_id', examId).eq('user_id', entry.user_id)
        .maybeSingle();

      if (existing) {
        if (existing.status === 'published') {
          throw new HttpError(409, 'User ' + entry.user_id
            + ' already has a published mark. Publishing is not undone by re-entry.');
        }
        await this.#db.from('onyx_exam_marks').update({
          raw_marks: entry.raw_marks,
          final_marks: entry.raw_marks,
          moderation_delta: 0,
          grade: band.grade,
          grade_points: band.points,
          status: 'entered',
          entered_by: actor.userId,
          updated_at: new Date(this.#now()).toISOString(),
        }).eq('tenant_id', tenantId).eq('id', existing.id);
      } else {
        await this.#db.from('onyx_exam_marks').insert({
          tenant_id: tenantId, exam_id: examId, user_id: entry.user_id,
          raw_marks: entry.raw_marks, moderation_delta: 0, final_marks: entry.raw_marks,
          grade: band.grade, grade_points: band.points,
          status: 'entered', entered_by: actor.userId,
        });
      }
      written.push(String(entry.user_id));
    }

    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'marks.entered', entityType: 'exam', entityId: examId,
        after: { count: written.length } });
    return { entered: written.length };
  }

  /**
   * Override one mark directly -- a dispute or a data-entry fix, not a
   * moderation pass across the whole paper (moderate(), below, stays the
   * board's tool, with its own delta+reason shape). Unlike enterMarks(),
   * this works regardless of status: an administrator resolving a dispute is
   * the deliberate override, not the everyday path enterMarks() protects
   * with its "not after publish" rule.
   */
  async updateMark(tenantId: number, markId: number, actor: { userId: string; role: Role },
    patch: { raw_marks?: number; final_marks?: number }) {
    if (!canRunExams(actor.role)) {
      throw new HttpError(403, 'Only the examinations office can change a mark.');
    }
    const { data: mark } = await this.#db.from('onyx_exam_marks').select(MARK_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', markId).maybeSingle();
    if (!mark) throw new HttpError(404, 'No such mark.');
    const exam = await this.exam(tenantId, Number(mark.exam_id));
    const maxMarks = Number(exam.max_marks);
    const passMarks = Number(exam.pass_marks);

    const raw = patch.raw_marks ?? Number(mark.raw_marks);
    const final = patch.final_marks ?? raw;
    if (final < 0 || final > maxMarks) {
      throw new HttpError(422, 'A mark has to be between 0 and ' + maxMarks + '.');
    }
    const band = gradeFor(final, maxMarks, passMarks);
    const before = { raw_marks: mark.raw_marks, final_marks: mark.final_marks, grade: mark.grade };
    const after = {
      raw_marks: raw, final_marks: final, grade: band.grade, grade_points: band.points,
    };

    await this.#db.from('onyx_exam_marks')
      .update({ ...after, updated_at: new Date(this.#now()).toISOString() }).eq('id', markId);
    await this.#audit.record({ tenant_id: tenantId, user_id: actor.userId },
      { action: 'marks.overridden', entityType: 'exam_mark', entityId: markId, before, after });
    return { id: markId, ...after };
  }

  /**
   * Apply a moderation delta across a paper.
   *
   * The raw mark is never overwritten -- the delta is stored beside it, so the
   * board's decision and the marker's judgement stay separable afterwards. A
   * moderated mark is still clamped to the paper's range: a +10 on a 95 gives
   * 100, not 105.
   */
  async moderate(tenantId: number, examId: number, actor: { userId: string; role: Role },
    delta: number, reason: string) {
    if (!canRunExams(actor.role) && actor.role !== 'faculty') {
      throw new HttpError(403, 'Only the examinations office or the course’s own faculty '
        + 'can moderate a paper.');
    }
    if (!reason.trim()) throw new HttpError(422, 'Moderation needs a reason.');
    const exam = await this.exam(tenantId, examId);
    const maxMarks = Number(exam.max_marks);
    const passMarks = Number(exam.pass_marks);

    const { data: marks } = await this.#db.from('onyx_exam_marks').select(MARK_COLUMNS)
      .eq('tenant_id', tenantId).eq('exam_id', examId).neq('status', 'published');
    if (!marks?.length) throw new HttpError(422, 'There are no unpublished marks to moderate.');

    const at = new Date(this.#now()).toISOString();
    for (const mark of marks) {
      const final = Math.max(0, Math.min(maxMarks, Number(mark.raw_marks) + delta));
      const band = gradeFor(final, maxMarks, passMarks);
      await this.#db.from('onyx_exam_marks').update({
        moderation_delta: delta,
        final_marks: final,
        grade: band.grade,
        grade_points: band.points,
        status: 'moderated',
        moderated_by: actor.userId,
        moderated_at: at,
        updated_at: at,
      }).eq('tenant_id', tenantId).eq('id', mark.id);
    }

    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'marks.moderated', entityType: 'exam', entityId: examId,
        after: { delta, reason: reason.trim(), affected: marks.length } });
    return { moderated: marks.length, delta };
  }

  async publishMarks(tenantId: number, examId: number, actor: { userId: string; role: Role }) {
    if (!canRunExams(actor.role) && actor.role !== 'faculty') {
      throw new HttpError(403, 'Only the examinations office or the course’s own faculty '
        + 'can publish results.');
    }
    await this.exam(tenantId, examId);
    const at = new Date(this.#now()).toISOString();

    const { data: marks } = await this.#db.from('onyx_exam_marks').select('id')
      .eq('tenant_id', tenantId).eq('exam_id', examId).neq('status', 'published');
    if (!marks?.length) throw new HttpError(422, 'There is nothing left to publish.');

    await this.#db.from('onyx_exam_marks')
      .update({ status: 'published', published_at: at, updated_at: at })
      .eq('tenant_id', tenantId).eq('exam_id', examId).neq('status', 'published');
    await this.#db.from('onyx_exams').update({ status: 'completed', updated_at: at })
      .eq('tenant_id', tenantId).eq('id', examId);

    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'result.published', entityType: 'exam', entityId: examId,
        after: { published: marks.length } });
    return { published: marks.length };
  }

  /**
   * One person's marks.
   *
   * A learner asking about themselves sees published marks only. Staff see
   * everything, because somebody has to be able to look at a paper before it
   * goes out.
   */
  async marksFor(tenantId: number, userId: string, viewer: { userId: string; role: Role },
    filters: { exam_id?: number } = {}) {
    const own = viewer.userId === userId;
    if (!own && !canRunExams(viewer.role) && viewer.role !== 'faculty') {
      throw new HttpError(403, 'Those are not your marks.');
    }

    let q = this.#db.from('onyx_exam_marks').select(MARK_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId);
    if (filters.exam_id) q = q.eq('exam_id', filters.exam_id);
    if (own && !canRunExams(viewer.role)) q = q.eq('status', 'published');

    const { data } = await q.order('id', { ascending: true });
    return this.#withExam(tenantId, data ?? []);
  }

  /**
   * Attaches each mark's examination -- QA F11.
   *
   * `onyx_exam_marks` holds no title, so a learner's own results page had
   * nothing to print and fell back to "Exam #125": their official record,
   * naming the paper by its primary key, on the one screen they would show a
   * parent or attach to an application. A guardian looking at the same mark
   * already saw the real title, because GuardianService resolves it.
   *
   * One `.in()` for the whole page rather than the per-mark lookup the
   * guardian does -- a transcript is a list, and a query per row is how a
   * list becomes slow the term somebody sits ten papers.
   *
   * Nested under `exam` because that is the shape the platform grades screen
   * already reads (`marks[0]?.exam?.title`).
   */
  async #withExam(tenantId: number, marks: Record<string, unknown>[]) {
    if (!marks.length) return marks;
    const ids = [...new Set(marks.map((m) => Number(m.exam_id)).filter(Boolean))];
    if (!ids.length) return marks;
    const { data } = await this.#db.from('onyx_exams')
      .select('id, title, starts_at, max_marks, pass_marks, course_id')
      .eq('tenant_id', tenantId).in('id', ids);
    const byId = new Map((data ?? []).map((e) => [Number(e.id), e]));
    return marks.map((m) => ({ ...m, exam: byId.get(Number(m.exam_id)) ?? null }));
  }

  async marksForExam(tenantId: number, examId: number, viewer: { role: Role }) {
    if (!canRunExams(viewer.role) && viewer.role !== 'faculty') {
      throw new HttpError(403, 'Staff only.');
    }
    await this.exam(tenantId, examId);
    const { data } = await this.#db.from('onyx_exam_marks').select(MARK_COLUMNS)
      .eq('tenant_id', tenantId).eq('exam_id', examId).order('user_id', { ascending: true });
    return data ?? [];
  }

  /**
   * Issue a transcript from the published marks.
   *
   * Only published marks go on it: a transcript built from a mark still under
   * moderation is a document that will contradict itself next week.
   */
  async issueTranscript(tenantId: number, userId: string, actor: { userId: string; role: Role },
    opts: { program_id?: number | null } = {}) {
    if (!canRunExams(actor.role)) {
      throw new HttpError(403, 'Only the examinations office can issue a transcript.');
    }
    const { data: membership } = await this.#db.from('onyx_memberships').select('id')
      .eq('tenant_id', tenantId).eq('user_id', userId).eq('status', 1).maybeSingle();
    if (!membership) throw new HttpError(404, 'No such member of this institution.');

    const { data: marks } = await this.#db.from('onyx_exam_marks').select(MARK_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId).eq('status', 'published')
      .order('exam_id', { ascending: true });
    if (!marks?.length) {
      throw new HttpError(422, 'That learner has no published results yet.');
    }

    const lines: { exam_id: number; title: string; final_marks: number; max_marks: number; grade: string; points: number }[] = [];
    for (const mark of marks) {
      const exam = await this.exam(tenantId, Number(mark.exam_id));
      lines.push({
        exam_id: Number(mark.exam_id),
        title: String(exam.title),
        final_marks: Number(mark.final_marks),
        max_marks: Number(exam.max_marks),
        grade: String(mark.grade ?? ''),
        points: Number(mark.grade_points ?? 0),
      });
    }

    const gpa = lines.length
      ? Number((lines.reduce((s, l) => s + l.points, 0) / lines.length).toFixed(2))
      : 0;
    const payload = { user_id: userId, program_id: opts.program_id ?? null, lines };
    const checksum = checksumOf(canonicalise(payload));

    const { data, error } = await this.#db.from('onyx_transcripts').insert({
      tenant_id: tenantId,
      user_id: userId,
      program_id: opts.program_id ?? null,
      // Unguessable rather than sequential: a serial number tells anybody
      // holding one how many the institution has issued, and lets them try the
      // next one.
      serial: 'TR-' + randomBytes(12).toString('hex').toUpperCase(),
      payload,
      gpa,
      credits_earned: lines.length,
      checksum,
      issued_by: actor.userId,
    }).select(TRANSCRIPT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not issue the transcript: ' + error.message);

    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'transcript.generated', entityType: 'transcript', entityId: Number(data!.id),
        after: { user_id: userId, serial: data!.serial, checksum } });
    return data;
  }

  /**
   * Does this transcript still reconcile with the marks behind it?
   *
   * Two separate answers, and they are not the same question:
   *   * `intact` -- the stored payload still hashes to the stored checksum.
   *     False means the row was tampered with.
   *   * `current` -- the marks today still produce that payload. False is
   *     normal after a remark, and means the transcript should be reissued
   *     rather than that anything is wrong.
   */
  async verifyTranscript(tenantId: number, serial: string) {
    const { data } = await this.#db.from('onyx_transcripts').select(TRANSCRIPT_COLUMNS)
      .eq('tenant_id', tenantId).eq('serial', serial).maybeSingle();
    if (!data) throw new HttpError(404, 'No such transcript.');

    const stored = data.payload as { user_id: string; program_id: number | null; lines: { exam_id: number; final_marks: number; max_marks: number; grade: string }[] };
    const intact = checksumOf(canonicalise(stored)) === data.checksum;

    const { data: marks } = await this.#db.from('onyx_exam_marks').select(MARK_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', String(data.user_id)).eq('status', 'published')
      .order('exam_id', { ascending: true });

    const liveLines: { exam_id: number; final_marks: number; max_marks: number; grade: string }[] = [];
    for (const mark of marks ?? []) {
      const exam = await this.exam(tenantId, Number(mark.exam_id));
      liveLines.push({
        exam_id: Number(mark.exam_id),
        final_marks: Number(mark.final_marks),
        max_marks: Number(exam.max_marks),
        grade: String(mark.grade ?? ''),
      });
    }
    const live = checksumOf(canonicalise({
      user_id: String(data.user_id),
      program_id: data.program_id === null ? null : Number(data.program_id),
      lines: liveLines,
    }));

    return {
      serial: data.serial,
      issued_at: data.issued_at,
      revoked_at: data.revoked_at,
      gpa: data.gpa,
      intact,
      current: live === data.checksum,
      checksum: data.checksum,
      lines: stored.lines.length,
    };
  }

  /**
   * The same reconciliation as `verifyTranscript`, but for the person who
   * cannot call that one at all: an employer holding a printed transcript has
   * no Onyx account and no tenant id to send, and `verifyTranscript` requires
   * both. This was the gap -- CMP-02 promises "transcript generation end to
   * end", and end to end has to include the third party who was handed the
   * document being able to check it. CAR-03 already solved exactly this shape
   * of problem for certificates; this is the same answer for transcripts.
   *
   * Looked up by serial ALONE, deliberately not tenant-scoped, for the same
   * reason certificate verification is not: a verifier does not know which
   * institution issued what they are holding, and requiring them to know
   * would make the feature useless to them.
   *
   * "Not found" and "malformed serial" are the same answer for the same
   * reason as CAR-03's: a verifier learns only whether the one in their hand
   * is good, never whether some OTHER serial would have worked.
   */
  async verifyTranscriptPublic(serial: string) {
    const trimmed = serial.trim().toUpperCase();
    if (!/^TR-[0-9A-F]{8,64}$/.test(trimmed)) {
      return { found: false as const };
    }

    const { data } = await this.#db.from('onyx_transcripts').select(TRANSCRIPT_COLUMNS)
      .eq('serial', trimmed).maybeSingle();
    if (!data) return { found: false as const };

    const stored = data.payload as { user_id: string; program_id: number | null; lines: { exam_id: number; final_marks: number; max_marks: number; grade: string }[] };
    const intact = checksumOf(canonicalise(stored)) === data.checksum;

    const [{ data: tenant }, { data: holder }] = await Promise.all([
      this.#db.from('onyx_tenants').select('id, name').eq('id', data.tenant_id).maybeSingle(),
      // Name only, matching CAR-03: not the email, not the id, not the marks
      // themselves -- a verifier needs to match a name on a document, not be
      // handed the record.
      this.#db.from('onyx_users').select('name').eq('id', data.user_id).maybeSingle(),
    ]);

    // "Current" needs the live register, and that register is tenant-scoped --
    // this is the one place data.tenant_id is used, read off the row itself
    // rather than trusted from the caller, which is exactly why this can be
    // public at all: the tenant comes from what was found, never from input.
    const { data: marks } = await this.#db.from('onyx_exam_marks').select(MARK_COLUMNS)
      .eq('tenant_id', data.tenant_id).eq('user_id', String(data.user_id)).eq('status', 'published')
      .order('exam_id', { ascending: true });
    const liveLines: { exam_id: number; final_marks: number; max_marks: number; grade: string }[] = [];
    for (const mark of marks ?? []) {
      const exam = await this.exam(Number(data.tenant_id), Number(mark.exam_id));
      liveLines.push({
        exam_id: Number(mark.exam_id), final_marks: Number(mark.final_marks),
        max_marks: Number(exam.max_marks), grade: String(mark.grade ?? ''),
      });
    }
    const live = checksumOf(canonicalise({
      user_id: String(data.user_id),
      program_id: data.program_id === null ? null : Number(data.program_id),
      lines: liveLines,
    }));

    return {
      found: true as const,
      serial: data.serial,
      holder: holder?.name ?? null,
      issuer: tenant?.name ?? null,
      issued_at: data.issued_at,
      revoked_at: data.revoked_at,
      gpa: data.gpa,
      credits_earned: data.credits_earned,
      intact,
      current: live === data.checksum,
      lines: stored.lines.length,
    };
  }

  async transcripts(tenantId: number, userId: string, viewer: { userId: string; role: Role }) {
    if (viewer.userId !== userId && !canRunExams(viewer.role)) {
      throw new HttpError(403, 'Those are not your transcripts.');
    }
    const { data } = await this.#db.from('onyx_transcripts').select(TRANSCRIPT_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId)
      .order('issued_at', { ascending: false });
    return data ?? [];
  }

  /** Marks for one person, but only the published ones. The guardian path. */
  async publishedMarks(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_exam_marks')
      .select(MARK_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId).eq('status', 'published')
      .order('exam_id', { ascending: true });
    return (data ?? []) as { exam_id: number; final_marks: number; grade: string | null; status: MarkStatus }[];
  }
}
