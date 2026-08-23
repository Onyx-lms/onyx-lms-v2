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
  CAPABILITIES, CAPABILITY_AREAS, holdersOf, can, normaliseOverrides,
  type PermissionOverrides,
} from '@onyx/core';
import type { Role } from '@onyx/types';
import type { AppContext } from '../../app-context.ts';
import { assertCan } from '../../capability.ts';

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
    const [memberships, name, tenant, profile] = await Promise.all([
      ctx.onyxTenancy.membershipsFor(claims.user_id),
      ctx.onyxTenancy.userName(claims.user_id),
      ctx.onyxTenancy.tenant(claims.tenant_id),
      // For the avatar in the header. Every screen in the product already
      // fetches /me, so carrying the picture here means no page has to ask a
      // second question to draw one.
      ctx.onyxTenancy.profileFor(claims.user_id),
    ]);
    return ok({
      user_id: claims.user_id,
      name,
      photo_url: ctx.onyxTenancy.photoUrl(profile?.photo as string | null | undefined),
      email: claims.email,
      role: claims.tenant_role,
      // This institution's own number for them, so a learner can read their
      // roll number off their own profile rather than off a printed list --
      // and so staff writing it on a script have it to hand. Per membership,
      // so switching institutions switches the number with it.
      roll_number: memberships.find((m) => Number(m.tenant?.id) === claims.tenant_id)
        ?.roll_number ?? null,
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
      faculty_can_schedule_exams: z.boolean().optional(),
      student_signup: z.boolean().optional(),
      signup_domains: z.string().max(500).optional(),
      // How, not whether. 'domain' is the address deciding; 'open' is anyone
      // being able to pick this institution and join it at once.
      signup_mode: z.enum(['domain', 'open']).optional(),
    }), req.body);
    const before = await ctx.onyxTenancy.tenant(claims.tenant_id);
    let tenant = before;
    if (body.faculty_can_schedule_exams !== undefined) {
      tenant = await ctx.onyxTenancy.setFacultyCanScheduleExams(
        claims.tenant_id, body.faculty_can_schedule_exams);
    }
    if (body.student_signup !== undefined || body.signup_domains !== undefined
      || body.signup_mode !== undefined) {
      tenant = await ctx.onyxTenancy.setSignupPolicy(
        claims.tenant_id,
        body.student_signup ?? Boolean(before.student_signup),
        body.signup_domains ?? String(before.signup_domains ?? ''),
        body.signup_mode);
    }
    await ctx.onyxAudit.record(claims, {
      action: 'tenant.updated', entityType: 'tenant', entityId: claims.tenant_id,
      before: { faculty_can_schedule_exams: before.faculty_can_schedule_exams },
      after: { faculty_can_schedule_exams: tenant.faculty_can_schedule_exams },
      ip: ipOf(req),
    });
    return ok(tenant, 'Updated.');
  });

  /**
   * The permission matrix: what this institution delegates, and to whom.
   *
   * GET is open to any member, not just an administrator, and deliberately so.
   * Every screen that hides a control needs to know whether the person holding
   * it may act -- a lecturer's course page has to decide whether to offer
   * "Publish", and the honest way to decide is to ask, rather than to keep a
   * second copy of the rules in the browser and let the two drift.
   *
   * It returns the catalogue as well as the answers, because a matrix without
   * its labels is a list of keys nobody can render, and the catalogue is the
   * one place those labels live.
   */
  app.get('/api/onyx/permissions', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const tenant = await ctx.onyxTenancy.tenant(claims.tenant_id);
    const overrides = (tenant?.permissions ?? {}) as PermissionOverrides;
    return ok({
      capabilities: CAPABILITIES.map((cap) => ({
        ...cap,
        holders_now: holdersOf(cap.key, overrides),
        changed: Object.prototype.hasOwnProperty.call(overrides, cap.key),
      })),
      areas: CAPABILITY_AREAS,
      /** What THIS caller may do, so a screen can hide what it must. */
      mine: CAPABILITIES.filter((cap) => can(claims.tenant_role, cap.key, overrides))
        .map((cap) => cap.key),
    });
  });

  /**
   * Saving the matrix is itself a capability (`settings.manage`), which is why
   * this is not simply an admin-only route: an institution that has delegated
   * settings to somebody has said who may change them, and the check should
   * read that answer like every other one.
   *
   * The whole matrix is sent, not a delta -- a screen that saves one row at a
   * time turns "revoke marking from faculty" into a state where the save
   * half-applied. `normaliseOverrides` drops anything a capability may not be
   * given to, so a hand-written request cannot grant a student the fee ledger.
   */
  app.put('/api/onyx/permissions', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'settings.manage');
    const body = validate(z.object({
      permissions: z.record(z.string(), z.array(z.string())),
    }), req.body);

    const before = await ctx.onyxTenancy.tenant(claims.tenant_id);
    const overrides = normaliseOverrides(body.permissions);
    const tenant = await ctx.onyxTenancy.setPermissions(claims.tenant_id, overrides);
    await ctx.onyxAudit.record(claims, {
      action: 'tenant.updated', entityType: 'tenant', entityId: claims.tenant_id,
      before: { permissions: before?.permissions ?? {} },
      after: { permissions: overrides },
      ip: ipOf(req),
    });
    return ok(tenant, 'Permissions saved.');
  });

  /**
   * Self-registration, for a learner at an institution that has opened it.
   *
   * Unauthenticated by necessity -- the whole point is that the person has no
   * account yet -- and narrow because of it: it only ever creates a `student`,
   * the institution comes from the email domain rather than from the request,
   * and an institution that has not switched signup on cannot be found at all.
   *
   * The four fields are the ones an institution actually needs to recognise a
   * learner: their name, the address it gave them, a number to reach them on,
   * and the roll number everything else in this product is keyed to.
   */
  /**
   * Ask for the verification code.
   *
   * The address is checked against the institution's domain rules here, so a
   * personal mailbox is refused while the applicant is still on the form and
   * no mail is sent on behalf of a registration that could never be accepted.
   *
   * No password is taken at this step, on purpose: nothing is stored between
   * the two calls, so there is no window in which this product holds a
   * password for an address nobody has proved they own.
   */
  app.post('/api/onyx/auth/signup/start', async (req) => {
    const body = validate(z.object({
      email: z.string().email(),
      tenant_id: z.number().int().positive().nullish(),
    }), req.body);
    return ok(await ctx.onyxTenancy.startSignUp(body),
      'We have sent a code to ' + body.email + '.');
  });

  /**
   * Redeem the code and become a student.
   *
   * Every rule from the first step runs again -- an institution can close its
   * registrations in the minutes somebody spends in their inbox, and the code
   * proves control of a mailbox, not eligibility.
   */
  app.post('/api/onyx/auth/signup/verify', async (req) => {
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      email: z.string().email(),
      password: z.string().min(8).max(255),
      // Length is GoTrue configuration, not a constant -- see #verifyEmailCode.
      code: z.string().min(4).max(10),
      phone: z.string().min(6).max(30).nullish(),
      roll_number: z.string().max(40).nullish(),
      // The institution they picked, when their address names none.
      tenant_id: z.number().int().positive().nullish(),
    }), req.body);

    const result = await ctx.onyxTenancy.completeSignUp(body);

    // Signed in immediately. Asking somebody to register and then to sign in
    // with what they just typed is a form they fill in twice.
    const session = await ctx.onyxTenancy.signIn(body.email, body.password);
    return ok({
      token: session.session.access_token,
      refresh_token: session.session.refresh_token,
      expires_at: session.session.expires_at,
      user: result.user,
      tenant: result.tenant,
      role: 'student',
    }, 'Welcome to ' + result.tenant.name + '.');
  });

  /**
   * Which institution an address would join, before anybody types a password.
   *
   * The form uses this to say "this address registers with ABC Institution"
   * while the learner is still filling it in -- and to say plainly that an
   * address matches nothing, rather than accepting six fields and refusing at
   * the end. It answers only about the address it was given.
   */
  /**
   * The institutions a student may pick from.
   *
   * Unauthenticated, like the lookup beside it: somebody choosing where they
   * study does not have an account yet. It names only institutions that have
   * said anyone may join, and only their name -- and the catalogue already
   * names the institution behind every public course, so this discloses
   * nothing a visitor could not already read.
   */
  app.get('/api/onyx/auth/signup/institutions', async () => {
    return ok(await ctx.onyxTenancy.openInstitutions());
  });

  app.get('/api/onyx/auth/signup/institution', async (req) => {
    const email = String((req.query as { email?: string }).email ?? '');
    if (!email.includes('@')) return ok(null);
    return ok(await ctx.onyxTenancy.signupInstitutionFor(email));
  });

  /** The person's own profile, with the fields only they can fill in. */
  app.get('/api/onyx/my/profile-details', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxTenancy.profileFor(claims.user_id));
  });

  app.patch('/api/onyx/my/profile-details', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      // Their own name and number, which they could not change until now: an
      // administrator typed them when the account was made, and people are
      // married, transition, or simply had it spelled wrong on day one.
      name: z.string().min(1).max(120).optional(),
      phone: z.string().max(40).nullish(),
      // A storage KEY from the sign route below, never a URL -- the service
      // refuses anything with a scheme, because this ends up in an <img src>.
      photo: z.string().max(500).nullish(),
      username: z.string().max(40).nullish(),
      headline: z.string().max(160).optional(),
      bio: z.string().max(2000).optional(),
      skills_text: z.string().max(600).optional(),
      interests: z.string().max(600).optional(),
      experience: z.string().max(3000).optional(),
      website: z.string().max(200).optional(),
      profile_public: z.boolean().optional(),
    }), req.body);
    return ok(await ctx.onyxTenancy.updateProfile(claims.user_id, body), 'Profile saved.');
  });

  /**
   * A ticket to upload a profile picture.
   *
   * The browser PUTs straight to storage: Vercel rejects request bodies over
   * about 4.5 MB and a photograph off a phone is routinely larger. The key is
   * minted server-side from the caller's own tenant and user id, so a ticket
   * cannot be aimed at somebody else's picture -- see signAvatarUpload.
   */
  app.post('/api/onyx/my/avatar/sign', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      filename: z.string().min(1).max(200),
    }), req.body);
    return ok(await ctx.onyxTenancy.signAvatarUpload(
      claims.tenant_id, claims.user_id, body.filename));
  });

  /**
   * Somebody's public profile, by handle.
   *
   * Unauthenticated on purpose -- a shareable link that demands a login is not
   * shareable. It answers only for a person who has switched their profile on,
   * and with only what they wrote plus where they belong; a 404 covers "no such
   * handle" and "not public" alike, so the endpoint cannot be used to discover
   * who exists.
   */
  app.get('/api/onyx/p/:username', async (req) => {
    const handle = String((req.params as { username: string }).username ?? '');
    const profile = await ctx.onyxTenancy.publicProfile(handle);
    if (!profile) throw new HttpError(404, 'No public profile at that address.');
    return ok(profile);
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
    // A lecturer's directory is their own class lists. Admin and the
    // examinations office run the institution and keep the whole roster.
    const onlyStudentsOn = claims.tenant_role === 'faculty'
      ? await ctx.onyxAcademics.teachingFor(claims.tenant_id, claims.user_id)
      : undefined;
    return ok(await ctx.onyxTenancy.members(claims.tenant_id, {
      onlyStudentsOn,
      role: q.role, search: q.search,
    }));
  });

  app.post('/api/onyx/members', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'exams', 'placement');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'people.invite');
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      email: z.string().email(),
      role: RoleSchema,
      password: z.string().min(8).max(255).optional(),
      // The institution's own number for this person. Optional: an institution
      // that does not use roll numbers must not be blocked from adding people.
      roll_number: z.string().max(40).nullish(),
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
    // The outer bound for both capabilities this route can serve: `people.edit`
    // (exams, placement) and `people.roll_numbers` (exams, faculty).
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret,
      'admin', 'exams', 'placement', 'faculty');
    const body = validate(z.object({
      name: z.string().min(1).max(255).optional(),
      email: z.string().email().optional(),
      phone: z.string().max(50).nullish(),
      account_status: z.number().int().min(0).max(1).optional(),
      role: RoleSchema.optional(),
      membership_status: z.number().int().min(0).max(1).optional(),
      // Blank clears it -- an administrator who typed one onto the wrong
      // person needs a way back.
      roll_number: z.string().max(40).nullish(),
    }), req.body);

    // Which capability this is depends on what is being written. The roll
    // number travels on the same PATCH as the rest of a membership, and it is
    // its own capability: an institution that lets the examinations office keep
    // roll numbers has not thereby let it rename people or change their role.
    // So a body that carries only a roll number is checked against the narrow
    // one, and anything else against `people.edit`.
    const onlyRollNumber = Object.keys(body).length === 1
      && Object.prototype.hasOwnProperty.call(body, 'roll_number');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role,
      onlyRollNumber ? 'people.roll_numbers' : 'people.edit');

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
    // Not widened: `people.remove` has no holders beyond admin (permissions.ts),
    // so the outer bound and the capability agree rather than the guard being
    // looser than anything that could ever pass it.
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'people.remove');
    const removed = await ctx.onyxTenancy.removeMember(claims.tenant_id, idOf(req));
    await ctx.onyxAudit.record(claims, {
      action: 'membership.removed', entityType: 'membership', entityId: idOf(req),
      before: removed, ip: ipOf(req),
    });
    return ok({}, 'Member removed.');
  });

  // ---- F-05: the audit log ----

  app.get('/api/onyx/audit', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'exams');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'audit.read');
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
