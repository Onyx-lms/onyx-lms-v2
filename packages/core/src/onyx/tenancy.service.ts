/**
 * F-04 / F-06 -- tenants, people and the membership that binds them.
 *
 * A `user` is an identity: one email, across the whole platform. A
 * `membership` is what that identity IS inside one institution. Roles live on
 * the membership, so the same person can be a student at one and faculty at
 * another without either institution seeing the other.
 *
 * Credentials moved to Supabase Auth (see docs/ADR-011-supabase-auth-migration.md):
 * onyx_users.id is a real auth.users uuid, and this service creates the
 * auth.users row (via the Admin API -- `#authAdmin`) before it ever writes
 * the profile row that references it. Signing in is a real Supabase Auth
 * session (`#authClient`), not a password comparison against a column this
 * table used to hold.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnyxDb } from './db.ts';
import { onyxAuthAdmin, onyxAuthClient } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import { slugify } from '../authoring/slug.ts';
import type { PermissionOverrides } from './permissions.ts';

const TENANT_COLUMNS = 'id, name, slug, status, plan, faculty_can_schedule_exams, permissions, created_at, updated_at';
const USER_COLUMNS = 'id, email, name, phone, photo, status, email_verified_at, created_at';
const MEMBERSHIP_COLUMNS = 'id, tenant_id, user_id, role, status, roll_number, created_at';

/**
 * Every role a membership may hold.
 *
 * Two of these are outsiders rather than staff: `employer` (O05) sees only its
 * own posts, and `guardian` (O07) sees only what a learner has consented to
 * share. Both are in this list because both need an account; neither is
 * anywhere in a staff check.
 */
export const ROLES: Role[] = [
  'student', 'faculty', 'exams', 'placement', 'employer', 'admin', 'guardian',
];

export class TenancyService {
  #db: OnyxDb;
  #authAdminOverride: SupabaseClient | undefined;
  #authClientOverride: SupabaseClient | undefined;

  /**
   * `authAdmin`/`authClient` exist as constructor parameters only so a test
   * can inject a fake -- FakeDb can simulate Postgrest, but there is no
   * in-memory GoTrue to fall back to for these. Left unset, the real
   * Supabase Auth clients are resolved lazily (module-level singletons, see
   * db.ts) the first time a method actually needs one, rather than eagerly
   * in the constructor -- eager resolution would require SUPABASE_URL/
   * SUPABASE_SERVICE_ROLE_KEY to exist even for a unit test that never
   * touches auth and constructs this with a FakeDb.
   */
  constructor(db: OnyxDb, authAdmin?: SupabaseClient, authClient?: SupabaseClient) {
    this.#db = db;
    this.#authAdminOverride = authAdmin;
    this.#authClientOverride = authClient;
  }

  get #authAdmin(): SupabaseClient { return this.#authAdminOverride ?? onyxAuthAdmin(); }
  get #authClient(): SupabaseClient { return this.#authClientOverride ?? onyxAuthClient(); }

  // ---- tenants ----

  async tenant(id: number) {
    const { data } = await this.#db.from('onyx_tenants')
      .select(TENANT_COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Institution not found.');
    return data;
  }

  async tenantBySlug(slug: string) {
    const { data } = await this.#db.from('onyx_tenants')
      .select(TENANT_COLUMNS).eq('slug', slug.trim().toLowerCase()).maybeSingle();
    return data ?? null;
  }

  /**
   * F-06 -- stand up an institution and its first administrator in one step.
   *
   * An institution with no admin is unusable and nobody can fix it from inside,
   * so the two are created together rather than left to a follow-up call.
   */
  async createTenant(input: {
    name: string; slug?: string; plan?: string | null;
    admin: { name: string; email: string; password: string };
  }) {
    const slug = slugify(input.slug ?? input.name);
    if (!slug) throw new HttpError(422, 'That name does not make a usable address.');
    if (await this.tenantBySlug(slug)) {
      throw new HttpError(422, 'An institution with that address already exists.');
    }

    const { data: tenant, error } = await this.#db.from('onyx_tenants').insert({
      name: input.name.trim(), slug, status: 1, plan: input.plan ?? null,
    }).select(TENANT_COLUMNS).maybeSingle();
    // Two simultaneous signups for the same address get past the check above
    // and collide on the unique constraint. That is the caller's answer, not a
    // server fault, so it reads the same either way.
    if (error?.code === '23505') {
      throw new HttpError(422, 'An institution with that address already exists.');
    }
    if (error) throw new HttpError(500, 'Could not create the institution: ' + error.message);

