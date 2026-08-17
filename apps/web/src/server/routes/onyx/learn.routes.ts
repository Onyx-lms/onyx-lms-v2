/**
 * Onyx O02 -- Onyx Learn.
 *
 * "Courses, structured content, attendance and assignments in one continuous
 * flow -- so every learner always knows what to do next."
 *
 * As in O01, the tenant is ALWAYS the one in the caller's token. The only ids a
 * route accepts are ids *within* that tenant, and every service call takes the
 * tenant as its first argument, so a mismatched id is a 404 rather than a read
 * of somebody else's institution.
 *
 * Two guards recur:
 *   requireOnyxRole(..., 'admin')                -- structural changes
 *   ctx.onyxAcademics.assertCanTeach(...)        -- anything about one course
 *
 * The second is the important one. "Faculty" is not a tenant-wide key: it means
 * faculty *of this course*, or the role would open every roster and grade in
 * the institution.
 */
import type { Router, ReqLike } from '../../router.ts';
import { z } from 'zod';
import {
  validate, ok, HttpError, requireOnyx, requireOnyxRole,
  ATTENDANCE_STATUSES, LATE_POLICIES, ONYX_LESSON_TYPES,
} from '@onyx/core';
import type { AttendanceStatus, LatePolicy, LessonType } from '@onyx/types';
import type { AppContext } from '../../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike, key = 'id') =>
  Number((req.params as Record<string, string>)[key]);
// A person's id, straight off the URL -- a Supabase Auth uuid, never Number()'d.
const userIdOf = (req: ReqLike, key: string) =>
  String((req.params as Record<string, string>)[key] ?? '');
const ipOf = (req: ReqLike) => (req as unknown as { ip?: string }).ip ?? null;

// Course video belongs with a video provider, not in object storage; this is
// for notes, slides and worked examples.
const MAX_RESOURCE_BYTES = 25 * 1024 * 1024;

/**
 * Staff, for the purpose of seeing a course without being in it. Only these
 * two: `exams` and `placement` are real roles with no business in a course
 * they are not part of, and `!== 'student'` would have let them straight in.
 */
const isStaff = (role: string) => role === 'admin' || role === 'faculty';

const StatusSchema = z.enum(ATTENDANCE_STATUSES as [AttendanceStatus, ...AttendanceStatus[]]);
const PolicySchema = z.enum(LATE_POLICIES as [LatePolicy, ...LatePolicy[]]);
const TypeSchema = z.enum(ONYX_LESSON_TYPES as [LessonType, ...LessonType[]]);

