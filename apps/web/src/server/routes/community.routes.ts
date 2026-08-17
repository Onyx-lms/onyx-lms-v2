/**
 * S10 -- certificates, forum and reviews.
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import {
  validate, ok, requireAuth, requireRole, parsePageQuery, verificationUrl,
} from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

export function registerCommunityRoutes(app: Router, ctx: AppContext): void {
  // ---- CERT-03: public verification, deliberately unauthenticated ----
  app.get('/api/verify/certificate/:identifier', async (req) => {
    const { identifier } = req.params as { identifier: string };
    return ok(await ctx.certificates.verify(identifier));
  });

  app.get('/api/certificates/:identifier/render', async (req) => {
    const { identifier } = req.params as { identifier: string };
    const result = await ctx.certificates.verify(identifier);
    if (!result.verified) return ok({ verified: false, certificate: null });
    const { verificationQrDataUri } = await import('@onyx/core');
    return ok({
      ...result,
      template: await ctx.certificates.template(),
      qr: await verificationQrDataUri(verificationUrl(ctx.webOrigin, identifier)),
      verify_url: verificationUrl(ctx.webOrigin, identifier),
    });
  });

  app.get('/api/me/certificates', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.certificates.myCertificates(c.user_id));
  });

  // ---- CERT-02 / CERT-05: administration ----
  app.get('/api/admin/certificates', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const q = req.query as Record<string, string>;
    const filters: { search?: string; courseId?: number } = {};
    if (q.search) filters.search = q.search;
    if (q.course_id) filters.courseId = Number(q.course_id);
    return ok(await ctx.certificates.list(filters, parsePageQuery(q), '/api/admin/certificates'));
  });

  app.get('/api/admin/certificates/eligible/:courseId', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const courseId = Number((req.params as { courseId: string }).courseId);
    return ok(await ctx.certificates.eligibleStudents(courseId));
  });

  app.post('/api/admin/certificates', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      course_id: z.number().int().positive(),
      user_id: z.number().int().positive(),
    }), req.body);
    const created = await ctx.certificates.issue(body.course_id, body.user_id);
    return ok(created, 'Certificate issued successfully. ID: ' + created?.identifier);
  });

  app.delete('/api/admin/certificates/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.certificates.remove(Number((req.params as { id: string }).id));
    return ok({}, 'Certificate deleted successfully');
  });

  app.get('/api/admin/certificate-template', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.certificates.template());
  });

  app.post('/api/admin/certificate-template', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      background: z.string().nullish(),
      signature: z.string().nullish(),
      name_top: z.number().optional(), name_left: z.number().optional(),
      course_top: z.number().optional(), course_left: z.number().optional(),
      date_top: z.number().optional(), date_left: z.number().optional(),
      qr_top: z.number().optional(), qr_left: z.number().optional(),
      qr_size: z.number().optional(),
    }), req.body);
    return ok(await ctx.certificates.saveTemplate(body), 'Template saved.');
  });

  // ---- FOR-01..03: the course forum ----
  app.get('/api/courses/:courseId/forum', async (req) => {
    requireAuth(asReq(req), ctx.jwtSecret);
    const courseId = Number((req.params as { courseId: string }).courseId);
    const q = req.query as Record<string, string>;
    return ok(await ctx.forum.questions(courseId, q.search, parsePageQuery(q),
      '/api/courses/' + courseId + '/forum'));
  });

  app.get('/api/forum/:id', async (req) => {
    requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.forum.thread(Number((req.params as { id: string }).id)));
  });

  app.post('/api/courses/:courseId/forum', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const courseId = Number((req.params as { courseId: string }).courseId);
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      description: z.string().min(1),
    }), req.body);
    return ok(await ctx.forum.ask(courseId, c.user_id, body.title, body.description),
      'Your question has been posted.');
  });

  app.post('/api/forum/:id/reply', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ description: z.string().min(1) }), req.body);
    return ok(await ctx.forum.reply(
      Number((req.params as { id: string }).id), c.user_id, body.description), 'Reply posted.');
  });

  app.patch('/api/forum/:id', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().optional(), description: z.string().optional(),
    }), req.body);
    await ctx.forum.update(Number((req.params as { id: string }).id), c.user_id, body);
    return ok({}, 'Updated.');
  });

  app.delete('/api/forum/:id', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    await ctx.forum.remove(Number((req.params as { id: string }).id),
      c.user_id, c.app_role === 'admin');
    return ok({}, 'Deleted.');
  });

  app.post('/api/forum/:id/react', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ reaction: z.enum(['like', 'dislike']) }), req.body);
    return ok(await ctx.forum.react(
      Number((req.params as { id: string }).id), c.user_id, body.reaction));
  });
}
