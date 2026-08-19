/**
 * Onyx O07 -- CMP-01 to CMP-04.
 *
 * Academic administration, timetables, examinations, fees and guardians.
 *
 * Three roles appear here that appear nowhere else in this shape:
 *
 *   * **`exams`** owns the calendar, the halls, moderation and publication. Not
 *     `faculty`: a lecturer may enter marks for their own paper and may not
 *     decide when results go out.
 *   * **`admin`** owns money. Fees are the one area where faculty have no
 *     access at all, in either direction.
 *   * **`guardian`** reaches exactly four routes, all of them derived from
 *     links other people control, and none of them taking a learner id the
 *     guardian chose without the service checking the link first.
 */
import type { Router, ReqLike } from '../../router.ts';
import { z } from 'zod';
import { validate, ok, requireOnyx, requireOnyxRole, HttpError } from '@onyx/core';
import type { Role } from '@onyx/types';
import type { AppContext } from '../../app-context.ts';
import { assertCan } from '../../capability.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike, key = 'id') =>
  Number((req.params as Record<string, string>)[key]);

/** A path segment that names a person, not an entity -- their auth uuid, not `Number()`'d. */
const uidOf = (req: ReqLike, key: string) =>
  String((req.params as Record<string, string>)[key] ?? '');

const ipOf = (req: ReqLike) => (req as unknown as { ip?: string }).ip ?? null;

/** The registry: who builds the term. */
// The outer bound: roles the timetable and registry capabilities may ever be
// granted to (permissions.ts `holders`). Which of them actually hold one is
// the institution's answer, checked by assertCan inside each route.
const REGISTRY = ['admin', 'exams', 'faculty'] as const;
/** The examinations office. */
const EXAMS = ['admin', 'exams'] as const;
/** Faculty may enter marks for a paper; only EXAMS may moderate or publish. */
const MARKERS = ['admin', 'exams', 'faculty'] as const;

const TimeSchema = z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/,
  'A time looks like 09:00.');