export function registerOnyxLearnRoutes(app: Router, ctx: AppContext): void {
  /**
   * Adding someone to a roster, or removing them, is an administrator's act
   * OR this specific course's own faculty -- not faculty tenant-wide, the
   * same distinction assertCanTeach() draws everywhere else. A student is
   * added by whoever actually runs the course, not only by whoever runs the
   * institution.
   */
  async function requireCourseManager(req: ReqLike, courseId: number) {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    if (claims.tenant_role !== 'admin') {
      await ctx.onyxAcademics.assertCanTeach(
        claims.tenant_id, courseId, claims.user_id, claims.tenant_role);
    }
    return claims;
  }

  // -------------------------------------------------------------------------
  // LRN-01a -- academic structure
  // -------------------------------------------------------------------------

  app.get('/api/onyx/programs', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxAcademics.programs(claims.tenant_id));
  });

  app.post('/api/onyx/programs', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      code: z.string().min(1).max(50),
      description: z.string().nullish(),
      duration_semesters: z.number().int().min(1).max(20).optional(),
    }), req.body);
    return ok(await ctx.onyxAcademics.createProgram(claims.tenant_id, body), 'Programme created.');
  });

  app.get('/api/onyx/semesters', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const q = req.query as { program_id?: string };
    return ok(await ctx.onyxAcademics.semesters(
      claims.tenant_id, q.program_id ? Number(q.program_id) : undefined));
  });

  app.post('/api/onyx/semesters', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      program_id: z.number().int().positive(),
      name: z.string().min(1).max(255),
      number: z.number().int().min(1).max(20),
      starts_on: z.string().nullish(),
      ends_on: z.string().nullish(),
    }), req.body);
    return ok(await ctx.onyxAcademics.createSemester(claims.tenant_id, body), 'Semester created.');
  });

  app.get('/api/onyx/batches', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const q = req.query as { program_id?: string };
    return ok(await ctx.onyxAcademics.batches(
      claims.tenant_id, q.program_id ? Number(q.program_id) : undefined));
  });

  app.post('/api/onyx/batches', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      program_id: z.number().int().positive(),
      name: z.string().min(1).max(255),
      code: z.string().min(1).max(50),
      year: z.number().int().min(1900).max(2200).nullish(),
    }), req.body);
    return ok(await ctx.onyxAcademics.createBatch(claims.tenant_id, body), 'Batch created.');
  });

  app.get('/api/onyx/batches/:id/members', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    return ok(await ctx.onyxAcademics.batchMembers(claims.tenant_id, idOf(req)));
  });

  app.post('/api/onyx/batches/:id/members', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      user_ids: z.array(z.string().uuid()).min(1).max(1000),
    }), req.body);

    // Everyone named has to be a member of this institution. Without this the
    // batch would accept any user id in the platform.
    const members = await ctx.onyxTenancy.members(claims.tenant_id);
    const known = new Set(members.map((m) => String(m.user_id)));
    const stranger = body.user_ids.find((id) => !known.has(id));
    if (stranger) throw new HttpError(422, 'Someone in that list is not at this institution.');

    const result = await ctx.onyxAcademics.addToBatch(claims.tenant_id, idOf(req), body.user_ids);
    return ok(result, result.added + ' added to the batch.');
  });

  // -------------------------------------------------------------------------
  // LRN-01b -- catalog and enrolment
  // -------------------------------------------------------------------------

  app.get('/api/onyx/courses', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const q = req.query as { program_id?: string; semester_id?: string; search?: string; all?: string };
    // A learner sees the published catalog. Faculty and admins see drafts too,
    // because they are the ones who have to finish them.
    const canSeeDrafts = claims.tenant_role === 'admin' || claims.tenant_role === 'faculty';
    return ok(await ctx.onyxAcademics.courses(claims.tenant_id, {
      programId: q.program_id ? Number(q.program_id) : undefined,
      semesterId: q.semester_id ? Number(q.semester_id) : undefined,
      status: canSeeDrafts && q.all === '1' ? undefined : 1,
      search: q.search,
    }));
  });

  app.get('/api/onyx/courses/:id', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const course = await ctx.onyxAcademics.assertCourseVisible(
      claims.tenant_id, idOf(req), claims.tenant_role);
    return ok({
      ...course,
      faculty: await ctx.onyxAcademics.faculty(claims.tenant_id, course.id),
      enrollment: await ctx.onyxAcademics.enrollment(claims.tenant_id, course.id, claims.user_id),
    });
  });

  /**
   * A course an administrator stands up, or a course faculty stands up for
   * themselves. The second is real -- "run your own course, add your own
   * students to it" is not something that should need an administrator in
   * the loop for every new class -- but a course created by a faculty
   * member and assigned to nobody would be invisible to them the moment
   * they left this screen (every "your courses" list on this product is
   * keyed off `onyx_course_faculty`, not `created_by`), so the two happen
   * together: they are the course's faculty from the moment it exists,
   * the same as if an administrator had assigned them right after.
   */
  app.post('/api/onyx/courses', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const body = validate(z.object({
      code: z.string().min(1).max(50),
      title: z.string().min(1).max(255),
      slug: z.string().max(255).optional(),
      description: z.string().nullish(),
      program_id: z.number().int().positive().nullish(),
      semester_id: z.number().int().positive().nullish(),
      credits: z.number().int().min(0).max(100).optional(),
      self_enroll: z.boolean().optional(),
    }), req.body);

    const course = await ctx.onyxAcademics.createCourse(claims.tenant_id, claims.user_id, body);
    if (claims.tenant_role === 'faculty') {
      await ctx.onyxAcademics.assignFaculty(claims.tenant_id, Number(course.id), claims.user_id);
    }
    return ok(course, 'Course created.');
  });

  app.patch('/api/onyx/courses/:id', async (req) => {
    const claims = await requireCourseManager(req, idOf(req));
    const body = validate(z.object({
      code: z.string().min(1).max(50).optional(),
      title: z.string().min(1).max(255).optional(),
      description: z.string().nullish(),
      program_id: z.number().int().positive().nullish(),
      semester_id: z.number().int().positive().nullish(),
      credits: z.number().int().min(0).max(100).optional(),
      self_enroll: z.boolean().optional(),
      status: z.number().int().min(0).max(1).optional(),
    }), req.body);
    return ok(await ctx.onyxAcademics.updateCourse(claims.tenant_id, idOf(req), body),
      'Course updated.');
  });

  /**
   * Removes a course outright. Same guard as editing one -- an
   * administrator, or the course's own faculty (requireCourseManager) --
   * not a separately restricted action, matching how this codebase
   * already treats edit and delete as one authorization boundary
   * elsewhere (see DELETE /api/onyx/exams/:id).
   */
  app.delete('/api/onyx/courses/:id', async (req) => {
    const claims = await requireCourseManager(req, idOf(req));
    const course = await ctx.onyxAcademics.course(claims.tenant_id, idOf(req));
    await ctx.onyxAcademics.remove(claims.tenant_id, idOf(req), claims.tenant_role);
    await ctx.onyxAudit.record(claims, {
      action: 'course.removed', entityType: 'course', entityId: idOf(req),
      before: { code: course.code, title: course.title, status: course.status },
      after: null, ip: ipOf(req),
    });
    return ok({}, 'Removed.');
  });

  /**
   * Open a course to learners, and close it again.
   *
   * The same thing is expressible as PATCH { status }, but assignments and
   * problems both publish through a named endpoint, and a course is the one
   * people reach for first. Matching the shape means the authoring UI does
   * not need a special case for the one resource that works differently.
   *
   * Both admin and this course's own faculty, same as PATCH above -- a
   * faculty member who can create and staff a course but not open it to the
   * students they just added would still need an administrator for the one
   * step that makes the course real to anyone but them.
   */
  app.post('/api/onyx/courses/:id/publish', async (req) => {
    const claims = await requireCourseManager(req, idOf(req));
    const course = await ctx.onyxAcademics.updateCourse(claims.tenant_id, idOf(req),
      { status: 1 });
    await ctx.onyxAudit.record(claims, {
      action: 'enrolment.created', entityType: 'course', entityId: idOf(req),
      after: { status: 1 }, ip: ipOf(req),
    });
    return ok(course, 'Course is open.');
  });

  app.post('/api/onyx/courses/:id/close', async (req) => {
    const claims = await requireCourseManager(req, idOf(req));
    return ok(await ctx.onyxAcademics.updateCourse(claims.tenant_id, idOf(req),
      { status: 0 }), 'Course closed.');
  });

  app.post('/api/onyx/courses/:id/faculty', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ user_id: z.string().uuid() }), req.body);

    // They have to teach here before they can teach this.
    const membership = await ctx.onyxTenancy.membership(claims.tenant_id, body.user_id);
    if (!membership) throw new HttpError(422, 'They are not at this institution.');
    if (membership.role !== 'faculty' && membership.role !== 'admin') {
      throw new HttpError(422, 'Only faculty can be assigned to a course.');
    }
    const result = await ctx.onyxAcademics.assignFaculty(claims.tenant_id, idOf(req), body.user_id);
    if (result.assigned) {
      await ctx.onyxAudit.record(claims, {
        action: 'course.faculty_assigned', entityType: 'course', entityId: idOf(req),
        after: { user_id: body.user_id }, ip: ipOf(req),
      });
    }
    return ok(result, 'Assigned.');
  });

  /** Who currently teaches this course -- an admin, or faculty of this course. */
  app.get('/api/onyx/courses/:id/faculty', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role);
    return ok(await ctx.onyxAcademics.faculty(claims.tenant_id, idOf(req)));
  });

  /** The other half of assigning -- freeing a slot back below the cap of two. */
  app.delete('/api/onyx/courses/:id/faculty/:userId', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const removed = await ctx.onyxAcademics.removeFaculty(
      claims.tenant_id, idOf(req), userIdOf(req, 'userId'));
    await ctx.onyxAudit.record(claims, {
      action: 'course.faculty_removed', entityType: 'course', entityId: idOf(req),
      before: { user_id: userIdOf(req, 'userId') }, ip: ipOf(req),
    });
    return ok(removed, 'Removed.');
  });

  /** What this learner is enrolled in -- the "what do I do next" list. */
  /**
   * "My courses" -- enrolled in, or teaching. These used to mean only the
   * first: a faculty member teaches a course through `onyx_course_faculty`,
   * never `onyx_enrollments`, so this returned empty for every lecturer who
   * was not *also* personally enrolled as a student somewhere. Every screen
   * built on this endpoint (the catalogue's "my courses", the dashboard's
   * "your courses", a workspace's course picker) inherited the same hole.
   */
  app.get('/api/onyx/my/courses', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const [enrollments, teaching] = await Promise.all([
      ctx.onyxAcademics.enrollmentsFor(claims.tenant_id, claims.user_id),
      ctx.onyxAcademics.teachingFor(claims.tenant_id, claims.user_id),
    ]);
    const courseIds = [...new Set([
      ...enrollments.map((e) => Number(e.course_id)),
      ...teaching,
    ])];
    // One `.in('id', ids)` query, not one `course()` call per id -- every
    // screen built on this endpoint (the catalogue's "my courses", the
    // dashboard, a workspace's course picker) used to pay for that loop.
    // A learner sees only published courses here, because an administrator
    // can enrol a cohort into a course that is still being written and that
    // is a legitimate thing to do -- it just must not put a draft on the
    // learner's shelf before it opens.
    return ok(await ctx.onyxAcademics.coursesByIds(claims.tenant_id, courseIds,
      { publishedOnly: !isStaff(claims.tenant_role) }));
  });

  /**
   * Everything the faculty dashboard needs about the courses this person
   * teaches, in one round trip.
   *
   * Before this existed, that page found "what do I teach" by reading up to
   * `deep` catalogue rows one at a time (there was no direct query for it),
   * then read roster/assignments/sessions/discussions/attendance for each
   * taught course with five more calls apiece, then read one more call per
   * published assignment for its marking-queue count -- as many as a
   * hundred-plus round trips for a single page. `teachingFor()` already
   * answers "what do I teach" in one query; everything below is that plus
   * five bulk reads across the taught set instead of that many per-course
   * ones, plus one more bulk read for marking-queue counts.
   *
   * `deep`/`queue` mirror the page's own SCAN/DEEP/QUEUE caps -- how many
   * taught courses get the full per-course bundle, and how many published
   * assignments get a submission count -- so a very large teaching load
   * still costs a bounded, predictable number of rows read, not an
   * unbounded one.
   */
  app.get('/api/onyx/my/teaching-overview', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const query = req.query as Record<string, string>;
    const deep = Math.max(0, Math.min(50, Number(query.deep) || 12));
    const queueCap = Math.max(0, Math.min(200, Number(query.queue) || 24));

    const allTaughtIds = await ctx.onyxAcademics.teachingFor(claims.tenant_id, claims.user_id);
    const taughtIds = allTaughtIds.slice(0, deep);

    const [taught, roster, assignments, sessions, discussions, cohort] = await Promise.all([
      ctx.onyxAcademics.coursesByIds(claims.tenant_id, taughtIds),
      ctx.onyxAcademics.rosterBulk(claims.tenant_id, taughtIds),
      ctx.onyxAssignments.listBulk(claims.tenant_id, taughtIds),
      ctx.onyxAttendance.sessionsBulk(claims.tenant_id, taughtIds),
      ctx.onyxEngage.openDiscussionsBulk(claims.tenant_id, taughtIds),
      ctx.onyxAttendance.cohortBulk(claims.tenant_id, taughtIds),
    ]);

    const publishedIds = assignments
      .filter((a) => a.status === 'published')
      .slice(0, queueCap)
      .map((a) => Number(a.id));
    const submissionCounts = await ctx.onyxAssignments.submissionCountsBulk(
      claims.tenant_id, publishedIds);

    return ok({
      taught, taughtTotal: allTaughtIds.length,
      roster, assignments, sessions, discussions, cohort, submissionCounts,
    });
  });

  /**
   * Everything the student dashboard needs about this learner's enrolled
   * courses, in one round trip: what is due, and each course's own
   * progress (for a progress ring and the "resume where you left off"
   * card). Before this, the page called `/courses/:id/assignments` and
   * `/courses/:id/outline` once per enrolled course -- two calls times
   * every course a learner is on, uncapped.
   */
  app.get('/api/onyx/my/learning-overview', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const enrollments = await ctx.onyxAcademics.enrollmentsFor(claims.tenant_id, claims.user_id);
    // Same publication rule as `/my/courses`, and for the same reason: this
    // feeds the learner's dashboard, and an enrolment can predate the course
    // opening. Resolving the ids through `coursesByIds` first costs one
    // query and keeps a draft out of every panel below.
    const courses = await ctx.onyxAcademics.coursesByIds(claims.tenant_id,
      [...new Set(enrollments.map((e) => Number(e.course_id)))],
      { publishedOnly: !isStaff(claims.tenant_role) });
    const courseIds = courses.map((c) => Number(c.id));

    const [assignments, outlines] = await Promise.all([
      ctx.onyxAssignments.listBulk(claims.tenant_id, courseIds, { publishedOnly: true }),
      ctx.onyxContent.outlinesBulk(claims.tenant_id, courseIds, claims.user_id),
    ]);

    return ok({ assignments, outlines });
  });

  app.get('/api/onyx/courses/:id/roster', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role);
    return ok(await ctx.onyxAcademics.roster(claims.tenant_id, idOf(req)));
  });

  app.post('/api/onyx/courses/:id/enroll', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      user_id: z.string().uuid().optional(),
      batch_id: z.number().int().positive().optional(),
    }), req.body ?? {});
    const courseId = idOf(req);

    // Enrolling somebody else, or a whole cohort, is an administrator's act,
    // or this course's own faculty acting on their own roster.
    if (body.batch_id) {
      await requireCourseManager(req, courseId);
      const result = await ctx.onyxAcademics.enrollBatch(
        claims.tenant_id, courseId, body.batch_id, claims.user_id);
      await ctx.onyxAudit.record(claims, {
        action: 'enrolment.created', entityType: 'course', entityId: courseId,
        after: { batch_id: body.batch_id, ...result }, ip: ipOf(req),
      });
      return ok(result, result.enrolled + ' enrolled.');
    }

    if (body.user_id && body.user_id !== claims.user_id) {
      await requireCourseManager(req, courseId);
      const enrolled = await ctx.onyxAcademics.enroll(
        claims.tenant_id, courseId, body.user_id, { enrolledBy: claims.user_id });
      await ctx.onyxAudit.record(claims, {
        action: 'enrolment.created', entityType: 'enrollment', entityId: Number(enrolled.id),
        after: { user_id: body.user_id, course_id: courseId }, ip: ipOf(req),
      });
      return ok(enrolled, 'Enrolled.');
    }

    // Enrolling yourself, which only some courses allow.
    return ok(await ctx.onyxAcademics.selfEnroll(claims.tenant_id, courseId, claims.user_id),
      'You are enrolled.');
  });

  app.delete('/api/onyx/courses/:id/enroll/:userId', async (req) => {
    const claims = await requireCourseManager(req, idOf(req));
    const userId = userIdOf(req, 'userId');
    const result = await ctx.onyxAcademics.withdraw(claims.tenant_id, idOf(req), userId);
    await ctx.onyxAudit.record(claims, {
      action: 'enrolment.removed', entityType: 'enrollment', entityId: idOf(req),
      before: { user_id: userId, course_id: idOf(req) }, ip: ipOf(req),
    });
    return ok(result, 'Withdrawn.');
  });

  // -------------------------------------------------------------------------
  // LRN-02 -- content
  // -------------------------------------------------------------------------

  app.post('/api/onyx/courses/:id/modules', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      summary: z.string().nullish(),
      sort: z.number().int().optional(),
    }), req.body);
    return ok(await ctx.onyxContent.createModule(claims.tenant_id, idOf(req), body),
      'Module added.');
  });

  app.post('/api/onyx/modules/:id/lessons', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      type: TypeSchema.optional(),
      path: z.string().max(500).nullish(),
      body: z.string().nullish(),
      duration_seconds: z.number().int().min(0).optional(),
      sort: z.number().int().optional(),
      is_preview: z.boolean().optional(),
    }), req.body);

    // The module knows its course; the course decides who may add to it.
    const lesson = await ctx.onyxContent.createLesson(claims.tenant_id, idOf(req), body);
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(lesson.course_id), claims.user_id, claims.tenant_role);
    return ok(lesson, 'Lesson added.');
  });

  app.get('/api/onyx/courses/:id/outline', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxContent.outline(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role));
  });

  app.get('/api/onyx/lessons/:id', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxContent.lesson(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role));
  });

  app.post('/api/onyx/lessons/:id/progress', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      position_seconds: z.number().int().min(0),
      completed: z.boolean().optional(),
    }), req.body);
    return ok(await ctx.onyxContent.recordProgress(
      claims.tenant_id, idOf(req), claims.user_id, body));
  });

  // ---- LRN-02b: resources ----

  app.post('/api/onyx/courses/:id/resources', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      path: z.string().min(1).max(500),
      lesson_id: z.number().int().positive().nullish(),
      mime: z.string().max(120).nullish(),
      size_bytes: z.number().int().min(0).nullish(),
    }), req.body);
    return ok(await ctx.onyxContent.addResource(
      claims.tenant_id, idOf(req), claims.user_id, body), 'Resource added.');
  });

  /**
   * Uploading a course file. Faculty of the course only, and the stored key is
   * derived from the tenant rather than anything the caller sends -- a path
   * from a request body is a path into another institution's files.
   */
  app.post('/api/onyx/courses/:id/resources/upload', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role);

    const file = await (req as unknown as {
      file: () => Promise<{ filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined>;
    }).file();
    if (!file) throw new HttpError(400, 'No file was uploaded.');
    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_RESOURCE_BYTES) {
      throw new HttpError(400, 'That file is larger than '
        + MAX_RESOURCE_BYTES / 1024 / 1024 + 'MB.');
    }

    const q = req.query as { title?: string; lesson_id?: string };
    return ok(await ctx.onyxContent.uploadResource(claims.tenant_id, idOf(req), claims.user_id, {
      filename: file.filename, contentType: file.mimetype, bytes: new Uint8Array(buffer),
    }, { title: q.title, lesson_id: q.lesson_id ? Number(q.lesson_id) : null }),
      'Resource uploaded.');
  });

  app.get('/api/onyx/courses/:id/resources', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    if (!isStaff(claims.tenant_role)) {
      await ctx.onyxAcademics.assertEnrolled(claims.tenant_id, idOf(req), claims.user_id);
    }
    return ok(await ctx.onyxContent.resources(claims.tenant_id, idOf(req)));
  });

  /** The signed, expiring link. The enrolment check lives in the service. */
  app.get('/api/onyx/resources/:id/url', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxContent.resourceUrl(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role));
  });

  // -------------------------------------------------------------------------
  // LRN-03 -- attendance
  // -------------------------------------------------------------------------

  app.post('/api/onyx/courses/:id/attendance', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      scheduled_at: z.string().min(1),
      duration_minutes: z.number().int().min(5).max(600).optional(),
      qr_window_seconds: z.number().int().min(10).max(300).optional(),
    }), req.body);
    return ok(await ctx.onyxAttendance.createSession(
      claims.tenant_id, idOf(req), claims.user_id, body), 'Session created.');
  });

  app.get('/api/onyx/courses/:id/attendance', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    if (!isStaff(claims.tenant_role)) {
      await ctx.onyxAcademics.assertEnrolled(claims.tenant_id, idOf(req), claims.user_id);
    }
    return ok(await ctx.onyxAttendance.sessions(claims.tenant_id, idOf(req)));
  });

  app.get('/api/onyx/attendance/:id/roster', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const session = await ctx.onyxAttendance.session(claims.tenant_id, idOf(req));
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(session.course_id), claims.user_id, claims.tenant_role);
    return ok(await ctx.onyxAttendance.roster(claims.tenant_id, idOf(req)));
  });

  app.post('/api/onyx/attendance/:id/mark', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const session = await ctx.onyxAttendance.session(claims.tenant_id, idOf(req));
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(session.course_id), claims.user_id, claims.tenant_role);
    const body = validate(z.object({
      entries: z.array(z.object({
        user_id: z.string().uuid(),
        status: StatusSchema,
        note: z.string().max(500).nullish(),
      })).min(1).max(1000),
    }), req.body);

    const result = await ctx.onyxAttendance.mark(
      claims.tenant_id, idOf(req), claims.user_id, body.entries);
    await ctx.onyxAudit.record(claims, {
      action: result.amended ? 'attendance.amended' : 'attendance.marked',
      entityType: 'attendance_session', entityId: idOf(req),
      after: result, ip: ipOf(req),
    });
    return ok(result, 'Attendance recorded.');
  });

  app.post('/api/onyx/attendance/:id/close', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const session = await ctx.onyxAttendance.session(claims.tenant_id, idOf(req));
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(session.course_id), claims.user_id, claims.tenant_role);
    return ok(await ctx.onyxAttendance.closeSession(claims.tenant_id, idOf(req)), 'Session closed.');
  });

  /**
   * LRN-03b -- the code on screen.
   *
   * Faculty only. A learner who could read this would be able to mark
   * themselves present from anywhere.
   */
  app.get('/api/onyx/attendance/:id/code', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const session = await ctx.onyxAttendance.session(claims.tenant_id, idOf(req));
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(session.course_id), claims.user_id, claims.tenant_role);
    return ok(await ctx.onyxAttendance.currentCode(claims.tenant_id, idOf(req)));
  });

  /** The learner scans and posts the code. There is no user_id to send. */
  app.post('/api/onyx/attendance/:id/check-in', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ code: z.string().min(1).max(32) }), req.body);
    return ok(await ctx.onyxAttendance.checkIn(
      claims.tenant_id, idOf(req), claims.user_id, body.code), 'You are marked present.');
  });

  // ---- LRN-03c: analytics ----

  app.get('/api/onyx/courses/:id/attendance/analytics', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role);
    const q = req.query as { threshold?: string };
    return ok(await ctx.onyxAttendance.courseAnalytics(
      claims.tenant_id, idOf(req), q.threshold ? Number(q.threshold) : 75));
  });

  app.get('/api/onyx/courses/:id/attendance/export', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role);
    return ok(await ctx.onyxAttendance.exportRows(claims.tenant_id, idOf(req)));
  });

  /** LRN-03c -- the same rows as a file, which is what an export means here. */
  app.get('/api/onyx/courses/:id/attendance/export.csv', async (req, reply) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role);
    const members = await ctx.onyxTenancy.members(claims.tenant_id);
    const names = new Map(members.map((m) => [String(m.user_id), {
      name: m.user?.name ?? '', email: m.user?.email ?? '',
    }]));
    const csv = await ctx.onyxAttendance.exportCsv(claims.tenant_id, idOf(req), { names });

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition',
      'attachment; filename="course-' + idOf(req) + '-attendance.csv"');
    return reply.send(csv);
  });

  /** A learner's own attendance, across everything they are enrolled in. */
  app.get('/api/onyx/my/attendance', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxAttendance.learnerSummary(claims.tenant_id, claims.user_id));
  });

  // -------------------------------------------------------------------------
  // LRN-04 -- assignments
  // -------------------------------------------------------------------------

  app.post('/api/onyx/courses/:id/assignments', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      instructions: z.string().nullish(),
      attachment_path: z.string().max(500).nullish(),
      due_at: z.string().nullish(),
      total_points: z.number().int().min(1).max(10_000).optional(),
      late_policy: PolicySchema.optional(),
      late_penalty_percent: z.number().int().min(0).max(100).optional(),
      allow_resubmission: z.boolean().optional(),
    }), req.body);
    return ok(await ctx.onyxAssignments.create(
      claims.tenant_id, idOf(req), claims.user_id, body), 'Assignment created.');
  });

  app.get('/api/onyx/courses/:id/assignments', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const staff = isStaff(claims.tenant_role);
    if (!staff) {
      await ctx.onyxAcademics.assertEnrolled(claims.tenant_id, idOf(req), claims.user_id);
    }
    // A draft assignment is not yet a thing a learner has been asked to do.
    return ok(await ctx.onyxAssignments.list(claims.tenant_id, idOf(req),
      { publishedOnly: !staff }));
  });

  app.put('/api/onyx/assignments/:id/rubric', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const assignment = await ctx.onyxAssignments.assignment(claims.tenant_id, idOf(req));
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(assignment.course_id), claims.user_id, claims.tenant_role);
    const body = validate(z.object({
      criteria: z.array(z.object({
        title: z.string().min(1).max(255),
        description: z.string().nullish(),
        points: z.number().int().min(1).max(10_000),
      })).min(1).max(50),
    }), req.body);
    return ok(await ctx.onyxAssignments.setRubric(claims.tenant_id, idOf(req), body.criteria),
      'Rubric saved.');
  });

  app.get('/api/onyx/assignments/:id', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const assignment = await ctx.onyxAssignments.assignment(claims.tenant_id, idOf(req));
    const staff = isStaff(claims.tenant_role);
    if (!staff) {
      if (assignment.status !== 'published') throw new HttpError(404, 'Assignment not found.');
      await ctx.onyxAcademics.assertEnrolled(
        claims.tenant_id, Number(assignment.course_id), claims.user_id);
    }
    return ok({
      ...assignment,
      rubric: await ctx.onyxAssignments.rubric(claims.tenant_id, idOf(req)),
      // Staff get the marking queue; a learner gets their own work and nobody
      // else's.
      submissions: staff
        ? await ctx.onyxAssignments.submissions(claims.tenant_id, idOf(req))
        : undefined,
      my_submission: staff
        ? undefined
        : await ctx.onyxAssignments.mySubmission(claims.tenant_id, idOf(req), claims.user_id),
    });
  });

  app.post('/api/onyx/assignments/:id/publish', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const assignment = await ctx.onyxAssignments.assignment(claims.tenant_id, idOf(req));
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(assignment.course_id), claims.user_id, claims.tenant_role);
    const published = await ctx.onyxAssignments.publish(claims.tenant_id, idOf(req));
    await ctx.onyxAudit.record(claims, {
      action: 'assessment.published', entityType: 'assignment', entityId: idOf(req),
      after: { title: assignment.title }, ip: ipOf(req),
    });
    return ok(published, 'Published.');
  });

  // ---- the learner's side ----

  /** LRN-04c -- autosave. Saves without submitting, and never submits. */
  app.post('/api/onyx/assignments/:id/draft', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ body: z.string().max(200_000) }), req.body);
    const saved = await ctx.onyxAssignments.saveDraft(
      claims.tenant_id, idOf(req), claims.user_id, body.body);
    return ok({ id: saved.id, updated_at: saved.updated_at }, 'Draft saved.');
  });

  app.post('/api/onyx/assignments/:id/submit', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      body: z.string().max(200_000).nullish(),
      file_path: z.string().max(500).nullish(),
    }), req.body);
    return ok(await ctx.onyxAssignments.submit(
      claims.tenant_id, idOf(req), claims.user_id, body), 'Submitted.');
  });

  // ---- marking ----

  app.get('/api/onyx/submissions/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const detail = await ctx.onyxAssignments.submissionDetail(claims.tenant_id, idOf(req));
    const assignment = await ctx.onyxAssignments.assignment(
      claims.tenant_id, Number(detail.assignment_id));
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(assignment.course_id), claims.user_id, claims.tenant_role);
    return ok(detail);
  });

  app.post('/api/onyx/submissions/:id/grade', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const submission = await ctx.onyxAssignments.submissionDetail(claims.tenant_id, idOf(req));
    const assignment = await ctx.onyxAssignments.assignment(
      claims.tenant_id, Number(submission.assignment_id));
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(assignment.course_id), claims.user_id, claims.tenant_role);

    const body = validate(z.object({
      score: z.number().min(0).optional(),
      feedback: z.string().max(50_000).nullish(),
      scores: z.array(z.object({
        criterion_id: z.number().int().positive(),
        points: z.number().min(0),
        comment: z.string().max(5_000).nullish(),
      })).optional(),
    }), req.body);

    const graded = await ctx.onyxAssignments.grade(
      claims.tenant_id, idOf(req), claims.user_id, body);
    await ctx.onyxAudit.record(claims, {
      action: 'assignment.graded', entityType: 'submission', entityId: idOf(req),
      before: { score: submission.score }, after: { score: graded.score }, ip: ipOf(req),
    });
    return ok(graded, 'Graded.');
  });

  app.post('/api/onyx/submissions/:id/return', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const submission = await ctx.onyxAssignments.submissionDetail(claims.tenant_id, idOf(req));
    const assignment = await ctx.onyxAssignments.assignment(
      claims.tenant_id, Number(submission.assignment_id));
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(assignment.course_id), claims.user_id, claims.tenant_role);

    const returned = await ctx.onyxAssignments.returnToLearner(claims.tenant_id, idOf(req));
    await ctx.onyxAudit.record(claims, {
      action: 'assignment.returned', entityType: 'submission', entityId: idOf(req),
      after: { score: submission.score }, ip: ipOf(req),
    });
    return ok(returned, 'Returned to the learner.');
  });

  app.post('/api/onyx/assignments/:id/return-all', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const assignment = await ctx.onyxAssignments.assignment(claims.tenant_id, idOf(req));
    await ctx.onyxAcademics.assertCanTeach(
      claims.tenant_id, Number(assignment.course_id), claims.user_id, claims.tenant_role);
    const result = await ctx.onyxAssignments.returnAll(claims.tenant_id, idOf(req));
    await ctx.onyxAudit.record(claims, {
      action: 'assignment.returned', entityType: 'assignment', entityId: idOf(req),
      after: result, ip: ipOf(req),
    });
    return ok(result, result.returned + ' returned.');
  });
}
