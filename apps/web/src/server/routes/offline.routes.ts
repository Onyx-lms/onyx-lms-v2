/**
 * PAY-15 -- offline / bank-transfer payments.
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import { validate, ok, requireAuth, requireRole } from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

export function registerOfflineRoutes(app: Router, ctx: AppContext): void {
  app.post('/api/payment/offline', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      phone_on: z.string().max(255).optional(),
      bank_no: z.string().max(255).optional(),
      doc: z.string().max(255).optional(),
      coupon: z.string().optional(),
    }), req.body);
    return ok(await ctx.offline.submit(c.user_id, body),
      'Your payment has been submitted. It will take some time to enrol.');
  });

  app.get('/api/payment/offline/mine', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.offline.mine(c.user_id));
  });

  app.get('/api/admin/offline-payments', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const q = req.query as Record<string, string>;
    const status = q.status !== undefined && q.status !== '' ? Number(q.status) : undefined;
    return ok(await ctx.offline.list(status));
  });

  app.post('/api/admin/offline-payments/:id/accept', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const result = await ctx.offline.accept(Number((req.params as { id: string }).id));
    return ok(result, 'Payment accepted and the student is enrolled.');
  });

  app.post('/api/admin/offline-payments/:id/decline', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.offline.decline(Number((req.params as { id: string }).id));
    return ok({}, 'Payment declined.');
  });

  app.delete('/api/admin/offline-payments/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.offline.remove(Number((req.params as { id: string }).id));
    return ok({}, 'Request removed.');
  });
}
