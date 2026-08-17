/**
 * S05 -- quiz authoring and attempts.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { validate, ok, requireAuth, requireRole } from '@onyx/core';
import type { AppContext } from '../context.ts';

const asReq = (req: FastifyRequest) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const QuestionBody = z.object({
  title: z.string().min(1),
  type: z.enum(['mcq', 'fill_blanks', 'true_false']),
  answer: z.union([z.array(z.string()), z.string(), z.boolean()]),
  options: z.array(z.string()).optional(),
});

const SubmitBody = z.object({
  answers: z.record(z.union([
    z.string(), z.boolean(), z.null(), z.array(z.string()),
  ])),
});

export function registerQuizRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---- Q-02: authoring ----
  app.get('/api/authoring/quizzes/:quizId/questions', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'instructor', 'admin');
    const quizId = Number((req.params as { quizId: string }).quizId);
    return ok(await ctx.questions.listForQuiz(quizId));
  });

  app.post('/api/authoring/quizzes/:quizId/questions', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'instructor', 'admin');
    const quizId = Number((req.params as { quizId: string }).quizId);
    return ok(await ctx.questions.create(quizId, validate(QuestionBody, req.body)),
      'Question has been added.');
  });

  app.patch('/api/authoring/questions/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'instructor', 'admin');
    await ctx.questions.update(Number((req.params as { id: string }).id),
      validate(QuestionBody, req.body));
    return ok({}, 'Question updated.');
  });

  app.delete('/api/authoring/questions/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'instructor', 'admin');
    await ctx.questions.remove(Number((req.params as { id: string }).id));
    return ok({}, 'Question deleted.');
  });

  app.post('/api/authoring/questions/sort', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'instructor', 'admin');
    const body = validate(z.object({ ids: z.array(z.number().int().positive()).min(1) }), req.body);
    await ctx.questions.sort(body.ids);
    return ok({}, 'Questions sorted successfully');
  });

  // ---- Q-06: instructor results ----
  app.get('/api/authoring/quizzes/:quizId/participants', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'instructor', 'admin');
    const quizId = Number((req.params as { quizId: string }).quizId);
    return ok(await ctx.quiz.participants(quizId));
  });

  // ---- Q-03 / Q-05: student attempts ----
  app.get('/api/quizzes/:quizId/attempt', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    const quizId = Number((req.params as { quizId: string }).quizId);
    return ok(await ctx.quiz.startAttempt(quizId, claims.user_id));
  });

  app.post('/api/quizzes/:quizId/submit', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    const quizId = Number((req.params as { quizId: string }).quizId);
    const body = validate(SubmitBody, req.body);
    return ok(await ctx.quiz.submit(quizId, claims.user_id, body.answers),
      'Your answers have been submitted.');
  });

  app.get('/api/quiz-submissions/:id', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    const id = Number((req.params as { id: string }).id);
    return ok(await ctx.quiz.review(id, claims.user_id));
  });
}
