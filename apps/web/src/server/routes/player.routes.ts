/**
 * S09 -- the course player.
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import { validate, ok, requireAuth } from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

export function registerPlayerRoutes(app: Router, ctx: AppContext): void {
  app.get('/api/player/:slug', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const { slug } = req.params as { slug: string };
    const q = req.query as Record<string, string>;
    const lessonId = q.lesson ? Number(q.lesson) : undefined;

    const payload = await ctx.player.load(slug, c.user_id, c.app_role, lessonId);
    if (payload.current) {
      await ctx.watch.setWatching(payload.course.id, c.user_id, payload.current.id);
    }
    return ok(payload);
  });

  app.get('/api/player/lesson/:id', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const id = Number((req.params as { id: string }).id);
    return ok(await ctx.player.lessonSource(id, c.user_id, c.app_role));
  });

  /**
   * PL-04 -- the 5-second progress ping.
   *
   * Deliberately cheap and idempotent: the player fires this constantly, and a
   * dropped or duplicated tick must not change the outcome.
   */
  app.post('/api/player/ping', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      course_id: z.number().int().positive(),
      lesson_id: z.number().int().positive(),
      current_duration: z.union([z.number(), z.string()]),
    }), req.body);

    const result = await ctx.watch.ping(
      body.course_id, body.lesson_id, c.user_id, body.current_duration);

    // Reaching 100% is what mints the certificate, exactly as Laravel did.
    const certificate = result.is_completed
      ? await ctx.watch.issueCertificateIfComplete(body.course_id, c.user_id)
      : null;
    return ok({ ...result, certificate });
  });

  /** PL-09 -- the manual "mark complete" toggle. */
  app.post('/api/player/complete', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      course_id: z.number().int().positive(),
      lesson_id: z.number().int().positive(),
    }), req.body);

    const progress = await ctx.watch.markComplete(body.course_id, c.user_id, body.lesson_id);
    const certificate = await ctx.watch.issueCertificateIfComplete(body.course_id, c.user_id);
    return ok({ progress, certificate });
  });
}
