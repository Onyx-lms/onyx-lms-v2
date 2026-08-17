/**
 * S17 -- revenue, payouts and dashboards (REV-01 .. REV-08).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { validate, ok, requireAuth, requireRole, forbidden, type AppRole } from '@onyx/core';
import type { AppContext } from '../context.ts';

const asReq = (req: FastifyRequest) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);
const AUTHORS: AppRole[] = ['admin', 'instructor'];

const period = (req: FastifyRequest) => {
  const q = req.query as { from?: string; to?: string };
  return { from: q.from, to: q.to };
};

export function registerReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** REV-01 -- the platform revenue report. */
  app.get('/api/admin/revenue', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.revenue.totals(period(req)));
  });

  app.delete('/api/admin/revenue/course/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.revenue.removeCourseEntry(idOf(req));
    return ok({}, 'Entry removed.');
  });

  /** REV-06 -- KPI tiles and the 12-month chart. */
  app.get('/api/admin/dashboard', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const [totals, months, users, courses, enrolments] = await Promise.all([
      ctx.revenue.totals(),
      ctx.revenue.monthly(12),
      ctx.db.from('users').select('id', { count: 'exact', head: true }),
      ctx.db.from('courses').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      ctx.db.from('enrollments').select('id', { count: 'exact', head: true }),
    ]);
    return ok({
      totals, months,
      counts: {
        users: users.count ?? 0,
        courses: courses.count ?? 0,
        enrolments: enrolments.count ?? 0,
      },
    });
  });

  /**
   * REV-02 / REV-07 -- an instructor's own numbers. An admin may ask for
   * somebody else's; an instructor only ever sees their own.
   */
  app.get('/api/instructor/revenue', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const asked = Number((req.query as { instructor?: string }).instructor ?? c.user_id);
    if (c.app_role !== 'admin' && asked !== c.user_id) throw forbidden();
    return ok({
      totals: await ctx.revenue.totals(period(req), asked),
      months: await ctx.revenue.monthly(12, asked),
      balance: await ctx.payouts.balance(asked),
    });
  });

  /** REV-03 -- one buyer's purchases, across all four product types. */
  app.get('/api/me/purchases', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.revenue.purchasesFor(c.user_id));
  });

  app.get('/api/admin/purchases/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.revenue.purchasesFor(idOf(req)));
  });

  // ---- REV-04 / REV-05: payouts ----

  app.get('/api/instructor/payouts', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    return ok({
      balance: await ctx.payouts.balance(c.user_id),
      requests: await ctx.payouts.listFor(c.user_id),
    });
  });

  app.post('/api/instructor/payouts', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const body = validate(z.object({
      amount: z.number().min(1),
      payment_method: z.string().min(1).max(255),
      payment_details: z.record(z.string(), z.unknown()).optional(),
    }), req.body);
    return ok(await ctx.payouts.request(c.user_id, body.amount, body),
      'Your request has been submitted.');
  });

  app.delete('/api/instructor/payouts/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await ctx.payouts.withdraw(idOf(req), c.user_id);
    return ok({}, 'Your request has been deleted.');
  });

  app.get('/api/admin/payouts', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const q = req.query as { status?: string };
    return ok(await ctx.payouts.list(q.status === undefined ? undefined : Number(q.status)));
  });

  app.post('/api/admin/payouts/:id/paid', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      payment_method: z.string().max(255).optional(),
    }).default({}), req.body ?? {});
    return ok(await ctx.payouts.markPaid(idOf(req), body), 'Payout recorded.');
  });

  /** REV-08 -- the student dashboard summary. */
  app.get('/api/me/dashboard', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const [enrolments, certificates, purchases] = await Promise.all([
      ctx.db.from('enrollments')
        .select('id', { count: 'exact', head: true }).eq('user_id', c.user_id),
      ctx.db.from('certificates')
        .select('id', { count: 'exact', head: true }).eq('user_id', c.user_id),
      ctx.revenue.purchasesFor(c.user_id),
    ]);
    return ok({
      counts: {
        courses: enrolments.count ?? 0,
        certificates: certificates.count ?? 0,
        purchases: purchases.length,
      },
      spent: Math.round(purchases.reduce((t, p) => t + p.amount, 0) * 100) / 100,
      recent_purchases: purchases.slice(0, 5),
    });
  });
}
