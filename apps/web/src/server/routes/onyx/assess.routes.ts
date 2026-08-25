/**
 * Onyx O04 -- Onyx Assess.
 *
 * "Timed tests, remote proctoring and rich results analytics that give faculty
 * confidence in every score and cohort insight."
 *
 * The `exams` role earns its keep here. Until now it was a role with no work;
 * in Assess it is the one that runs papers, invigilates and publishes results,
 * without needing to teach the course.
 *
 * Three things are enforced by these routes rather than by any screen:
 *
 *   * **A candidate never sees an answer key.** The banks, the questions and
 *     the mark sheet are staff-only endpoints; the candidate's own view comes
 *     from `attemptForCandidate`, which is built to omit them.
 *   * **Time comes from the server.** No route accepts a client timestamp as
 *     authoritative; `seconds_remaining` is computed here.
 *   * **Results are invisible until published**, and publishing is audited.
 */
import type { Router, ReqLike } from '../../router.ts';
import { z } from 'zod';
import {
  validate, ok, HttpError, requireOnyx, requireOnyxRole,
  QUESTION_TYPES, EVENT_KINDS, ASSESSMENT_STATUSES,
} from '@onyx/core';
import type { OnyxQuestionType, MarkRole } from '@onyx/core';
import type { AppContext } from '../../app-context.ts';
import { assertCan } from '../../capability.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike, key = 'id') =>
  Number((req.params as Record<string, string>)[key]);
const ipOf = (req: ReqLike) => (req as unknown as { ip?: string }).ip ?? null;

/** Who runs assessments. Faculty teach; exams officers run papers. */
const STAFF = ['admin', 'faculty', 'exams'] as const;

const TypeSchema = z.enum(QUESTION_TYPES as unknown as [OnyxQuestionType, ...OnyxQuestionType[]]);
const OptionSchema = z.object({ id: z.string().min(1).max(20), text: z.string().min(1).max(2000) });

