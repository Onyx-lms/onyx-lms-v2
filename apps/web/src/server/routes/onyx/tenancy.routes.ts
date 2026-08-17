/**
 * Onyx O01 -- authentication, tenants, members and the audit log.
 *
 * Every route here is mounted under /api/onyx so the Laravel port's routes and
 * Onyx's can never shadow each other (ADR-006).
 *
 * The tenant is ALWAYS taken from the caller's token, never from the path or
 * body. That is the whole isolation guarantee: there is no parameter to tamper
 * with, and the same id reaches the RLS policies through the JWT claim.
 */
import type { Router, ReqLike } from '../../router.ts';
import { z } from 'zod';
import {
  validate, ok, HttpError,
  requireOnyx, requireOnyxRole, requirePlatformAdmin, ROLES,
} from '@onyx/core';
import type { Role } from '@onyx/types';
import type { AppContext } from '../../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike) => Number((req.params as { id: string }).id);
const ipOf = (req: ReqLike) => (req as unknown as { ip?: string }).ip ?? null;

const RoleSchema = z.enum(ROLES as [Role, ...Role[]]);

export function registerOnyxTenancyRoutes(app: Router, ctx: AppContext): void {
  // ---- F-03: sign in, and choose which institution to sign in to ----

  app.post('/api/onyx/auth/login', async (req) => {
    const body = validate(z.object({
      email: z.string().email(),
      password: z.string().min(1),
      tenant_id: z.number().int().positive().optional(),
    }), req.body);

    // Supabase Auth mints the session now -- see tenancy.service.ts's
    // signIn() for why this is a sign-in/point-at-a-tenant/refresh sequence
    // rather than one call (docs/ADR-011-supabase-auth-migration.md).
    const result = await ctx.onyxTenancy.signIn(body.email, body.password, body.tenant_id);
    return ok({
      token: result.session.access_token,
      refresh_token: result.session.refresh_token,
      expires_at: result.session.expires_at,
      user: result.user,
      tenant: result.membership.tenant,
      role: result.membership.role,
      // The switcher needs to know where else they belong.
      memberships: result.memberships.map((m) => ({
        tenant: m.tenant, role: m.role,
      })),
    });
  });

  /**
   * F-06 -- move to another institution this person already belongs to.
   *
   * Needs the caller's refresh token now, not just their access token --
   * nothing on the API can mint a token unilaterally the way
   * issueOnyxToken() used to; only GoTrue can, in exchange for a refresh
   * token. See tenancy.service.ts's switchTenant().
   */
  app.post('/api/onyx/auth/switch', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      tenant_id: z.number().int().positive(),
      refresh_token: z.string().min(1),
    }), req.body);

    const memberships = await ctx.onyxTenancy.membershipsFor(claims.user_id);
    const target = memberships.find((m) => Number(m.tenant_id) === body.tenant_id);
    // Switching is only ever between institutions they already belong to.
    if (!target) throw new HttpError(403, 'You do not belong to that institution.');

    const session = await ctx.onyxTenancy.switchTenant(claims.user_id, body.tenant_id, body.refresh_token);
    return ok({
      token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      tenant: target.tenant,
      role: target.role,
    });
  });

  app.get('/api/onyx/me', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const [memberships, name, tenant] = await Promise.all([
      ctx.onyxTenancy.membershipsFor(claims.user_id),
      ctx.onyxTenancy.userName(claims.user_id),
      ctx.onyxTenancy.tenant(claims.tenant_id),
    ]);
    return ok({
      user_id: claims.user_id,
      name,
      email: claims.email,
      role: claims.tenant_role,
      tenant,
      memberships: memberships.map((m) => ({ tenant: m.tenant, role: m.role })),
    });
  });

  /**
   * The institution's own settings -- one flag today (can faculty schedule an
   * exam themselves, or does every one have to come from admin or the exams
   * office), on the tenant row itself. Admin only: this changes what an
   * entire staff role can do, the same reach as a role change on a single
   * membership, just aimed at everyone holding that role at once.
   */
  app.patch('/api/onyx/tenant/settings', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      faculty_can_schedule_exams: z.boolean(),
    }), req.body);
    const before = await ctx.onyxTenancy.tenant(claims.tenant_id);
    const tenant = await ctx.onyxTenancy.setFacultyCanScheduleExams(
      claims.tenant_id, body.faculty_can_schedule_exams);
    await ctx.onyxAudit.record(claims, {
      action: 'tenant.updated', entityType: 'tenant', entityId: claims.tenant_id,
      before: { faculty_can_schedule_exams: before.faculty_can_schedule_exams },
      after: { faculty_can_schedule_exams: tenant.faculty_can_schedule_exams },
      ip: ipOf(req),
    });
    return ok(tenant, 'Updated.');
  });

  // ---- F-06: onboarding a new institution ----

  /**
   * Creating an institution is a platform-admin act, and only that.
   *
   * This used to be deliberately unauthenticated, with a comment saying that
   * "in production this sits behind a signup gate or an operator console".
   * It did not: /onyx/signup posted here through an open allow-list entry, so
   * anyone who could reach the API could bring an institution into existence
   * and make themselves its administrator. The operator console the comment
   * imagined already exists -- POST /api/onyx/platform/tenants -- so this
   * route now demands the same platform token rather than being a second,
   * softer way in.
   *
   * (Naming the guard function in this comment is deliberately avoided:
   * tools/onyx/gen-api-docs.mjs infers "who may call it" by grepping the
   * handler window for the guard's name, and prose mentioning it upstream
   * made the generator report neighbouring routes as platform-gated when
   * they are not. A security document that mislabels a route is worse than
   * one that is terse.)
   *
   * The bootstrap objection ("who creates the first one, before any token
   * exists?") is already answered elsewhere: the first platform admin is
   * granted from the machine by tools/onyx/grant-platform-admin.mjs, against
   * the service-role connection. Nothing needs an open HTTP route.
   */
  app.post('/api/onyx/tenants', async (req) => {
    await requirePlatformAdmin(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      slug: z.string().max(255).optional(),
      plan: z.string().max(50).nullish(),
      admin: z.object({
        name: z.string().min(1).max(255),
        email: z.string().email(),
        password: z.string().min(8).max(255),
      }),
    }), req.body);

    const { tenant, admin } = await ctx.onyxTenancy.createTenant(body);
    await ctx.onyxAudit.recordSystem(tenant!.id, {
      action: 'tenant.created', entityType: 'tenant', entityId: tenant!.id,
      after: { name: tenant!.name, slug: tenant!.slug }, ip: ipOf(req),
    });
    return ok({ tenant, admin: { id: admin.id, email: admin.email } },
      'Institution created.');
  });

  // ---- F-04: members ----

  app.get('/api/onyx/members', async (req) => {
    // 'exams' added alongside admin/faculty: the examinations office runs
    // invigilation and marking institution-wide and needs the same "who is
    // this" name lookup admin/faculty already had -- without it, Invigilate
    // could only ever show a candidate's raw id to that role.
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty', 'exams');
    const q = req.query as { role?: Role; search?: string };
    return ok(await ctx.onyxTenancy.members(claims.tenant_id, {
      role: q.role, search: q.search,
    }));
  });

  app.post('/api/onyx/members', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      email: z.string().email(),
      role: RoleSchema,
      password: z.string().min(8).max(255).optional(),
    }), req.body);

    const result = await ctx.onyxTenancy.invite(claims.tenant_id, body);
    await ctx.onyxAudit.record(claims, {
      action: 'membership.created', entityType: 'membership',
      entityId: result.membership.id,
      after: { user_id: result.user.id, role: body.role }, ip: ipOf(req),
    });

    // F-06 calls this an invitation. Until now it was an account appearing,
    // and somebody having to tell the person out of band that it had.
    const tenant = await ctx.onyxTenancy.tenant(claims.tenant_id);
    await ctx.onyxNotify.notify(claims.tenant_id, {
      userId: result.user.id,
      kind: 'membership.invited',
      title: 'You have been added to ' + (tenant?.name ?? 'an institution'),
      body: 'You joined as ' + body.role + '. Sign in to see what is waiting for you.',
      link: '/onyx/dashboard',
      email: { to: body.email, subject: 'You have been added to ' + (tenant?.name ?? 'Onyx') },
    });
    return ok(result, 'Member added.');
  });

  /**
   * A member's identity and their standing at this institution, edited
   * together -- the tenant-side version of the same panel the platform
   * console's own operators use. `role` alone still works exactly as before
   * for any existing caller; everything else is additive.
   */
  app.patch('/api/onyx/members/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({
      name: z.string().min(1).max(255).optional(),
      email: z.string().email().optional(),
      phone: z.string().max(50).nullish(),
      account_status: z.number().int().min(0).max(1).optional(),
      role: RoleSchema.optional(),
      membership_status: z.number().int().min(0).max(1).optional(),
    }), req.body);

    const result = await ctx.onyxTenancy.updateMember(claims.tenant_id, idOf(req), body);
    if (result.userChange) {
      await ctx.onyxAudit.record(claims, {
        action: 'user.updated', entityType: 'user', entityId: idOf(req),
        before: result.userChange.before, after: result.userChange.after, ip: ipOf(req),
      });
    }
    if (result.membershipChange) {
      // A role change is the security-sensitive half of "membership updated" --
      // 'membership.role_changed' has existed in the AuditAction union since
      // it was first written, but nothing ever actually emitted it, so every
      // promotion and demotion was indistinguishable in the log from a status
      // toggle. Status-only changes still record as the generic action.
      const roleChanged = 'role' in result.membershipChange.before;
      await ctx.onyxAudit.record(claims, {
        action: roleChanged ? 'membership.role_changed' : 'membership.updated',
        entityType: 'membership', entityId: idOf(req),
        before: result.membershipChange.before, after: result.membershipChange.after,
        ip: ipOf(req),
      });
    }
    return ok(result, 'Updated.');
  });

  app.delete('/api/onyx/members/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const removed = await ctx.onyxTenancy.removeMember(claims.tenant_id, idOf(req));
    await ctx.onyxAudit.record(claims, {
      action: 'membership.removed', entityType: 'membership', entityId: idOf(req),
      before: removed, ip: ipOf(req),
    });
    return ok({}, 'Member removed.');
  });

  // ---- F-05: the audit log ----

  app.get('/api/onyx/audit', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    const q = req.query as { action?: string; entity_type?: string; limit?: string };
    // Always this tenant's log. audit_logs has RLS with no select policy, so
    // this service-role path is the only way to read it at all.
    return ok(await ctx.onyxAudit.list(claims.tenant_id, {
      action: q.action,
      entityType: q.entity_type,
      limit: q.limit ? Number(q.limit) : undefined,
    }));
  });
}
