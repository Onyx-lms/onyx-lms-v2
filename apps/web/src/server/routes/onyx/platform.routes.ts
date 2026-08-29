/**
 * The platform console -- create, list and suspend institutions; grant and
 * revoke who else can.
 *
 * Every route here uses requirePlatformAdmin(), never requireOnyx() or
 * requireOnyxRole(). That is not a style choice: a tenant token cannot pass
 * requirePlatformAdmin() (it has no `platform` claim) and a platform token
 * cannot pass requireOnyx() (it has no `tenant_id`), so the two surfaces
 * cannot be confused for each other by a route registered in the wrong file.
 */
import type { Router, ReqLike } from '../../router.ts';
import { z } from 'zod';
import {
  validate, ok, requirePlatformAdmin, ROLES, HttpError,
  CAPABILITIES, CAPABILITY_AREAS, holdersOf, normaliseOverrides, normalisePersonal, can,
  GREEK_SECTIONS, LETTER_SECTIONS, pdfScript, pdfScriptBundle,
  type PermissionOverrides,
} from '@onyx/core';
import type { Role } from '@onyx/types';
import type { AppContext } from '../../app-context.ts';
import { QUESTION_TYPES, type OnyxQuestionType } from '@onyx/core';
import { syncExamAssessmentWindow } from '../../exam-window.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike) => Number((req.params as { id: string }).id);
const subIdOf = (req: ReqLike, key: string) =>
  Number((req.params as Record<string, string>)[key]);
const RoleSchema = z.enum(ROLES as [Role, ...Role[]]);

/**
 * The fields a Code Lab problem is written with, from the console.
 *
 * One schema for create and patch, because they take the same fields and only
 * differ on whether `title` is required -- each route `.extend()`s that.
 * Nothing here re-checks what the service already checks (that a difficulty is
 * a difficulty, that a date rule carries a date): a second copy of a rule is a
 * second place for it to drift.
 */