    const admin = await this.upsertUser({
      name: input.admin.name, email: input.admin.email, password: input.admin.password,
    });
    await this.addMember(tenant!.id, admin.id, 'admin');
    return { tenant, admin };
  }

  // ---- people ----

  async userByEmail(email: string) {
    const { data } = await this.#db.from('onyx_users')
      .select('id, email, name, status')
      .eq('email', email.trim().toLowerCase()).maybeSingle();
    return data ?? null;
  }

  /**
   * Finds or creates the identity behind an email.
   *
   * Inviting someone who already has an account must attach them, not create a
   * second identity with the same address -- that is how one person ends up
   * unable to see half their institutions.
   *
   * A new identity is created in TWO places, in order: the real credential
   * (auth.users, via the Admin API -- GoTrue owns that table, so this never
   * writes to it directly) first, then the onyx_users profile row keyed by
   * the uuid that came back. If the profile insert failed after the
   * auth.users row already exists, a retry finds it via userByEmail() above
   * and attaches rather than double-creating -- see the email-exists branch.
   */
  async upsertUser(input: { name: string; email: string; password?: string }) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.userByEmail(email);
    if (existing) return existing;

    const { data: authUser, error: authError } = await this.#authAdmin.auth.admin.createUser({
      email, password: input.password, email_confirm: true,
    });
    if (authError || !authUser?.user) {
      // A prior attempt may have created the auth.users row and died before
      // the profile insert below -- look it up rather than fail outright.
      if (/already.*registered|already.*exists/i.test(authError?.message ?? '')) {
        const { data: list } = await this.#authAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const found = list?.users.find((u) => u.email?.toLowerCase() === email);
        if (found) return this.#insertProfile(found.id, email, input.name);
      }
      throw new HttpError(422, 'Could not create that account: ' + (authError?.message ?? 'unknown error'));
    }
    return this.#insertProfile(authUser.user.id, email, input.name);
  }

  async #insertProfile(authId: string, email: string, name: string) {
    const { data, error } = await this.#db.from('onyx_users').insert({
      id: authId, email, name: name.trim(), status: 1,
    }).select(USER_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the account: ' + error.message);
    return data!;
  }

  // ---- memberships ----

  async membership(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_memberships')
      .select(MEMBERSHIP_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    return data ?? null;
  }

  /** Every institution this person belongs to, for the tenant switcher. */
  async membershipsFor(userId: string) {
    const { data } = await this.#db.from('onyx_memberships')
      .select(MEMBERSHIP_COLUMNS).eq('user_id', userId).eq('status', 1);
    const rows = data ?? [];
    if (!rows.length) return [];

    const ids = [...new Set(rows.map((r) => Number(r.tenant_id)))];
    const { data: tenants } = await this.#db.from('onyx_tenants')
      .select(TENANT_COLUMNS).in('id', ids).eq('status', 1);
    const byId = new Map((tenants ?? []).map((t) => [t.id, t]));
    // A membership of a suspended institution is not a way in.
    return rows
      .filter((r) => byId.has(Number(r.tenant_id)))
      .map((r) => ({ ...r, tenant: byId.get(Number(r.tenant_id))! }));
  }

  /**
   * The institution's own number for somebody -- roll number, enrolment
   * number, staff ID -- checked before it is written.
   *
   * Unique per institution and compared case-insensitively, because
   * CS-2024-014 and cs-2024-014 are the same person to everybody except a
   * database. The database enforces this too (a partial unique index); the
   * check here exists so the answer is a sentence about which person already
   * holds it rather than a constraint-violation code.
   *
   * Blank clears it. An institution that stops using roll numbers, or an
   * administrator who typed one onto the wrong person, needs a way back.
   */
  async #cleanRoll(tenantId: number, roll: string | null | undefined, membershipId?: number) {
    if (roll === undefined) return undefined;
    const value = (roll ?? '').trim();
    if (!value) return null;
    if (value.length > 40) throw new HttpError(422, 'A roll number can be 40 characters at most.');

    let q = this.#db.from('onyx_memberships')
      .select('id, user_id, roll_number').eq('tenant_id', tenantId);
    if (membershipId) q = q.neq('id', membershipId);
    const { data: rows } = await q;
    const clash = (rows ?? []).find((r) =>
      String(r.roll_number ?? '').toLowerCase() === value.toLowerCase());
    if (clash) {
      const { data: who } = await this.#db.from('onyx_users')
        .select('name').eq('id', String(clash.user_id)).maybeSingle();
      throw new HttpError(409, value + ' is already ' + (who?.name ?? 'somebody else') + '.');
    }
    return value;
  }

  async addMember(tenantId: number, userId: string, role: Role, roll?: string | null) {
    if (!ROLES.includes(role)) throw new HttpError(422, 'That is not a role.');
    const existing = await this.membership(tenantId, userId);
    if (existing) throw new HttpError(422, 'They are already a member of this institution.');

    const rollNumber = await this.#cleanRoll(tenantId, roll);
    const { data, error } = await this.#db.from('onyx_memberships')
      .insert({
        tenant_id: tenantId, user_id: userId, role, status: 1,
        roll_number: rollNumber ?? null,
      })
      .select(MEMBERSHIP_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not add them: ' + error.message);
    return data!;
  }

  /** F-06 -- invite by email, creating the identity if it is new. */
  async invite(tenantId: number, input: {
    name: string; email: string; role: Role; password?: string; roll_number?: string | null;
  }) {
    const user = await this.upsertUser(input);
    const membership = await this.addMember(tenantId, user.id, input.role, input.roll_number);
    return { user: { id: user.id, email: user.email, name: user.name }, membership };
  }

  /**
   * Just a name, for `GET /me` -- the token carries email because email is
   * how a session is issued, but it never carried a name, so "Your profile"
   * had nothing to greet anyone by except an inbox address. One row, not
   * folded into the token: the alternative (embedding name in the JWT at
   * login) means every session issued before that change is missing it until
   * it naturally expires, for a field this page is the only caller of.
   */
  async userName(userId: string): Promise<string | null> {
    const { data } = await this.#db.from('onyx_users')
      .select('name').eq('id', userId).maybeSingle();
    return data?.name ? String(data.name) : null;
  }

  /**
   * Whether faculty may schedule an examination on their own, or every one
   * has to come from admin or the exams office. Defaults true (every
   * institution's existing behaviour) on the tenant row itself rather than a
   * separate settings table -- one flag does not earn its own table, and
   * `GET /me`'s tenant object already carries this to every screen that asks
   * "can I schedule this?" for free.
   */
  async setFacultyCanScheduleExams(tenantId: number, allow: boolean) {
    const { data, error } = await this.#db.from('onyx_tenants')
      .update({ faculty_can_schedule_exams: allow, updated_at: new Date().toISOString() })
      .eq('id', tenantId).select(TENANT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not change that setting: ' + error.message);
    if (!data) throw new HttpError(404, 'Institution not found.');
    return data;
  }

  /**
   * What this institution has changed about who may do what.
   *
   * Stored as the DIFFERENCE from the shipped defaults (see permissions.ts and
   * migration 0023), so a capability added in a later release arrives switched
   * on for the roles that release intends rather than missing from every
   * institution that ever saved a matrix.
   *
   * The sanitising is done in `normaliseOverrides` rather than here: it is the
   * same rule the settings screen needs to render the matrix, and two copies of
   * "which roles may hold this" is how they come to disagree.
   */
  async setPermissions(tenantId: number, overrides: PermissionOverrides) {
    const { data, error } = await this.#db.from('onyx_tenants')
      .update({ permissions: overrides as never, updated_at: new Date().toISOString() })
      .eq('id', tenantId).select(TENANT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not save those permissions: ' + error.message);
    if (!data) throw new HttpError(404, 'Institution not found.');
    return data;
  }

  /**
   * The people at this institution, as this caller may see them.
   *
   * `onlyStudentsOn` is the faculty rule, and it is a policy decision rather
   * than a technical one: a lecturer sees the contact details of the students
   * they teach, and nobody else's. Before this, any faculty account could read
   * the email address of every learner in the institution, plus the
   * administrators, the examinations and placement offices, the guardians and
   * the employer accounts -- a whole-institution address book, handed to a
   * role that needs a class list.
   *
   * Colleagues are not removed, they are *redacted*: name and id stay, email
   * and phone go. That distinction matters. A timetable naming who teaches
   * the next session, or a picker for assigning a second lecturer to a course,
   * are not directory lookups -- dropping staff entirely would turn those
   * screens back into raw ids to solve a problem they are not part of.
   */
  async members(tenantId: number, filters: {
    role?: Role; search?: string; onlyStudentsOn?: number[];
  } = {}) {
    let query = this.#db.from('onyx_memberships')
      .select(MEMBERSHIP_COLUMNS).eq('tenant_id', tenantId);
    if (filters.role) query = query.eq('role', filters.role);
    const { data } = await query.order('id');
    const rows = data ?? [];
    if (!rows.length) return [];

    const ids = [...new Set(rows.map((r) => String(r.user_id)))];
    const { data: users } = await this.#db.from('onyx_users').select(USER_COLUMNS).in('id', ids);
    const byId = new Map((users ?? []).map((u) => [u.id, u]));

    let out = rows.map((r) => ({ ...r, user: byId.get(String(r.user_id)) ?? null }));

    if (filters.onlyStudentsOn) {
      const courseIds = filters.onlyStudentsOn;
      // No courses taught means no students to see -- not "see everybody".
      const { data: enrolled } = courseIds.length
        ? await this.#db.from('onyx_enrollments')
          .select('user_id').eq('tenant_id', tenantId).eq('status', 1).in('course_id', courseIds)
        : { data: [] as { user_id: string }[] };
      const mine = new Set((enrolled ?? []).map((e) => String(e.user_id)));

      out = out
        .filter((r) => r.role !== 'student' || mine.has(String(r.user_id)))
        .map((r) => (r.role === 'student' && mine.has(String(r.user_id))
          ? r
          : { ...r, user: r.user ? { ...r.user, email: '', phone: null } : null }));
    }
    if (filters.search?.trim()) {
      const needle = filters.search.trim().toLowerCase();
      // By roll number too. It is the thing staff are most likely to have in
      // front of them -- off a register, a script, a hall ticket -- and
      // searching a roster by a number that does not match anything is a
      // convincing way to conclude somebody is not enrolled.
      out = out.filter((r) =>
        (r.user?.name ?? '').toLowerCase().includes(needle)
        || (r.user?.email ?? '').toLowerCase().includes(needle)
        || String(r.roll_number ?? '').toLowerCase().includes(needle));
    }
    return out;
  }

  async changeRole(tenantId: number, membershipId: number, role: Role) {
    if (!ROLES.includes(role)) throw new HttpError(422, 'That is not a role.');
    const current = await this.#findMembership(tenantId, membershipId);

    if (current.role === 'admin' && role !== 'admin') {
      await this.#assertNotLastAdmin(tenantId, membershipId);
    }
    await this.#db.from('onyx_memberships')
      .update({ role, updated_at: new Date().toISOString() }).eq('id', membershipId);
    return { id: membershipId, from: current.role as Role, to: role };
  }

  /**
   * A member's identity (name/email/phone/account status) and their standing
   * at this institution (role/membership status), edited together -- the
   * same combined shape the platform console's own member editor uses, since
   * this is the same "who is this person" panel from the institution's own
   * side rather than an operator's. Returns what changed on each half
   * separately so the route can audit them as the two different sentences
   * they are: "renamed someone" is not "made someone an admin".
   */
  async updateMember(tenantId: number, membershipId: number, patch: {
    name?: string; email?: string; phone?: string | null; account_status?: number;
    role?: Role; membership_status?: number; roll_number?: string | null;
  }) {
    const current = await this.#findMembership(tenantId, membershipId);
    const userId = String(current.user_id);
    const { data: user } = await this.#db.from('onyx_users')
      .select(USER_COLUMNS).eq('id', userId).maybeSingle();
    if (!user) throw new HttpError(404, 'No such account.');

    if (patch.role !== undefined && patch.role !== current.role) {
      if (!ROLES.includes(patch.role)) throw new HttpError(422, 'That is not a role.');
      if (current.role === 'admin') await this.#assertNotLastAdmin(tenantId, membershipId);
    }

    const userBefore: Record<string, unknown> = {};
    const userPatch: Record<string, unknown> = {};
    if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== user.name) {
      userBefore.name = user.name; userPatch.name = patch.name.trim();
    }
    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase();
      if (email !== user.email) {
        const { data: clash } = await this.#db.from('onyx_users')
          .select('id').eq('email', email).neq('id', userId).maybeSingle();
        if (clash) throw new HttpError(409, 'That email is already in use.');
        userBefore.email = user.email; userPatch.email = email;
      }
    }
    if (patch.phone !== undefined && patch.phone !== user.phone) {
      userBefore.phone = user.phone; userPatch.phone = patch.phone;
    }
    if (patch.account_status !== undefined && patch.account_status !== user.status) {
      userBefore.status = user.status; userPatch.status = patch.account_status;
    }
    if (Object.keys(userPatch).length) {
      const { error } = await this.#db.from('onyx_users')
        .update({ ...userPatch, updated_at: new Date().toISOString() }).eq('id', userId);
      if (error) throw new HttpError(500, 'Could not update the account: ' + error.message);
    }

    const memberBefore: Record<string, unknown> = {};
    const memberPatch: Record<string, unknown> = {};
    if (patch.role !== undefined && patch.role !== current.role) {
      memberBefore.role = current.role; memberPatch.role = patch.role;
    }
    if (patch.membership_status !== undefined && patch.membership_status !== current.status) {
      memberBefore.status = current.status; memberPatch.status = patch.membership_status;
    }
    if (patch.roll_number !== undefined) {
      const rollNumber = await this.#cleanRoll(tenantId, patch.roll_number, membershipId);
      if (rollNumber !== current.roll_number) {
        memberBefore.roll_number = current.roll_number;
        memberPatch.roll_number = rollNumber;
      }
    }
    if (Object.keys(memberPatch).length) {
      await this.#db.from('onyx_memberships')
        .update({ ...memberPatch, updated_at: new Date().toISOString() }).eq('id', membershipId);
    }

    return {
      userChange: Object.keys(userPatch).length ? { before: userBefore, after: userPatch } : null,
      membershipChange: Object.keys(memberPatch).length
        ? { before: memberBefore, after: memberPatch } : null,
    };
  }

  async removeMember(tenantId: number, membershipId: number): Promise<{ user_id: string }> {
    const current = await this.#findMembership(tenantId, membershipId);
    if (current.role === 'admin') await this.#assertNotLastAdmin(tenantId, membershipId);
    await this.#db.from('onyx_memberships').delete().eq('id', membershipId);
    return { user_id: String(current.user_id) };
  }

  /**
   * Points a person's NEXT minted token at one institution.
   *
   * Supabase Auth owns the token now -- the client cannot hand it one with
   * arbitrary claims the way issueOnyxToken() used to. This is the pointer
   * the Custom Access Token Hook (0015_auth_claims_hook.sql) reads at mint
   * time to decide `tenant_id`/`tenant_role`; setting it here does nothing
   * to any token already issued, only the next one -- signIn() below mints
   * fresh right after setting it, and /api/onyx/auth/switch refreshes the
   * session for the same reason.
   */
  async setActiveTenant(userId: string, tenantId: number): Promise<void> {
    const { error } = await this.#authAdmin.auth.admin.updateUserById(userId, {
      app_metadata: { active_tenant_id: tenantId },
    });
    if (error) throw new HttpError(500, 'Could not switch institutions: ' + error.message);
  }

  /**
   * Sign-in for one institution. Returns the session that authorises it.
   *
   * The password check is now Supabase Auth's, not a column this table
   * holds -- see docs/ADR-011-supabase-auth-migration.md. The two-step shape
   * below (sign in, THEN resolve/point at a tenant, THEN refresh) exists
   * because the Custom Access Token Hook cannot see which tenant this
   * sign-in is for until setActiveTenant() has run, so the token
   * signInWithPassword() mints first is deliberately thrown away in favour
   * of the one refreshSession() mints right after -- the same session, with
   * tenant_id/tenant_role now attached. The FIRST call's failure is checked
   * before any of that, and with the exact generic message the old
   * bcrypt-based check used, so a wrong password and a nonexistent email
   * still read identically -- which emails exist is not public.
   */
  async signIn(email: string, password: string, tenantId?: number) {
    const { data: signed, error: signError } = await this.#authClient.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    });
    if (signError || !signed.session || !signed.user) {
      throw new HttpError(401, 'Those details do not match.');
    }

    // Independent reads, run together -- neither needs the other's result,
    // only the uuid signInWithPassword() already returned.
    const [profile, memberships] = await Promise.all([
      this.userByEmail(email),
      this.membershipsFor(signed.user.id),
    ]);
    if (!profile || profile.status !== 1) throw new HttpError(403, 'That account is not active.');
    if (!memberships.length) {
      throw new HttpError(403, 'That account does not belong to an institution yet.');
    }
    const chosen = tenantId
      ? memberships.find((m) => Number(m.tenant_id) === tenantId)
      : memberships[0];
    if (!chosen) throw new HttpError(403, 'You do not belong to that institution.');

    await this.setActiveTenant(signed.user.id, Number(chosen.tenant_id));
    const { data: refreshed, error: refreshError } = await this.#authClient.auth.refreshSession({
      refresh_token: signed.session.refresh_token,
    });
    if (refreshError || !refreshed.session) {
      throw new HttpError(500, 'Signed in, but could not scope the session: ' + (refreshError?.message ?? ''));
    }

    return {
      session: refreshed.session,
      user: { id: profile.id, email: profile.email, name: profile.name },
      membership: chosen,
      memberships,
    };
  }

  /**
   * F-06 -- move to another institution this person already belongs to.
   *
   * Needs the caller's own refresh token, not just their access token:
   * unlike the old issueOnyxToken(), nothing here can mint a token
   * unilaterally -- only GoTrue can, and only in exchange for a valid
   * refresh token. setActiveTenant() first, so the Custom Access Token Hook
   * sees the new pointer when refreshSession() asks GoTrue to mint.
   */
  async switchTenant(userId: string, tenantId: number, refreshToken: string) {
    await this.setActiveTenant(userId, tenantId);
    const { data, error } = await this.#authClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      throw new HttpError(500, 'Could not switch institutions: ' + (error?.message ?? ''));
    }
    return data.session;
  }

  async #findMembership(tenantId: number, membershipId: number) {
    const { data } = await this.#db.from('onyx_memberships')
      .select(MEMBERSHIP_COLUMNS).eq('id', membershipId).maybeSingle();
    // Scoped to the caller's tenant: an id from another institution is a 404,
    // not a 403, because its existence is not the caller's business.
    if (!data || Number(data.tenant_id) !== tenantId) {
      throw new HttpError(404, 'Member not found.');
    }
    return data;
  }

  /**
   * An institution with no administrator cannot be recovered from inside it, so
   * the last one cannot demote or delete themselves.
   */
  async #assertNotLastAdmin(tenantId: number, membershipId: number): Promise<void> {
    const { data } = await this.#db.from('onyx_memberships')
      .select('id').eq('tenant_id', tenantId).eq('role', 'admin').eq('status', 1);
    const admins = (data ?? []).map((m) => m.id);
    if (admins.length <= 1 && admins.includes(membershipId)) {
      throw new HttpError(422, 'This is the only administrator. Appoint another first.');
    }
  }
}