export function registerOnyxAssessRoutes(app: Router, ctx: AppContext): void {
  // -------------------------------------------------------------------------
  // ASS-01a -- question banks
  // -------------------------------------------------------------------------

  app.get('/api/onyx/banks', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    const q = req.query as { course_id?: string };
    return ok(await ctx.onyxAssess.banks(
      claims.tenant_id, q.course_id ? Number(q.course_id) : undefined));
  });

  app.post('/api/onyx/banks', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'assess.banks', claims.user_id);
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      description: z.string().max(5000).nullish(),
      course_id: z.number().int().positive().nullish(),
    }), req.body);
    return ok(await ctx.onyxAssess.createBank(
      claims.tenant_id, { userId: claims.user_id, role: claims.tenant_role }, body),
      'Bank created.');
  });

  /**
   * The questions, answer keys included.
   *
   * Staff only, and deliberately a separate endpoint from anything a candidate
   * can reach: this is the key to every paper drawn from the bank.
   */
  app.get('/api/onyx/banks/:id/questions', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    const q = req.query as { difficulty?: string; tag?: string; retired?: string };
    return ok(await ctx.onyxAssess.questions(claims.tenant_id, idOf(req), {
      difficulty: q.difficulty, tag: q.tag, includeRetired: q.retired === '1',
    }));
  });

  app.post('/api/onyx/banks/:id/questions', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'assess.banks', claims.user_id);
    const body = validate(z.object({
      type: TypeSchema.optional(),
      prompt: z.string().min(1).max(20_000),
      options: z.array(OptionSchema).max(20).optional(),
      answer: z.unknown().optional(),
      explanation: z.string().max(20_000).nullish(),
      points: z.number().int().min(1).max(1000).optional(),
      difficulty: z.string().max(20).optional(),
      tags: z.array(z.string().max(50)).max(20).optional(),
      // `code` only: the Code Lab problem whose tests mark this question.
      problem_id: z.number().int().positive().nullish(),
    }), req.body);
    return ok(await ctx.onyxAssess.addQuestion(
      claims.tenant_id, idOf(req), { userId: claims.user_id, role: claims.tenant_role }, body),
      'Question added.');
  });

  /** Editing writes a new version; the old one stays as it was sat. */
  app.patch('/api/onyx/questions/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    const body = validate(z.object({
      type: TypeSchema.optional(),
      prompt: z.string().min(1).max(20_000).optional(),
      options: z.array(OptionSchema).max(20).optional(),
      answer: z.unknown().optional(),
      explanation: z.string().max(20_000).nullish(),
      points: z.number().int().min(1).max(1000).optional(),
      difficulty: z.string().max(20).optional(),
      tags: z.array(z.string().max(50)).max(20).optional(),
      problem_id: z.number().int().positive().nullish(),
    }), req.body);
    return ok(await ctx.onyxAssess.editQuestion(
      claims.tenant_id, idOf(req), { userId: claims.user_id, role: claims.tenant_role }, body),
      'Question updated.');
  });

  app.delete('/api/onyx/questions/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    return ok(await ctx.onyxAssess.retireQuestion(
      claims.tenant_id, idOf(req), { userId: claims.user_id, role: claims.tenant_role }),
      'Retired.');
  });

  // -------------------------------------------------------------------------
  // ASS-01b -- assessments
  // -------------------------------------------------------------------------

  app.get('/api/onyx/assessments', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const q = req.query as { course_id?: string };
    // A learner's own section, so they are shown their section's papers and
    // the ones set for everybody. Staff pass undefined and see them all.
    const staff = claims.tenant_role === 'admin' || claims.tenant_role === 'faculty'
      || claims.tenant_role === 'exams';
    const sectionId = staff ? undefined
      : await ctx.onyxSections.sectionOf(claims.tenant_id, claims.user_id);
    return ok(await ctx.onyxAssess.assessments(
      claims.tenant_id, claims.tenant_role,
      q.course_id ? Number(q.course_id) : undefined, sectionId));
  });

  app.post('/api/onyx/assessments', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'assess.papers', claims.user_id);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      course_id: z.number().int().positive().nullish(),
      instructions: z.string().max(20_000).nullish(),
      opens_at: z.string().nullish(),
      closes_at: z.string().nullish(),
      duration_minutes: z.number().int().min(1).max(1440).optional(),
      attempts_allowed: z.number().int().min(1).max(20).optional(),
      sections: z.array(z.object({
        id: z.string().min(1).max(50),
        title: z.string().min(1).max(255),
        bank_id: z.number().int().positive(),
        take: z.number().int().min(1).max(500),
      })).max(20).optional(),
      shuffle_questions: z.boolean().optional(),
      shuffle_options: z.boolean().optional(),
      proctoring: z.boolean().optional(),
      require_camera: z.boolean().optional(),
      // ASS-02b. Off by default at the column too: a paper that switched
      // this on by accident would be watching people who consented to less.
      watch_camera: z.boolean().optional(),
      // Hand the mark back at submit, for a paper that needs no marker. The
      // service refuses to act on it when anything awaits a human or the
      // paper requires moderation -- see AssessService#finalise.
      instant_results: z.boolean().optional(),
      require_screen: z.boolean().optional(),
      anonymous_marking: z.boolean().optional(),
      moderation_required: z.boolean().optional(),
      pass_mark: z.number().int().min(0).nullish(),
    }), req.body);
    return ok(await ctx.onyxAssess.createAssessment(
      claims.tenant_id, { userId: claims.user_id, role: claims.tenant_role }, body),
      'Assessment created.');
  });

  app.get('/api/onyx/assessments/:id', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const assessment = await ctx.onyxAssess.assessment(claims.tenant_id, idOf(req));
    const staff = (STAFF as readonly string[]).includes(claims.tenant_role);
    if (!staff && assessment.status !== 'published') {
      throw new HttpError(404, 'Assessment not found.');
    }
    return ok({
      ...assessment,
      // The section definitions name the banks a paper is drawn from, which is
      // not something a candidate needs and is a map of the bank if they had it.
      sections: staff ? assessment.sections : undefined,
    });
  });

  /** Correct an assessment's own fields -- title, window, pass mark, duration. */
  app.patch('/api/onyx/assessments/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    const body = validate(z.object({
      title: z.string().min(1).max(255).optional(),
      opens_at: z.string().nullish(),
      closes_at: z.string().nullish(),
      pass_mark: z.number().int().min(0).nullish(),
      duration_minutes: z.number().int().min(1).max(1440).optional(),
      status: z.enum(ASSESSMENT_STATUSES).optional(),
      // Composition. The service refuses these once the paper is published --
      // a sat paper whose sections changed underneath it is two different
      // papers under one title.
      instructions: z.string().max(20_000).nullish(),
      attempts_allowed: z.number().int().min(1).max(20).optional(),
      sections: z.array(z.object({
        id: z.string().min(1).max(50),
        title: z.string().min(1).max(255),
        bank_id: z.number().int().positive(),
        take: z.number().int().min(1).max(500),
      })).max(20).optional(),
      shuffle_questions: z.boolean().optional(),
      shuffle_options: z.boolean().optional(),
      proctoring: z.boolean().optional(),
      require_camera: z.boolean().optional(),
      // ASS-02b. Off by default at the column too: a paper that switched
      // this on by accident would be watching people who consented to less.
      watch_camera: z.boolean().optional(),
      // Hand the mark back at submit, for a paper that needs no marker. The
      // service refuses to act on it when anything awaits a human or the
      // paper requires moderation -- see AssessService#finalise.
      instant_results: z.boolean().optional(),
      require_screen: z.boolean().optional(),
      anonymous_marking: z.boolean().optional(),
      moderation_required: z.boolean().optional(),
    }), req.body);
    const { assessment, before, after } = await ctx.onyxAssess.updateAssessment(
      claims.tenant_id, idOf(req), { userId: claims.user_id, role: claims.tenant_role }, body);
    if (Object.keys(after).length) {
      await ctx.onyxAudit.record(claims, {
        action: 'assessment.updated', entityType: 'assessment', entityId: idOf(req),
        before, after, ip: ipOf(req),
      });
    }
    return ok(assessment, 'Updated.');
  });

  /**
   * Cancel a paper.
   *
   * There was no way to remove one from the institution's side at all: a paper
   * created by mistake, or a draft that drew nothing and never would, stayed on
   * the list for ever with an Edit button and nothing else. Only the console
   * could delete one, which meant a lecturer's own tidying-up needed a platform
   * operator.
   *
   * `assertCanTeach` first: a paper belongs to a course, and faculty may act
   * only on the courses they teach. An admin is past that check
   * unconditionally, which is the same rule every other route here follows.
   *
   * The service refuses once anybody has sat it, and says how many -- their
   * answers and marks hang off the row.
   */
  app.delete('/api/onyx/assessments/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    const assessment = await ctx.onyxAssess.assessment(claims.tenant_id, idOf(req));
    if (assessment.course_id) {
      await ctx.onyxAcademics.assertCanTeach(claims.tenant_id, Number(assessment.course_id),
        claims.user_id, claims.tenant_role);
    } else if (claims.tenant_role !== 'admin') {
      // A paper tied to no course has no teaching relationship to check
      // against, so there is nothing that would make it one lecturer's rather
      // than another's. An administrator decides.
      throw new HttpError(403, 'Only an administrator can remove a paper that is not '
        + 'tied to a course.');
    }

    const removed = await ctx.onyxAssess.deleteAssessment(claims.tenant_id, idOf(req));
    await ctx.onyxAudit.record(claims, {
      action: 'assessment.deleted', entityType: 'assessment', entityId: idOf(req),
      before: { title: removed.title, status: assessment.status }, ip: ipOf(req),
    });
    return ok({ id: removed.id, removed: true }, 'Paper removed.');
  });

  /** Override one attempt's score directly -- a dispute or a data-entry fix. */
  app.patch('/api/onyx/attempts/:id/score', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    const body = validate(z.object({ score: z.number().min(0) }), req.body);
    const result = await ctx.onyxAssess.overrideScore(claims.tenant_id, idOf(req), body.score);
    await ctx.onyxAudit.record(claims, {
      action: 'assessment.grade_changed', entityType: 'assessment_attempt', entityId: idOf(req),
      before: result.before, after: { score: result.score }, ip: ipOf(req),
    });
    return ok(result, 'Score updated.');
  });

  /**
   * A representative dealt paper, without sitting one.
   *
   * Until now the only way to see what a paper actually produces was to start
   * a real attempt -- which consumes an allowance, starts a server-side timer
   * and, on a one-attempt paper, cannot be undone. So nobody checked, and the
   * first person to see the paper was a candidate.
   *
   * Seeded by the assessment id rather than an attempt, so it is stable
   * between refreshes and is honestly labelled as *a* draw rather than *the*
   * draw -- with shuffling on, every candidate gets a different one.
   * Staff-only, and the answer keys are stripped: this is what a candidate
   * sees, which is the whole question being asked.
   */
  app.get('/api/onyx/assessments/:id/preview', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    return ok(await ctx.onyxAssess.previewPaper(
      claims.tenant_id, idOf(req), { userId: claims.user_id, role: claims.tenant_role }));
  });

  app.post('/api/onyx/assessments/:id/publish', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'assess.publish', claims.user_id);
    // The actor, so publishing is held to the same course check as every
    // other authoring act rather than being the one hole in it.
    const published = await ctx.onyxAssess.publishAssessment(claims.tenant_id, idOf(req),
      { userId: claims.user_id, role: claims.tenant_role });
    await ctx.onyxAudit.record(claims, {
      action: 'assessment.published', entityType: 'assessment', entityId: idOf(req),
      after: { title: published.title }, ip: ipOf(req),
    });
    return ok(published, 'Published.');
  });

  // -------------------------------------------------------------------------
  // ASS-01b/c -- sitting one
  // -------------------------------------------------------------------------

  /** Starts, or resumes the attempt already in progress. Same call either way. */
  app.post('/api/onyx/assessments/:id/start', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      consent: z.boolean().optional(),
      // What the browser has running. A paper that requires a camera or a
      // screen share is not dealt without it -- see AssessService.start.
      devices: z.object({
        camera: z.boolean().optional(),
        screen: z.boolean().optional(),
      }).optional(),
    }), req.body ?? {});
    return ok(await ctx.onyxAssess.start(claims.tenant_id, idOf(req), claims.user_id, body));
  });

  app.get('/api/onyx/attempts/:id', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxAssess.attemptForCandidate(
      claims.tenant_id, idOf(req), claims.user_id));
  });

  /** ASS-01c -- autosave. One answer, written as it is given. */
  app.post('/api/onyx/attempts/:id/answer', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      question_id: z.number().int().positive(),
      response: z.unknown(),
    }), req.body);
    return ok(await ctx.onyxAssess.saveAnswer(
      claims.tenant_id, idOf(req), claims.user_id, body));
  });

  app.post('/api/onyx/attempts/:id/submit', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxAssess.submit(claims.tenant_id, idOf(req), claims.user_id),
      'Handed in.');
  });

  /** Sweeps attempts whose time ran out while nobody was looking. */
  app.post('/api/onyx/assessments/expire', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    return ok(await ctx.onyxAssess.expireOverdue(claims.tenant_id));
  });

  // -------------------------------------------------------------------------
  // ASS-02 -- proctoring
  // -------------------------------------------------------------------------

  /**
   * One event from the candidate's own session.
   *
   * The attempt is checked against the caller, so nobody can post events onto
   * another candidate's paper.
   */
  app.post('/api/onyx/attempts/:id/proctor', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      kind: z.enum(EVENT_KINDS as [string, ...string[]]),
      detail: z.unknown().optional(),
      client_at: z.string().nullish(),
      media_path: z.string().max(500).nullish(),
    }), req.body);
    return ok(await ctx.onyxProctor.record(
      claims.tenant_id, idOf(req), claims.user_id, body));
  });

  // ---- ASS-02b: watching a candidate's camera, live ----------------------
  //
  // The video is peer-to-peer and never reaches this server. These four routes
  // carry only the messages two browsers need in order to find each other, and
  // they exist so that "may this person watch this candidate" is answered by
  // the same guards as everything else rather than by a second set of rules on
  // a Realtime channel. Migration 0033's header has the reasoning and the
  // limits -- one candidate at a time, and some networks need a TURN relay.

  /**
   * Which end of the negotiation a caller is, worked out from who they are.
   *
   * NEVER from the request body. A candidate who could name themselves the
   * watcher would be able to read an invigilator's half of the exchange, and
   * to post an offer that makes their own screen believe somebody with
   * authority is watching them.
   *
   * Owning the attempt makes you the candidate. Otherwise you must be staff
   * who may invigilate -- the same authority that already reads the proctoring
   * timeline for that attempt, so nobody is escalated by this: somebody who
   * may see every flag raised against a candidate may see the camera those
   * flags came from.
   */
  const sideOf = async (
    claims: { tenant_id: number; user_id: string; tenant_role: string },
    attemptId: number,
  ): Promise<'watcher' | 'candidate'> => {
    if (await ctx.onyxProctor.isCandidate(claims.tenant_id, attemptId, claims.user_id)) {
      return 'candidate';
    }
    if (!(STAFF as readonly string[]).includes(claims.tenant_role)) {
      throw new HttpError(403, 'That is not your attempt.');
    }
    return 'watcher';
  };

  /**
   * Whoever may invigilate this paper asks to watch one candidate.
   *
   * The service refuses if the paper was not set up for live invigilation, if
   * the attempt has finished, or if the candidate never consented.
   */
  app.post('/api/onyx/attempts/:id/watch', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    return ok(await ctx.onyxProctor.startWatch(
      claims.tenant_id, idOf(req), { userId: claims.user_id }));
  });

  /**
   * Is anybody watching me?
   *
   * The CANDIDATE's own screen asks this, which is why it is `requireOnyx` and
   * an ownership check rather than a staff role. It does two things: nothing
   * streams until somebody is actually looking, and the person being watched
   * is told so on their own screen while it happens.
   */
  app.get('/api/onyx/attempts/:id/watch', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    if (!(await ctx.onyxProctor.isCandidate(claims.tenant_id, idOf(req), claims.user_id))) {
      throw new HttpError(403, 'That is not your attempt.');
    }
    return ok(await ctx.onyxProctor.watchState(claims.tenant_id, idOf(req)));
  });

  /** One message into the negotiation. */
  app.post('/api/onyx/attempts/:id/signal', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      session_id: z.string().uuid(),
      kind: z.enum(['offer', 'answer', 'ice', 'bye']),
      payload: z.unknown(),
    }), req.body);
    const sender = await sideOf(claims, idOf(req));
    return ok(await ctx.onyxProctor.postSignal(claims.tenant_id, idOf(req), {
      sessionId: body.session_id, sender, kind: body.kind, payload: body.payload,
    }));
  });

  /** Everything the other side has sent on this session since `after`. */
  app.get('/api/onyx/attempts/:id/signal', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const q = req.query as { session_id?: string; after?: string };
    if (!q.session_id) throw new HttpError(422, 'Which watching session?');
    const sender = await sideOf(claims, idOf(req));
    return ok(await ctx.onyxProctor.pollSignals(claims.tenant_id, idOf(req), {
      sessionId: q.session_id, sender, after: q.after ? Number(q.after) : 0,
    }));
  });

  app.get('/api/onyx/attempts/:id/proctor', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    return ok(await ctx.onyxProctor.timeline(claims.tenant_id, idOf(req)));
  });

  /**
   * Admin and exams see the institution's whole queue -- that is the
   * office's job. Faculty see it narrowed to their own courses: this used
   * to hand every faculty account the unfiltered queue, flags on courses
   * they had never taught included, because nothing ever passed a filter.
   * An explicit `?assessment_id=` still narrows further, for whoever is
   * already looking at one paper.
   */
  app.get('/api/onyx/proctor/queue', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    const q = req.query as { assessment_id?: string };
    if (q.assessment_id) {
      return ok(await ctx.onyxProctor.reviewQueue(claims.tenant_id, [Number(q.assessment_id)]));
    }
    if (claims.tenant_role === 'faculty') {
      const teaching = await ctx.onyxAcademics.teachingFor(claims.tenant_id, claims.user_id);
      const ids = await ctx.onyxAssess.assessmentIdsForCourses(claims.tenant_id, teaching);
      return ok(await ctx.onyxProctor.reviewQueue(claims.tenant_id, ids));
    }
    return ok(await ctx.onyxProctor.reviewQueue(claims.tenant_id));
  });

  app.post('/api/onyx/proctor/events/:id/review', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'assess.proctor', claims.user_id);
    const body = validate(z.object({
      decision: z.enum(['dismissed', 'upheld']),
      note: z.string().max(5000).nullish(),
    }), req.body);
    return ok(await ctx.onyxProctor.review(claims.tenant_id, idOf(req), claims, body),
      'Reviewed.');
  });

  app.post('/api/onyx/attempts/:id/integrity', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    const body = validate(z.object({
      decision: z.enum(['cleared', 'upheld']),
      note: z.string().max(5000).nullish(),
    }), req.body);
    return ok(await ctx.onyxProctor.settle(claims.tenant_id, idOf(req), claims, body),
      'Recorded.');
  });

  // -------------------------------------------------------------------------
  // ASS-03 -- marking and moderation
  // -------------------------------------------------------------------------

  app.get('/api/onyx/assessments/:id/marking', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    return ok(await ctx.onyxAssess.markingQueue(claims.tenant_id, idOf(req)));
  });

  /** One paper to mark. Anonymised when the assessment says so. */
  app.get('/api/onyx/attempts/:id/paper', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    return ok(await ctx.onyxAssess.attemptForMarker(claims.tenant_id, idOf(req)));
  });

  app.post('/api/onyx/attempts/:id/mark', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'assess.mark', claims.user_id);
    const body = validate(z.object({
      role: z.enum(['first', 'second', 'moderation']).optional(),
      marks: z.array(z.object({
        question_id: z.number().int().positive(),
        points: z.number().min(0),
        comment: z.string().max(10_000).nullish(),
      })).min(1).max(500),
      comment: z.string().max(10_000).nullish(),
    }), req.body);

    const marked = await ctx.onyxAssess.mark(
      claims.tenant_id, idOf(req), claims.user_id, body as { role?: MarkRole } & typeof body);
    await ctx.onyxAudit.record(claims, {
      action: 'assessment.grade_changed', entityType: 'assessment_attempt', entityId: idOf(req),
      after: { role: body.role ?? 'first', score: marked.score }, ip: ipOf(req),
    });
    return ok(marked, 'Marked.');
  });

  /**
   * ASS-03b -- release. Audited, and refused if moderation is outstanding.
   *
   * The examinations office institution-wide, or this specific assessment's
   * own course faculty -- the same split just extended to exams (see
   * assertCanRunExam in campus.routes.ts): a faculty member who marks their
   * own course's quiz can release it themselves, not only enter the marks
   * and then wait on the office. An assessment with no course at all (not
   * tied to any one class) stays office-only -- there is no "this course's
   * faculty" to extend it to.
   */
  app.post('/api/onyx/assessments/:id/results/publish', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'assess.release', claims.user_id);
    if (claims.tenant_role !== 'admin' && claims.tenant_role !== 'exams') {
      const assessment = await ctx.onyxAssess.assessment(claims.tenant_id, idOf(req));
      if (!assessment.course_id) {
        throw new HttpError(403, 'Only the examinations office can publish results for an '
          + 'assessment with no course.');
      }
      await ctx.onyxAcademics.assertCanTeach(
        claims.tenant_id, Number(assessment.course_id), claims.user_id, claims.tenant_role);
    }
    const result = await ctx.onyxAssess.publishResults(claims.tenant_id, idOf(req));
    await ctx.onyxAudit.record(claims, {
      action: 'result.published', entityType: 'assessment', entityId: idOf(req),
      after: result, ip: ipOf(req),
    });
    return ok(result, result.published + ' results published.');
  });

  // -------------------------------------------------------------------------
  // ASS-04 -- results and analytics
  // -------------------------------------------------------------------------

  app.get('/api/onyx/assessments/:id/results', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    return ok(await ctx.onyxAssessAnalytics.results(claims.tenant_id, idOf(req)));
  });

  app.get('/api/onyx/assessments/:id/items', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    return ok(await ctx.onyxAssessAnalytics.itemAnalysis(claims.tenant_id, idOf(req)));
  });

  app.get('/api/onyx/courses/:id/benchmark', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    return ok(await ctx.onyxAssessAnalytics.benchmark(claims.tenant_id, idOf(req)));
  });

  /** ASS-04b -- the CSV an exams office actually wants. */
  app.get('/api/onyx/assessments/:id/results.csv', async (req, reply) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    const members = await ctx.onyxTenancy.members(claims.tenant_id);
    const names = new Map(members.map((m) => [String(m.user_id), {
      name: m.user?.name ?? '', email: m.user?.email ?? '',
    }]));
    const csv = await ctx.onyxAssessAnalytics.exportCsv(claims.tenant_id, idOf(req), { names });

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition',
      'attachment; filename="assessment-' + idOf(req) + '-results.csv"');
    return reply.send(csv);
  });

  /** ASS-04b -- the same report as a document, for the board paper. */
  app.get('/api/onyx/assessments/:id/results.pdf', async (req, reply) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...STAFF);
    const [members, tenant] = await Promise.all([
      ctx.onyxTenancy.members(claims.tenant_id),
      ctx.onyxTenancy.tenant(claims.tenant_id),
    ]);
    const names = new Map(members.map((m) => [String(m.user_id), {
      name: m.user?.name ?? '', email: m.user?.email ?? '',
    }]));
    const pdf = await ctx.onyxAssessAnalytics.exportPdf(claims.tenant_id, idOf(req), {
      names, issuer: tenant?.name ?? null,
    });

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition',
      'attachment; filename="assessment-' + idOf(req) + '-results.pdf"');
    return reply.send(pdf);
  });

  /** A candidate's own results, once they exist. */
  app.get('/api/onyx/my/assessments', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxAssess.myAttempts(claims.tenant_id, claims.user_id));
  });
}
