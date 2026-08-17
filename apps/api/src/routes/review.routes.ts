/**
 * S10 -- course and instructor reviews (R-01 / R-02).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { validate, ok, requireAuth } from '@onyx/core';
import type { AppContext } from '../context.ts';

const asReq = (req: FastifyRequest) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const ReviewBody = z.object({
  rating: z.number().min(1).max(5),
  review: z.string().max(5000).default(''),
});

export function registerReviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Public: reviews are part of the course page, which anyone can read. */
  app.get('/api/courses/:courseId/reviews', async (req) => {
    const courseId = Number((req.params as { courseId: string }).courseId);
    return ok(await ctx.reviews.forCourse(courseId));
  });

  app.get('/api/courses/:courseId/reviews/mine', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const courseId = Number((req.params as { courseId: string }).courseId);
    return ok(await ctx.reviews.mine(courseId, c.user_id));
  });

  app.post('/api/courses/:courseId/reviews', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const courseId = Number((req.params as { courseId: string }).courseId);
    const body = validate(ReviewBody, req.body);
    return ok(await ctx.reviews.submit(courseId, c.user_id, body.rating, body.review),
      'Thanks for your review.');
  });

  app.delete('/api/reviews/:id', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    await ctx.reviews.remove(Number((req.params as { id: string }).id),
      c.user_id, c.app_role === 'admin');
    return ok({}, 'Review removed.');
  });

  app.post('/api/reviews/:id/react', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ reaction: z.enum(['like', 'dislike']) }), req.body);
    return ok(await ctx.reviews.react(
      Number((req.params as { id: string }).id), c.user_id, body.reaction));
  });

  app.get('/api/instructors/:id/reviews', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return ok(await ctx.instructorReviews.forInstructor(id));
  });

  app.post('/api/instructors/:id/reviews', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const id = Number((req.params as { id: string }).id);
    const body = validate(ReviewBody, req.body);
    return ok(await ctx.instructorReviews.submit(id, c.user_id, body.rating, body.review),
      'Thanks for your review.');
  });
}