export function registerOnyxCampusRoutes(app: Router, ctx: AppContext): void {
  const viewerOf = async (req: ReqLike) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return { claims, viewer: { role: claims.tenant_role, userId: claims.user_id } };
  };

  /**
   * The one thing that makes an exam's `assessment_id` mean something: the
   * linked CBT paper's window is forced to exactly the exam's scheduled
   * slot, not the flexible open/close range a standalone assessment picks
   * for itself. That is the entire difference the proposal draws between
   * the two -- "assessments any time before the deadline, examinations at
   * their scheduled time only" -- and it is enforced here rather than
   * invented twice, because AssessService.start() already refuses an
   * attempt outside opens_at/closes_at. Locking the window to the exam's
   * slot is the whole mechanism; nothing new has to check the clock.
   *
   * The field existed on the exams table and accepted this input long
   * before anything read it back -- an exam could be told an
   * `assessment_id` and it went nowhere. This is where it starts meaning
   * something.
   */
  /**
   * Scheduling, editing, moderating or publishing an exam: the examinations
   * office runs the calendar institution-wide, or this specific course's own
   * faculty may -- not faculty tenant-wide, the same course-scoped trust
   * already extended to course management, workspace visibility and
   * practice problems this session. A lecturer running their own course's
   * midterm no longer needs the examinations office to schedule it, mark it
   * or release it for them.
   */
  async function assertCanRunExam(
    tenantId: number, courseId: number, userId: string, role: Role,
  ) {
    if (role === 'admin' || role === 'exams') return;
    await ctx.onyxAcademics.assertCanTeach(tenantId, courseId, userId, role);
  }

  /**
   * Scheduling specifically, not the rest of what assertCanRunExam gates.
   * An institution can switch this off for faculty while leaving marking,
   * publishing and everything else about an exam faculty already run
   * untouched -- this is deliberately its own check, not folded into
   * assertCanRunExam, so it is never accidentally checked on those other
   * actions too.
   */
  async function assertCanScheduleExam(tenantId: number, role: Role) {
    // The matrix answers this for every role now (permissions.ts,
    // `exams.schedule`). The 0012 flag is kept as a FLOOR rather than dropped:
    // an institution that switched faculty scheduling off before the matrix
    // existed has that decision recorded only in the flag, and honouring the
    // matrix alone would silently hand the capability back.
    await assertCan(ctx, tenantId, role, 'exams.schedule');
    if (role !== 'faculty') return;
    const tenant = await ctx.onyxTenancy.tenant(tenantId);
    if (!tenant.faculty_can_schedule_exams) {
      throw new HttpError(403,
        'Your institution has switched off faculty scheduling exams. Ask an administrator.');
    }
  }

  /**
   * Tells the course's own faculty (other than whoever just scheduled it)
   * and everyone enrolled that a paper landed on their calendar. Notifying
   * never blocks or fails the request it followed from -- see NotifyService's
   * own doc comment -- so this runs after the exam already exists and its
   * own errors go nowhere the caller can see.
   */
  async function notifyExamScheduled(
    tenantId: number, scheduledBy: string, courseId: number,
    exam: { id: number; title: string; starts_at: string },
  ) {
    const [faculty, roster] = await Promise.all([
      ctx.onyxAcademics.faculty(tenantId, courseId),
      ctx.onyxAcademics.roster(tenantId, courseId),
    ]);
    const when = new Date(exam.starts_at).toLocaleString(undefined,
      { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const recipients = [
      ...faculty.map((f) => String(f.user_id)).filter((id) => id !== scheduledBy),
      ...roster.map((r) => String(r.user_id)),
    ];
    await ctx.onyxNotify.notifyAll(tenantId, recipients.map((userId) => ({
      userId,
      kind: 'exam.scheduled' as const,
      title: '"' + exam.title + '" has been scheduled',
      body: 'Starts ' + when + '.',
      link: '/onyx/exams/' + exam.id,
    })));
  }

  async function syncExamAssessmentWindow(
    tenantId: number, assessmentId: number,
    exam: { course_id: number; starts_at: string; duration_minutes: number; status: string },
    actor: { userId: string; role: Role },
  ) {
    const assessment = await ctx.onyxAssess.assessment(tenantId, assessmentId);
    if (Number(assessment.course_id) !== Number(exam.course_id)) {
      throw new HttpError(422,
        'That assessment is not on this exam’s course — pick one that is, or leave it unlinked.');
    }
    const start = Date.parse(exam.starts_at);
    const end = start + exam.duration_minutes * 60_000;
    await ctx.onyxAssess.updateAssessment(tenantId, assessmentId, actor, {
      opens_at: new Date(start).toISOString(),
      closes_at: new Date(end).toISOString(),
      duration_minutes: exam.duration_minutes,
      // A cancelled exam's paper stops taking attempts; scheduling or
      // editing an active one never force-publishes it -- that stays the
      // office's own decision, made once the paper is actually ready.
      status: exam.status === 'cancelled' ? 'closed' : undefined,
    });
  }

  // =========================================================================
  // CMP-01a -- faculty allocation
  // =========================================================================

  app.post('/api/onyx/allocations', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    const body = validate(z.object({
      semester_id: z.number().int().positive(),
      course_id: z.number().int().positive(),
      user_id: z.string().uuid(),
      batch_id: z.number().int().positive().nullish(),
      kind: z.enum(['lead', 'assistant', 'lab']).optional(),
      hours_per_week: z.number().int().min(0).max(60).optional(),
    }), req.body);
    return ok(await ctx.onyxCampus.allocate(claims.tenant_id, body));
  });

  app.get('/api/onyx/allocations', async (req) => {
    const { claims } = await viewerOf(req);
    const query = req.query as { semester_id?: string; user_id?: string };
    return ok(await ctx.onyxCampus.allocations(claims.tenant_id, {
      semester_id: query.semester_id ? Number(query.semester_id) : undefined,
      user_id: query.user_id,
    }));
  });

  app.get('/api/onyx/semesters/:id/workload', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    return ok(await ctx.onyxCampus.workload(claims.tenant_id, idOf(req)));
  });

  // =========================================================================
  // CMP-01b -- rooms and the timetable
  // =========================================================================

  app.post('/api/onyx/rooms', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'timetable.manage');
    const body = validate(z.object({
      code: z.string().min(1).max(40),
      name: z.string().min(1).max(255),
      capacity: z.number().int().min(0).max(5000).optional(),
      kind: z.enum(['lecture', 'lab', 'seminar', 'hall']).optional(),
      building: z.string().max(120).nullish(),
    }), req.body);
    return ok(await ctx.onyxCampus.createRoom(claims.tenant_id, body));
  });

  app.get('/api/onyx/rooms', async (req) => {
    const { claims } = await viewerOf(req);
    return ok(await ctx.onyxCampus.rooms(claims.tenant_id));
  });

  /**
   * Ask before you submit.
   *
   * The UI calls this as the form is filled in, so a registrar sees the clash
   * named while they can still change the answer rather than after a 409.
   */
  app.post('/api/onyx/timetable/check', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'timetable.manage');
    const body = validate(z.object({
      semester_id: z.number().int().positive(),
      course_id: z.number().int().positive(),
      batch_id: z.number().int().positive(),
      room_id: z.number().int().positive(),
      faculty_id: z.string().uuid(),
      day_of_week: z.number().int().min(1).max(7),
      starts_at: TimeSchema,
      ends_at: TimeSchema,
      exclude_id: z.number().int().positive().optional(),
    }), req.body);
    const clashes = await ctx.onyxCampus.clashes(claims.tenant_id, body);
    return ok({ clear: clashes.length === 0, clashes });
  });

  app.post('/api/onyx/timetable', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'timetable.manage');
    const body = validate(z.object({
      semester_id: z.number().int().positive(),
      course_id: z.number().int().positive(),
      batch_id: z.number().int().positive(),
      room_id: z.number().int().positive(),
      faculty_id: z.string().uuid(),
      day_of_week: z.number().int().min(1).max(7),
      starts_at: TimeSchema,
      ends_at: TimeSchema,
    }), req.body);
    return ok(await ctx.onyxCampus.schedule(claims.tenant_id, body));
  });

  /**
   * The grid. A learner only ever sees the published one -- a draft timetable
   * on a learner's phone is a room they turn up to and nobody else does.
   *
   * Unscoped by default, this returned the whole institution's grid to every
   * role alike -- a student reading their own timetable had to pick their
   * classes out of every batch's. Registry (admin/exams) still gets
   * everything, because building and auditing the grid is their job. Faculty
   * default to their own sessions, students to their own enrolled courses;
   * either can still ask for the full grid with `?scope=all`, or narrow with
   * an explicit filter, same as before.
   */
  app.get('/api/onyx/timetable', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const query = req.query as {
      semester_id?: string; batch_id?: string; faculty_id?: string; room_id?: string;
      course_id?: string; scope?: string;
    };
    const staff = viewer.role === 'admin' || viewer.role === 'faculty'
      || viewer.role === 'exams';
    const registry = viewer.role === 'admin' || viewer.role === 'exams';
    // Who may look past their own week at all.
    //
    // `scope=all` and the batch/faculty/room filters used to be open to
    // anybody, so a learner could ask for -- and get -- every published
    // session in the institution: who teaches what, when, and in which room.
    // That is a staff view of the estate, not a learner's schedule. It is now
    // staff only, and a learner is scoped to their own enrolments whatever
    // they ask for.
    const explicitFilter = staff
      && Boolean(query.batch_id || query.faculty_id || query.room_id);
    const wantsAll = registry || (staff && query.scope === 'all') || explicitFilter;

    let facultyFilter = staff && query.faculty_id ? query.faculty_id : undefined;
    let roomFilter = staff && query.room_id ? Number(query.room_id) : undefined;
    let batchFilter = staff && query.batch_id ? Number(query.batch_id) : undefined;
    let courseIds: number[] | undefined;
    let courseFilter: number | undefined;

    if (!wantsAll) {
      if (viewer.role === 'faculty') {
        facultyFilter = claims.user_id;
      } else {
        const mine = await ctx.onyxAcademics.enrollmentsFor(claims.tenant_id, claims.user_id);
        courseIds = mine.map((e) => Number(e.course_id));
      }
    }

    // One course's timings, for the course page. A learner may ask this only
    // about a course they are actually on -- otherwise it is the same
    // institution-wide read through a narrower door.
    if (query.course_id) {
      const asked = Number(query.course_id);
      if (staff || (courseIds ?? []).includes(asked)) {
        courseFilter = asked;
      } else {
        // Not theirs: answer with nothing rather than with somebody else's.
        courseIds = [];
      }
    }

    return ok(await ctx.onyxCampus.timetable(claims.tenant_id, {
      semester_id: query.semester_id ? Number(query.semester_id) : undefined,
      batch_id: batchFilter,
      faculty_id: facultyFilter,
      room_id: roomFilter,
      course_id: courseFilter,
      course_ids: courseIds,
      publishedOnly: !staff,
    }));
  });

  app.post('/api/onyx/timetable/publish', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'timetable.publish');
    const body = validate(z.object({
      semester_id: z.number().int().positive(),
    }), req.body);
    return ok(await ctx.onyxCampus.publish(claims.tenant_id, body.semester_id, claims.user_id));
  });

  app.delete('/api/onyx/timetable/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'timetable.manage');
    return ok(await ctx.onyxCampus.removeSlot(claims.tenant_id, idOf(req)));
  });

  // =========================================================================
  // CMP-02a -- the exam calendar
  // =========================================================================

  app.post('/api/onyx/exams', async (req) => {
    // Guard first, validate second, same rule as everywhere else in this file:
    // a role that can NEVER schedule an exam -- a student, an employer, a
    // guardian -- is refused before it can learn anything about the shape the
    // API expects, rather than being let through to a validation error. Only
    // faculty need the finer, course-scoped question ("do you teach THIS
    // course"), and that one genuinely cannot be answered before the body is
    // parsed -- so it stays a second check, after validate(), for faculty only.
    await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'exams', 'faculty');
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({
      semester_id: z.number().int().positive(),
      course_id: z.number().int().positive(),
      title: z.string().min(1).max(255),
      starts_at: z.string().min(1),
      duration_minutes: z.number().int().min(5).max(600).optional(),
      max_marks: z.number().int().min(1).max(1000).optional(),
      pass_marks: z.number().int().min(0).max(1000).optional(),
      assessment_id: z.number().int().positive().nullish(),
    }), req.body);
    await assertCanRunExam(claims.tenant_id, body.course_id, claims.user_id, claims.tenant_role);
    await assertCanScheduleExam(claims.tenant_id, claims.tenant_role);
    // Checked here, before the exam is written, not only inside
    // syncExamAssessmentWindow() below -- that check used to run AFTER
    // schedule() had already inserted the row, so a mismatched course threw
    // its 422 too late to stop anything: the exam was left sitting in the
    // database half-linked to an assessment on somebody else's course, and
    // that assessment's own window was never touched. A candidate later
    // following "Sit this exam" landed on the wrong paper, outside the
    // window it was never synced to -- which is exactly what looked like a
    // broken proctoring flow from the student's side, when the real fault
    // was an exam that should never have been created in this shape.
    if (body.assessment_id) {
      const assessment = await ctx.onyxAssess.assessment(claims.tenant_id, body.assessment_id);
      if (Number(assessment.course_id) !== Number(body.course_id)) {
        throw new HttpError(422,
          'That assessment is not on this exam’s course — pick one that is, or leave it unlinked.');
      }
    }
    const exam = await ctx.onyxExams.schedule(claims.tenant_id, viewer, body);
    if (body.assessment_id && exam) {
      await syncExamAssessmentWindow(claims.tenant_id, body.assessment_id, exam, viewer);
    }
    if (exam) await notifyExamScheduled(claims.tenant_id, claims.user_id, body.course_id, exam);
    return ok(exam);
  });

  app.get('/api/onyx/exams', async (req) => {
    const { claims } = await viewerOf(req);
    const query = req.query as { semester_id?: string; course_id?: string };
    return ok(await ctx.onyxExams.exams(claims.tenant_id, {
      semester_id: query.semester_id ? Number(query.semester_id) : undefined,
      course_id: query.course_id ? Number(query.course_id) : undefined,
    }));
  });

  app.get('/api/onyx/exams/:id', async (req) => {
    const { claims } = await viewerOf(req);
    return ok(await ctx.onyxExams.exam(claims.tenant_id, idOf(req)));
  });

  /** Correct a scheduled exam, or cancel it -- the examinations office, or
   * this exam's own course's faculty (see assertCanRunExam). */
  app.patch('/api/onyx/exams/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const existing = await ctx.onyxExams.exam(claims.tenant_id, idOf(req));
    await assertCanRunExam(
      claims.tenant_id, Number(existing.course_id), claims.user_id, claims.tenant_role);
    const body = validate(z.object({
      title: z.string().min(1).max(255).optional(),
      starts_at: z.string().nullish(),
      duration_minutes: z.number().int().min(5).max(600).optional(),
      max_marks: z.number().min(1).max(1000).optional(),
      pass_marks: z.number().min(0).max(1000).optional(),
      status: z.enum(['draft', 'scheduled', 'completed', 'cancelled']).optional(),
    }), req.body);
    const exam = await ctx.onyxExams.updateExam(claims.tenant_id, idOf(req), viewer, body);
    // Re-sync only when there was something to re-sync for: an exam with no
    // linked paper, or an edit that touched neither the time nor the
    // duration nor cancelled it, has nothing for the assessment's window to
    // catch up on.
    if (exam?.assessment_id
      && (body.starts_at !== undefined || body.duration_minutes !== undefined
        || body.status === 'cancelled')) {
      await syncExamAssessmentWindow(claims.tenant_id, Number(exam.assessment_id), exam, viewer);
    }
    return ok(exam, 'Updated.');
  });

  /**
   * Removes an exam outright. Same guard as editing one -- the examinations
   * office, or the course's own faculty (assertCanRunExam) -- not a
   * separately-restricted action, matching how this codebase already treats
   * edit and delete as one authorization boundary elsewhere.
   */
  app.delete('/api/onyx/exams/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const existing = await ctx.onyxExams.exam(claims.tenant_id, idOf(req));
    await assertCanRunExam(
      claims.tenant_id, Number(existing.course_id), claims.user_id, claims.tenant_role);
    await ctx.onyxExams.remove(claims.tenant_id, idOf(req), viewer);
    return ok({}, 'Removed.');
  });

  /** Override one mark directly -- a dispute or a data-entry fix. */
  app.patch('/api/onyx/exam-marks/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({
      raw_marks: z.number().min(0).optional(),
      final_marks: z.number().min(0).optional(),
    }), req.body);
    return ok(await ctx.onyxExams.updateMark(claims.tenant_id, idOf(req), viewer, body),
      'Mark updated.');
  });

  // =========================================================================
  // CMP-02b -- halls and seating
  // =========================================================================

  app.post('/api/onyx/halls', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...EXAMS);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'exams.halls');
    const body = validate(z.object({
      code: z.string().min(1).max(40),
      name: z.string().min(1).max(255),
      row_count: z.number().int().min(1).max(100),
      col_count: z.number().int().min(1).max(100),
      capacity: z.number().int().min(1).max(5000).optional(),
    }), req.body);
    return ok(await ctx.onyxExams.createHall(claims.tenant_id, body));
  });

  app.get('/api/onyx/halls', async (req) => {
    const { claims } = await viewerOf(req);
    return ok(await ctx.onyxExams.halls(claims.tenant_id));
  });

  app.post('/api/onyx/exams/:id/seating', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'exams.seating');
    const body = validate(z.object({
      hall_ids: z.array(z.number().int().positive()).min(1).max(50),
    }), req.body);
    return ok(await ctx.onyxExams.allocateSeats(
      claims.tenant_id, idOf(req), body.hall_ids, viewer));
  });

  /** The printable plan. Staff only -- it is every candidate's name and seat. */
  app.get('/api/onyx/exams/:id/seating', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...EXAMS);
    return ok(await ctx.onyxExams.seatingPlan(claims.tenant_id, idOf(req)));
  });

  /**
   * CMP-02b -- the plan as paper.
   *
   * The route above returns the plan; this returns the thing that gets pinned
   * to a door and carried by an invigilator, with a column to sign in. Same
   * staff-only guard: it is every candidate's name and seat.
   */
  app.get('/api/onyx/exams/:id/seating.pdf', async (req, reply) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...EXAMS);
    const tenant = await ctx.onyxTenancy.tenant(claims.tenant_id);
    const pdf = await ctx.onyxExams.seatingPdf(claims.tenant_id, idOf(req), {
      issuer: tenant?.name ?? null,
    });

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition',
      'attachment; filename="exam-' + idOf(req) + '-seating.pdf"');
    return reply.send(pdf);
  });

  /** Where you sit. Yours only, from the token. */
  app.get('/api/onyx/exams/:id/seat', async (req) => {
    const { claims } = await viewerOf(req);
    return ok(await ctx.onyxExams.seatFor(claims.tenant_id, idOf(req), claims.user_id));
  });

  // =========================================================================
  // CMP-02c -- marks, moderation, transcripts
  // =========================================================================

  app.post('/api/onyx/exams/:id/marks', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...MARKERS);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'exams.marks');
    const viewer = { role: claims.tenant_role, userId: claims.user_id };
    const exam = await ctx.onyxExams.exam(claims.tenant_id, idOf(req));
    // MARKERS lets any faculty member through the role check; this is the
    // course-scoped half -- entering marks for a paper you do not teach was
    // possible before as long as the candidates named happened to be
    // enrolled, which enterMarks()'s own roster check never ruled out.
    await assertCanRunExam(
      claims.tenant_id, Number(exam.course_id), claims.user_id, claims.tenant_role);
    const body = validate(z.object({
      entries: z.array(z.object({
        user_id: z.string().uuid(),
        raw_marks: z.number().min(0).max(1000),
      })).min(1).max(500),
    }), req.body);
    return ok(await ctx.onyxExams.enterMarks(claims.tenant_id, idOf(req), viewer, body.entries));
  });

  app.get('/api/onyx/exams/:id/marks', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxExams.marksForExam(claims.tenant_id, idOf(req), viewer));
  });

  /**
   * Reads every fully-marked score off this exam's online paper into its own
   * marks register through enterMarks(), the exact path a person typing
   * marks in by hand goes through, so roster checks, moderation, publishing
   * and the audit trail all work precisely as if the office had entered them
   * by hand. Only attempts with nothing left for a marker are pulled; the
   * rest wait for the marking queue rather than syncing in as a wrong,
   * partial score. Scores are scaled onto the exam's own mark scheme, since
   * the paper and the exam are not required to share one.
   *
   * Called automatically by publish, below -- there used to be a manual
   * "pull marks" step between finishing the marking queue and publishing,
   * which was one click that only ever needed to happen right before this
   * one anyway.
   */
  async function syncExamMarksFromPaper(
    tenantId: number, examId: number,
    exam: { assessment_id: number | null; max_marks: number },
    viewer: { userId: string; role: Role },
  ) {
    if (!exam.assessment_id) return { entered: 0 };
    const scored = await ctx.onyxAssess.scoredAttempts(tenantId, exam.assessment_id);
    if (!scored.length) return { entered: 0 };
    const examMax = Number(exam.max_marks);
    const entries = scored.map((a) => ({
      user_id: a.user_id,
      raw_marks: a.max_score > 0
        ? Math.round((a.score / a.max_score) * examMax * 100) / 100 : 0,
    }));
    return ctx.onyxExams.enterMarks(tenantId, examId, viewer, entries);
  }

  app.post('/api/onyx/exams/:id/marks/sync-from-paper', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...MARKERS);
    const viewer = { role: claims.tenant_role, userId: claims.user_id };
    const exam = await ctx.onyxExams.exam(claims.tenant_id, idOf(req));
    await assertCanRunExam(
      claims.tenant_id, Number(exam.course_id), claims.user_id, claims.tenant_role);
    if (!exam.assessment_id) {
      throw new HttpError(422, 'This exam has no online paper to pull marks from.');
    }
    const result = await syncExamMarksFromPaper(claims.tenant_id, idOf(req), exam, viewer);
    return ok(result, result.entered
      ? 'Pulled ' + result.entered + (result.entered === 1 ? ' mark' : ' marks') + ' from the online paper.'
      : 'Nothing on the online paper is fully marked yet.');
  });

  app.post('/api/onyx/exams/:id/moderate', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'exams.moderate');
    const exam = await ctx.onyxExams.exam(claims.tenant_id, idOf(req));
    await assertCanRunExam(
      claims.tenant_id, Number(exam.course_id), claims.user_id, claims.tenant_role);
    const body = validate(z.object({
      delta: z.number().min(-100).max(100),
      reason: z.string().min(1).max(500),
    }), req.body);
    return ok(await ctx.onyxExams.moderate(
      claims.tenant_id, idOf(req), viewer, body.delta, body.reason));
  });

  app.post('/api/onyx/exams/:id/publish', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'exams.publish');
    const exam = await ctx.onyxExams.exam(claims.tenant_id, idOf(req));
    await assertCanRunExam(
      claims.tenant_id, Number(exam.course_id), claims.user_id, claims.tenant_role);
    // Whatever the online paper's marking queue has finished grading since
    // the last sync goes in first -- publishing used to require a separate
    // "pull marks" click immediately beforehand, which was never really a
    // decision on its own, just a step nobody could skip.
    await syncExamMarksFromPaper(claims.tenant_id, idOf(req), exam, viewer);
    return ok(await ctx.onyxExams.publishMarks(claims.tenant_id, idOf(req), viewer));
  });

  /** Your own marks. Published ones only unless you run examinations. */
  app.get('/api/onyx/results', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const q = req.query as { exam_id?: string };
    return ok(await ctx.onyxExams.marksFor(claims.tenant_id, claims.user_id, viewer,
      { exam_id: q.exam_id ? Number(q.exam_id) : undefined }));
  });

  app.get('/api/onyx/results/:userId', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxExams.marksFor(
      claims.tenant_id, uidOf(req, 'userId'), viewer));
  });

  app.post('/api/onyx/transcripts', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'exams.transcripts');
    const body = validate(z.object({
      user_id: z.string().uuid(),
      program_id: z.number().int().positive().nullish(),
    }), req.body);
    return ok(await ctx.onyxExams.issueTranscript(claims.tenant_id, body.user_id, viewer, {
      program_id: body.program_id ?? null,
    }));
  });

  app.get('/api/onyx/transcripts', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxExams.transcripts(claims.tenant_id, claims.user_id, viewer));
  });

  /**
   * Does the document reconcile with the marks behind it?
   *
   * Inside the institution rather than public: unlike a certificate, a
   * transcript is a full academic record and the serial is not a capability
   * meant for strangers.
   */
  app.get('/api/onyx/transcripts/:serial/verify', async (req) => {
    const { claims } = await viewerOf(req);
    const serial = String((req.params as { serial: string }).serial ?? '');
    return ok(await ctx.onyxExams.verifyTranscript(claims.tenant_id, serial));
  });

  /**
   * The public verification page's data. No token, by design -- matching
   * /api/onyx/verify/:credentialId exactly.
   *
   * This route did not exist. The route above requires a signed-in session and
   * that session's own tenant, so the one person a "verifiable transcript" is
   * FOR -- an employer with no Onyx account, checking a document they were
   * handed -- had no way to call it at all. `verifyTranscriptPublic` looks up
   * by serial alone for exactly that reason.
   */
  app.get('/api/onyx/verify/transcript/:serial', async (req) => {
    const serial = String((req.params as { serial: string }).serial ?? '');
    return ok(await ctx.onyxExams.verifyTranscriptPublic(serial));
  });

  // =========================================================================
  // CMP-03 -- fees, invoices, payment
  // =========================================================================

  app.post('/api/onyx/fee-heads', async (req) => {
    // As above: the service owns the rule, the route stops the wrong caller
    // reaching the validator at all.
    await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({
      code: z.string().min(1).max(40),
      name: z.string().min(1).max(255),
      category: z.enum(['tuition', 'exam', 'hostel', 'transport', 'library', 'misc']).optional(),
      refundable: z.boolean().optional(),
    }), req.body);
    return ok(await ctx.onyxFinance.createHead(claims.tenant_id, viewer, body));
  });

  app.get('/api/onyx/fee-heads', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'fees.structures');
    return ok(await ctx.onyxFinance.heads(claims.tenant_id));
  });

  app.post('/api/onyx/fee-structures', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'fees.structures');
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      program_id: z.number().int().positive().nullish(),
      semester_id: z.number().int().positive().nullish(),
      instalments: z.number().int().min(1).max(12).optional(),
      currency: z.string().length(3).optional(),
      lines: z.array(z.object({
        head_id: z.number().int().positive(),
        amount_minor: z.number().int().min(0),
      })).min(1).max(50),
    }), req.body);
    return ok(await ctx.onyxFinance.createStructure(claims.tenant_id, viewer, body));
  });

  app.get('/api/onyx/fee-structures', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    return ok(await ctx.onyxFinance.structures(claims.tenant_id));
  });

  app.get('/api/onyx/fee-structures/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    return ok(await ctx.onyxFinance.structure(claims.tenant_id, idOf(req)));
  });

  app.post('/api/onyx/fee-structures/:id/publish', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxFinance.publishStructure(claims.tenant_id, idOf(req), viewer));
  });

  app.post('/api/onyx/invoices', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'fees.invoice');
    const body = validate(z.object({
      user_id: z.string().uuid(),
      structure_id: z.number().int().positive(),
      instalment_no: z.number().int().min(1).max(12).optional(),
      due_at: z.string().nullish(),
    }), req.body);
    return ok(await ctx.onyxFinance.issueInvoice(claims.tenant_id, viewer, body));
  });

  /** Your own invoices. An id in the path is refused for anyone but finance. */
  app.get('/api/onyx/invoices', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const query = req.query as { user_id?: string };
    const userId = query.user_id ?? claims.user_id;
    return ok(await ctx.onyxFinance.invoicesFor(claims.tenant_id, userId, viewer));
  });

  app.get('/api/onyx/invoices/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxFinance.invoice(claims.tenant_id, idOf(req), viewer));
  });

  app.get('/api/onyx/invoices/:id/reconcile', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxFinance.reconcile(claims.tenant_id, idOf(req), viewer));
  });

  /**
   * Everything the institution has taken, both ways it arrives.
   *
   * Admin only, and behind `fees.structures` rather than a role list, because
   * "may see the money" is the same delegation question as everything else in
   * Settings. Not paginated: a term's takings are hundreds of rows, and a
   * financial report that silently stopped at fifty would be worse than the
   * query taking a moment.
   */
  app.get('/api/onyx/finance/receipts', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'fees.structures');
    return ok(await ctx.onyxFinance.receipts(claims.tenant_id));
  });

  /**
   * The same report, narrowed to the person asking.
   *
   * A learner's fees screen showed invoices only, so a course they had bought
   * -- money they had actually paid -- appeared nowhere on the one page in the
   * product about what they have paid.
   */
  app.get('/api/onyx/my/receipts', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxFinance.receipts(claims.tenant_id, { userId: claims.user_id }));
  });

  app.get('/api/onyx/finance/outstanding', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxFinance.outstanding(claims.tenant_id, viewer));
  });

  /**
   * A gateway callback.
   *
   * Idempotent on (gateway, reference): a replay returns the original payment
   * with `replayed: true` and does not touch the invoice a second time. The
   * response is 200 either way -- a gateway that gets an error retries, which
   * is exactly the wrong response to "I have already processed this".
   */
  app.post('/api/onyx/payments', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'fees.record_payment');
    const body = validate(z.object({
      invoice_id: z.number().int().positive(),
      gateway: z.string().min(1).max(30),
      reference: z.string().min(1).max(191),
      amount_minor: z.number().int().positive(),
      method: z.string().max(30).nullish(),
      status: z.enum(['captured', 'failed', 'pending']).optional(),
      raw: z.unknown().optional(),
    }), req.body);
    return ok(await ctx.onyxFinance.recordPayment(claims.tenant_id, body));
  });

  // =========================================================================
  // CMP-03b -- paying online
  // =========================================================================

  /**
   * Which gateways an institution has switched on.
   *
   * Readable by anyone signed in, because a learner about to pay has to be
   * offered a choice. Identifier, title and currency only -- no credentials
   * and no test-mode flag, neither of which is a payer's business.
   */
  app.get('/api/onyx/gateways', async (req) => {
    const { claims } = await viewerOf(req);
    return ok(await ctx.onyxCheckout.enabledGateways(claims.tenant_id));
  });

  /** The institution's own merchant configuration. Administrators only. */
  app.get('/api/onyx/admin/gateways', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    return ok(await ctx.onyxCheckout.gateways(claims.tenant_id));
  });

  app.put('/api/onyx/admin/gateways', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...REGISTRY);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'fees.gateways');
    const body = validate(z.object({
      identifier: z.string().min(1).max(30),
      title: z.string().max(120).optional(),
      // Values are write-only. Nothing reads them back out to a caller.
      keys: z.record(z.string(), z.string()).optional(),
      currency: z.string().length(3).optional(),
      test_mode: z.boolean().optional(),
      status: z.boolean().optional(),
    }), req.body);

    const saved = await ctx.onyxCheckout.saveGateway(claims.tenant_id, body);
    await ctx.onyxAudit.record(claims, {
      action: 'gateway.configured', entityType: 'payment_gateway', entityId: saved.id,
      // The names of the credentials that changed, never the values -- an audit
      // log that records a live secret key is a second place it can leak from.
      after: {
        identifier: saved.identifier, test_mode: saved.test_mode, status: saved.status,
        keys_set: Object.keys(body.keys ?? {}),
      },
      ip: ipOf(req),
    });
    return ok(saved, 'Saved.');
  });

  /**
   * Start paying an invoice.
   *
   * The amount is the outstanding balance computed server-side; there is no
   * parameter for it, so a request cannot pay one rupee against a fee.
   */
  app.post('/api/onyx/invoices/:id/checkout', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({
      gateway: z.string().min(1).max(30),
    }), req.body);
    return ok(await ctx.onyxCheckout.begin(claims.tenant_id, idOf(req), viewer, {
      gateway: body.gateway, email: claims.email ?? null,
    }));
  });

  /**
   * The redirect back from a gateway.
   *
   * Signed-in, because it is the payer's own browser returning -- but the
   * outcome is asked of the provider rather than read from the query string.
   */
  app.post('/api/onyx/payments/confirm', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      reference: z.string().min(1).max(4000),
      provider_ref: z.string().max(255).optional(),
      query: z.record(z.string(), z.string()).optional(),
    }), req.body);
    return ok(await ctx.onyxCheckout.confirm(
      body.reference, body.provider_ref ?? '', body.query ?? {},
      { tenantId: claims.tenant_id }));
  });

  /**
   * A gateway calling us. No token, and none possible.
   *
   * The tenant is in the path because a signature can only be checked against
   * one institution's secret and the body cannot be trusted to name it. It
   * grants nothing on its own: the reference inside the body is HMAC-signed by
   * us and carries the real tenant, and the two must agree.
   *
   * Always 200. A gateway that receives an error retries, and retrying is the
   * wrong answer to both "already processed" and "not for us".
   */
  app.post('/api/onyx/payments/webhook/:tenantId/:gateway', async (req) => {
    const params = req.params as { tenantId: string; gateway: string };
    const result = await ctx.onyxCheckout.webhook(params.gateway, {
      rawBody: (req as unknown as { rawBody?: string }).rawBody ?? '',
      headers: req.headers as Record<string, string | string[] | undefined>,
    }, Number(params.tenantId) || undefined);
    return ok(result);
  });

  // =========================================================================
  // CMP-04 -- guardians
  // =========================================================================

  app.post('/api/onyx/guardians', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({
      guardian_user_id: z.string().uuid(),
      student_user_id: z.string().uuid(),
      relationship: z.string().max(40).optional(),
    }), req.body);
    const link = await ctx.onyxGuardians.link(claims.tenant_id, viewer, body);

    // CMP-04a: "notifications on key events". The LEARNER is told, not the
    // guardian -- a link grants nothing until the learner accepts it, and
    // announcing it to the guardian first would describe access they do not
    // have. This is the notification that makes the consent model work: an
    // acceptance nobody knows to give never happens.
    await ctx.onyxNotify.notify(claims.tenant_id, {
      userId: body.student_user_id,
      kind: 'guardian.linked',
      title: 'Somebody has asked to be linked to your account',
      body: 'They see nothing until you accept, and then only the categories '
        + 'you switch on. You can revoke it at any time.',
      link: '/onyx/profile',
    });
    return ok(link);
  });

  app.post('/api/onyx/guardians/:id/accept', async (req) => {
    const { claims } = await viewerOf(req);
    return ok(await ctx.onyxGuardians.accept(claims.tenant_id, idOf(req),
      { userId: claims.user_id }));
  });

  /**
   * CMP-04a. Consent changing is a key event for the guardian: what they can
   * see just changed, and only the learner knows it did.
   */
  app.post('/api/onyx/guardians/:id/consent', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({
      scope: z.enum(['attendance', 'results', 'fees']),
      allowed: z.boolean(),
    }), req.body);
    return ok(await ctx.onyxGuardians.setConsent(
      claims.tenant_id, idOf(req), viewer, body.scope, body.allowed));
  });

  app.delete('/api/onyx/guardians/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxGuardians.unlink(claims.tenant_id, idOf(req), viewer));
  });

  /** A learner's own list: who is watching, and what they can see. */
  app.get('/api/onyx/guardians', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxGuardians.linksForStudent(claims.tenant_id, claims.user_id, viewer));
  });

  /**
   * The guardian's whole world. No id anywhere: which children exist comes
   * from verified links, and each scope comes from the consent on that link.
   */
  app.get('/api/onyx/family', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'guardian');
    return ok(await ctx.onyxGuardians.overview(claims.tenant_id, claims.user_id));
  });

  app.get('/api/onyx/family/:studentId/attendance', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'guardian');
    return ok(await ctx.onyxGuardians.attendanceFor(
      claims.tenant_id, claims.user_id, uidOf(req, 'studentId')));
  });

  app.get('/api/onyx/family/:studentId/results', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'guardian');
    return ok(await ctx.onyxGuardians.resultsFor(
      claims.tenant_id, claims.user_id, uidOf(req, 'studentId')));
  });

  app.get('/api/onyx/family/:studentId/fees', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'guardian');
    return ok(await ctx.onyxGuardians.feesFor(
      claims.tenant_id, claims.user_id, uidOf(req, 'studentId')));
  });
}
