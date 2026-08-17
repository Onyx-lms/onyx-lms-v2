/**
 * S15 -- team training packages / classrooms (TP-01 .. TP-05).
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import {
  validate, ok, requireAuth, requireRole, forbidden, parsePageQuery, type AppRole,
} from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike) => Number((req.params as { id: string }).id);
const AUTHORS: AppRole[] = ['admin', 'instructor'];

const PackageBody = z.object({
  title: z.string().min(1).max(255),
  course_id: z.number().int().positive(),
  course_privacy: z.enum(['public', 'private']),
  allocation: z.number().int().min(1).max(10000),
  pricing_type: z.union([z.literal(0), z.literal(1)]),
  price: z.number().min(0).nullish(),
  expiry_type: z.enum(['limited', 'lifetime']),
  start_date: z.union([z.string(), z.number()]).nullish(),
  expiry_date: z.union([z.string(), z.number()]).nullish(),
  features: z.array(z.string().max(255)).optional(),
  thumbnail: z.string().max(255).nullish(),
});

/** The package, if this account may edit it. */
async function assertOwner(ctx: AppContext, packageId: number,
                           userId: number, appRole: string): Promise<void> {
  if (appRole === 'admin') return;
  const pkg = await ctx.teamPackages.find(packageId) as { user_id?: number };
  if (Number(pkg.user_id) !== userId) throw forbidden();
}

export function registerTeamRoutes(app: Router, ctx: AppContext): void {
  // ---- TP-05: public ----

  app.get('/api/team-packages', async (req) => {
    const q = req.query as { course?: string; search?: string };
    return ok(await ctx.teamPackages.published(
      { courseId: q.course ? Number(q.course) : undefined, search: q.search },
      parsePageQuery(req.query as Record<string, string>), '/api/team-packages'));
  });

  app.get('/api/team-packages/:slug', async (req) => {
    const slug = (req.params as { slug: string }).slug;
    const pkg = await ctx.teamPackages.bySlug(slug) as Record<string, unknown>;
    const claims = optionalClaims(req, ctx);
    const purchased = claims
      ? await ctx.teamMembers.hasPurchased(Number(pkg['id']), claims.user_id)
      : false;
    return ok({ package: pkg, purchased });
  });

  // ---- TP-01: authoring ----

  app.get('/api/manage/team-packages', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const q = req.query as { search?: string };
    return ok(await ctx.teamPackages.listFor({
      userId: c.app_role === 'admin' ? undefined : c.user_id, search: q.search,
    }, parsePageQuery(req.query as Record<string, string>), '/api/manage/team-packages'));
  });

  app.post('/api/manage/team-packages', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    const body = validate(PackageBody, req.body);
    return ok(await ctx.teamPackages.create(c.user_id, body), 'Package has been created.');
  });

  app.patch('/api/manage/team-packages/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await assertOwner(ctx, idOf(req), c.user_id, c.app_role);
    const body = validate(PackageBody, req.body);
    return ok(await ctx.teamPackages.update(idOf(req), body), 'Package has been updated.');
  });

  app.post('/api/manage/team-packages/:id/status', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await assertOwner(ctx, idOf(req), c.user_id, c.app_role);
    return ok(await ctx.teamPackages.toggleStatus(idOf(req)), 'Status updated.');
  });

  app.post('/api/manage/team-packages/:id/duplicate', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await assertOwner(ctx, idOf(req), c.user_id, c.app_role);
    return ok(await ctx.teamPackages.duplicate(idOf(req), c.user_id, c.app_role === 'admin'),
      'Package has been duplicated.');
  });

  app.delete('/api/manage/team-packages/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, ...AUTHORS);
    await assertOwner(ctx, idOf(req), c.user_id, c.app_role);
    await ctx.teamPackages.remove(idOf(req));
    return ok({}, 'Package deleted.');
  });

  // ---- TP-03: purchase ----

  app.post('/api/team-packages/:id/claim-free', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const invoice = '#' + ctx.bootcampPurchases.newInvoice();
    return ok(await ctx.teamMembers.claimFree(idOf(req), c.user_id, invoice),
      'Package added to your classrooms.');
  });

  app.post('/api/team-packages/:id/purchase', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      phone_on: z.string().max(255).nullish(),
      bank_no: z.string().max(255).nullish(),
      doc: z.string().max(255).nullish(),
    }).default({}), req.body ?? {});
    return ok(await ctx.offline.submitTeamPackage(c.user_id, idOf(req), body),
      'Your request is in process.');
  });

  app.get('/api/my-team-packages', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.teamMembers.purchasesFor(c.user_id));
  });

  app.get('/api/team-package-invoices/:invoice', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const invoice = (req.params as { invoice: string }).invoice;
    return ok(await ctx.teamMembers.byInvoice(invoice, c.user_id, c.app_role === 'admin'));
  });

  // ---- TP-04: the classroom ----

  app.get('/api/my-team-packages/:id/members', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const packageId = idOf(req);
    if (!(await ctx.teamMembers.hasPurchased(packageId, c.user_id))) throw forbidden();
    const pkg = await ctx.teamPackages.find(packageId) as Record<string, unknown>;
    return ok({
      package: pkg,
      members: await ctx.teamMembers.members(packageId, c.user_id),
      // Seats are per leader; the original shared one pool across all buyers.
      seats_used: await ctx.teamMembers.reservedSeats(packageId, c.user_id),
      seats_total: Number(pkg['allocation'] ?? 0),
    });
  });

  app.get('/api/my-team-packages/:id/search', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const packageId = idOf(req);
    if (!(await ctx.teamMembers.hasPurchased(packageId, c.user_id))) throw forbidden();
    const term = (req.query as { search?: string }).search ?? '';
    return ok(await ctx.teamMembers.searchCandidates(packageId, c.user_id, term));
  });

  app.post('/api/my-team-packages/:id/members', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ member_id: z.number().int().positive() }), req.body);
    await ctx.teamMembers.addMember(idOf(req), c.user_id, body.member_id);
    return ok({}, 'Member has been added to classroom.');
  });

  app.delete('/api/my-team-packages/:id/members/:memberId', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const memberId = Number((req.params as { memberId: string }).memberId);
    await ctx.teamMembers.removeMember(idOf(req), c.user_id, memberId);
    return ok({}, 'Member has been removed from classroom.');
  });
}

function optionalClaims(req: ReqLike, ctx: AppContext) {
  try {
    return requireAuth(asReq(req), ctx.jwtSecret);
  } catch {
    return undefined;
  }
}