const ProblemBody = z.object({
  /**
   * What this problem is answered with (0041).
   *
   * `code` is written and run against tests; `web` is HTML, CSS and
   * JavaScript, previewed in a browser and marked by a person. The two demand
   * different things at publish time, which is why the kind is set here and
   * not inferred from whether anybody happened to add a test.
   */
  kind: z.enum(['code', 'web']).optional(),
  preview_entry: z.string().max(200).optional(),
  /** For `code`, keyed by language. For `web`, keyed by path. */
  starter_code: z.record(z.string().max(200), z.string().max(200_000)).optional(),
  statement: z.string().max(50_000).nullish(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  topic: z.string().max(100).nullish(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  languages: z.array(z.string().max(30)).max(20).optional(),
  course_id: z.number().int().positive().nullish(),
  time_limit_ms: z.number().int().min(100).max(30_000).optional(),
  memory_limit_kb: z.number().int().min(1024).max(1024 * 1024).optional(),
  solution: z.string().max(50_000).nullish(),
  solution_rule: z.enum(['never', 'after_solve', 'after_attempts', 'after_date']).optional(),
  solution_after_attempts: z.number().int().min(1).max(100).optional(),
  solution_after: z.string().max(40).nullish(),
});

type ProblemInput = Parameters<AppContext['onyxCodeLab']['createProblem']>[2];
type ProblemPatch = Parameters<AppContext['onyxCodeLab']['updateProblem']>[2];

export function registerOnyxPlatformRoutes(app: Router, ctx: AppContext): void {
  app.post('/api/onyx/platform/login', async (req) => {
    const body = validate(z.object({
      email: z.string().email(), password: z.string().min(1),
    }), req.body);
    const result = await ctx.onyxPlatform.authenticate(body.email, body.password);
    return ok({
      token: result.session.access_token,
      refresh_token: result.session.refresh_token,
      expires_at: result.session.expires_at,
      user: result.user,
    });
  });

  app.get('/api/onyx/platform/me', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok({ user_id: claims.user_id, email: claims.email });
  });

  app.get('/api/onyx/platform/tenants', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = validate(z.object({
      search: z.string().max(255).optional(),
      status: z.coerce.number().int().min(0).max(1).optional(),
      plan: z.string().max(50).optional(),
    }), req.query ?? {});
    return ok(await ctx.onyxPlatform.tenants(q));
  });

  app.get('/api/onyx/platform/tenants/:id', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.tenant(idOf(req)));
  });

  /**
   * One institution's permission matrix, from above it.
   *
   * A platform admin holds everything everywhere by definition, so this is not
   * about what THEY may do -- it is the same screen an administrator sees,
   * reachable when the person who needs it changed is on the phone rather than
   * in the console. Every save is recorded in the platform audit log against
   * the operator who made it, which is the difference between helping a
   * customer and quietly editing their institution.
   */
  app.get('/api/onyx/platform/tenants/:id/permissions', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const tenant = await ctx.onyxPlatform.tenant(idOf(req));
    const overrides = (tenant?.permissions ?? {}) as PermissionOverrides;
    return ok({
      capabilities: CAPABILITIES.map((cap) => ({
        ...cap,
        holders_now: holdersOf(cap.key, overrides),
        changed: Object.prototype.hasOwnProperty.call(overrides, cap.key),
      })),
      areas: CAPABILITY_AREAS,
      tenant: { id: tenant.id, name: tenant.name },
    });
  });

  app.put('/api/onyx/platform/tenants/:id/permissions', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      permissions: z.record(z.string(), z.array(z.string())),
    }), req.body);
    const overrides = normaliseOverrides(body.permissions);
    const tenant = await ctx.onyxPlatform.setPermissions(idOf(req), claims.user_id, overrides);
    return ok(tenant, 'Permissions saved.');
  });

  // The drill-in reads. Same guard as everything else in this file: a tenant
  // token has no `platform` claim, so it cannot reach an institution it does
  // not belong to through here -- and a platform token has no `tenant_id`, so
  // it cannot reach the tenant surface either. `:id` scopes every query.
  app.get('/api/onyx/platform/tenants/:id/people', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = validate(z.object({
      role: z.enum(['student', 'faculty', 'exams', 'placement', 'employer', 'admin', 'guardian'])
        .optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
      // A section id, or the literal `none` for everybody in no section.
      section_id: z.union([z.literal('none'), z.coerce.number().int().positive()]).optional(),
    }), req.query ?? {});
    return ok(await ctx.onyxPlatform.tenantPeople(idOf(req), {
      role: q.role, limit: q.limit, sectionId: q.section_id,
    }));
  });

  /**
   * One student's whole record at this institution.
   *
   * The console could list a roll, open a course and open a sitting, and had
   * no way to answer the question anybody arrives with: what is going on with
   * this person. Their division, their number, what they are enrolled in,
   * what they have sat and what they were given for it.
   */
  app.get('/api/onyx/platform/tenants/:id/students/:userId', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const userId = String((req.params as Record<string, string>).userId ?? '');
    if (!userId) throw new HttpError(422, 'Which student?');
    return ok(await ctx.onyxPlatform.studentRecord(idOf(req), userId));
  });

  app.get('/api/onyx/platform/tenants/:id/academics', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = validate(z.object({
      limit: z.coerce.number().int().positive().max(200).optional(),
    }), req.query ?? {});
    return ok(await ctx.onyxPlatform.tenantAcademics(idOf(req), q));
  });

  app.get('/api/onyx/platform/tenants/:id/timetable', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = validate(z.object({
      semester_id: z.coerce.number().int().positive().optional(),
    }), req.query ?? {});
    return ok(await ctx.onyxPlatform.tenantTimetable(idOf(req), q));
  });

  // Audited in the service, not here: the log entry belongs next to the read it
  // describes, so no future caller can reach the data around the logging.
  app.get('/api/onyx/platform/tenants/:id/grades', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = validate(z.object({
      limit: z.coerce.number().int().positive().max(200).optional(),
      // Present together with the exam/assessment list itself: pick one from
      // there, land here scoped to it. Mutually exclusive by construction --
      // a caller sending both gets the exam, since exam_id is checked first
      // in the service -- but nothing here forces only one to be sent.
      exam_id: z.coerce.number().int().positive().optional(),
      assessment_id: z.coerce.number().int().positive().optional(),
    }), req.query ?? {});
    return ok(await ctx.onyxPlatform.tenantGrades(idOf(req), claims.user_id,
      { limit: q.limit, examId: q.exam_id, assessmentId: q.assessment_id }));
  });

  app.post('/api/onyx/platform/tenants', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      slug: z.string().max(255).optional(),
      plan: z.string().max(50).nullish(),
      admin: z.object({
        name: z.string().min(1).max(255),
        email: z.string().email(),
        password: z.string().min(8).max(255),
      }),
    }), req.body);
    return ok(await ctx.onyxPlatform.createTenant(body, claims.user_id), 'Institution created.');
  });

  app.post('/api/onyx/platform/tenants/:id/suspend', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.suspend(idOf(req), claims.user_id), 'Suspended.');
  });

  app.post('/api/onyx/platform/tenants/:id/activate', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.activate(idOf(req), claims.user_id), 'Activated.');
  });

  // -------------------------------------------------------------------------
  // Editing inside an institution. Same guard, same tenant_id-as-boundary
  // rule as every read above -- see PlatformService's own comment on this.
  // -------------------------------------------------------------------------

  app.patch('/api/onyx/platform/tenants/:id', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      name: z.string().min(1).max(255).optional(),
      slug: z.string().max(255).optional(),
      plan: z.string().max(50).nullish(),
      // The community link shown beside an institution's jobs. Nullable rather
      // than merely optional: clearing it is a thing an operator does, and
      // `undefined` reads as "leave it alone".
      community_url: z.string().max(500).nullish(),
      community_label: z.string().max(120).nullish(),
      /*
       * Whether this institution takes registrations, and how.
       *
       * The same three fields the institution's own PATCH /api/onyx/tenant/
       * settings accepts, with the same meanings -- an operator supporting an
       * institution should not have to be handed that institution's own
       * administrator account to answer "why can nobody sign up".
       */
      student_signup: z.boolean().optional(),
      signup_domains: z.string().max(500).optional(),
      signup_mode: z.enum(['domain', 'open']).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateTenant(idOf(req), claims.user_id, body), 'Updated.');
  });

  app.delete('/api/onyx/platform/tenants/:id', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ confirm_name: z.string().min(1) }), req.body);
    return ok(await ctx.onyxPlatform.deleteTenant(idOf(req), claims.user_id, body.confirm_name),
      'Institution deleted.');
  });

  app.post('/api/onyx/platform/tenants/:id/members', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      email: z.string().email(),
      role: RoleSchema,
      password: z.string().min(8).max(255).optional(),
      // Set as they are added, so a student never arrives in no division --
      // which is how somebody comes to miss every section-targeted paper.
      roll_number: z.string().max(40).nullish(),
      section_id: z.number().int().positive().nullish(),
    }), req.body);
    return ok(await ctx.onyxPlatform.addMember(idOf(req), claims.user_id, body), 'Member added.');
  });

  app.delete('/api/onyx/platform/tenants/:id/members/:memberId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.removeMember(
      idOf(req), subIdOf(req, 'memberId'), claims.user_id), 'Member removed.');
  });

  app.post('/api/onyx/platform/tenants/:id/courses', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      code: z.string().min(1).max(50),
      title: z.string().min(1).max(255),
      credits: z.number().int().min(0).optional(),
      self_enroll: z.boolean().optional(),
      status: z.number().int().min(0).max(1).optional(),
      // How a learner gets on. Without these the console could only ever make
      // a `batch` course -- one nobody can join and nobody can buy.
      access: z.enum(['batch', 'open', 'locked']).optional(),
      price_minor: z.number().int().min(0).max(10_000_000).optional(),
      currency: z.string().length(3).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.createCourse(idOf(req), claims.user_id, body), 'Course created.');
  });

  /*
   * ------------------------------------------------------------------------
   * Who is ON a course, from the console.
   *
   * The console could CREATE a course and never put anybody on it. That is not
   * a missing convenience: a course with an empty roster is a course whose
   * examination nobody can sit, whose register has no names and whose paper
   * deals to no one -- so an operator standing an institution up built the
   * teaching and then had to sign in as that institution's own administrator
   * to make any of it reachable by a learner.
   *
   * Same AcademicsService calls the institution's own route makes, so the
   * duplicate check, the capacity rule and the audit line are one
   * implementation rather than two.
   * ------------------------------------------------------------------------
   */

  app.get('/api/onyx/platform/tenants/:id/courses/:courseId/roster', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxAcademics.roster(idOf(req), subIdOf(req, 'courseId')));
  });

  app.post('/api/onyx/platform/tenants/:id/courses/:courseId/enroll', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      user_id: z.string().uuid(),
    }), req.body);
    const enrolled = await ctx.onyxAcademics.enroll(
      idOf(req), subIdOf(req, 'courseId'), body.user_id, { enrolledBy: claims.user_id });
    return ok(enrolled, 'Enrolled.');
  });

  app.delete('/api/onyx/platform/tenants/:id/courses/:courseId/enroll/:userId', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const userId = String((req.params as Record<string, string>).userId ?? '');
    return ok(
      await ctx.onyxAcademics.withdraw(idOf(req), subIdOf(req, 'courseId'), userId),
      'Withdrawn.');
  });

  /*
   * ------------------------------------------------------------------------
   * CAR-03 from the console -- credentials.
   *
   * The one thing an operator who had just stood up an institution, taught it,
   * examined it and published its marks could not then do: hand out the
   * certificate. Issuing one meant signing in as that institution's own
   * administrator, which is the handover the console exists to avoid.
   * ------------------------------------------------------------------------
   */
  app.get('/api/onyx/platform/tenants/:id/certificates', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.certificates(idOf(req)));
  });

  app.post('/api/onyx/platform/tenants/:id/certificates', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      user_id: z.string().uuid(),
      title: z.string().min(1).max(255),
      kind: z.enum(['course', 'assessment', 'contest', 'program']).optional(),
      course_id: z.number().int().positive().nullish(),
      expires_at: z.string().nullish(),
    }), req.body);
    return ok(await ctx.onyxPlatform.issueCertificate(idOf(req), claims.user_id, body),
      'Certificate issued.');
  });

  app.post('/api/onyx/platform/tenants/:id/certificates/:certificateId/revoke', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ reason: z.string().min(1).max(500) }), req.body);
    const certificateId = Number((req.params as { certificateId?: string }).certificateId);
    return ok(await ctx.onyxPlatform.revokeCertificate(
      idOf(req), certificateId, claims.user_id, body.reason), 'Revoked.');
  });

  app.post('/api/onyx/platform/tenants/:id/assignments', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      course_id: z.number().int().positive(),
      title: z.string().min(1).max(255),
      due_at: z.string().nullish(),
      total_points: z.number().min(0).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.createAssignment(idOf(req), claims.user_id, body),
      'Assignment created.');
  });

  app.post('/api/onyx/platform/tenants/:id/assessments', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      course_id: z.number().int().positive().nullish(),
      title: z.string().min(1).max(255),
      opens_at: z.string().nullish(),
      closes_at: z.string().nullish(),
      duration_minutes: z.number().int().min(1).max(1440).optional(),
      pass_mark: z.number().min(0).nullish(),
      // Which teaching division the paper is set for. Absent or null means
      // every section.
      section_id: z.number().int().positive().nullish(),
      // How many times a candidate may leave the paper before it is handed in
      // for them. Zero switches the rule off.
      breach_limit: z.number().int().min(0).max(20).optional(),
      // How the paper is sat. Absent means "not stated", which the service
      // reads as its default -- monitored, with camera and screen, for a paper
      // set by an institution rather than by a lecturer.
      attempts_allowed: z.number().int().min(1).max(20).optional(),
      shuffle_questions: z.boolean().optional(),
      shuffle_options: z.boolean().optional(),
      proctoring: z.boolean().optional(),
      require_camera: z.boolean().optional(),
      require_screen: z.boolean().optional(),
      watch_camera: z.boolean().optional(),
      anonymous_marking: z.boolean().optional(),
      moderation_required: z.boolean().optional(),
      instant_results: z.boolean().optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.createAssessment(idOf(req), claims.user_id, body),
      'Assessment created.');
  });

  app.post('/api/onyx/platform/tenants/:id/exams', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      // Optional, and taken from the course when it is absent -- 0037 made a
      // sitting with no term a real thing, and this route was still demanding
      // one.
      semester_id: z.number().int().positive().nullish(),
      course_id: z.number().int().positive(),
      title: z.string().min(1).max(255),
      starts_at: z.string(),
      duration_minutes: z.number().int().min(5).max(600).optional(),
      max_marks: z.number().min(1).max(1000).optional(),
      pass_marks: z.number().min(0).max(1000).optional(),
      // Ties the sitting to a paper sat in the browser. Without this the
      // console could only ever schedule an exam marked by hand.
      assessment_id: z.number().int().positive().nullish(),
      // Which teaching division sits it. Absent or null means every section,
      // which is what an examination for the whole cohort is.
      section_id: z.number().int().positive().nullish(),
      window_enforced: z.boolean().optional(),
    }), req.body);
    const exam = await ctx.onyxPlatform.createExam(idOf(req), claims.user_id, body);

    /*
     * The paper is opened for exactly this sitting.
     *
     * The tenant-side route has always done this and the console's never did:
     * it wrote the link and left the assessment's own `opens_at`/`closes_at`
     * alone. An operator who scheduled an exam through a paper therefore
     * produced a sitting whose paper was not open at the time the sitting
     * happened -- and, because the calendar selects assessments on
     * `closes_at`, a paper with a null window never appeared on anybody's
     * week at all. The exam showed; the thing candidates actually sit did not.
     *
     * A platform operator acts with an institution administrator's authority
     * here, which is the same authority the console already exercises on every
     * other write in this file.
     */
    if (body.assessment_id && exam) {
      await syncExamAssessmentWindow(ctx, idOf(req), body.assessment_id,
        exam as unknown as Parameters<typeof syncExamAssessmentWindow>[3],
        { userId: claims.user_id, role: 'admin' });
    }
    return ok(exam, 'Exam scheduled.');
  });

  app.get('/api/onyx/platform/tenants/:id/semesters', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.tenantSemesters(idOf(req)));
  });

  app.get('/api/onyx/platform/tenants/:id/fees', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.tenantFees(idOf(req)));
  });

  /**
   * One institution's takings, from above it.
   *
   * The fees page beside this one answers "what is owed"; this answers "what
   * has been paid", which for a platform operator is the question behind
   * every billing conversation with a customer. Same rows the institution's
   * own administrator sees -- there is no operator-only view of somebody
   * else's money.
   */
  app.get('/api/onyx/platform/tenants/:id/receipts', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxFinance.receipts(idOf(req)));
  });

  app.post('/api/onyx/platform/tenants/:id/fee-heads', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      code: z.string().min(1).max(40),
      name: z.string().min(1).max(255),
      category: z.enum(['tuition', 'exam', 'hostel', 'transport', 'library', 'misc']).optional(),
      refundable: z.boolean().optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.createFeeHead(idOf(req), claims.user_id, body),
      'Fee head created.');
  });

  app.post('/api/onyx/platform/tenants/:id/fee-structures', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      instalments: z.number().int().min(1).max(12).optional(),
      currency: z.string().max(10).optional(),
      lines: z.array(z.object({
        head_id: z.number().int().positive(),
        amount_minor: z.number().int().min(0),
      })).min(1),
    }), req.body);
    return ok(await ctx.onyxPlatform.createFeeStructure(idOf(req), claims.user_id, body),
      'Fee structure created.');
  });

  app.post('/api/onyx/platform/tenants/:id/fee-structures/:structureId/status', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      status: z.enum(['draft', 'published', 'archived']),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateFeeStructureStatus(
      idOf(req), subIdOf(req, 'structureId'), claims.user_id, body.status), 'Updated.');
  });

  app.patch('/api/onyx/platform/tenants/:id/members/:memberId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      name: z.string().min(1).max(255).optional(),
      email: z.string().email().optional(),
      phone: z.string().max(50).nullish(),
      account_status: z.number().int().min(0).max(1).optional(),
      role: RoleSchema.optional(),
      membership_status: z.number().int().min(0).max(1).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateMember(
      idOf(req), subIdOf(req, 'memberId'), claims.user_id, body), 'Member updated.');
  });

  app.patch('/api/onyx/platform/tenants/:id/exam-marks/:markId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      raw_marks: z.number().min(0).optional(),
      final_marks: z.number().min(0).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateExamMark(
      idOf(req), subIdOf(req, 'markId'), claims.user_id, body), 'Mark updated.');
  });

  // ---------------------------------------------------------------------------
  // Invigilation, from the console.
  //
  // The institution's own invigilation console has existed for some time; the
  // platform had none, so an operator watching a live examination on behalf of
  // an institution had to be handed that institution's own administrator
  // account. These are the same operations behind the platform guard, and they
  // delegate to the SAME service methods rather than reimplementing the rules
  // -- who may be watched, when, and whether they consented is decided in one
  // place, and a second copy of that decision is exactly the copy that would
  // drift.
  // ---------------------------------------------------------------------------

  /**
   * The whole institution's invigilation queue, or one paper's.
   *
   * Never narrowed by course, unlike the tenant-side route's faculty branch:
   * an operator in the console teaches nothing, so narrowing to "their"
   * courses would narrow it to nothing.
   */
  app.get('/api/onyx/platform/tenants/:id/proctor/queue', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = req.query as { assessment_id?: string };
    return ok(await ctx.onyxProctor.reviewQueue(
      idOf(req), q.assessment_id ? [Number(q.assessment_id)] : undefined));
  });

  /** What one attempt's invigilation record says, event by event. */
  app.get('/api/onyx/platform/tenants/:id/attempts/:attemptId/proctor', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxProctor.timeline(idOf(req), subIdOf(req, 'attemptId')));
  });

  /** Dismiss or uphold one flag. */
  app.post('/api/onyx/platform/tenants/:id/proctor/events/:eventId/review', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      decision: z.enum(['dismissed', 'upheld']),
      note: z.string().max(5000).nullish(),
    }), req.body);
    const tenantId = idOf(req);
    return ok(await ctx.onyxProctor.review(tenantId, subIdOf(req, 'eventId'),
      { tenant_id: tenantId, user_id: claims.user_id }, body), 'Reviewed.');
  });

  /**
   * Let a stopped candidate carry on, from the console.
   *
   * The same act the institution's own invigilator can take, behind the
   * platform guard -- and the same service call, so what is restored (the
   * answers, the minutes that were left, a fresh set of warnings) is decided
   * in one place rather than twice.
   */
  app.post('/api/onyx/platform/tenants/:id/attempts/:attemptId/reinstate', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const tenantId = idOf(req);
    const attemptId = subIdOf(req, 'attemptId');
    const restored = await ctx.onyxAssess.reinstate(tenantId, attemptId,
      { userId: claims.user_id });
    await ctx.onyxPlatform.recordAction(claims.user_id, 'attempt.reinstated', 'attempt',
      attemptId, null, { expires_at: restored?.expires_at ?? null });
    return ok(restored, 'They can carry on from where they were.');
  });

  /** Settle the whole attempt: cleared, or upheld. */
  app.post('/api/onyx/platform/tenants/:id/attempts/:attemptId/integrity', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      decision: z.enum(['cleared', 'upheld']),
      note: z.string().max(5000).nullish(),
    }), req.body);
    const tenantId = idOf(req);
    return ok(await ctx.onyxProctor.settle(tenantId, subIdOf(req, 'attemptId'),
      { tenant_id: tenantId, user_id: claims.user_id }, body), 'Recorded.');
  });

  /**
   * Watch one candidate's camera, live.
   *
   * The service refuses unless the paper was set up for live invigilation, the
   * attempt is still running, and the candidate consented -- so an operator
   * here gets exactly the three refusals an invigilator does, and cannot look
   * at somebody who agreed to less than that. The watch is audited against the
   * operator's own id, and the candidate is told on their own screen.
   */
  app.post('/api/onyx/platform/tenants/:id/attempts/:attemptId/watch', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxProctor.startWatch(
      idOf(req), subIdOf(req, 'attemptId'), { userId: claims.user_id }));
  });

  /**
   * One message into the negotiation, and everything the other side has sent.
   *
   * The sender is always `watcher`: a candidate signs in as themselves and uses
   * the tenant-side route, so there is no side to work out and no branch to get
   * wrong.
   */
  app.post('/api/onyx/platform/tenants/:id/attempts/:attemptId/signal', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      session_id: z.string().uuid(),
      kind: z.enum(['offer', 'answer', 'ice', 'bye']),
      payload: z.unknown(),
    }), req.body);
    return ok(await ctx.onyxProctor.postSignal(idOf(req), subIdOf(req, 'attemptId'), {
      sessionId: body.session_id, sender: 'watcher', kind: body.kind, payload: body.payload,
    }));
  });

  app.get('/api/onyx/platform/tenants/:id/attempts/:attemptId/signal', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = req.query as { session_id?: string; after?: string };
    if (!q.session_id) throw new HttpError(422, 'Which watching session?');
    return ok(await ctx.onyxProctor.pollSignals(idOf(req), subIdOf(req, 'attemptId'), {
      sessionId: q.session_id, sender: 'watcher', after: q.after ? Number(q.after) : 0,
    }));
  });

  /**
   * One candidate's script, from the console.
   *
   * The marker's view: the answers, the key beside each, the marks and any
   * note written against them. An operator is acting with an institution
   * administrator's authority here, which is the authority every other write
   * in this file already exercises.
   */
  app.get('/api/onyx/platform/tenants/:id/attempts/:attemptId/script.pdf',
    async (req, reply) => {
      await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
      const tenantId = idOf(req);
      const attemptId = subIdOf(req, 'attemptId');
      const [script, tenant] = await Promise.all([
        ctx.onyxAssess.scriptFor(tenantId, attemptId, null),
        ctx.onyxTenancy.tenant(tenantId),
      ]);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition',
        'attachment; filename="script-' + attemptId + '.pdf"');
      return reply.send(pdfScript({ ...script, institution: tenant?.name ?? '' }));
    });

  /** Every script on one paper, in one document. See the tenant-side route. */
  app.get('/api/onyx/platform/tenants/:id/assessments/:assessmentId/scripts.pdf',
    async (req, reply) => {
      await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
      const tenantId = idOf(req);
      const assessmentId = subIdOf(req, 'assessmentId');
      const [scripts, tenant] = await Promise.all([
        ctx.onyxAssess.scriptsFor(tenantId, assessmentId),
        ctx.onyxTenancy.tenant(tenantId),
      ]);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition',
        'attachment; filename="assessment-' + assessmentId + '-scripts.pdf"');
      return reply.send(pdfScriptBundle(
        scripts.map((sx) => ({ ...sx, institution: tenant?.name ?? '' }))));
    });

  /**
   * Every script sat under one EXAMINATION.
   *
   * A sitting is scheduled on a paper, so this resolves the paper first and
   * then reports on it. Offered separately because an operator looking at the
   * examinations list is thinking about the sitting, not about which
   * assessment id it happens to be linked to -- and an exam with no online
   * paper is answered plainly rather than with an empty document.
   */
  app.get('/api/onyx/platform/tenants/:id/exams/:examId/scripts.pdf', async (req, reply) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const tenantId = idOf(req);
    const exam = await ctx.onyxExams.exam(tenantId, subIdOf(req, 'examId'));
    if (!exam.assessment_id) {
      throw new HttpError(422, 'This sitting is marked by hand — it has no online paper, '
        + 'so there are no scripts to report on.');
    }
    const [scripts, tenant] = await Promise.all([
      ctx.onyxAssess.scriptsFor(tenantId, Number(exam.assessment_id)),
      ctx.onyxTenancy.tenant(tenantId),
    ]);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition',
      'attachment; filename="exam-' + subIdOf(req, 'examId') + '-scripts.pdf"');
    return reply.send(pdfScriptBundle(
      scripts.map((sx) => ({ ...sx, institution: tenant?.name ?? '' }))));
  });

  /**
   * Mark one attempt, question by question, from the console.
   *
   * The PATCH below sets a TOTAL, which is the right tool for correcting a
   * figure and the wrong one for marking. A web question -- and an essay, and
   * a code question the sandbox misjudged -- is marked per question, with a
   * comment against each, and the total is then derived rather than typed.
   *
   * The same service call a lecturer's marking screen makes, so what happens
   * afterwards is identical: the marks recompute, the attempt is released, and
   * the candidate sees the corrected figure rather than the old one.
   */
  app.post('/api/onyx/platform/tenants/:id/attempts/:attemptId/mark', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      marks: z.array(z.object({
        question_id: z.number().int().positive(),
        points: z.number().min(0),
        comment: z.string().max(5000).nullish(),
      })).min(1).max(200),
      comment: z.string().max(5000).nullish(),
    }), req.body);
    const tenantId = idOf(req);
    const attemptId = subIdOf(req, 'attemptId');
    const marked = await ctx.onyxAssess.mark(tenantId, attemptId, claims.user_id, body);
    await ctx.onyxPlatform.recordAction(claims.user_id, 'marks.overridden', 'attempt',
      attemptId, null, { questions: body.marks.length });
    return ok(marked, 'Marked.');
  });

  app.patch('/api/onyx/platform/tenants/:id/attempts/:attemptId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ score: z.number().min(0) }), req.body);
    return ok(await ctx.onyxPlatform.updateAssessmentAttemptScore(
      idOf(req), subIdOf(req, 'attemptId'), claims.user_id, body.score), 'Score updated.');
  });

  app.get('/api/onyx/platform/tenants/:id/attempts/:attemptId', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.assessmentAttempt(idOf(req), subIdOf(req, 'attemptId')));
  });

  app.get('/api/onyx/platform/tenants/:id/submissions/:submissionId', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.submission(idOf(req), subIdOf(req, 'submissionId')));
  });

  app.patch('/api/onyx/platform/tenants/:id/submissions/:submissionId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      score: z.number().min(0).optional(),
      feedback: z.string().max(4000).nullish(),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateSubmissionGrade(
      idOf(req), subIdOf(req, 'submissionId'), claims.user_id, body), 'Grade updated.');
  });

  app.get('/api/onyx/platform/tenants/:id/assignments/:assignmentId/submissions', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.assignmentSubmissions(idOf(req), subIdOf(req, 'assignmentId')));
  });

  app.patch('/api/onyx/platform/tenants/:id/courses/:courseId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(255).optional(),
      code: z.string().min(1).max(50).optional(),
      credits: z.number().int().min(0).optional(),
      status: z.number().int().min(0).max(1).optional(),
      access: z.enum(['batch', 'open', 'locked']).optional(),
      price_minor: z.number().int().min(0).max(10_000_000).optional(),
      currency: z.string().length(3).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateCourse(
      idOf(req), subIdOf(req, 'courseId'), claims.user_id, body), 'Updated.');
  });

  app.delete('/api/onyx/platform/tenants/:id/courses/:courseId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    await ctx.onyxPlatform.deleteCourse(idOf(req), subIdOf(req, 'courseId'), claims.user_id);
    return ok({}, 'Removed.');
  });

  // ===========================================================================
  // Live Classes
  //
  // The institution side has had these since domains shipped; the console had
  // no route to any of them, so the section could not exist. An operator
  // setting an institution up had to sign in as that institution to add one.
  // ===========================================================================

  app.get('/api/onyx/platform/tenants/:id/domains', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    // Through DomainsService, which resolves the stored image KEY into a URL
    // a browser can actually load. PlatformService has no storage and would
    // hand back a bucket path that renders as a broken image.
    return ok(await ctx.onyxDomains.list(idOf(req), { includeHidden: true }));
  });

  /**
   * A ticket to upload one Live Class banner, for the console.
   *
   * The same seam the institution's own composer uses -- the browser PUTs
   * straight to storage and sends back only the key, which is minted from the
   * tenant in the path and never from anything the caller supplies.
   */
  app.post('/api/onyx/platform/tenants/:id/domains/uploads/sign', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      filename: z.string().min(1).max(255),
    }), req.body);
    return ok(await ctx.onyxDomains.signUpload(idOf(req), body.filename));
  });

  app.post('/api/onyx/platform/tenants/:id/domains', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(200),
      summary: z.string().max(4000).nullish(),
      // Checked by name on the way in -- see normaliseCurriculumUrl. This
      // ends up in an anchor's href.
      curriculum_url: z.string().max(500).nullish(),
      // A storage key from the sign route above, never a URL: the bucket can
      // move, and a URL written into a row outlives the host it names.
      image_path: z.string().max(500).nullish(),
      certificate: z.string().max(200).nullish(),
      duration_label: z.string().max(80).nullish(),
      // Minor units, capped like every other price in this API.
      price_minor: z.number().int().min(0).max(100_000_000).optional(),
      sort: z.number().int().min(0).max(9999).optional(),
      status: z.number().int().min(0).max(1).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.createDomain(idOf(req), claims.user_id, body),
      'Live Class created.');
  });

  app.patch('/api/onyx/platform/tenants/:id/domains/:domainId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(200).optional(),
      summary: z.string().max(4000).nullish(),
      curriculum_url: z.string().max(500).nullish(),
      image_path: z.string().max(500).nullish(),
      certificate: z.string().max(200).nullish(),
      duration_label: z.string().max(80).nullish(),
      price_minor: z.number().int().min(0).max(100_000_000).optional(),
      sort: z.number().int().min(0).max(9999).optional(),
      status: z.number().int().min(0).max(1).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateDomain(
      idOf(req), subIdOf(req, 'domainId'), claims.user_id, body), 'Updated.');
  });

  app.delete('/api/onyx/platform/tenants/:id/domains/:domainId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.removeDomain(
      idOf(req), subIdOf(req, 'domainId'), claims.user_id), 'Removed.');
  });

  // ===========================================================================
  // Inside a course
  //
  // The console could create a course and rename it and never open it, so
  // there was nowhere for "add a module" to happen.
  // ===========================================================================

  app.get('/api/onyx/platform/tenants/:id/courses/:courseId/outline', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.courseOutline(idOf(req), subIdOf(req, 'courseId')));
  });

  app.post('/api/onyx/platform/tenants/:id/courses/:courseId/modules', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      summary: z.string().max(4000).nullish(),
      // Omitted means "put it last", which is what somebody adding a module
      // to the end of a course means. See createCourseModule.
      sort: z.number().int().min(0).max(9999).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.createCourseModule(
      idOf(req), subIdOf(req, 'courseId'), claims.user_id, body), 'Module added.');
  });

  app.patch('/api/onyx/platform/tenants/:id/modules/:moduleId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(255).optional(),
      summary: z.string().max(4000).nullish(),
      sort: z.number().int().min(0).max(9999).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateCourseModule(
      idOf(req), subIdOf(req, 'moduleId'), claims.user_id, body), 'Updated.');
  });

  app.post('/api/onyx/platform/tenants/:id/modules/:moduleId/lessons', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      type: z.enum(['video', 'document', 'image', 'text', 'link']),
      // A storage KEY from the sign route below for a file, or a URL for a
      // link. Never a path a caller invented: the key is minted server-side.
      path: z.string().max(500).nullish(),
      body: z.string().max(200_000).nullish(),
      duration_seconds: z.number().int().min(0).max(86_400).optional(),
      is_preview: z.boolean().optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.createCourseLesson(
      idOf(req), subIdOf(req, 'moduleId'), claims.user_id, body), 'Lesson added.');
  });

  /**
   * One lesson, opened.
   *
   * `ContentService.lesson` is reused rather than reimplemented: it mints the
   * signed URL, resolves a `link` to its own address, and gathers the lesson's
   * resources. Its enrolment gate is skipped for staff, and an operator asking
   * for a lesson through a platform-guarded route is exactly that case -- so
   * the role passed is 'admin', which is what the method already understands.
   *
   * The alternative was a second copy of the signing logic in
   * PlatformService, and two places that decide who may read a file is one
   * place too many.
   */
  app.get('/api/onyx/platform/tenants/:id/lessons/:lessonId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxContent.lesson(
      idOf(req), subIdOf(req, 'lessonId'), claims.user_id, 'admin'));
  });

  app.patch('/api/onyx/platform/tenants/:id/lessons/:lessonId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(255).optional(),
      body: z.string().max(200_000).nullish(),
      is_preview: z.boolean().optional(),
      sort: z.number().int().min(0).max(9999).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateCourseLesson(
      idOf(req), subIdOf(req, 'lessonId'), claims.user_id, body), 'Updated.');
  });

  // ===========================================================================
  // Making a paper sittable
  //
  // `createAssessment` writes a paper with no sections, so it draws no
  // questions -- and `start()` refuses it with "this assessment has no
  // questions" at the moment a candidate presses the button, which is far too
  // late for anybody to do something about it.
  // ===========================================================================

  app.delete('/api/onyx/platform/tenants/:id/assessments/:assessmentId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.deleteAssessment(
      idOf(req), subIdOf(req, 'assessmentId'), claims.user_id), 'Removed.');
  });

  app.delete('/api/onyx/platform/tenants/:id/exams/:examId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.deleteExam(
      idOf(req), subIdOf(req, 'examId'), claims.user_id), 'Removed.');
  });

  /**
   * The three "open the row" reads.
   *
   * Everything an operator needs about one paper, one sitting or one Live
   * Class -- who sat it, what they answered, what the invigilator's console
   * recorded, who registered and what was taken. All of it was already in the
   * database and none of it was reachable from the console.
   */
  app.get('/api/onyx/platform/tenants/:id/assessments/:assessmentId', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.assessmentDetail(idOf(req), subIdOf(req, 'assessmentId')));
  });

  app.get('/api/onyx/platform/tenants/:id/exams/:examId', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.examDetail(idOf(req), subIdOf(req, 'examId')));
  });

  app.get('/api/onyx/platform/tenants/:id/domains/:domainId', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const [domain, rest] = await Promise.all([
      ctx.onyxDomains.domain(idOf(req), subIdOf(req, 'domainId')),
      ctx.onyxPlatform.domainRegistrations(idOf(req), subIdOf(req, 'domainId')),
    ]);
    return ok({ domain, ...rest });
  });

  /**
   * Authoring, from the console.
   *
   * `AssessService` is reused rather than reimplemented: it validates an
   * answer key against the question type, refuses a code question with no
   * problem behind it, checks that the problem is published and has tests, and
   * versions a question when it changes. Rewriting any of that here would give
   * the console a second, quieter set of rules -- and the one that is quieter
   * is the one that lets a broken paper through.
   *
   * The actor is passed as `admin`, which is what a platform operator is with
   * respect to any one institution: `#assertCanAuthor` lets an admin author
   * against any course, and a platform token has already been checked to be a
   * platform token before we get here.
   */
  app.post('/api/onyx/platform/tenants/:id/banks', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      description: z.string().max(4000).nullish(),
      course_id: z.number().int().positive().nullish(),
    }), req.body);
    return ok(await ctx.onyxAssess.createBank(
      idOf(req), { userId: claims.user_id, role: 'admin' }, body), 'Question bank created.');
  });

  /** The parallel sets a bank holds. See the tenant-side route. */
  app.get('/api/onyx/platform/tenants/:id/banks/:bankId/sets', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxAssess.bankSets(idOf(req), subIdOf(req, 'bankId')));
  });

  app.get('/api/onyx/platform/tenants/:id/banks/:bankId/questions', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxAssess.questions(idOf(req), subIdOf(req, 'bankId')));
  });

  app.post('/api/onyx/platform/tenants/:id/banks/:bankId/questions', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      /*
       * Derived, not re-typed.
       *
       * This was a second hand-written copy of the list of question types, and
       * it drifted the moment a seventh was added: the console could author
       * every kind of question except the new one, and said only "the given
       * data was invalid". The service owns the list; this reads it.
       */
      type: z.enum(
        QUESTION_TYPES as unknown as [OnyxQuestionType, ...OnyxQuestionType[]]).optional(),
      prompt: z.string().min(1).max(20_000),
      options: z.array(z.object({
        id: z.string().min(1).max(20),
        text: z.string().min(1).max(2000),
      })).max(20).optional(),
      answer: z.unknown().optional(),
      explanation: z.string().max(20_000).nullish(),
      points: z.number().int().min(1).max(1000).optional(),
      difficulty: z.string().max(20).optional(),
      tags: z.array(z.string().max(50)).max(20).optional(),
      // Which parallel set of the bank this belongs to. Absent means Set 1.
      set_number: z.number().int().min(1).max(50).optional(),
      // `code` only: the Code Lab problem whose tests mark this question.
      problem_id: z.number().int().positive().nullish(),
    }), req.body);
    return ok(await ctx.onyxAssess.addQuestion(
      idOf(req), subIdOf(req, 'bankId'), { userId: claims.user_id, role: 'admin' }, body),
    'Question added.');
  });

  /**
   * The problems a code question can be bound to.
   *
   * Published ones only, because an unpublished problem has no promise that
   * its tests are finished -- and a code question is marked by running them.
   */
  app.get('/api/onyx/platform/tenants/:id/problems', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = validate(z.object({
      difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
      topic: z.string().max(100).optional(),
      course_id: z.coerce.number().int().positive().optional(),
      search: z.string().max(255).optional(),
    }), req.query ?? {});
    // 'admin' -- the console reads the bank as staff, so drafts are listed too.
    // Publishing is what makes a problem bindable to a code question, and an
    // operator cannot finish a draft they are not shown.
    return ok(await ctx.onyxCodeLab.problems(idOf(req), 'admin', {
      difficulty: q.difficulty, topic: q.topic, courseId: q.course_id, search: q.search,
    }));
  });

  /*
   * ------------------------------------------------------------------------
   * Code Lab authoring, from the console.
   *
   * The bank was readable here and nowhere else: an operator could bind a code
   * question to a problem but had no way to CREATE one, so the first coding
   * problem at any institution had to be authored by signing in as that
   * institution's own administrator. These routes are the same
   * CodeLabService calls the tenant side already makes -- no second
   * implementation of the validation, the publish rules, or of what a hidden
   * case may reveal.
   *
   * requirePlatformAdmin throughout, like every other route in this file. A
   * platform operator has no tenant role, so the service is handed 'admin'
   * explicitly for the reads that take one.
   * ------------------------------------------------------------------------
   */

  app.post('/api/onyx/platform/tenants/:id/problems', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(ProblemBody.extend({
      title: z.string().min(1).max(255),
      slug: z.string().max(255).optional(),
    }), req.body);
    return ok(
      await ctx.onyxCodeLab.createProblem(idOf(req), claims.user_id, body as ProblemInput),
      'Problem created as a draft.');
  });

  /** One problem, unredacted -- hidden cases included, because staff author them. */
  app.get('/api/onyx/platform/tenants/:id/problems/:problemId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxCodeLab.problem(
      idOf(req), subIdOf(req, 'problemId'), claims.user_id, 'admin'));
  });

  app.patch('/api/onyx/platform/tenants/:id/problems/:problemId', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(ProblemBody.extend({
      title: z.string().min(1).max(255).optional(),
    }), req.body);
    return ok(
      await ctx.onyxCodeLab.updateProblem(idOf(req), subIdOf(req, 'problemId'),
        body as ProblemPatch),
      'Saved.');
  });

  /**
   * The answer key.
   *
   * The service refuses this on a published problem -- changing the cases
   * under submissions already graded would regrade them silently -- so the
   * console offers Unpublish below rather than working around it.
   */
  app.put('/api/onyx/platform/tenants/:id/problems/:problemId/tests', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      tests: z.array(z.object({
        name: z.string().max(120).optional(),
        stdin: z.string().max(64 * 1024).nullish(),
        expected_stdout: z.string().max(64 * 1024),
        is_hidden: z.boolean().optional(),
        weight: z.number().min(0.01).max(1000).optional(),
      })).min(1).max(100),
    }), req.body);
    return ok(await ctx.onyxCodeLab.setTests(
      idOf(req), subIdOf(req, 'problemId'), body.tests), 'Test cases saved.');
  });

  app.post('/api/onyx/platform/tenants/:id/problems/:problemId/publish', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxCodeLab.publishProblem(
      idOf(req), subIdOf(req, 'problemId')), 'Published.');
  });

  app.post('/api/onyx/platform/tenants/:id/problems/:problemId/unpublish', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxCodeLab.unpublishProblem(
      idOf(req), subIdOf(req, 'problemId')), 'Back to draft.');
  });

  /** Every practice hand-in at this institution, filtered. */
  app.get('/api/onyx/platform/tenants/:id/code-submissions', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = validate(z.object({
      problem_id: z.coerce.number().int().positive().optional(),
      user_id: z.string().max(64).optional(),
      course_id: z.coerce.number().int().positive().optional(),
      // The states the grader actually writes -- queued, running, then done
      // or failed. 'graded' is the word the UI prints, not a value in the row.
      status: z.enum(['queued', 'running', 'done', 'failed']).optional(),
      language: z.string().max(50).optional(),
      mode: z.enum(['run', 'submit']).optional(),
      from: z.string().max(40).optional(),
      to: z.string().max(40).optional(),
      search: z.string().max(255).optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
    }), req.query ?? {});
    return ok(await ctx.onyxCodeLab.allSubmissions(idOf(req), q));
  });

  /** Every project workspace at this institution, filtered. */
  app.get('/api/onyx/platform/tenants/:id/workspaces', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = validate(z.object({
      course_id: z.union([z.literal('none'), z.coerce.number().int().positive()]).optional(),
      user_id: z.string().max(64).optional(),
      language: z.string().max(50).optional(),
      search: z.string().max(255).optional(),
    }), req.query ?? {});
    return ok(await ctx.onyxWorkspaces.listAll(idOf(req), {
      ...q, course_id: q.course_id === 'none' ? null : q.course_id,
    }));
  });

  /** The week a candidate would see: examinations and paper windows. */
  app.get('/api/onyx/platform/tenants/:id/exam-week', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const query = req.query as { from?: string; to?: string };
    const from = query.from ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
    const to = query.to ?? new Date(Date.now() + 21 * 86_400_000).toISOString();
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw new HttpError(422, 'That is not a date range.');
    }
    return ok(await ctx.onyxPlatform.examWeek(idOf(req), from, to));
  });

  // ===========================================================================
  // One person's permissions, and the institution's support queue
  //
  // Both existed on the institution's own side and neither was reachable from
  // the console -- so an operator taking a support call about either had to
  // sign in as that institution to act on it.
  // ===========================================================================

  /**
   * What one member may do, and why.
   *
   * The whole shape the institution's own screen reads, so the two consoles
   * render from one contract: what their ROLE gives them, what has been
   * decided about them BY NAME, what actually applies, and whether the
   * capability may be delegated to that role at all.
   */
  app.get('/api/onyx/platform/tenants/:id/members/:memberId/permissions', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const tenantId = idOf(req);
    const member = await ctx.onyxTenancy.memberById(tenantId, subIdOf(req, 'memberId'));
    const tenant = await ctx.onyxTenancy.tenant(tenantId);
    const overrides = (tenant?.permissions ?? {}) as PermissionOverrides;
    const personal = (member.permissions ?? {}) as Record<string, boolean>;
    const role = String(member.role) as Role;

    return ok({
      member: {
        id: member.id, user_id: member.user_id, role,
        name: member.user?.name ?? null, email: member.user?.email ?? null,
        roll_number: member.roll_number ?? null,
      },
      capabilities: CAPABILITIES.map((cap) => ({
        key: cap.key, area: cap.area, label: cap.label, detail: cap.detail,
        by_role: holdersOf(cap.key, overrides).includes(role),
        personal: Object.prototype.hasOwnProperty.call(personal, cap.key)
          ? personal[cap.key] : null,
        effective: can(role, cap.key, overrides,
          personal as Parameters<typeof can>[3]),
        // Several capabilities are deliberately never delegable. Naming a
        // person is not a way round that, and a screen should not offer a
        // switch the API will drop.
        grantable: role === 'admin' || cap.holders.includes(role),
      })),
      areas: CAPABILITY_AREAS,
    });
  });

  app.put('/api/onyx/platform/tenants/:id/members/:memberId/permissions', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const tenantId = idOf(req);
    const memberId = subIdOf(req, 'memberId');
    const body = validate(z.object({
      permissions: z.record(z.boolean()),
    }), req.body);

    const before = await ctx.onyxTenancy.memberById(tenantId, memberId);
    // `normalisePersonal` drops any GRANT the capability may never carry for
    // that role, so a hand-written request cannot give a student the fee
    // ledger -- the same guard the institution's own route relies on.
    const cleaned = normalisePersonal(body.permissions, String(before.role) as Role);
    await ctx.onyxTenancy.setMemberPermissions(tenantId, memberId, cleaned);

    // The PLATFORM log, not the institution's: an operator changing a
    // customer's permissions is an act of the platform and should read as one.
    await ctx.onyxPlatform.recordAction(claims.user_id, 'member.permissions',
      'membership', memberId,
      { permissions: before.permissions ?? {} }, { permissions: cleaned });
    return ok({ id: memberId, permissions: cleaned }, 'Permissions saved.');
  });

  /**
   * The institution's support queue.
   *
   * A learner raises a question from Help and it lands here. The console had
   * no view of it at all, so a platform operator could be told "nobody has
   * answered my ticket" and had no way to look, let alone answer.
   *
   * Read as an administrator of that institution -- which is what an operator
   * is with respect to it -- so the queue is the whole institution's rather
   * than one person's.
   */
  /*
   * The operator sees the whole of an institution's support queue.
   *
   * `worksQueue: true` says so outright rather than leaning on the `role:
   * 'admin'` it passes: the service now decides the queue from the
   * `support.assign` capability, and an operator holds no membership at the
   * institution and therefore no capabilities in it. Stating it here is what
   * keeps the console working, and stating it is also honest -- this session
   * is above the institution by definition.
   */
  app.get('/api/onyx/platform/tenants/:id/tickets', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const query = validate(z.object({
      status: z.enum(['open', 'assigned', 'answered', 'resolved', 'closed']).optional(),
    }), req.query ?? {});
    return ok(await ctx.onyxSupport.queue(idOf(req),
      { userId: claims.user_id, role: 'admin', worksQueue: true }, query));
  });

  app.get('/api/onyx/platform/tenants/:id/tickets/:ticketId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxSupport.ticket(idOf(req), subIdOf(req, 'ticketId'),
      { userId: claims.user_id, role: 'admin', worksQueue: true }));
  });

  app.post('/api/onyx/platform/tenants/:id/tickets/:ticketId/respond', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      body: z.string().min(1).max(20_000),
    }), req.body);
    return ok(await ctx.onyxSupport.respond(idOf(req), subIdOf(req, 'ticketId'),
      { userId: claims.user_id, role: 'admin', worksQueue: true }, body.body), 'Reply sent.');
  });

  app.post('/api/onyx/platform/tenants/:id/tickets/:ticketId/resolve', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      body: z.string().max(20_000).optional(),
    }), req.body);
    return ok(await ctx.onyxSupport.resolve(idOf(req), subIdOf(req, 'ticketId'),
      { userId: claims.user_id, role: 'admin', worksQueue: true }, body.body), 'Marked as resolved.');
  });

  // ===========================================================================
  // Who teaches a course
  //
  // The institution's own side has had these three routes all along; the
  // console had none of them, so an operator could create a course, add its
  // modules and lessons, publish it, schedule its examinations -- and not say
  // who teaches it. That is not a cosmetic gap: `assertCanTeach` is the check
  // every faculty-facing route makes, so an unassigned course is one no
  // lecturer can take a register for, mark work in, or invigilate.
  //
  // Delegated to AcademicsService rather than reimplemented here, which is the
  // exception to this file's usual rule of writing its own queries. The usual
  // rule exists because those methods take an actor shaped for a tenant token;
  // these three take only ids, so there is nothing to translate -- and the cap
  // of two faculty per course is a rule that must not exist twice.
  // ===========================================================================

  /** Who teaches this course, with the names an operator can recognise. */
  app.get('/api/onyx/platform/tenants/:id/courses/:courseId/faculty', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const tenantId = idOf(req);
    const courseId = subIdOf(req, 'courseId');
    const rows = await ctx.onyxAcademics.faculty(tenantId, courseId);

    /*
     * Names, not bare uuids.
     *
     * The institution's own screen can afford to return ids because it renders
     * beside a roster it already has. The console does not, and an operator
     * looking at "who teaches this" needs a person rather than a identifier
     * they would have to go and look up.
     */
    const people = await ctx.onyxPlatform.tenantPeople(tenantId, { limit: 200 });
    const byId = new Map((people.people ?? [])
      .map((p: { user_id: string }) => [String(p.user_id), p]));
    return ok(rows.map((r) => {
      const person = byId.get(String(r.user_id)) as
        { name?: string; email?: string; role?: string } | undefined;
      return {
        user_id: r.user_id,
        name: person?.name ?? null,
        email: person?.email ?? null,
        role: person?.role ?? null,
      };
    }));
  });

  app.post('/api/onyx/platform/tenants/:id/courses/:courseId/faculty', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const tenantId = idOf(req);
    const courseId = subIdOf(req, 'courseId');
    const body = validate(z.object({ user_id: z.string().uuid() }), req.body);

    // They have to teach HERE before they can teach this -- and the check is
    // against this institution's membership, so an operator cannot attach
    // somebody from another one by pasting their id.
    const membership = await ctx.onyxTenancy.membership(tenantId, body.user_id);
    if (!membership) throw new HttpError(422, 'They are not at this institution.');
    if (membership.role !== 'faculty' && membership.role !== 'admin') {
      throw new HttpError(422, 'Only faculty can be assigned to a course.');
    }

    const result = await ctx.onyxAcademics.assignFaculty(tenantId, courseId, body.user_id);
    if (result.assigned) {
      await ctx.onyxPlatform.recordAction(claims.user_id, 'course.faculty_assigned',
        'course', courseId, null, { user_id: body.user_id });
    }
    return ok(result, result.assigned ? 'Assigned.' : 'They already teach this course.');
  });

  app.delete('/api/onyx/platform/tenants/:id/courses/:courseId/faculty/:userId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const tenantId = idOf(req);
    const courseId = subIdOf(req, 'courseId');
    const userId = String((req.params as Record<string, string>).userId ?? '');
    const removed = await ctx.onyxAcademics.removeFaculty(tenantId, courseId, userId);
    await ctx.onyxPlatform.recordAction(claims.user_id, 'course.faculty_removed',
      'course', courseId, { user_id: userId }, null);
    return ok(removed, 'Removed.');
  });

  // ===========================================================================
  // Sections -- the teaching divisions an institution runs
  //
  // Reachable from the console because an institution's own administrator is
  // often the person who has NOT set them up: the divisions exist on a
  // timetable long before anybody types them into a product. An operator
  // configuring an institution needs to be able to put them in.
  // ===========================================================================

  app.get('/api/onyx/platform/tenants/:id/sections', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const tenantId = idOf(req);
    const [sections, counts] = await Promise.all([
      ctx.onyxSections.list(tenantId, { includeRetired: true }),
      ctx.onyxSections.counts(tenantId),
    ]);
    // The head-count beside each, because "which sections does this
    // institution run" and "how many are in them" are one question.
    return ok(sections.map((sx) => ({
      ...sx, member_count: counts.get(Number(sx.id)) ?? 0,
    })));
  });

  app.post('/api/onyx/platform/tenants/:id/sections', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      name: z.string().min(1).max(80),
      code: z.string().max(20).optional(),
      sort: z.number().int().min(0).max(999).optional(),
    }), req.body);
    const section = await ctx.onyxSections.create(idOf(req), body);
    await ctx.onyxPlatform.recordAction(claims.user_id, 'section.created', 'section',
      Number(section.id), null, { name: section.name, code: section.code });
    return ok(section, 'Section added.');
  });

  app.patch('/api/onyx/platform/tenants/:id/sections/:sectionId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      name: z.string().min(1).max(80).optional(),
      code: z.string().max(20).optional(),
      sort: z.number().int().min(0).max(999).optional(),
      status: z.number().int().min(0).max(1).optional(),
    }), req.body);
    const { before, section } = await ctx.onyxSections.update(
      idOf(req), subIdOf(req, 'sectionId'), body);
    await ctx.onyxPlatform.recordAction(claims.user_id, 'section.updated', 'section',
      subIdOf(req, 'sectionId'),
      { name: before.name, code: before.code, status: before.status },
      { name: section.name, code: section.code, status: section.status });
    return ok(section, 'Saved.');
  });

  /** Refused while anybody is in it — retire it instead. See the service. */
  app.delete('/api/onyx/platform/tenants/:id/sections/:sectionId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const gone = await ctx.onyxSections.remove(idOf(req), subIdOf(req, 'sectionId'));
    await ctx.onyxPlatform.recordAction(claims.user_id, 'section.removed', 'section',
      subIdOf(req, 'sectionId'), null, null);
    return ok(gone, 'Section removed.');
  });

  /**
   * The default set, for an institution that has none.
   *
   * Two presets because the naming is the only thing that differs: Malla Reddy
   * runs Alpha, Beta and Gamma; the convention nearly everywhere else is
   * Section A, B and C. Both are ordinary rows afterwards — renamed, reordered,
   * added to or retired — and neither is more real than the other.
   */
  app.post('/api/onyx/platform/tenants/:id/sections/seed', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      preset: z.enum(['greek', 'letters']).optional(),
    }), req.body ?? {});
    const sections = await ctx.onyxSections.seedDefaults(idOf(req),
      body.preset === 'greek' ? GREEK_SECTIONS : LETTER_SECTIONS);
    await ctx.onyxPlatform.recordAction(claims.user_id, 'section.created', 'tenant',
      idOf(req), null, { seeded: sections.length, preset: body.preset ?? 'letters' });
    return ok(sections, sections.length + ' sections ready.');
  });

  /** Move one person into a section, or out of every section. */
  app.put('/api/onyx/platform/tenants/:id/members/:memberId/section', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      section_id: z.number().int().positive().nullable(),
    }), req.body);
    const saved = await ctx.onyxSections.assign(
      idOf(req), subIdOf(req, 'memberId'), body.section_id);
    await ctx.onyxPlatform.recordAction(claims.user_id, 'member.section', 'membership',
      subIdOf(req, 'memberId'), null, { section_id: body.section_id });
    return ok(saved, body.section_id === null ? 'Removed from their section.' : 'Section set.');
  });

  app.get('/api/onyx/platform/tenants/:id/banks', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.questionBanks(idOf(req)));
  });

  app.put('/api/onyx/platform/tenants/:id/assessments/:assessmentId/sections', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      sections: z.array(z.object({
        id: z.string().min(1).max(50),
        title: z.string().min(1).max(255),
        bank_id: z.number().int().positive(),
        take: z.number().int().min(1).max(500),
      })).max(20),
    }), req.body);
    return ok(await ctx.onyxPlatform.setAssessmentSections(
      idOf(req), subIdOf(req, 'assessmentId'), claims.user_id, body.sections), 'Sections saved.');
  });

  app.post('/api/onyx/platform/tenants/:id/assessments/:assessmentId/publish', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.publishAssessment(
      idOf(req), subIdOf(req, 'assessmentId'), claims.user_id), 'Published.');
  });

  app.delete('/api/onyx/platform/tenants/:id/lessons/:lessonId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.removeCourseLesson(
      idOf(req), subIdOf(req, 'lessonId'), claims.user_id), 'Removed.');
  });

  /**
   * A ticket to upload one lesson file, for the console.
   *
   * The same seam the course's own composer uses: the browser PUTs straight
   * to storage and sends us back only the key. The key is derived from the
   * tenant in the path, never from anything the caller supplies -- a path
   * from a request body is a path into another institution's files.
   */
  app.post('/api/onyx/platform/tenants/:id/courses/:courseId/uploads/sign', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      filename: z.string().min(1).max(255),
    }), req.body);
    return ok(await ctx.onyxContent.signLessonUpload(
      idOf(req), subIdOf(req, 'courseId'), body.filename));
  });

  app.delete('/api/onyx/platform/tenants/:id/modules/:moduleId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.removeCourseModule(
      idOf(req), subIdOf(req, 'moduleId'), claims.user_id), 'Removed.');
  });

  app.patch('/api/onyx/platform/tenants/:id/assignments/:assignmentId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(255).optional(),
      due_at: z.string().nullish(),
      total_points: z.number().min(0).optional(),
      status: z.string().max(20).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateAssignment(
      idOf(req), subIdOf(req, 'assignmentId'), claims.user_id, body), 'Updated.');
  });

  app.patch('/api/onyx/platform/tenants/:id/exams/:examId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(255).optional(),
      starts_at: z.string().nullish(),
      duration_minutes: z.number().int().min(0).optional(),
      max_marks: z.number().min(0).optional(),
      pass_marks: z.number().min(0).optional(),
      status: z.string().max(20).optional(),
      window_enforced: z.boolean().optional(),
    }), req.body);
    const exam = await ctx.onyxPlatform.updateExam(
      idOf(req), subIdOf(req, 'examId'), claims.user_id, body);

    /*
     * MOVE THE PAPER WITH THE SITTING.
     *
     * An examination sat in a browser is an online paper whose window is
     * pinned to the sitting's slot, so a candidate cannot start it early or
     * late. The institution's own reschedule route has re-synced that window
     * since the link existed; this one never did -- so an operator moving a
     * sitting from the console moved the sitting and left the paper open at
     * the old hour. The list, the timetable and the register would all agree
     * on the new time, and the one thing that decides whether anybody can sit
     * it would still be on the old one.
     *
     * Re-synced only when there is something to re-sync for: no linked paper,
     * or an edit that touched neither the time nor the duration nor cancelled
     * it, leaves the window alone.
     */
    const linked = (exam as { assessment_id?: number | null } | null)?.assessment_id;
    if (linked
      && (body.starts_at !== undefined || body.duration_minutes !== undefined
        || body.window_enforced !== undefined
        || body.status === 'cancelled')) {
      await syncExamAssessmentWindow(ctx, idOf(req), Number(linked),
        exam as unknown as Parameters<typeof syncExamAssessmentWindow>[3],
        { userId: claims.user_id, role: 'admin' });
    }
    return ok(exam, 'Updated.');
  });

  app.patch('/api/onyx/platform/tenants/:id/assessments/:assessmentId', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(255).optional(),
      opens_at: z.string().nullish(),
      closes_at: z.string().nullish(),
      pass_mark: z.number().min(0).nullish(),
      duration_minutes: z.number().int().min(0).optional(),
      status: z.string().max(20).optional(),
      // How the paper is sat. Absent means "not stated", which the service
      // reads as its default -- monitored, with camera and screen, for a paper
      // set by an institution rather than by a lecturer.
      attempts_allowed: z.number().int().min(1).max(20).optional(),
      shuffle_questions: z.boolean().optional(),
      shuffle_options: z.boolean().optional(),
      proctoring: z.boolean().optional(),
      require_camera: z.boolean().optional(),
      require_screen: z.boolean().optional(),
      watch_camera: z.boolean().optional(),
      anonymous_marking: z.boolean().optional(),
      moderation_required: z.boolean().optional(),
      instant_results: z.boolean().optional(),
      // The departure rule, changeable after the fact -- every paper written
      // before 0040 has it at zero, and an institution deciding to apply the
      // rule should not have to rebuild the paper to do it.
      breach_limit: z.number().int().min(0).max(20).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.updateAssessment(
      idOf(req), subIdOf(req, 'assessmentId'), claims.user_id, body), 'Updated.');
  });

  app.get('/api/onyx/platform/admins', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.admins());
  });

  app.post('/api/onyx/platform/admins', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      email: z.string().email(),
      name: z.string().min(1).max(255).optional(),
      password: z.string().min(8).max(255).optional(),
    }), req.body);
    return ok(await ctx.onyxPlatform.grant(
      body.email, body.name ?? body.email, body.password ?? null, claims.user_id),
      'Granted.');
  });

  app.delete('/api/onyx/platform/admins/:id', async (req) => {
    const claims = await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.revoke(idOf(req), claims.user_id), 'Revoked.');
  });

  app.get('/api/onyx/platform/audit', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const q = req.query as { limit?: string; action?: string; entity_type?: string };
    return ok(await ctx.onyxPlatform.auditLog({
      limit: q.limit ? Number(q.limit) : undefined,
      action: q.action || undefined,
      entityType: q.entity_type || undefined,
    }));
  });

  app.get('/api/onyx/platform/audit/filters', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlatform.auditFilterOptions());
  });

  // ---------------------------------------------------------------------
  // OAuth Server Mode -- visibility, not registration. Third-party apps
  // self-register against GoTrue's own /oauth/clients/register directly
  // (Dynamic Client Registration); this is a platform admin's window into
  // what has registered, and the ability to revoke one. See
  // docs/ADR-011-supabase-auth-migration.md and
  // docs/runbooks/supabase-auth-setup.md.
  // ---------------------------------------------------------------------

  app.get('/api/onyx/platform/oauth-clients', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxOAuthClients.list());
  });

  app.delete('/api/onyx/platform/oauth-clients/:clientId', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const { clientId } = req.params as { clientId: string };
    await ctx.onyxOAuthClients.revoke(clientId);
    return ok({}, 'Revoked.');
  });
}
