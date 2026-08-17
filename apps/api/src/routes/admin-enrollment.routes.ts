/**
 * S06 -- coupon administration and manual enrolment (E-03 / E-06).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { validate, ok, requireRole, parsePageQuery } from '@onyx/core';
import type { AppContext } from '../context.ts';

const asReq = (req: FastifyRequest) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

export function registerAdminEnrollmentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/admin/coupons', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.coupons.list());
  });

  app.post('/api/admin/coupons', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      code: z.string().min(2).max(255),
      discount: z.number().min(0).max(100),
      expiry: z.string().min(1),
    }), req.body);
    return ok(await ctx.coupons.create(body), 'Coupon created.');
  });

  app.post('/api/admin/coupons/:id/status', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.coupons.toggleStatus(Number((req.params as { id: string }).id)),
      'Coupon updated.');
  });

  app.delete('/api/admin/coupons/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.coupons.remove(Number((req.params as { id: string }).id));
    return ok({}, 'Coupon deleted.');
  });

  app.get('/api/admin/enrollments', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const q = req.query as Record<string, string>;
    const page = parsePageQuery(q);
    let query = ctx.db.from('enrollments')
      .select('id, user_id, course_id, enrollment_type, expiry_date, entry_date, created_at',
        { count: 'exact' });
    if (q.course_id) query = query.eq('course_id', Number(q.course_id));
    const { data, count } = await query.order('id', { ascending: false }).range(page.from, page.to);

    // Names resolved in two reads; enrollments has no FK to embed through.
    const rows = data ?? [];
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as number[];
    const courseIds = [...new Set(rows.map((r) => r.course_id).filter(Boolean))] as number[];
    const [users, courses] = await Promise.all([
      userIds.length ? ctx.db.from('users').select('id, name, email').in('id', userIds)
                     : Promise.resolve({ data: [] }),
      courseIds.length ? ctx.db.from('courses').select('id, title').in('id', courseIds)
                       : Promise.resolve({ data: [] }),
    ]);
    const userById = new Map((users.data ?? []).map((u) => [u.id, u]));
    const courseById = new Map((courses.data ?? []).map((c) => [c.id, c]));

    return ok({
      total: count ?? 0,
      data: rows.map((r) => ({
        ...r,
        user: userById.get(r.user_id as number) ?? null,
        course: courseById.get(r.course_id as number) ?? null,
      })),
    });
  });

  app.post('/api/admin/enrollments', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      course_id: z.number().int().positive(),
      user_id: z.number().int().positive(),
    }), req.body);
    await ctx.enrollment.enrollManually(body.course_id, body.user_id);
    return ok({}, 'Student enrolled.');
  });

  app.delete('/api/admin/enrollments/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.enrollment.remove(Number((req.params as { id: string }).id));
    return ok({}, 'Enrolment removed.');
  });
}
