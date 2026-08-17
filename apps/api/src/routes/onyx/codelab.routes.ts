/**
 * Onyx O03 -- Code Lab.
 *
 * "A browser IDE, guided practice and project workspaces backed by a sandboxed,
 * auto-grading evaluator built for real skill-building."
 *
 * Three things are enforced here rather than in the browser:
 *
 *   * **Hidden test cases never appear in a response.** The service strips
 *     them; these routes never reach around it to select the raw rows.
 *   * **Submitting queues work and returns.** Nothing on this file runs learner
 *     code inline, so 200 submissions at once is a latency problem.
 *   * **`assertCanTeach` on anything about a course**, as in O02.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  validate, ok, HttpError, requireOnyx, requireOnyxRole,
  LANGUAGES, DIFFICULTIES, SOLUTION_RULES, NoSandboxError,
} from '@onyx/core';
import type { Difficulty, Language, SolutionRule } from '@onyx/core';
import type { AppContext } from '../../context.ts';

const asReq = (req: FastifyRequest) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: FastifyRequest, key = 'id') =>
  Number((req.params as Record<string, string>)[key]);

const LanguageSchema = z.enum(LANGUAGES as [Language, ...Language[]]);
const DifficultySchema = z.enum(DIFFICULTIES as unknown as [Difficulty, ...Difficulty[]]);
const RuleSchema = z.enum(SOLUTION_RULES as unknown as [SolutionRule, ...SolutionRule[]]);

export function registerOnyxCodeLabRoutes(app: FastifyInstance, ctx: AppContext): void {
  // -------------------------------------------------------------------------
  // LAB-04 -- the problem bank
  // -------------------------------------------------------------------------

  app.get('/api/onyx/problems', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const q = req.query as {
      difficulty?: Difficulty; topic?: string; course_id?: string; search?: string;
    };
    return ok(await ctx.onyxCodeLab.problems(claims.tenant_id, claims.tenant_role, {
      difficulty: q.difficulty,
      topic: q.topic,
      courseId: q.course_id ? Number(q.course_id) : undefined,
      search: q.search,
    }));
  });

  app.post('/api/onyx/problems', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      slug: z.string().max(255).optional(),
      statement: z.string().max(100_000).nullish(),
      difficulty: DifficultySchema.optional(),
      topic: z.string().max(100).nullish(),
      tags: z.array(z.string().max(50)).max(20).optional(),
      languages: z.array(LanguageSchema).max(8).optional(),
      starter_code: z.record(z.string(), z.string().max(20_000)).optional(),
      course_id: z.number().int().positive().nullish(),
      time_limit_ms: z.number().int().min(100).max(30_000).optional(),
      memory_limit_kb: z.number().int().min(16_384).max(1_048_576).optional(),
      solution: z.string().max(100_000).nullish(),
      solution_rule: RuleSchema.optional(),
      solution_after_attempts: z.number().int().min(1).max(100).optional(),
      solution_after: z.string().nullish(),
    }), req.body);

    if (body.course_id) {
      await ctx.onyxAcademics.assertCanTeach(
        claims.tenant_id, body.course_id, claims.user_id, claims.tenant_role);
    }
    return ok(await ctx.onyxCodeLab.createProblem(claims.tenant_id, claims.user_id, body),
      'Problem created.');
  });

  /**
   * Everything about a problem except its cases -- title, statement, topic,
   * tags, languages, limits, the course it belongs to, the worked solution
   * and when it releases. Stays editable regardless of publish status; see
   * updateProblem()'s own comment for why that is safe where setTests()
   * below is deliberately not.
   */
  app.patch('/api/onyx/problems/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const body = validate(z.object({
      title: z.string().min(1).max(255).optional(),
      statement: z.string().max(100_000).nullish(),
      difficulty: DifficultySchema.optional(),
      topic: z.string().max(100).nullish(),
      tags: z.array(z.string().max(50)).max(20).optional(),
      languages: z.array(LanguageSchema).max(8).optional(),
      course_id: z.number().int().positive().nullish(),
      time_limit_ms: z.number().int().min(100).max(30_000).optional(),
      memory_limit_kb: z.number().int().min(16_384).max(1_048_576).optional(),
      solution: z.string().max(100_000).nullish(),
      solution_rule: RuleSchema.optional(),
      solution_after_attempts: z.number().int().min(1).max(100).optional(),
      solution_after: z.string().nullish(),
    }), req.body);

    if (body.course_id) {
      await ctx.onyxAcademics.assertCanTeach(
        claims.tenant_id, body.course_id, claims.user_id, claims.tenant_role);
    }
    return ok(await ctx.onyxCodeLab.updateProblem(claims.tenant_id, idOf(req), body), 'Updated.');
  });

  /**
   * The way back to draft, so setTests() below has somewhere to work again
   * once a problem is published. See unpublishProblem()'s own comment for
   * why this is a deliberate, separate action rather than automatic.
   */
  app.post('/api/onyx/problems/:id/unpublish', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    return ok(await ctx.onyxCodeLab.unpublishProblem(claims.tenant_id, idOf(req)), 'Unpublished.');
  });

  /**
   * The answer key. Faculty only, and only before publishing -- the service
   * refuses afterwards, because changing cases regrades old submissions
   * silently.
   */
  app.put('/api/onyx/problems/:id/tests', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const body = validate(z.object({
      tests: z.array(z.object({
        name: z.string().max(255).optional(),
        stdin: z.string().max(100_000).nullish(),
        expected_stdout: z.string().max(100_000),
        is_hidden: z.boolean().optional(),
        weight: z.number().int().min(1).max(1000).optional(),
      })).min(1).max(100),
    }), req.body);
    return ok(await ctx.onyxCodeLab.setTests(claims.tenant_id, idOf(req), body.tests),
      'Test cases saved.');
  });

  app.put('/api/onyx/problems/:id/hints', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    const body = validate(z.object({
      hints: z.array(z.object({
        body: z.string().min(1).max(10_000),
        penalty_percent: z.number().int().min(0).max(100).optional(),
      })).max(20),
    }), req.body);
    return ok(await ctx.onyxCodeLab.setHints(claims.tenant_id, idOf(req), body.hints),
      'Hints saved.');
  });

  app.post('/api/onyx/problems/:id/publish', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    return ok(await ctx.onyxCodeLab.publishProblem(claims.tenant_id, idOf(req)), 'Published.');
  });

  app.get('/api/onyx/problems/:id', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxCodeLab.problem(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role));
  });

  /** One hint at a time, in order. The response carries only the one revealed. */
  app.post('/api/onyx/problems/:id/hint', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxCodeLab.revealHint(claims.tenant_id, idOf(req), claims.user_id));
  });

  // -------------------------------------------------------------------------
  // LAB-01 / LAB-03 -- running and submitting
  // -------------------------------------------------------------------------

  /**
   * Queues a run and returns immediately.
   *
   * The response is a `queued` submission, not a result: the browser polls the
   * submission. That indirection IS the answer to a class of 200 -- the request
   * never waits on a sandbox.
   */
  app.post('/api/onyx/problems/:id/submit', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      language: LanguageSchema,
      source: z.string().min(1).max(200_000),
      mode: z.enum(['run', 'submit']).optional(),
    }), req.body);

    // Refuse up front when there is no sandbox, rather than queueing work that
    // can only fail three times and then be marked failed.
    if (!ctx.onyxExecution.supports(body.language)) {
      throw new HttpError(503, new NoSandboxError().message);
    }
    return ok(await ctx.onyxCodeLab.submit(claims.tenant_id, idOf(req), claims.user_id, body),
      'Queued.');
  });

  app.get('/api/onyx/submissions/code/:id', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxCodeLab.submissionDetail(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role));
  });

  app.get('/api/onyx/problems/:id/submissions', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxCodeLab.submissions(claims.tenant_id, idOf(req), claims.user_id));
  });

  /** Faculty view: everyone's attempts at one problem. */
  app.get('/api/onyx/problems/:id/attempts', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    return ok(await ctx.onyxCodeLab.attempts(claims.tenant_id, idOf(req)));
  });

  /**
   * Drains the queue on demand.
   *
   * The API also runs the worker on an interval; this exists so an operator can
   * push it, and so the end-to-end tests can drain deterministically instead of
   * sleeping and hoping.
   */
  app.post('/api/onyx/queue/drain', async (req) => {
    await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      concurrency: z.number().int().min(1).max(32).optional(),
    }), req.body ?? {});
    return ok(await ctx.onyxRunWorker({ concurrency: body.concurrency ?? 8 }));
  });

  /**
   * The work queue, for an operator.
   *
   * Named `/queue` rather than `/jobs`: O05 added a placement job board, and in
   * a product for institutions "jobs" means the ones people apply for.
   */
  app.get('/api/onyx/queue', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.onyxQueue.stats(claims.tenant_id));
  });

  // -------------------------------------------------------------------------
  // LAB-05 -- project workspaces
  // -------------------------------------------------------------------------

  app.get('/api/onyx/workspaces', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxWorkspaces.list(claims.tenant_id, claims.user_id));
  });

  /**
   * Monitoring, not creating -- an administrator sees every project at the
   * institution; faculty see the same thing narrowed to their own classes
   * (every workspace attached to a course they teach), not the whole
   * institution's. Neither creates a workspace here.
   */
  app.get('/api/onyx/workspaces/all', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    if (claims.tenant_role === 'admin') {
      return ok(await ctx.onyxWorkspaces.listAll(claims.tenant_id));
    }
    const teaching = await ctx.onyxAcademics.teachingFor(claims.tenant_id, claims.user_id);
    return ok(await ctx.onyxWorkspaces.listForCourses(claims.tenant_id, teaching));
  });

  app.post('/api/onyx/workspaces', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      language: z.string().max(50).optional(),
      entry_path: z.string().max(500).optional(),
      course_id: z.number().int().positive().nullish(),
      files: z.array(z.object({
        path: z.string().min(1).max(500),
        content: z.string().max(512 * 1024),
      })).max(200).optional(),
    }), req.body);
    return ok(await ctx.onyxWorkspaces.create(claims.tenant_id, claims.user_id, body),
      'Workspace created.');
  });

  app.get('/api/onyx/workspaces/:id', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxWorkspaces.open(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role));
  });

  /**
   * Runs one file in the sandbox and answers with the result directly --
   * unlike `/problems/:id/submit`, nothing here is queued. See
   * WorkspaceService.run for why: one owner, one file, one Judge0 call.
   */
  app.post('/api/onyx/workspaces/:id/run', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      path: z.string().max(500).optional(),
      stdin: z.string().max(65_536).optional(),
    }), req.body ?? {});
    return ok(await ctx.onyxWorkspaces.run(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role, body));
  });

  app.put('/api/onyx/workspaces/:id/files', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      files: z.array(z.object({
        path: z.string().min(1).max(500),
        content: z.string().max(512 * 1024),
      })).min(1).max(200),
    }), req.body);
    return ok(await ctx.onyxWorkspaces.writeFiles(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role, body.files), 'Saved.');
  });

  app.delete('/api/onyx/workspaces/:id/files', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const q = req.query as { path?: string };
    if (!q.path) throw new HttpError(422, 'Which file?');
    return ok(await ctx.onyxWorkspaces.deleteFile(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role, q.path), 'Deleted.');
  });

  app.post('/api/onyx/workspaces/:id/snapshots', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ label: z.string().max(255).optional() }), req.body ?? {});
    return ok(await ctx.onyxWorkspaces.snapshot(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role,
      body.label ?? 'Snapshot'), 'Snapshot taken.');
  });

  app.post('/api/onyx/workspaces/:id/restore/:snapshotId', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxWorkspaces.restore(
      claims.tenant_id, idOf(req), idOf(req, 'snapshotId'),
      claims.user_id, claims.tenant_role), 'Restored.');
  });

  app.post('/api/onyx/workspaces/:id/comments', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      body: z.string().min(1).max(20_000),
      file_path: z.string().max(500).nullish(),
      line: z.number().int().min(1).nullish(),
      snapshot_id: z.number().int().positive().nullish(),
    }), req.body);
    return ok(await ctx.onyxWorkspaces.comment(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role, body), 'Comment added.');
  });

  app.post('/api/onyx/workspaces/:id/comments/:commentId/resolve', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxWorkspaces.resolveComment(
      claims.tenant_id, idOf(req), idOf(req, 'commentId'),
      claims.user_id, claims.tenant_role), 'Resolved.');
  });

  /** Mentor view: every workspace attached to a course they teach. */
  app.get('/api/onyx/courses/:id/workspaces', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty');
    return ok(await ctx.onyxWorkspaces.forCourse(
      claims.tenant_id, idOf(req), claims.user_id, claims.tenant_role));
  });
}
