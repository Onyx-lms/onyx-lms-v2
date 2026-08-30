/**
 * The platform layer -- the operator who sits above every institution.
 *
 * Not a tenant role, and not one of the seven in `Role`. A platform admin is
 * not a member of any institution by virtue of holding this; they can create
 * one, look at the shape of any of them, and suspend one that has stopped
 * paying or started misbehaving, all without a tenant token that would make
 * them subject to (or a hole in) that institution's own RLS boundary.
 *
 * Every read and write in this file goes through the service-role client --
 * the same one tenant creation already uses -- because there is no tenant
 * claim for RLS to check a platform admin's token against. See 0009_platform
 * for why a permissive policy here would be the wrong shape of trust.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@onyx/types';
import type { OnyxDb } from './db.ts';
import { onyxAuthAdmin, onyxAuthClientFresh } from './db.ts';
import { HttpError } from '../http/errors.ts';
import { peopleFor } from './directory.ts';
import { authorsOf } from './authorship.ts';
import type { TenancyService } from './tenancy.service.ts';
import { slugify } from '../authoring/slug.ts';
import { ROLES, normaliseCommunityUrl } from './tenancy.service.ts';
import { gradeFor } from './examinations.service.ts';
// The same two tests the marker applies, so the count an operator reads and
// the decision `#finalise` makes can never drift apart.
import { isObjective, hasKey, type AssessService } from './assess.service.ts';
import type { CareerService } from './career.service.ts';
// The same guard the institution-side service uses, imported rather than
// copied: a curriculum link becomes an anchor's href, and `javascript:` in
// an href is stored XSS with extra steps. Two implementations of that check
// is one implementation and one hole waiting to be found.
import { normaliseCurriculumUrl } from './domains.service.ts';
import { resolveCourseAccess, type CourseAccess } from './academics.service.ts';

/*
 * The signup policy is in here, and it was not.
 *
 * The console read every column an institution has EXCEPT whether it accepts
 * registrations -- so an operator answering "why is my institution missing
 * from the sign-up list" had the one fact that answers it hidden from them,
 * on a screen listing every other fact about the same row.
 */
// eslint-disable-next-line max-len -- one literal; a concatenated select collapses the row type.
const TENANT_COLUMNS = 'id, name, slug, status, plan, faculty_can_schedule_exams, permissions, student_signup, signup_domains, signup_mode, community_url, community_label, created_at, updated_at';
const ADMIN_COLUMNS = 'id, user_id, granted_by, created_at';

/**
 * Caps.
 *
 * An operator opening an institution should get a page, not a table scan. Every
 * list below is bounded, and every bounded list reports whether it hit the
 * bound so the screen can say "showing the first N" rather than quietly lying
 * about how much there is. ROW_CAP bounds what an operator reads directly;
 * SCAN_CAP bounds the one-query-then-tally passes used to attach counts to
 * those rows (a per-row count query would be N round trips).
 */
const ROW_CAP = 200;
const SCAN_CAP = 5000;

/**
 * How many rows one page of a scan-and-tally carries.
 *
 * A thousand is what the server returns for a request naming no range, so it
 * is the largest useful page -- and asking for more with `.limit()` does not
 * work, because the cap is applied before the limit is read. SCAN_CAP stays as
 * the ceiling on the whole scan.
 */
const TALLY_PAGE = 1000;

const num = (v: unknown): number => Number(v ?? 0);
const clampLimit = (v: number | undefined, fallback = ROW_CAP) =>
  Math.min(Math.max(Number.isFinite(v) && v! > 0 ? Math.trunc(v!) : fallback, 1), ROW_CAP);

/** Mean to one decimal, or null when there is nothing to average. */
function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

interface PersonRow {
  membership_id: number; user_id: string; name: string; email: string; phone: string | null;
  /**
   * The institution's own number for this person.
   *
   * It was missing from this payload entirely, so the platform console could
   * neither show it nor search by it -- and a roll number is the thing staff
   * most often have in front of them, off a register, a script or a hall
   * ticket. Looking somebody up by the one identifier you are holding and
   * being told nobody matches is a convincing way to conclude they are not
   * enrolled.
   */
  roll_number: string | null;
  /**
   * The teaching division this person is in, named rather than numbered.
   *
   * An operator reading a roster wants "Alpha", not "17". Null for staff, who
   * have none, and for a learner nobody has assigned yet — which is a state
   * worth being able to see and to filter for.
   */
  section: { id: number; name: string; code: string } | null;
  role: string; membership_status: number; account_status: number; joined_at: string;
  batch: { id: number; name: string; code: string } | null;
  programme: { id: number; name: string; code: string } | null;
  enrollment_count: number; teaching_count: number;
}

/**
 * Roll order for the register above.
 *
 * `byRoll` in `directory.ts` sorts `Person` records; this sorts the joined row,
 * which carries the same two fields under the same names. Numeric-aware, so
 * MR-002 comes before MR-010, and anybody without a number sorts last by name
 * rather than first -- an unnumbered row at the top of a numbered register
 * reads as an error.
 */
function byRoll2(
  a: { roll_number: string | null; name: string },
  b: { roll_number: string | null; name: string },
): number {
  if (a.roll_number && b.roll_number) {
    return a.roll_number.localeCompare(b.roll_number, undefined,
      { numeric: true, sensitivity: 'base' });
  }
  if (a.roll_number) return -1;
  if (b.roll_number) return 1;
  return a.name.localeCompare(b.name);
}

/**
 * Whether one candidate passed, from the ledger mark or the online score.
 *
 * Kept out of the row builder because the rule is the interesting part and the
 * row builder is long: the entered mark is judged against the sitting's own
 * pass mark; an online score has to be judged against the PAPER's total, so
 * the pass mark is scaled to it. A paper out of 21 sat under a sitting out of
 * 100 with a pass at 40 passes at 8.4 of 21, not at 40 of 21 -- which is a
 * mark nobody can reach, and would have failed everybody.
 */
function passFail(
  entered: number | null,
  passMark: number | null,
  outOf: number,
  score: number | null,
  scoreOutOf: number | null,
): 'pass' | 'fail' | null {
  if (passMark == null) return null;
  if (entered != null) return entered >= passMark ? 'pass' : 'fail';
  if (score == null) return null;
  // No usable total on either side: judge like for like rather than guess.
  if (!scoreOutOf || !outOf) return score >= passMark ? 'pass' : 'fail';
  const needed = (passMark / outOf) * scoreOutOf;
  return score >= needed ? 'pass' : 'fail';
}

export class PlatformService {
  #db: OnyxDb;
  #assess: AssessService | null = null;
  #tenancy: TenancyService | null;
  /** CAR-03 from the console. Optional like the others, so a unit test that
   *  never touches a credential does not have to build one. */
  #career: CareerService | null;
  #authClientOverride: SupabaseClient | undefined;
  /**
   * `assess` is optional so every existing caller and test that builds this
   * with one argument keeps working. It is needed only where a rule already
   * belongs to the institution's own service and must not be written twice --
   * cancelling a paper is the first of those.
   */
  /**
   * `tenancy` is optional for the same reason `assess` is: the console is
   * constructed in tests without every collaborator, and a method that needs
   * one says so with a 500 rather than the whole console failing to build.
   */
  constructor(db: OnyxDb, authClient?: SupabaseClient, assess?: AssessService,
    tenancy?: TenancyService, career?: CareerService) {
    this.#db = db;
    this.#authClientOverride = authClient;
    this.#assess = assess ?? null;
    this.#tenancy = tenancy ?? null;
    this.#career = career ?? null;
  }
  /** Fresh per exchange -- see onyxAuthClientFresh in db.ts. A shared client
   *  hands concurrent sign-ins each other's sessions. */
  get #authClient(): SupabaseClient {
    return this.#authClientOverride ?? onyxAuthClientFresh();
  }

  // -------------------------------------------------------------------------
  // Who gets in
  // -------------------------------------------------------------------------

  /**
   * Signing in as a platform admin uses the same email and password as any
   * other Onyx account -- there is one identity per person, same as
   * tenancy.service.ts's signIn(). What differs is what it checks
   * afterwards: not "do you belong to an institution" but "are you listed in
   * onyx_platform_admins", and what it carries: no tenant_id at all -- the
   * Custom Access Token Hook checks onyx_platform_admins first and stamps
   * `platform: true` instead (0015_auth_claims_hook.sql), so there is
   * nothing this method needs to point at a tenant the way tenancy
   * service's signIn() does.
   */
  async authenticate(email: string, password: string) {
    const { data: signed, error: signError } = await this.#authClient.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    });
    // The same message either way: which emails exist, and which of those
    // are platform admins, is not public.
    if (signError || !signed.user || !signed.session) throw new HttpError(401, 'Those details do not match.');

    const { data: user } = await this.#db.from('onyx_users')
      .select('id, email, name, status').eq('id', signed.user.id).maybeSingle();
    if (!user || user.status !== 1) throw new HttpError(403, 'That account is not active.');

    const { data: grant } = await this.#db.from('onyx_platform_admins')
      .select(ADMIN_COLUMNS).eq('user_id', user.id).maybeSingle();
    if (!grant) throw new HttpError(401, 'Those details do not match.');

    // No tenant pointer to set and no refresh needed: the hook reads
    // onyx_platform_admins directly, so this first-minted session already
    // carries `platform: true`.
    return { session: signed.session, user: { id: user.id, email: user.email, name: user.name } };
  }

  async isPlatformAdmin(userId: string): Promise<boolean> {
    const { data } = await this.#db.from('onyx_platform_admins')
      .select('id').eq('user_id', userId).maybeSingle();
    return Boolean(data);
  }

  async admins() {
    const { data } = await this.#db.from('onyx_platform_admins')
      .select(ADMIN_COLUMNS).order('created_at', { ascending: true });
    const rows = data ?? [];
    if (!rows.length) return [];
    const { data: people } = await this.#db.from('onyx_users').select('id, name, email')
      .in('id', rows.map((r) => String(r.user_id)));
    const byId = new Map((people ?? []).map((p) => [String(p.id), p]));
    return rows.map((r) => ({ ...r, user: byId.get(String(r.user_id)) ?? null }));
  }

  /**
   * Grant platform admin to an existing account, or a brand new one.
   *
   * Bootstrapping the very first platform admin -- when this table is empty
   * and nobody holds a token that could pass requirePlatformAdmin() to call
   * this -- is deliberately NOT this method's job. That happens once, from
   * the machine, via tools/onyx/grant-platform-admin.mjs, which writes the
   * row directly with the service-role connection this same class uses. This
   * method is for the second admin onward, granted by the first.
   *
   * A brand-new account's identity is created in auth.users first (the
   * Admin API, same as tenancy.service.ts's upsertUser()) -- see
   * docs/ADR-011-supabase-auth-migration.md.
   */
  async grant(email: string, name: string, password: string | null, grantedBy: string | null) {
    const normalised = email.trim().toLowerCase();
    const { data: existing } = await this.#db.from('onyx_users')
      .select('id, name').eq('email', normalised).maybeSingle();

    let userId: string;
    if (existing) {
      userId = String(existing.id);
    } else {
      if (!password) throw new HttpError(422, 'A new account needs a password.');
      const { data: authUser, error: authError } = await onyxAuthAdmin().auth.admin.createUser({
        email: normalised, password, email_confirm: true,
      });
      if (authError || !authUser?.user) {
        throw new HttpError(500, 'Could not create the account: ' + (authError?.message ?? 'unknown error'));
      }
      const { error } = await this.#db.from('onyx_users').insert({
        id: authUser.user.id, email: normalised, name: name.trim(), status: 1,
      });
      if (error) {
        throw new HttpError(500, 'Could not create the account: ' + error.message);
      }
      userId = authUser.user.id;
    }

    const { data, error } = await this.#db.from('onyx_platform_admins').insert({
      user_id: userId, granted_by: grantedBy,
    }).select(ADMIN_COLUMNS).maybeSingle();
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw new HttpError(409, 'That person is already a platform admin.');
      }
      throw new HttpError(500, 'Could not grant platform admin: ' + error.message);
    }

    await this.#log(grantedBy, 'platform_admin.granted', 'platform_admin', Number(data!.id),
      null, { user_id: userId, email: normalised });
    return data;
  }

  async revoke(id: number, actorId: string | null) {
    const { data: row } = await this.#db.from('onyx_platform_admins')
      .select(ADMIN_COLUMNS).eq('id', id).maybeSingle();
    if (!row) throw new HttpError(404, 'No such platform admin.');

    // The last one is not removable through this path: a platform with nobody
    // able to sign in to it is not "more secure", it is unrecoverable short
    // of the same direct-database step bootstrapping used.
    const { data: all } = await this.#db.from('onyx_platform_admins').select('id');
    if ((all ?? []).length <= 1) {
      throw new HttpError(422, 'That is the last platform admin. Grant another one first.');
    }

    await this.#db.from('onyx_platform_admins').delete().eq('id', id);
    await this.#log(actorId, 'platform_admin.revoked', 'platform_admin', id,
      { user_id: row.user_id }, null);
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Every institution
  // -------------------------------------------------------------------------

  async tenants(filters: { search?: string; status?: number; plan?: string } = {}) {
    let q = this.#db.from('onyx_tenants').select(TENANT_COLUMNS);
    if (filters.status !== undefined) q = q.eq('status', filters.status);
    if (filters.plan) q = q.eq('plan', filters.plan);
    const { data } = await q.order('created_at', { ascending: false });
    let rows = data ?? [];
    // Search is a substring match on name or address -- there are too few
    // institutions per platform for this to need a database-side ilike, and
    // it keeps this one query rather than two different code paths.
    if (filters.search?.trim()) {
      const needle = filters.search.trim().toLowerCase();
      rows = rows.filter((t) =>
        String(t.name).toLowerCase().includes(needle)
        || String(t.slug).toLowerCase().includes(needle));
    }
    if (!rows.length) return [];

    /*
     * COUNTED per institution, not tallied from the rows.
     *
     * This fetched every membership row across every institution and added
     * them up in a loop -- with no range, which reads as "all of them" and is
     * not: PostgREST caps a request that names none at a thousand rows. So the
     * directory reported an institution of 1,440 as 943, and the "members
     * across every institution" figure above it -- which is this column summed
     * -- came out at exactly 1000 however many people were really there. Both
     * numbers were right for a platform small enough not to notice and wrong
     * for the moment anybody wanted them.
     *
     * One exact head count per institution instead, in parallel, returning no
     * rows at all. A handful of tiny counts beats a thousand rows over the
     * wire to be re-counted here -- and this page is a directory of
     * institutions, so "a handful" is what it will stay.
     */
    const counted = await Promise.all(rows.map(async (t) => {
      const { count } = await this.#db.from('onyx_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', Number(t.id)).eq('status', 1);
      return [Number(t.id), count ?? 0] as const;
    }));
    const counts = new Map(counted);

    return rows.map((t) => ({ ...t, member_count: counts.get(Number(t.id)) ?? 0 }));
  }

  /**
   * One institution's headline shape.
   *
   * The role breakdown was all this returned, which answers "how many people"
   * and nothing about whether the place is actually being used. The counts
   * added here are the cheap ones -- HEAD requests that come back as a number
   * from Postgres rather than rows over the wire -- so the drill-in page can
   * lead with what an operator actually wants to know before scrolling.
   */
  async tenant(id: number) {
    const { data } = await this.#db.from('onyx_tenants')
      .select(TENANT_COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such institution.');

    const head = { count: 'exact' as const, head: true };

    /*
     * COUNTED, not tallied from the rows.
     *
     * This used to select every membership row and add them up in a loop --
     * with no limit, which reads as "all of them" and is not: PostgREST caps a
     * request that names no limit at a thousand rows. So an institution with
     * 1,440 students had its own overview report 995 of them, under a heading
     * that says how many people are there, with nothing anywhere hinting the
     * number had been truncated. It was right for every institution small
     * enough not to notice and wrong for exactly the ones where the count
     * matters.
     *
     * One exact head count per role instead -- the same `count: 'exact', head:
     * true` every other figure on this screen already uses, and no rows come
     * back at all. Seven small counts in parallel, rather than a thousand rows
     * over the wire to be re-counted here.
     */
    const roleCounts = await Promise.all(ROLES.map(async (role) => {
      const { count } = await this.#db.from('onyx_memberships')
        .select('id', head).eq('tenant_id', id).eq('status', 1).eq('role', role);
      return [role, count ?? 0] as const;
    }));
    const byRole: Record<string, number> = {};
    // Absent rather than zero: a role nobody holds is not worth a row on the
    // overview, which is how this read before and what the screen expects.
    for (const [role, n] of roleCounts) if (n > 0) byRole[role] = n;
    const [
      courses, assessments, assignments, enrollments,
      programs, batches, exams, examMarks, submissions, attempts,
    ] = await Promise.all([
      this.#db.from('onyx_courses').select('id', head).eq('tenant_id', id),
      this.#db.from('onyx_assessments').select('id', head).eq('tenant_id', id),
      this.#db.from('onyx_assignments').select('id', head).eq('tenant_id', id),
      this.#db.from('onyx_enrollments').select('id', head).eq('tenant_id', id),
      this.#db.from('onyx_programs').select('id', head).eq('tenant_id', id),
      this.#db.from('onyx_batches').select('id', head).eq('tenant_id', id),
      this.#db.from('onyx_exams').select('id', head).eq('tenant_id', id),
      this.#db.from('onyx_exam_marks').select('id', head).eq('tenant_id', id),
      this.#db.from('onyx_assignment_submissions').select('id', head).eq('tenant_id', id),
      this.#db.from('onyx_assessment_attempts').select('id', head).eq('tenant_id', id),
    ]);

    return {
      ...data,
      members_by_role: byRole,
      member_count: Object.values(byRole).reduce((sum, n) => sum + n, 0),
      counts: {
        courses: courses.count ?? 0,
        assessments: assessments.count ?? 0,
        assignments: assignments.count ?? 0,
        enrollments: enrollments.count ?? 0,
        programmes: programs.count ?? 0,
        batches: batches.count ?? 0,
        exams: exams.count ?? 0,
        exam_marks: examMarks.count ?? 0,
        submissions: submissions.count ?? 0,
        attempts: attempts.count ?? 0,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Looking inside one institution
  //
  // These three read a customer's own records -- their students, their marks --
  // from outside their tenancy. Three rules hold for all of them and are worth
  // stating once rather than three times:
  //
  //   1. Every query filters on tenant_id. There is no RLS underneath the
  //      service-role client to catch a forgotten one, so the filter IS the
  //      boundary. The one exception is onyx_users, which has no tenant_id by
  //      design (one identity per person, many memberships) -- so it is only
  //      ever read by an id list already derived from a tenant-filtered query.
  //   2. Every list is capped and says so, because "the operator's browser hung"
  //      is how a big customer finds out this page exists.
  //   3. Reading grades is audited. See tenantGrades().
  // -------------------------------------------------------------------------

  /** Cheap existence check -- 404 before doing eight more queries for nothing. */
  async #requireTenant(id: number) {
    const { data } = await this.#db.from('onyx_tenants')
      .select('id, name, slug').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such institution.');
    return data;
  }

  /**
   * onyx_users is the one table here without a tenant_id, so it is never
   * queried by tenant -- only by a list of ids that a tenant-scoped query
   * produced. Passing ids from anywhere else would leak across institutions.
   *
   * `id` has been a Supabase Auth uuid since the 0013/0014 migration
   * (ADR-011), not the bigint identity it started as. Every caller here used
   * to run these ids through `num()` -- fine while onyx_users.id was bigint,
   * silently wrong since: `Number("2bae7a10-...")` is NaN, so `.in('id', ids)`
   * was sent an array of NaNs, matched nobody, and every person on every one
   * of these screens fell back to "Unknown" / disabled. Kept as plain
   * strings throughout instead of coercing.
   */
  async #usersById(ids: string[]) {
    const out = new Map<string,
      { id: string; name: string; email: string; phone: string | null; status: number }>();
    if (!ids.length) return out;
    const { data } = await this.#db.from('onyx_users')
      .select('id, name, email, phone, status').in('id', ids);
    for (const u of data ?? []) {
      out.set(String(u.id), {
        id: String(u.id), name: String(u.name), email: String(u.email),
        phone: u.phone == null ? null : String(u.phone), status: num(u.status),
      });
    }
    return out;
  }

  /**
   * The institution's people: who is on the roll, what they are, and enough
   * context (batch, programme, how much they are enrolled in) to tell an active
   * student from a name that was imported once and never used.
   */
  async tenantPeople(id: number, opts: {
    role?: string; limit?: number;
    /** A section id, or `'none'` for the people in no section at all. */
    sectionId?: number | 'none';
  } = {}) {
    const tenant = await this.#requireTenant(id);
    const limit = clampLimit(opts.limit);

    const scoped = this.#db.from('onyx_memberships')
      .select('id, user_id, role, status, roll_number, section_id, created_at')
      .eq('tenant_id', id);

    // limit + 1 so "there is more" is a fact, not a guess from a full page.
    let listing = opts.role ? scoped.eq('role', opts.role as Role) : scoped;
    // "Unassigned" has to be askable: it is the list somebody works from at
    // the start of a term, and a filter that could only name a section would
    // make the people who most need moving the hardest to find.
    if (opts.sectionId === 'none') listing = listing.is('section_id', null);
    else if (opts.sectionId !== undefined) listing = listing.eq('section_id', opts.sectionId);
    const { data: rows } = await listing
      .order('role', { ascending: true }).order('id', { ascending: true })
      .limit(limit + 1);
    const page = (rows ?? []).slice(0, limit);
    const capped = (rows ?? []).length > limit;

    // The total counts the same set the page is a window onto -- with the role
    // filter applied -- so "showing 200 of 4,312" is about one comparable thing.
    const counting = this.#db.from('onyx_memberships')
      .select('id', { count: 'exact', head: true }).eq('tenant_id', id);
    let counted = opts.role ? counting.eq('role', opts.role as Role) : counting;
    if (opts.sectionId === 'none') counted = counted.is('section_id', null);
    else if (opts.sectionId !== undefined) counted = counted.eq('section_id', opts.sectionId);
    const { count: total } = await counted;

    const userIds = page.map((m) => String(m.user_id));
    const users = await this.#usersById(userIds);

    // Everything below is keyed on userIds, which came from a tenant-filtered
    // read, and is tenant-filtered again anyway.
    const [enrolQ, batchMemQ, facultyQ] = userIds.length ? await Promise.all([
      this.#db.from('onyx_enrollments').select('user_id, batch_id')
        .eq('tenant_id', id).eq('status', 1).in('user_id', userIds).limit(SCAN_CAP),
      this.#db.from('onyx_batch_members').select('user_id, batch_id')
        .eq('tenant_id', id).in('user_id', userIds).limit(SCAN_CAP),
      this.#db.from('onyx_course_faculty').select('user_id, course_id')
        .eq('tenant_id', id).in('user_id', userIds).limit(SCAN_CAP),
    ]) : [{ data: [] }, { data: [] }, { data: [] }];

    const enrolCount = new Map<string, number>();
    const batchOf = new Map<string, number>();
    for (const e of enrolQ.data ?? []) {
      const uid = String(e.user_id);
      enrolCount.set(uid, (enrolCount.get(uid) ?? 0) + 1);
      if (e.batch_id != null && !batchOf.has(uid)) batchOf.set(uid, num(e.batch_id));
    }
    // An explicit batch membership beats one inferred from an enrolment.
    for (const b of batchMemQ.data ?? []) batchOf.set(String(b.user_id), num(b.batch_id));
    const teachCount = new Map<string, number>();
    for (const f of facultyQ.data ?? []) {
      const uid = String(f.user_id);
      teachCount.set(uid, (teachCount.get(uid) ?? 0) + 1);
    }

    const batchIds = [...new Set(batchOf.values())];
    const { data: batchRows } = batchIds.length
      ? await this.#db.from('onyx_batches').select('id, name, code, program_id')
        .eq('tenant_id', id).in('id', batchIds)
      : { data: [] };
    const programIds = [...new Set((batchRows ?? [])
      .map((b) => num(b.program_id)).filter((n) => n > 0))];
    const { data: programRows } = programIds.length
      ? await this.#db.from('onyx_programs').select('id, name, code')
        .eq('tenant_id', id).in('id', programIds)
      : { data: [] };
    const programmes = new Map((programRows ?? []).map((p) => [num(p.id),
      { id: num(p.id), name: String(p.name), code: String(p.code) }]));
    const batches = new Map((batchRows ?? []).map((b) => [num(b.id), {
      batch: { id: num(b.id), name: String(b.name), code: String(b.code) },
      programme: programmes.get(num(b.program_id)) ?? null,
    }]));

    // Named once for the whole page rather than joined per row.
    const { data: sectionRows } = await this.#db.from('onyx_sections')
      .select('id, name, code').eq('tenant_id', id);
    const sections = new Map((sectionRows ?? []).map((sx) => [num(sx.id),
      { id: num(sx.id), name: String(sx.name), code: String(sx.code) }]));

    const people: PersonRow[] = page.map((m) => {
      const uid = String(m.user_id);
      const user = users.get(uid);
      const linked = batches.get(batchOf.get(uid) ?? -1) ?? null;
      return {
        membership_id: num(m.id),
        user_id: uid,
        name: user?.name ?? 'Unknown',
        email: user?.email ?? '',
        phone: user?.phone ?? null,
        roll_number: m.roll_number ? String(m.roll_number) : null,
        section: m.section_id == null ? null : sections.get(num(m.section_id)) ?? null,
        role: String(m.role),
        membership_status: num(m.status),
        account_status: user?.status ?? 0,
        joined_at: String(m.created_at),
        batch: linked?.batch ?? null,
        programme: linked?.programme ?? null,
        enrollment_count: enrolCount.get(uid) ?? 0,
        teaching_count: teachCount.get(uid) ?? 0,
      };
    });

    const byRole: Record<string, number> = {};
    for (const p of people) byRole[p.role] = (byRole[p.role] ?? 0) + 1;

    return {
      tenant: { id: num(tenant.id), name: String(tenant.name), slug: String(tenant.slug) },
      role: opts.role ?? null,
      limit, capped, total: total ?? people.length,
      counts_by_role: byRole,
      people,
    };
  }

  /**
   * What the institution teaches and what it sets: courses with how many people
   * are on them, and the assignments and assessments hanging off those courses
   * with how much work has actually come back.
   */
  async tenantAcademics(id: number, opts: { limit?: number } = {}) {
    const tenant = await this.#requireTenant(id);
    const limit = clampLimit(opts.limit);

    const [courseQ, assignmentQ, assessmentQ, examQ] = await Promise.all([
      this.#db.from('onyx_courses')
        .select('id, code, title, credits, status, program_id, semester_id, self_enroll, access, price_minor, currency, created_at')
        .eq('tenant_id', id).order('code', { ascending: true }).limit(limit + 1),
      this.#db.from('onyx_assignments')
        .select('id, course_id, title, due_at, total_points, status, created_at')
        .eq('tenant_id', id).order('due_at', { ascending: false, nullsFirst: false })
        .limit(limit + 1),
      this.#db.from('onyx_assessments')
        // One literal, not a concatenation: supabase-js infers the row type
        // from the select string as a literal type, and `a + b` is just string.
        .select('id, course_id, section_id, title, opens_at, closes_at, status, pass_mark, duration_minutes, attempts_allowed, sections, created_by, created_at')
        .eq('tenant_id', id).order('created_at', { ascending: false }).limit(limit + 1),
      // Examinations (CMP-02): scheduled papers, not the marks off them --
      // those are still tenantGrades()'s job, audited the same as ever.
      this.#db.from('onyx_exams')
        // With `assessment_id`: whether a sitting is sat in a browser is what
        // decides if it can be invigilated at all, and the console was reading
        // that fact from nowhere.
        // eslint-disable-next-line max-len -- one literal, same reason as above.
        .select('id, course_id, assessment_id, section_id, title, starts_at, duration_minutes, max_marks, pass_marks, status, created_by, created_at')
        .eq('tenant_id', id).order('starts_at', { ascending: false, nullsFirst: false })
        .limit(limit + 1),
    ]);

    const courseRows = (courseQ.data ?? []).slice(0, limit);
    const assignmentRows = (assignmentQ.data ?? []).slice(0, limit);
    const assessmentRows = (assessmentQ.data ?? []).slice(0, limit);
    const examRows = (examQ.data ?? []).slice(0, limit);

    /*
     * The enrolment tally, PAGED rather than capped.
     *
     * `.limit(SCAN_CAP)` reads as "up to five thousand" and was not: a request
     * naming no RANGE comes back with at most a thousand rows whatever limit it
     * asks for, because the cap is applied first. So this institution's 1,447
     * enrolments arrived as 1,000, all of which happened to belong to one
     * course -- and the console reported PY122 with exactly 1000 enrolled and
     * every one of the other sixty-three courses with none.
     *
     * Nothing looked wrong. Capacity, staffing and revenue read off that
     * screen would all have been wrong, which is why the end-user report
     * called it out on its own.
     */
    const enrolRows: { course_id: unknown; status: unknown }[] = [];
    for (let from = 0; from < SCAN_CAP; from += TALLY_PAGE) {
      // eslint-disable-next-line no-await-in-loop -- each page needs the one
      // before it to have arrived before it knows whether to ask for another.
      const { data } = await this.#db.from('onyx_enrollments').select('course_id, status, id')
        .eq('tenant_id', id).order('id').range(from, from + TALLY_PAGE - 1);
      const page = data ?? [];
      enrolRows.push(...page);
      if (page.length < TALLY_PAGE) break;
    }

    // Counts by one scan-and-tally per table rather than one query per row.
    const [facQ, subQ, attemptQ, progQ, markQ, seatQ] = await Promise.all([
      this.#db.from('onyx_course_faculty').select('course_id, user_id')
        .eq('tenant_id', id).limit(SCAN_CAP),
      assignmentRows.length
        ? this.#db.from('onyx_assignment_submissions').select('assignment_id, status')
          .eq('tenant_id', id).in('assignment_id', assignmentRows.map((a) => num(a.id)))
          .limit(SCAN_CAP)
        : Promise.resolve({ data: [] }),
      assessmentRows.length
        ? this.#db.from('onyx_assessment_attempts').select('assessment_id, status, score')
          .eq('tenant_id', id).in('assessment_id', assessmentRows.map((a) => num(a.id)))
          .limit(SCAN_CAP)
        : Promise.resolve({ data: [] }),
      this.#db.from('onyx_programs').select('id, name, code').eq('tenant_id', id).limit(ROW_CAP),
      examRows.length
        ? this.#db.from('onyx_exam_marks').select('exam_id, status')
          .eq('tenant_id', id).in('exam_id', examRows.map((e) => num(e.id)))
          .limit(SCAN_CAP)
        : Promise.resolve({ data: [] }),
      examRows.length
        ? this.#db.from('onyx_seat_allocations').select('exam_id')
          .eq('tenant_id', id).in('exam_id', examRows.map((e) => num(e.id)))
          .limit(SCAN_CAP)
        : Promise.resolve({ data: [] }),
    ]);

    const enrolBy = new Map<number, number>();
    for (const e of enrolRows) {
      if (num(e.status) !== 1) continue;
      const c = num(e.course_id);
      enrolBy.set(c, (enrolBy.get(c) ?? 0) + 1);
    }
    const facBy = new Map<number, number>();
    for (const f of facQ.data ?? []) {
      const c = num(f.course_id);
      facBy.set(c, (facBy.get(c) ?? 0) + 1);
    }
    const programmes = new Map((progQ.data ?? []).map((p) => [num(p.id), String(p.name)]));

    const courses = courseRows.map((c) => ({
      id: num(c.id),
      code: String(c.code),
      title: String(c.title),
      credits: num(c.credits),
      status: num(c.status),
      self_enroll: num(c.self_enroll) === 1,
      // How a learner joins, and what it costs them. The console listed
      // neither, so an operator could not tell a course anybody could start
      // from one nobody could.
      access: String(c.access ?? 'batch'),
      price_minor: num(c.price_minor),
      currency: String(c.currency ?? 'INR'),
      programme: c.program_id == null ? null : programmes.get(num(c.program_id)) ?? null,
      enrollment_count: enrolBy.get(num(c.id)) ?? 0,
      faculty_count: facBy.get(num(c.id)) ?? 0,
      created_at: String(c.created_at),
    }));
    const courseLabel = new Map(courses.map((c) => [c.id, { code: c.code, title: c.title }]));

    const subTotal = new Map<number, number>();
    const subGraded = new Map<number, number>();
    for (const s of subQ.data ?? []) {
      const a = num(s.assignment_id);
      subTotal.set(a, (subTotal.get(a) ?? 0) + 1);
      if (s.status === 'graded' || s.status === 'returned') {
        subGraded.set(a, (subGraded.get(a) ?? 0) + 1);
      }
    }
    const attTotal = new Map<number, number>();
    const attDone = new Map<number, number>();
    for (const a of attemptQ.data ?? []) {
      const k = num(a.assessment_id);
      attTotal.set(k, (attTotal.get(k) ?? 0) + 1);
      if (a.status !== 'in_progress') attDone.set(k, (attDone.get(k) ?? 0) + 1);
    }

    const markTotal = new Map<number, number>();
    const markPublished = new Map<number, number>();
    for (const m of markQ.data ?? []) {
      const e = num(m.exam_id);
      markTotal.set(e, (markTotal.get(e) ?? 0) + 1);
      if (m.status === 'published') markPublished.set(e, (markPublished.get(e) ?? 0) + 1);
    }
    const seatCount = new Map<number, number>();
    for (const s of seatQ.data ?? []) {
      const e = num(s.exam_id);
      seatCount.set(e, (seatCount.get(e) ?? 0) + 1);
    }

    /*
     * Who set each paper and who scheduled each sitting.
     *
     * One lookup for both lists rather than one per row: an operator opening
     * an institution's academics is looking at up to two hundred rows, and a
     * byline is not worth two hundred round trips. The column has been on both
     * tables since 0004 and 0008 and nothing ever read it -- so an operator
     * seeing an examination they did not recognise had no way to tell whether
     * the institution scheduled it or the console did.
     */
    const bylines = await authorsOf(this.#db, id, [
      ...examRows.map((e) => (e.created_by == null ? null : String(e.created_by))),
      ...assessmentRows.map((a) => (a.created_by == null ? null : String(a.created_by))),
    ]);
    const bylineOf = (v: unknown) => (v == null ? null : bylines.get(String(v)) ?? null);

    return {
      tenant: { id: num(tenant.id), name: String(tenant.name), slug: String(tenant.slug) },
      limit,
      capped: {
        courses: (courseQ.data ?? []).length > limit,
        assignments: (assignmentQ.data ?? []).length > limit,
        assessments: (assessmentQ.data ?? []).length > limit,
        exams: (examQ.data ?? []).length > limit,
      },
      courses,
      exams: examRows.map((e) => ({
        id: num(e.id),
        title: String(e.title),
        course_id: e.course_id == null ? null : num(e.course_id),
        course: e.course_id == null ? null : courseLabel.get(num(e.course_id)) ?? null,
        starts_at: e.starts_at ? String(e.starts_at) : null,
        duration_minutes: num(e.duration_minutes),
        max_marks: num(e.max_marks),
        pass_marks: num(e.pass_marks),
        status: String(e.status),
        /*
         * The two facts the row is READ for, which it was selecting and then
         * dropping on the way out.
         *
         * `assessment_id` is what says a sitting is sat in a browser rather
         * than in a hall -- so the invigilation console, which lists exactly
         * those, listed nothing at all. `section_id` is which division is
         * sitting it. Both are on the row; only this mapping was silent about
         * them, which is the worst way for a field to be missing: the query
         * looks right and the screen is simply empty.
         */
        assessment_id: e.assessment_id == null ? null : num(e.assessment_id),
        section_id: e.section_id == null ? null : num(e.section_id),
        author: bylineOf(e.created_by),
        seats_allocated: seatCount.get(num(e.id)) ?? 0,
        marks_entered: markTotal.get(num(e.id)) ?? 0,
        marks_published: markPublished.get(num(e.id)) ?? 0,
      })),
      assignments: assignmentRows.map((a) => ({
        id: num(a.id),
        title: String(a.title),
        course_id: num(a.course_id),
        course: courseLabel.get(num(a.course_id)) ?? null,
        due_at: a.due_at ? String(a.due_at) : null,
        total_points: num(a.total_points),
        status: String(a.status),
        submission_count: subTotal.get(num(a.id)) ?? 0,
        graded_count: subGraded.get(num(a.id)) ?? 0,
      })),
      assessments: assessmentRows.map((a) => ({
        id: num(a.id),
        title: String(a.title),
        course_id: a.course_id == null ? null : num(a.course_id),
        course: a.course_id == null ? null : courseLabel.get(num(a.course_id)) ?? null,
        opens_at: a.opens_at ? String(a.opens_at) : null,
        closes_at: a.closes_at ? String(a.closes_at) : null,
        status: String(a.status),
        // Which division it is set for, and the same omission the exam rows
        // had: a paper set for Alpha-CSE and one set for everybody are
        // different papers, and the list could not tell them apart.
        section_id: a.section_id == null ? null : num(a.section_id),
        pass_mark: a.pass_mark == null ? null : num(a.pass_mark),
        duration_minutes: num(a.duration_minutes),
        author: bylineOf(a.created_by),
        attempt_count: attTotal.get(num(a.id)) ?? 0,
        submitted_count: attDone.get(num(a.id)) ?? 0,
        /*
         * What this paper draws, and from where.
         *
         * Carried so the console can say "this paper has no questions" on the
         * list rather than leaving a candidate to discover it at the moment
         * they press Start -- which is where `start()` refuses it, and far too
         * late for anybody to do something about it.
         */
        sections: (a.sections ?? []) as {
          id: string; title: string; bank_id: number; take: number;
        }[],
      })),
    };
  }

  /**
   * The institution's timetable, read from outside it.
   *
   * Everything -- drafts included -- the same as an institution's own admin
   * sees, because a platform operator watching a build-out in progress needs
   * to see it exists, not just that it is finished. Read-only: the console
   * that builds and publishes a timetable is the institution's own, this is
   * oversight, not a second door to write through.
   */
  async tenantTimetable(id: number, opts: { semester_id?: number } = {}) {
    await this.#requireTenant(id);

    // One literal, not a concatenation: supabase-js infers the row type from
    // the select string as a literal type, and `a + b` is just string.
    let q = this.#db.from('onyx_timetable_slots')
      .select('id, semester_id, course_id, batch_id, room_id, faculty_id, day_of_week, starts_at, ends_at, status')
      .eq('tenant_id', id);
    if (opts.semester_id) q = q.eq('semester_id', opts.semester_id);
    const { data } = await q
      .order('day_of_week', { ascending: true }).order('starts_at', { ascending: true })
      .limit(SCAN_CAP);
    const slots = data ?? [];

    const courseIds = [...new Set(slots.map((s) => num(s.course_id)))];
    const roomIds = [...new Set(slots.map((s) => num(s.room_id)))];
    const facultyIds = [...new Set(slots.map((s) => String(s.faculty_id)))];
    const batchIds = [...new Set(slots.map((s) => num(s.batch_id)))];

    const [courseQ, roomQ, facultyQ, batchQ, semQ] = await Promise.all([
      courseIds.length
        ? this.#db.from('onyx_courses').select('id, code, title').eq('tenant_id', id)
          .in('id', courseIds)
        : Promise.resolve({ data: [] }),
      roomIds.length
        ? this.#db.from('onyx_rooms').select('id, code, name, kind').eq('tenant_id', id)
          .in('id', roomIds)
        : Promise.resolve({ data: [] }),
      facultyIds.length
        ? this.#db.from('onyx_users').select('id, name').in('id', facultyIds)
        : Promise.resolve({ data: [] }),
      batchIds.length
        ? this.#db.from('onyx_batches').select('id, name').eq('tenant_id', id).in('id', batchIds)
        : Promise.resolve({ data: [] }),
      this.#db.from('onyx_semesters').select('id, name').eq('tenant_id', id).limit(ROW_CAP),
    ]);
    const courseById = new Map((courseQ.data ?? []).map((c) => [num(c.id), c]));
    const roomById = new Map((roomQ.data ?? []).map((r) => [num(r.id), r]));
    const facultyById = new Map((facultyQ.data ?? []).map((u) => [String(u.id), u]));
    const batchById = new Map((batchQ.data ?? []).map((b) => [num(b.id), b]));
    const semesterById = new Map((semQ.data ?? []).map((s) => [num(s.id), s]));

    return {
      semesters: (semQ.data ?? []).map((s) => ({ id: num(s.id), name: String(s.name) })),
      slots: slots.map((s) => ({
        id: num(s.id),
        semester: semesterById.get(num(s.semester_id))?.name ?? null,
        course: courseById.get(num(s.course_id)) ?? null,
        room: roomById.get(num(s.room_id)) ?? null,
        faculty: facultyById.get(String(s.faculty_id)) ?? null,
        batch: batchById.get(num(s.batch_id))?.name ?? null,
        day_of_week: num(s.day_of_week),
        starts_at: String(s.starts_at),
        ends_at: String(s.ends_at),
        status: String(s.status),
      })),
    };
  }

  /**
   * The institution's results, read from outside it.
   *
   * This is the most privileged read in the file. A platform admin has a real
   * reason to look -- a customer disputing a marks import, a moderation bug --
   * but "who looked at our students' marks, and when" is exactly the question
   * that institution is entitled to be able to ask afterwards. So unlike
   * tenantPeople() and tenantAcademics(), this one writes an audit row on the
   * way past, the same as grant()/revoke()/suspend() do for writes. An
   * unlogged read here would be indistinguishable from an exfiltration.
   */
  async tenantGrades(id: number, actorId: string | null, opts: {
    limit?: number; examId?: number; assessmentId?: number;
  } = {}) {
    const tenant = await this.#requireTenant(id);
    const limit = clampLimit(opts.limit);
    // Grades are read one exam or one assessment at a time now -- an
    // operator picks which from the Examinations/Assessments list first, the
    // same drill-down every other platform screen already uses, rather than
    // one flat "most recent 200 marks, mixing every exam and assessment at
    // this institution" table. Scoped to one exam/assessment, the 200-row
    // cap that made sense for an institution-wide feed no longer applies --
    // a single exam's cohort is naturally bounded -- so it reads the whole
    // set instead of just the most recent slice of it.
    const scoped = Boolean(opts.examId) || Boolean(opts.assessmentId);
    const rowCap = scoped ? SCAN_CAP : limit + 1;

    const [markQ, attemptQ] = await Promise.all([
      opts.assessmentId ? Promise.resolve({ data: [] as Record<string, unknown>[] }) : (() => {
        let q = this.#db.from('onyx_exam_marks')
          .select('id, exam_id, user_id, raw_marks, moderation_delta, final_marks, grade, grade_points, status, published_at, created_at')
          .eq('tenant_id', id);
        if (opts.examId) q = q.eq('exam_id', opts.examId);
        return q.order('created_at', { ascending: false }).limit(rowCap);
      })(),
      opts.examId ? Promise.resolve({ data: [] as Record<string, unknown>[] }) : (() => {
        let q = this.#db.from('onyx_assessment_attempts')
          .select('id, assessment_id, user_id, attempt, score, max_score, status, submitted_at')
          .eq('tenant_id', id).not('score', 'is', null);
        if (opts.assessmentId) q = q.eq('assessment_id', opts.assessmentId);
        return q.order('submitted_at', { ascending: false, nullsFirst: false }).limit(rowCap);
      })(),
    ]);

    const markRows = scoped ? (markQ.data ?? []) : (markQ.data ?? []).slice(0, limit);
    const attemptRows = scoped ? (attemptQ.data ?? []) : (attemptQ.data ?? []).slice(0, limit);

    const examIds = [...new Set(markRows.map((m) => num(m.exam_id)))];
    const assessmentIds = [...new Set(attemptRows.map((a) => num(a.assessment_id)))];
    const [examQ, assessQ, gradeQ] = await Promise.all([
      examIds.length
        ? this.#db.from('onyx_exams')
          .select('id, title, course_id, max_marks, pass_marks, starts_at, status')
          .eq('tenant_id', id).in('id', examIds)
        : Promise.resolve({ data: [] }),
      assessmentIds.length
        ? this.#db.from('onyx_assessments').select('id, title, course_id, pass_mark')
          .eq('tenant_id', id).in('id', assessmentIds)
        : Promise.resolve({ data: [] }),
      attemptRows.length
        ? this.#db.from('onyx_assessment_grades').select('attempt_id, role, manual_score')
          .eq('tenant_id', id).in('attempt_id', attemptRows.map((a) => num(a.id)))
          .limit(SCAN_CAP)
        : Promise.resolve({ data: [] }),
    ]);

    const courseIds = [...new Set([
      ...(examQ.data ?? []).map((e) => num(e.course_id)),
      ...(assessQ.data ?? []).map((a) => (a.course_id == null ? 0 : num(a.course_id))),
    ].filter((n) => n > 0))];
    const { data: courseRows } = courseIds.length
      ? await this.#db.from('onyx_courses').select('id, code, title')
        .eq('tenant_id', id).in('id', courseIds)
      : { data: [] };
    const courses = new Map((courseRows ?? []).map((c) => [num(c.id),
      { id: num(c.id), code: String(c.code), title: String(c.title) }]));

    const exams = new Map((examQ.data ?? []).map((e) => [num(e.id), e]));
    const assessments = new Map((assessQ.data ?? []).map((a) => [num(a.id), a]));
    const markerCount = new Map<number, number>();
    for (const g of gradeQ.data ?? []) {
      const k = num(g.attempt_id);
      markerCount.set(k, (markerCount.get(k) ?? 0) + 1);
    }

    const users = await this.#usersById([...new Set([
      ...markRows.map((m) => String(m.user_id)), ...attemptRows.map((a) => String(a.user_id)),
    ])]);
    const person = (uid: string) => {
      const u = users.get(uid);
      return { id: uid, name: u?.name ?? 'Unknown', email: u?.email ?? '' };
    };

    const examMarks = markRows.map((m) => {
      const exam = exams.get(num(m.exam_id));
      return {
        id: num(m.id),
        kind: 'exam' as const,
        student: person(String(m.user_id)),
        exam: exam
          ? { id: num(exam.id), title: String(exam.title), starts_at: String(exam.starts_at) }
          : null,
        course: exam ? courses.get(num(exam.course_id)) ?? null : null,
        raw_marks: num(m.raw_marks),
        moderation_delta: num(m.moderation_delta),
        final_marks: num(m.final_marks),
        max_marks: exam ? num(exam.max_marks) : null,
        pass_marks: exam ? num(exam.pass_marks) : null,
        grade: m.grade == null ? null : String(m.grade),
        grade_points: m.grade_points == null ? null : num(m.grade_points),
        status: String(m.status),
        published_at: m.published_at ? String(m.published_at) : null,
        recorded_at: String(m.created_at),
      };
    });

    const assessmentGrades = attemptRows.map((a) => {
      const assessment = assessments.get(num(a.assessment_id));
      const courseId = assessment?.course_id == null ? 0 : num(assessment.course_id);
      return {
        id: num(a.id),
        kind: 'assessment' as const,
        student: person(String(a.user_id)),
        assessment: assessment
          ? { id: num(assessment.id), title: String(assessment.title) }
          : null,
        course: courses.get(courseId) ?? null,
        attempt: num(a.attempt),
        score: a.score == null ? null : num(a.score),
        max_score: num(a.max_score),
        pass_mark: assessment?.pass_mark == null ? null : num(assessment.pass_mark),
        status: String(a.status),
        marker_count: markerCount.get(num(a.id)) ?? 0,
        submitted_at: a.submitted_at ? String(a.submitted_at) : null,
      };
    });

    // A cohort summary over the rows actually read. When the list is capped
    // this describes the most recent `limit`, not the whole institution --
    // hence `over_rows`, which the page prints rather than implying a census.
    const examScored = examMarks.filter((m) => m.max_marks && m.max_marks > 0);
    const examPercents = examScored.map((m) => (m.final_marks / m.max_marks!) * 100);
    const examPassable = examScored.filter((m) => m.pass_marks != null);
    const assessScored = assessmentGrades
      .filter((g) => g.score != null && g.max_score > 0);
    const assessPercents = assessScored.map((g) => (g.score! / g.max_score) * 100);
    const assessPassable = assessScored.filter((g) => g.pass_mark != null);
    const rate = (hits: number, of: number) =>
      (of === 0 ? null : Math.round((hits / of) * 1000) / 10);

    const summary = {
      exams: {
        count: examMarks.length,
        mean_percent: mean(examPercents),
        mean_marks: mean(examScored.map((m) => m.final_marks)),
        pass_rate: rate(examPassable.filter((m) => m.final_marks >= m.pass_marks!).length,
          examPassable.length),
        published: examMarks.filter((m) => m.status === 'published').length,
        over_rows: examMarks.length,
      },
      assessments: {
        count: assessmentGrades.length,
        mean_percent: mean(assessPercents),
        pass_rate: rate(
          assessPassable.filter((g) => (g.score! / g.max_score) * 100 >= g.pass_mark!).length,
          assessPassable.length),
        over_rows: assessmentGrades.length,
      },
    };

    await this.#log(actorId, 'tenant.grades_read', 'tenant', num(tenant.id), null, {
      slug: tenant.slug,
      exam_marks_read: examMarks.length,
      assessment_grades_read: assessmentGrades.length,
      limit,
      exam_id: opts.examId ?? null,
      assessment_id: opts.assessmentId ?? null,
    });

    return {
      tenant: { id: num(tenant.id), name: String(tenant.name), slug: String(tenant.slug) },
      limit,
      capped: {
        exam_marks: !scoped && (markQ.data ?? []).length > limit,
        assessment_grades: !scoped && (attemptQ.data ?? []).length > limit,
      },
      exam_marks: examMarks,
      assessment_grades: assessmentGrades,
      summary,
    };
  }

  /**
   * The same shape public signup uses (tenancy.service.ts's createTenant),
   * duplicated rather than shared: signup's version is deliberately
   * unauthenticated, because that is how the first institution can exist at
   * all. This one is deliberately gated, because an operator provisioning an
   * institution on someone's behalf is a different act worth its own audit
   * entry, not the same code path with the door left open.
   */
  async createTenant(input: {
    name: string; slug?: string; plan?: string | null;
    admin: { name: string; email: string; password: string };
  }, actorId: string | null) {
    const slug = slugify(input.slug ?? input.name);
    if (!slug) throw new HttpError(422, 'That name does not make a usable address.');
    const { data: clash } = await this.#db.from('onyx_tenants')
      .select('id').eq('slug', slug).maybeSingle();
    if (clash) throw new HttpError(422, 'An institution with that address already exists.');

    /*
     * Open to self-signup from the moment it exists (0046) -- named here
     * explicitly rather than left to the column default, because this is the
     * route the operator console actually calls to bring a new institution
     * onto the platform, and whether that institution can be found and
     * joined by a stranger typing their own name and email is a decision
     * that should be visible at the point of creation, not implicit three
     * migrations away.
     */
    const { data: tenant, error } = await this.#db.from('onyx_tenants').insert({
      name: input.name.trim(), slug, status: 1, plan: input.plan ?? null,
      student_signup: true, signup_mode: 'open',
    }).select(TENANT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the institution: ' + error.message);

    const email = input.admin.email.trim().toLowerCase();
    const { data: existingUser } = await this.#db.from('onyx_users')
      .select('id, email, name').eq('email', email).maybeSingle();
    let admin = existingUser;
    if (!admin) {
      // Supabase Auth owns the credential now -- see tenancy.service.ts's
      // upsertUser(), the same pattern duplicated here for the reason the
      // doc comment above gives.
      const { data: authUser, error: authError } = await onyxAuthAdmin().auth.admin.createUser({
        email, password: input.admin.password, email_confirm: true,
      });
      if (authError || !authUser?.user) {
        throw new HttpError(500, 'Could not create the account: ' + (authError?.message ?? 'unknown error'));
      }
      const { data: created } = await this.#db.from('onyx_users').insert({
        id: authUser.user.id, email, name: input.admin.name.trim(), status: 1,
      }).select('id, email, name').maybeSingle();
      admin = created!;
    }
    await this.#db.from('onyx_memberships').insert({
      tenant_id: Number(tenant!.id), user_id: admin!.id, role: 'admin', status: 1,
    });

    await this.#log(actorId, 'tenant.created', 'tenant', Number(tenant!.id),
      null, { name: tenant!.name, slug: tenant!.slug, provisioned_by: 'platform' });
    return { tenant, admin: { id: admin!.id, email: admin!.email } };
  }

  /**
   * Permanently remove an institution and everything in it.
   *
   * Every one of the 75 onyx_* tables carries `tenant_id` with `ON DELETE
   * CASCADE` back to onyx_tenants (verified against the schema, not assumed --
   * see the tenant-purge work this same guarantee was checked for). Deleting
   * the tenant row is deleting all of it: every membership, course,
   * enrolment, mark, invoice. onyx_users is the one exception, by design --
   * identities are global, so a person who also belongs to another
   * institution keeps existing; only their membership here is gone with it.
   *
   * `confirmName` has to match the institution's name exactly, the same
   * "type it to confirm" shape as GitHub's repo delete: a click is reversible
   * by nobody meaning to, typing the name is a second, deliberate act.
   * suspend() already exists for "stop this without destroying it" -- this is
   * the other thing, and it does not ask twice in the API, only once, hard.
   */
  async deleteTenant(id: number, actorId: string | null, confirmName: string) {
    const { data: tenant } = await this.#db.from('onyx_tenants')
      .select(TENANT_COLUMNS).eq('id', id).maybeSingle();
    if (!tenant) throw new HttpError(404, 'No such institution.');
    if (confirmName.trim() !== tenant.name) {
      throw new HttpError(422, 'That does not match the institution\'s name.');
    }
    const { error } = await this.#db.from('onyx_tenants').delete().eq('id', id);
    if (error) throw new HttpError(500, 'Could not delete the institution: ' + error.message);
    await this.#log(actorId, 'tenant.deleted', 'tenant', id,
      { name: tenant.name, slug: tenant.slug, plan: tenant.plan }, null);
    return { ok: true };
  }

  async suspend(id: number, actorId: string | null) {
    const before = await this.tenant(id);
    const { data } = await this.#db.from('onyx_tenants')
      .update({ status: 0, updated_at: new Date().toISOString() })
      .eq('id', id).select(TENANT_COLUMNS).maybeSingle();
    await this.#log(actorId, 'tenant.suspended', 'tenant', id,
      { status: before.status }, { status: 0 });
    return data;
  }

  /**
   * One institution's permission matrix, set from the platform console.
   *
   * The same write an administrator makes from their own Settings, recorded in
   * the PLATFORM log instead of the tenant's -- an operator editing a
   * customer's permissions is an act of the platform, and it belongs where the
   * other things operators do to institutions are already written down.
   */
  async setPermissions(id: number, actorId: string | null, overrides: unknown) {
    const before = await this.tenant(id);
    const { data } = await this.#db.from('onyx_tenants')
      .update({ permissions: overrides as never, updated_at: new Date().toISOString() })
      .eq('id', id).select(TENANT_COLUMNS).maybeSingle();
    await this.#log(actorId, 'tenant.updated', 'tenant', id,
      { permissions: before?.permissions ?? {} }, { permissions: overrides });
    return data;
  }

  async activate(id: number, actorId: string | null) {
    const before = await this.tenant(id);
    const { data } = await this.#db.from('onyx_tenants')
      .update({ status: 1, updated_at: new Date().toISOString() })
      .eq('id', id).select(TENANT_COLUMNS).maybeSingle();
    await this.#log(actorId, 'tenant.activated', 'tenant', id,
      { status: before.status }, { status: 1 });
    return data;
  }

  // -------------------------------------------------------------------------
  // Editing inside an institution
  //
  // Everything above this line only ever read another institution's records.
  // These write to them -- the same trust boundary as suspend()/activate()
  // above (service-role client, tenant_id as the only filter, no RLS backstop),
  // extended from "flip a status bit" to "change what is there". Every write
  // is audited with before/after, the same as a grant or a revoke, because an
  // operator changing a customer's data without a trace would be
  // indistinguishable from someone else changing it.
  // -------------------------------------------------------------------------

  /** Edit a tenant's own identity: its name, its address, or its plan label. */
  /**
   * Edit an institution from the console.
   *
   * `community_url` is here because it was reachable ONLY from an institution's
   * own Settings screen, so an operator could not set the link for an
   * institution whose administrator had not got round to it -- and the Jobs
   * page simply showed no button, with nothing anywhere saying why.
   *
   * Validated by the same `normaliseCommunityUrl` the institution's own route
   * uses rather than a second check written here. The check is what stops
   * `javascript:` reaching an anchor, and a security check with two
   * implementations has one that is out of date.
   */
  async updateTenant(id: number, actorId: string | null, patch: {
    name?: string; slug?: string; plan?: string | null;
    community_url?: string | null; community_label?: string | null;
    /**
     * Whether this institution takes registrations, and how.
     *
     * The console could not see either, let alone change them, which made a
     * real support request unanswerable: a learner asks why their institution
     * is missing from the sign-up list, and the operator looking at seven
     * institutions cannot tell which of them accept registrations, cannot see
     * why, and cannot switch one on without being handed that institution's
     * own administrator account. The institution's own Settings screen has
     * had this switch since it existed; the console had no view of it at all.
     *
     * `student_signup` is whether; `signup_mode` is how -- `domain` means the
     * address decides, `open` means anybody may pick this institution from
     * the list and join at once. An institution appears on that public list
     * only when both are set, which is deliberate: the only check behind an
     * open registration is the code emailed to the address.
     */
    student_signup?: boolean;
    signup_domains?: string;
    signup_mode?: 'domain' | 'open';
  }) {
    const { data: tenant } = await this.#db.from('onyx_tenants')
      .select(TENANT_COLUMNS).eq('id', id).maybeSingle();
    if (!tenant) throw new HttpError(404, 'No such institution.');

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== tenant.name) {
      before.name = tenant.name; after.name = patch.name.trim();
    }
    if (patch.slug !== undefined) {
      const slug = slugify(patch.slug);
      if (!slug) throw new HttpError(422, 'That address is not usable.');
      if (slug !== tenant.slug) {
        const { data: clash } = await this.#db.from('onyx_tenants')
          .select('id').eq('slug', slug).neq('id', id).maybeSingle();
        if (clash) throw new HttpError(422, 'An institution with that address already exists.');
        before.slug = tenant.slug; after.slug = slug;
      }
    }
    if (patch.plan !== undefined && patch.plan !== tenant.plan) {
      before.plan = tenant.plan; after.plan = patch.plan;
    }
    if (patch.community_url !== undefined) {
      const url = normaliseCommunityUrl(patch.community_url);
      if (url !== tenant.community_url) {
        before.community_url = tenant.community_url; after.community_url = url;
      }
    }
    if (patch.community_label !== undefined) {
      const label = String(patch.community_label ?? '').trim() || null;
      if (label !== tenant.community_label) {
        before.community_label = tenant.community_label; after.community_label = label;
      }
    }
    /*
     * The registration policy, cleaned the same way the institution's own
     * screen cleans it.
     *
     * Delegated to TenancyService.setSignupPolicy rather than written here:
     * that method is where "how a domain list is parsed" lives -- commas or
     * whitespace, a leading @ dropped, a leading *. kept because it means
     * subdomains only -- and a second copy of that in the console is how the
     * two screens come to disagree about what "meridian.edu ashcroft.ac"
     * means.
     */
    let policy: typeof tenant | null = null;
    if (patch.student_signup !== undefined || patch.signup_domains !== undefined
      || patch.signup_mode !== undefined) {
      if (!this.#tenancy) {
        throw new HttpError(500, 'The tenancy service is not available here.');
      }
      before.student_signup = tenant.student_signup;
      before.signup_mode = tenant.signup_mode;
      before.signup_domains = tenant.signup_domains;
      policy = await this.#tenancy.setSignupPolicy(
        id,
        patch.student_signup ?? Boolean(tenant.student_signup),
        patch.signup_domains ?? String(tenant.signup_domains ?? ''),
        patch.signup_mode) as typeof tenant;
      after.student_signup = policy.student_signup;
      after.signup_mode = policy.signup_mode;
      after.signup_domains = policy.signup_domains;
    }

    const rest = Object.fromEntries(Object.entries(after).filter(
      ([k]) => !['student_signup', 'signup_mode', 'signup_domains'].includes(k)));
    if (!Object.keys(after).length) return tenant;
    if (!Object.keys(rest).length) {
      await this.#log(actorId, 'tenant.updated', 'tenant', id, before, after);
      return policy ?? tenant;
    }

    const { data } = await this.#db.from('onyx_tenants')
      .update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id)
      .select(TENANT_COLUMNS).maybeSingle();
    await this.#log(actorId, 'tenant.updated', 'tenant', id, before, after);
    return data;
  }

  /** Add someone to an institution -- the platform-console version of
   * tenancy.service.ts's invite(): finds or creates the identity by email,
   * then attaches a membership. */
  async addMember(tenantId: number, actorId: string | null, input: {
    name: string; email: string; role: Role; password?: string;
    /**
     * The institution's own number for them, and the division they are taught
     * with -- both settable at the moment somebody is added.
     *
     * They were not, and the omission mattered: a student added from the
     * console arrived in NO division, which means they are dealt only the
     * papers set for everybody and quietly miss any examination set for a
     * section. Fixing that afterwards meant finding them on a second screen,
     * and nothing anywhere said it needed doing.
     */
    roll_number?: string | null;
    section_id?: number | null;
  }) {
    if (!ROLES.includes(input.role)) throw new HttpError(422, 'That is not a role.');
    const email = input.email.trim().toLowerCase();
    let { data: user } = await this.#db.from('onyx_users')
      .select('id, name, email').eq('email', email).maybeSingle();
    if (!user) {
      if (!input.password) throw new HttpError(422, 'A new account needs a password.');
      // Supabase Auth owns the credential now -- see tenancy.service.ts's
      // upsertUser().
      const { data: authUser, error: authError } = await onyxAuthAdmin().auth.admin.createUser({
        email, password: input.password, email_confirm: true,
      });
      if (authError || !authUser?.user) {
        throw new HttpError(500, 'Could not create the account: ' + (authError?.message ?? 'unknown error'));
      }
      const { data: created, error } = await this.#db.from('onyx_users').insert({
        id: authUser.user.id, email, name: input.name.trim(), status: 1,
      }).select('id, name, email').maybeSingle();
      if (error) throw new HttpError(500, 'Could not create the account: ' + error.message);
      user = created!;
    }
    const { data: existing } = await this.#db.from('onyx_memberships')
      .select('id').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
    if (existing) throw new HttpError(422, 'They are already a member of this institution.');

    /*
     * Both are checked before the membership is written, not after.
     *
     * A section from another institution would put somebody in a division
     * nobody here is in; a roll number already in use would break the register
     * it exists to order. Refusing first means no half-made member is left
     * behind for somebody to find and delete.
     */
    let sectionId: number | null = null;
    if (input.section_id != null) {
      const { data: section } = await this.#db.from('onyx_sections').select('id')
        .eq('tenant_id', tenantId).eq('id', Number(input.section_id)).maybeSingle();
      if (!section) throw new HttpError(404, 'No such section at this institution.');
      sectionId = Number(input.section_id);
    }
    const roll = input.roll_number?.trim() || null;
    if (roll) {
      const { data: taken } = await this.#db.from('onyx_memberships')
        .select('id').eq('tenant_id', tenantId).ilike('roll_number', roll).maybeSingle();
      if (taken) throw new HttpError(422, 'Somebody here already has the number ' + roll + '.');
    }

    const { data: membership, error } = await this.#db.from('onyx_memberships')
      .insert({
        tenant_id: tenantId, user_id: user.id, role: input.role, status: 1,
        roll_number: roll,
        // Only learners have one, the same rule TenancyService.addMember
        // follows: a section on a staff membership is a number nothing reads
        // and a filter that would quietly hide them.
        section_id: input.role === 'student' ? sectionId : null,
      })
      .select('id, role, status, roll_number, section_id, created_at').maybeSingle();
    if (error) throw new HttpError(500, 'Could not add them: ' + error.message);
    await this.#log(actorId, 'member.added', 'membership', Number(membership!.id), null,
      { user_id: user.id, email: user.email, role: input.role });
    return { user, membership };
  }

  /** Remove someone from an institution. The last admin cannot be removed
   * this way, same guard as tenancy.service.ts's removeMember(). */
  async removeMember(tenantId: number, membershipId: number, actorId: string | null) {
    const { data: membership } = await this.#db.from('onyx_memberships')
      .select('id, tenant_id, user_id, role').eq('id', membershipId).maybeSingle();
    if (!membership || Number(membership.tenant_id) !== tenantId) {
      throw new HttpError(404, 'No such member at this institution.');
    }
    if (membership.role === 'admin') {
      const { data: admins } = await this.#db.from('onyx_memberships')
        .select('id').eq('tenant_id', tenantId).eq('role', 'admin').eq('status', 1);
      const ids = (admins ?? []).map((a) => Number(a.id));
      if (ids.length <= 1 && ids.includes(membershipId)) {
        throw new HttpError(422, 'This is the only administrator. Appoint another first.');
      }
    }
    await this.#db.from('onyx_memberships').delete().eq('id', membershipId);
    await this.#log(actorId, 'member.removed', 'membership', membershipId,
      { user_id: membership.user_id, role: membership.role }, null);
    return { ok: true };
  }

  /**
   * Edit a member: their identity (name/email/phone/account status) and their
   * standing at this institution (role/membership status), in one call. Saved
   * together because they are one "edit" action on the People tab, but
   * audited as two different sentences -- "renamed someone" is not "made
   * someone an admin" -- so each only writes a row when it actually changed.
   */
  async updateMember(tenantId: number, membershipId: number, actorId: string | null, patch: {
    name?: string; email?: string; phone?: string | null; account_status?: number;
    role?: Role; membership_status?: number;
  }) {
    const { data: membership } = await this.#db.from('onyx_memberships')
      .select('id, tenant_id, user_id, role, status').eq('id', membershipId).maybeSingle();
    if (!membership || Number(membership.tenant_id) !== tenantId) {
      throw new HttpError(404, 'No such member at this institution.');
    }
    const userId = String(membership.user_id);
    const { data: user } = await this.#db.from('onyx_users')
      .select('id, name, email, phone, status').eq('id', userId).maybeSingle();
    if (!user) throw new HttpError(404, 'No such account.');

    // Demoting or disabling this institution's last admin from outside it
    // would leave it unrecoverable the same way removing them would -- so the
    // same guard tenancy.service.ts's changeRole() applies from inside.
    if (patch.role !== undefined && patch.role !== membership.role) {
      if (!ROLES.includes(patch.role)) throw new HttpError(422, 'That is not a role.');
      if (membership.role === 'admin') {
        const { data: admins } = await this.#db.from('onyx_memberships')
          .select('id').eq('tenant_id', tenantId).eq('role', 'admin').eq('status', 1);
        const ids = (admins ?? []).map((a) => Number(a.id));
        if (ids.length <= 1 && ids.includes(membershipId)) {
          throw new HttpError(422, 'This is the only administrator. Appoint another first.');
        }
      }
    }

    const userPatch: Record<string, unknown> = {};
    const userBefore: Record<string, unknown> = {};
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
      // entity_id is bigint (shared across every entity type this log
      // covers, most of which are still bigint-keyed) and userId is a uuid
      // since the auth migration -- carried in the payload instead of a
      // column that cannot hold it.
      await this.#log(actorId, 'user.updated', 'user', null,
        { ...userBefore, user_id: userId }, { ...userPatch, user_id: userId });
    }

    const memberPatch: Record<string, unknown> = {};
    const memberBefore: Record<string, unknown> = {};
    if (patch.role !== undefined && patch.role !== membership.role) {
      memberBefore.role = membership.role; memberPatch.role = patch.role;
    }
    if (patch.membership_status !== undefined && patch.membership_status !== membership.status) {
      memberBefore.status = membership.status; memberPatch.status = patch.membership_status;
    }
    if (Object.keys(memberPatch).length) {
      const { error } = await this.#db.from('onyx_memberships')
        .update({ ...memberPatch, updated_at: new Date().toISOString() }).eq('id', membershipId);
      if (error) throw new HttpError(500, 'Could not update the membership: ' + error.message);
      await this.#log(actorId, 'membership.updated', 'membership', membershipId,
        memberBefore, memberPatch);
    }

    return { ok: true };
  }

  /**
   * Override one exam mark directly -- a data-entry fix or a dispute, not a
   * moderation pass across a whole paper (examinations.service's moderate()
   * stays the faculty/exams-office act, with its own delta+reason shape and
   * its own "not after publish" rule). This is the platform-level escape
   * hatch: change the number, recompute the grade band from it, and it works
   * regardless of status -- an operator resolving a dispute cannot be blocked
   * by the same publish lock that protects faculty from themselves.
   */
  async updateExamMark(tenantId: number, markId: number, actorId: string | null, patch: {
    raw_marks?: number; final_marks?: number;
  }) {
    const { data: mark } = await this.#db.from('onyx_exam_marks')
      .select('id, tenant_id, exam_id, raw_marks, final_marks, grade, grade_points, status')
      .eq('id', markId).maybeSingle();
    if (!mark || Number(mark.tenant_id) !== tenantId) throw new HttpError(404, 'No such mark.');
    const { data: exam } = await this.#db.from('onyx_exams')
      .select('max_marks, pass_marks').eq('id', mark.exam_id).maybeSingle();
    const maxMarks = Number(exam?.max_marks ?? 0);
    const passMarks = Number(exam?.pass_marks ?? 0);

    const raw = patch.raw_marks ?? Number(mark.raw_marks);
    const final = patch.final_marks ?? raw;
    if (maxMarks > 0 && (final < 0 || final > maxMarks)) {
      throw new HttpError(422, 'A mark has to be between 0 and ' + maxMarks + '.');
    }
    const band = gradeFor(final, maxMarks || 100, passMarks);

    const before = { raw_marks: mark.raw_marks, final_marks: mark.final_marks, grade: mark.grade };
    const after = {
      raw_marks: raw, final_marks: final, grade: band.grade, grade_points: band.points,
    };
    await this.#db.from('onyx_exam_marks')
      .update({ ...after, updated_at: new Date().toISOString() }).eq('id', markId);
    await this.#log(actorId, 'marks.overridden', 'exam_mark', markId, before, after);
    return { id: markId, ...after };
  }

  /** The same override, for an assessment attempt's score. */
  async updateAssessmentAttemptScore(tenantId: number, attemptId: number, actorId: string | null,
    score: number) {
    const { data: attempt } = await this.#db.from('onyx_assessment_attempts')
      .select('id, tenant_id, max_score, score').eq('id', attemptId).maybeSingle();
    if (!attempt || Number(attempt.tenant_id) !== tenantId) {
      throw new HttpError(404, 'No such attempt.');
    }
    const maxScore = Number(attempt.max_score ?? 0);
    if (maxScore > 0 && (score < 0 || score > maxScore)) {
      throw new HttpError(422, 'A score has to be between 0 and ' + maxScore + '.');
    }
    const before = { score: attempt.score };
    await this.#db.from('onyx_assessment_attempts')
      .update({ score, updated_at: new Date().toISOString() }).eq('id', attemptId);
    await this.#log(actorId, 'assessment_attempt.score_overridden', 'assessment_attempt',
      attemptId, before, { score });
    return { id: attemptId, score };
  }

  /**
   * One piece of submitted work, in full -- not the count tenantAcademics()
   * gives, the actual body and file an assignment's submission page would
   * show a marker. What an operator needs to resolve "the student says they
   * submitted this" without needing a tenant login to go look.
   */
  async submission(tenantId: number, submissionId: number) {
    const { data: row } = await this.#db.from('onyx_assignment_submissions')
      .select('id, tenant_id, assignment_id, user_id, body, file_path, status, attempt, submitted_at, is_late, score, feedback, graded_at')
      .eq('id', submissionId).maybeSingle();
    if (!row || Number(row.tenant_id) !== tenantId) throw new HttpError(404, 'No such submission.');
    const [{ data: assignment }, users] = await Promise.all([
      this.#db.from('onyx_assignments').select('id, title, total_points, course_id')
        .eq('id', row.assignment_id).maybeSingle(),
      this.#usersById([String(row.user_id)]),
    ]);
    return { ...row, student: users.get(String(row.user_id)) ?? null, assignment: assignment ?? null };
  }

  /** Every submission for one assignment, for the "view submissions" list. */
  async assignmentSubmissions(tenantId: number, assignmentId: number) {
    const { data: assignment } = await this.#db.from('onyx_assignments')
      .select('id, tenant_id, title, total_points').eq('id', assignmentId).maybeSingle();
    if (!assignment || Number(assignment.tenant_id) !== tenantId) {
      throw new HttpError(404, 'No such assignment.');
    }
    const { data: rows } = await this.#db.from('onyx_assignment_submissions')
      .select('id, user_id, status, attempt, submitted_at, is_late, score, feedback')
      .eq('tenant_id', tenantId).eq('assignment_id', assignmentId).neq('status', 'draft')
      .order('submitted_at', { ascending: false }).limit(SCAN_CAP);
    const submissions = rows ?? [];
    const users = await this.#usersById([...new Set(submissions.map((s) => String(s.user_id)))]);
    return {
      assignment: { id: num(assignment.id), title: String(assignment.title),
        total_points: num(assignment.total_points) },
      submissions: submissions.map((s) => ({
        ...s, student: users.get(String(s.user_id)) ?? null,
      })),
    };
  }

  /** Override a submission's score/feedback directly, same shape as an exam mark. */
  async updateSubmissionGrade(tenantId: number, submissionId: number, actorId: string | null,
    patch: { score?: number; feedback?: string | null }) {
    const { data: submission } = await this.#db.from('onyx_assignment_submissions')
      .select('id, tenant_id, assignment_id, score, feedback').eq('id', submissionId).maybeSingle();
    if (!submission || Number(submission.tenant_id) !== tenantId) {
      throw new HttpError(404, 'No such submission.');
    }
    const { data: assignment } = await this.#db.from('onyx_assignments')
      .select('total_points').eq('id', submission.assignment_id).maybeSingle();
    const max = Number(assignment?.total_points ?? 0);
    if (patch.score !== undefined && max > 0 && (patch.score < 0 || patch.score > max)) {
      throw new HttpError(422, 'This assignment is out of ' + max + '.');
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (patch.score !== undefined && patch.score !== submission.score) {
      before.score = submission.score; after.score = patch.score;
    }
    if (patch.feedback !== undefined && patch.feedback !== submission.feedback) {
      before.feedback = submission.feedback; after.feedback = patch.feedback;
    }
    if (!Object.keys(after).length) return submission;

    await this.#db.from('onyx_assignment_submissions').update({
      ...after, status: 'graded', updated_at: new Date().toISOString(),
    }).eq('id', submissionId);
    await this.#log(actorId, 'submission.grade_overridden', 'submission', submissionId,
      before, after);
    return { id: submissionId, ...after };
  }

  /** One assessment attempt, with the candidate's actual answers -- the "view submission" for CBT. */
  async assessmentAttempt(tenantId: number, attemptId: number) {
    const { data: row } = await this.#db.from('onyx_assessment_attempts')
      // eslint-disable-next-line max-len -- one literal: a concatenated select collapses the client's row type.
      .select('id, tenant_id, assessment_id, user_id, attempt, status, started_at, submitted_at, auto_score, manual_score, score, max_score, paper')
      .eq('id', attemptId).maybeSingle();
    if (!row || Number(row.tenant_id) !== tenantId) throw new HttpError(404, 'No such attempt.');
    const [{ data: assessment }, { data: answers }, users] = await Promise.all([
      this.#db.from('onyx_assessments').select('id, title, course_id')
        .eq('id', row.assessment_id).maybeSingle(),
      this.#db.from('onyx_assessment_answers')
        .select('id, question_id, response, auto_points, manual_points, marker_comment')
        .eq('tenant_id', tenantId).eq('attempt_id', attemptId),
      this.#usersById([String(row.user_id)]),
    ]);
    /*
     * The paper the candidate was dealt, joined to their answers.
     *
     * The answers alone are marks against bare question ids -- readable by a
     * database, useless to a person checking a result. `paper` is the snapshot
     * taken when the attempt started, so it carries the prompt and the options
     * exactly as THIS candidate saw them, which is the only version worth
     * showing: a question edited since is a different question.
     */
    const dealt = (row.paper ?? []) as unknown as {
      question_id: number; type: string; prompt: string; points: number;
      options?: { id: string; text: string }[];
    }[];
    const byQuestion = new Map((answers ?? []).map((a) => [Number(a.question_id), a]));

    // What the invigilator's console saw for the same attempt.
    const { data: events } = await this.#db.from('onyx_proctor_events')
      .select('id, kind, weight, detail, created_at')
      .eq('tenant_id', tenantId).eq('attempt_id', attemptId).order('created_at');

    return {
      ...row,
      student: users.get(String(row.user_id)) ?? null,
      assessment: assessment ?? null,
      answers: answers ?? [],
      questions: dealt.map((q) => {
        const answer = byQuestion.get(Number(q.question_id));
        return {
          question_id: q.question_id,
          type: q.type,
          prompt: q.prompt,
          points: q.points,
          options: q.options ?? [],
          response: answer?.response ?? null,
          auto_points: answer?.auto_points ?? null,
          manual_points: answer?.manual_points ?? null,
          marker_comment: answer?.marker_comment ?? null,
        };
      }),
      proctor_events: events ?? [],
      // One number an invigilator can sort by: informational events weigh 0,
      // and the ones somebody should look at weigh more.
      integrity_score: (events ?? []).reduce((n, e) => n + Number(e.weight ?? 0), 0),
    };
  }

  /** Edit a course's own fields, the same trust boundary as everything above. */
  /** Semesters, for the exam-scheduling form's dropdown -- nothing more. */
  async tenantSemesters(id: number) {
    await this.#requireTenant(id);
    const { data } = await this.#db.from('onyx_semesters')
      .select('id, name, status').eq('tenant_id', id).order('starts_on', { ascending: false });
    return data ?? [];
  }

  /**
   * Create a course from the platform console.
   *
   * A thinner copy of AcademicsService.createCourse() -- that one takes an
   * actor's role for its own tenant-side guard, which platform routes never
   * have (there is no tenant token here). Same slug/code rules, same insert
   * shape, called with the service-role client like everything else in this
   * file.
   */
  /**
   * A course, from the console.
   *
   * `access` is the part this route used to drop on the floor. Every course an
   * operator created landed on the column default -- `batch`, the institution
   * enrols you -- so a customer being set up from the console got courses no
   * learner could join and no learner could buy, and the only way to make one
   * open or paid was to sign in as that institution's own administrator.
   *
   * The rule lives in `resolveCourseAccess` rather than here: access,
   * self_enroll and price_minor are one decision, and a second copy of that
   * decision is how a course comes to say "open" on the catalogue and refuse
   * the learner who clicks it.
   */
  async createCourse(tenantId: number, actorId: string | null, input: {
    code: string; title: string; credits?: number; self_enroll?: boolean; status?: number;
    access?: CourseAccess; price_minor?: number; currency?: string;
  }) {
    const slug = slugify(input.title);
    if (!slug) throw new HttpError(422, 'That title does not make a usable address.');
    const { data, error } = await this.#db.from('onyx_courses').insert({
      tenant_id: tenantId, code: input.code.trim().toUpperCase(), title: input.title.trim(),
      slug, credits: input.credits ?? 0,
      ...resolveCourseAccess(input),
      status: input.status ?? 0, created_by: actorId,
    }).select('id, code, title, credits, status, access, price_minor, currency, created_at')
      .maybeSingle();
    if (error?.code === '23505') {
      throw new HttpError(422, 'That course code or address is already in use.');
    }
    if (error) throw new HttpError(500, 'Could not create the course: ' + error.message);
    await this.#log(actorId, 'course.created', 'course', Number(data!.id), null,
      { code: data!.code, title: data!.title });
    return data;
  }

  async updateCourse(tenantId: number, courseId: number, actorId: string | null, patch: {
    title?: string; code?: string; credits?: number; status?: number;
    access?: CourseAccess; price_minor?: number; currency?: string;
  }) {
    const { data: course } = await this.#db.from('onyx_courses')
      .select('id, tenant_id, title, code, credits, status, access, price_minor, currency')
      .eq('id', courseId).maybeSingle();
    if (!course || Number(course.tenant_id) !== tenantId) throw new HttpError(404, 'No such course.');

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ['title', 'code', 'credits', 'status'] as const) {
      const value = patch[key];
      if (value !== undefined && value !== course[key]) { before[key] = course[key]; after[key] = value; }
    }
    // Read against the course as it stands, so a price somebody already chose
    // survives a change of access -- see resolveCourseAccess.
    for (const [key, value] of Object.entries(resolveCourseAccess(patch, course))) {
      if (value !== course[key as keyof typeof course]) {
        before[key] = course[key as keyof typeof course];
        after[key] = value;
      }
    }
    if (!Object.keys(after).length) return course;
    await this.#db.from('onyx_courses')
      .update({ ...after, updated_at: new Date().toISOString() }).eq('id', courseId);
    await this.#log(actorId, 'course.updated', 'course', courseId, before, after);
    return { ...course, ...after };
  }

  /**
   * Removes a course outright, from the platform console -- an operator
   * acting on a tenant's behalf, same as createCourse/updateCourse above.
   * Everything that hangs off it cascades at the database (see
   * AcademicsService.remove()'s own comment for the full table list); a
   * question bank, assessment, problem/workspace, certificate or ticket
   * that drew on it survives with course_id set to null instead.
   */
  async deleteCourse(tenantId: number, courseId: number, actorId: string | null): Promise<void> {
    const { data: course } = await this.#db.from('onyx_courses')
      .select('id, tenant_id, title, code').eq('id', courseId).maybeSingle();
    if (!course || Number(course.tenant_id) !== tenantId) throw new HttpError(404, 'No such course.');

    const { error } = await this.#db.from('onyx_courses').delete().eq('id', courseId);
    if (error) throw new HttpError(500, 'Could not remove the course: ' + error.message);
    await this.#log(actorId, 'course.removed', 'course', courseId,
      { code: course.code, title: course.title }, null);
  }

  // ---------------------------------------------------------------------------
  // CAR-03 from the console -- credentials
  //
  // The console could stand an institution up entirely: people, courses,
  // lessons, question banks, examinations, marks. The one thing it could not do
  // was hand out the credential at the end of all that, so an operator who had
  // just published a cohort's results had to be given that institution's own
  // administrator password to issue a single certificate -- which is exactly
  // the handover the console exists to avoid.
  //
  // Delegated to CareerService rather than reimplemented. A credential id is
  // generated in one place, revocation keeps its "never deleted, keeps
  // answering" semantics in one place, and a certificate issued from the
  // console is indistinguishable from one the institution issued itself --
  // which it should be, because it is the same credential.
  //
  // What is NOT shared is the audit line: an operator reaching into a customer's
  // institution is a platform act and belongs in the platform log, against the
  // operator's name.
  // ---------------------------------------------------------------------------

  /** The institution's register of issued credentials. */
  async certificates(tenantId: number) {
    return this.#careerService().issuedCertificates(tenantId, {});
  }

  // `actorId` is required here, unlike its neighbours: a credential records
  // who issued it, and "nobody" is not an answer a verifier can act on.
  async issueCertificate(tenantId: number, actorId: string, input: {
    user_id: string; title: string;
    kind?: 'course' | 'assessment' | 'contest' | 'program';
    course_id?: number | null; expires_at?: string | null;
  }) {
    // Only somebody at this institution can hold its certificate -- the same
    // check the institution's own route makes, and the reason a uuid pasted
    // from the wrong tenant is a 422 rather than a credential nobody can
    // explain later.
    if (this.#tenancy) {
      const membership = await this.#tenancy.membership(tenantId, input.user_id);
      if (!membership) throw new HttpError(422, 'They are not at this institution.');
    }
    const certificate = await this.#careerService()
      .issueCertificate(tenantId, actorId, input);
    await this.#log(actorId, 'certificate.issued', 'certificate', num(certificate.id), null,
      { credential_id: String(certificate.credential_id), user_id: input.user_id,
        tenant_id: tenantId });
    return certificate;
  }

  async revokeCertificate(tenantId: number, id: number, actorId: string | null, reason: string) {
    const revoked = await this.#careerService().revokeCertificate(tenantId, id, reason);
    await this.#log(actorId, 'certificate.revoked', 'certificate', id,
      null, { reason, tenant_id: tenantId });
    return revoked;
  }

  /** Refuses in words rather than as a TypeError on a null. */
  #careerService(): CareerService {
    if (!this.#career) throw new HttpError(500, 'Credentials are not available here.');
    return this.#career;
  }

  async createAssignment(tenantId: number, actorId: string | null, input: {
    course_id: number; title: string; due_at?: string | null; total_points?: number;
  }) {
    const { data: course } = await this.#db.from('onyx_courses')
      .select('id').eq('tenant_id', tenantId).eq('id', input.course_id).maybeSingle();
    if (!course) throw new HttpError(404, 'No such course.');
    const total = input.total_points ?? 100;
    if (total <= 0) throw new HttpError(422, 'An assignment has to be worth something.');

    const { data, error } = await this.#db.from('onyx_assignments').insert({
      tenant_id: tenantId, course_id: input.course_id, title: input.title.trim(),
      due_at: input.due_at ?? null, total_points: total, late_policy: 'accept',
      late_penalty_percent: 0, allow_resubmission: 1, status: 'draft', created_by: actorId,
    }).select('id, title, course_id, due_at, total_points, status').maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the assignment: ' + error.message);
    await this.#log(actorId, 'assignment.created', 'assignment', Number(data!.id), null,
      { title: data!.title, course_id: input.course_id });
    return data;
  }

  async updateAssignment(tenantId: number, assignmentId: number, actorId: string | null, patch: {
    title?: string; due_at?: string | null; total_points?: number; status?: string;
  }) {
    const { data: a } = await this.#db.from('onyx_assignments')
      .select('id, tenant_id, title, due_at, total_points, status').eq('id', assignmentId).maybeSingle();
    if (!a || Number(a.tenant_id) !== tenantId) throw new HttpError(404, 'No such assignment.');

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ['title', 'due_at', 'total_points', 'status'] as const) {
      const value = patch[key];
      if (value !== undefined && value !== a[key]) { before[key] = a[key]; after[key] = value; }
    }
    if (!Object.keys(after).length) return a;
    await this.#db.from('onyx_assignments')
      .update({ ...after, updated_at: new Date().toISOString() }).eq('id', assignmentId);
    await this.#log(actorId, 'assignment.updated', 'assignment', assignmentId, before, after);
    return { ...a, ...after };
  }

  /**
   * Schedule an exam from the platform console.
   *
   * examinations.service.ts's schedule() also refuses a clash -- two papers
   * that would sit the same learner twice at once. That check exists for the
   * examinations office working one institution at a time; a platform
   * operator fixing a customer's calendar by hand is already the override
   * path, the same trust level updateExamMark() extends past a published
   * mark's normal lock. It is not skipped by accident.
   */
  async createExam(tenantId: number, actorId: string | null, input: {
    semester_id?: number | null; course_id: number; title: string; starts_at: string;
    duration_minutes?: number; max_marks?: number; pass_marks?: number;
    /** The online paper this sitting is sat through, where there is one. */
    assessment_id?: number | null;
    /** The section sitting it. Null or absent means every section. */
    section_id?: number | null;
    /** Whether the slot locks the paper (0043). Off unless asked for. */
    window_enforced?: boolean;
  }) {
    const { data: course } = await this.#db.from('onyx_courses')
      .select('id, semester_id').eq('tenant_id', tenantId).eq('id', input.course_id).maybeSingle();
    if (!course) throw new HttpError(404, 'No such course.');

    /*
     * The term, taken from the course when nobody names one.
     *
     * This route demanded a semester while the institution's own route stopped
     * doing so -- migration 0037 dropped the NOT NULL because better than a
     * quarter of the courses in this database belong to no programme, and a
     * resit or a certification sitting is still an exam. An operator was left
     * unable to schedule from the console exactly the sittings the product had
     * just been changed to allow.
     */
    let semesterId = input.semester_id ?? null;
    if (semesterId) {
      const { data: semester } = await this.#db.from('onyx_semesters')
        .select('id').eq('tenant_id', tenantId).eq('id', semesterId).maybeSingle();
      if (!semester) throw new HttpError(404, 'No such semester.');
    } else {
      semesterId = course.semester_id ? Number(course.semester_id) : null;
    }

    /*
     * The paper, if this is sat in a browser.
     *
     * Checked to be on the SAME course before anything is written. Tying a
     * sitting to a paper from another course leaves an exam half-linked to
     * somebody else's questions, and a candidate following "sit this exam"
     * lands on the wrong paper -- the tenant-side route learned this the hard
     * way and checks before it inserts, so this one does too.
     */
    if (input.assessment_id) {
      const { data: paper } = await this.#db.from('onyx_assessments')
        .select('id, course_id').eq('tenant_id', tenantId)
        .eq('id', input.assessment_id).maybeSingle();
      if (!paper) throw new HttpError(404, 'No such assessment.');
      if (Number(paper.course_id) !== Number(input.course_id)) {
        throw new HttpError(422,
          'That paper is not on this exam’s course — pick one that is, or leave it unlinked.');
      }
    }

    const start = Date.parse(input.starts_at);
    if (!Number.isFinite(start)) throw new HttpError(422, 'That is not a valid start time.');
    const maxMarks = input.max_marks ?? 100;
    const passMarks = input.pass_marks ?? 40;
    if (passMarks > maxMarks) throw new HttpError(422, 'The pass mark cannot be above the maximum.');

    const { data, error } = await this.#db.from('onyx_exams').insert({
      tenant_id: tenantId, semester_id: semesterId, course_id: input.course_id,
      assessment_id: input.assessment_id ?? null,
      section_id: input.section_id ?? null,
      title: input.title.trim(), starts_at: new Date(start).toISOString(),
      duration_minutes: input.duration_minutes ?? 180, max_marks: maxMarks, pass_marks: passMarks,
      status: 'scheduled', window_enforced: input.window_enforced ?? false,
      created_by: actorId,
    })
      // eslint-disable-next-line max-len -- one literal: a concatenated select collapses the client's row type.
      .select('id, title, course_id, section_id, semester_id, assessment_id, starts_at, duration_minutes, max_marks, pass_marks, status')
      .maybeSingle();
    if (error) throw new HttpError(500, 'Could not schedule the exam: ' + error.message);
    await this.#log(actorId, 'exam.scheduled', 'exam', Number(data!.id), null,
      { title: data!.title, starts_at: data!.starts_at });
    return data;
  }

  async updateExam(tenantId: number, examId: number, actorId: string | null, patch: {
    title?: string; starts_at?: string | null; duration_minutes?: number;
    max_marks?: number; pass_marks?: number; status?: string;
    /** Whether the slot locks the paper (0043). */
    window_enforced?: boolean;
  }) {
    /*
     * `course_id` and `assessment_id` are read but never patched.
     *
     * They are here because the caller needs them after the write: moving a
     * sitting has to move the window of the online paper it is sat on, and
     * that re-sync needs to know which paper and on which course. The loop
     * below only ever writes the six keys it names, so widening this select
     * changes nothing about what is saved.
     */
    // eslint-disable-next-line max-len -- one literal; a concatenated select collapses the row type.
    const { data: e } = await this.#db.from('onyx_exams')
      .select('id, tenant_id, course_id, assessment_id, title, starts_at, duration_minutes, max_marks, pass_marks, status, window_enforced')
      .eq('id', examId).maybeSingle();
    if (!e || Number(e.tenant_id) !== tenantId) throw new HttpError(404, 'No such exam.');

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of
      ['title', 'starts_at', 'duration_minutes', 'max_marks', 'pass_marks', 'status',
        'window_enforced'] as const) {
      const value = patch[key];
      if (value !== undefined && value !== e[key]) { before[key] = e[key]; after[key] = value; }
    }
    if (!Object.keys(after).length) return e;
    await this.#db.from('onyx_exams')
      .update({ ...after, updated_at: new Date().toISOString() }).eq('id', examId);
    await this.#log(actorId, 'exam.updated', 'exam', examId, before, after);
    return { ...e, ...after };
  }

  /** A basic assessment -- no sections/proctoring here, same as any assessment
   * created without a question bank on hand. Course faculty add sections once
   * a bank exists; this just gets it on the calendar. */
  /**
   * A paper, with the switches that decide how it is sat.
   *
   * These existed on the paper all along and only faculty could reach them, so
   * a paper created from the console was unproctored, unshuffled and
   * unchangeable from here -- and nothing on the screen said so. An operator
   * scheduling an examination got an open-book one.
   *
   * The defaults are not faculty's. A paper set by faculty is usually
   * coursework and monitoring is opt-in; a paper set from the console is an
   * institution's examination, so monitoring, camera and screen sharing are ON
   * unless the operator turns them off, and the form shows them ticked rather
   * than applying them invisibly.
   */
  async createAssessment(tenantId: number, actorId: string | null, input: {
    course_id?: number | null; title: string; opens_at?: string | null;
    closes_at?: string | null; duration_minutes?: number; pass_mark?: number | null;
    attempts_allowed?: number;
    /** The section this paper is set for. Null or absent means every section. */
    section_id?: number | null;
    /** Departures allowed before the paper is handed in. Zero is off. */
    breach_limit?: number;
    shuffle_questions?: boolean; shuffle_options?: boolean;
    proctoring?: boolean; require_camera?: boolean; require_screen?: boolean;
    watch_camera?: boolean; anonymous_marking?: boolean; moderation_required?: boolean;
    instant_results?: boolean;
  }) {
    if (input.course_id) {
      const { data: course } = await this.#db.from('onyx_courses')
        .select('id').eq('tenant_id', tenantId).eq('id', input.course_id).maybeSingle();
      if (!course) throw new HttpError(404, 'No such course.');
    }
    const duration = input.duration_minutes ?? 60;
    if (duration < 1 || duration > 1440) throw new HttpError(422, 'That is not a usable duration.');
    if (input.opens_at && input.closes_at
      && Date.parse(input.closes_at) <= Date.parse(input.opens_at)) {
      throw new HttpError(422, 'The window closes before it opens.');
    }

    /*
     * `?? true` for the monitoring three, `?? false` for the rest.
     *
     * An absent field means the caller did not say, and what to do then differs
     * per switch: an examination is monitored unless somebody decides otherwise,
     * while nobody is put on the other end of a camera by omission. `=== false`
     * would be wrong here -- it cannot tell "unticked" from "not sent", and the
     * form sends every switch every time precisely so it can.
     */
    const flag = (v: boolean | undefined, fallback: boolean) => (v === undefined
      ? Number(fallback) : Number(Boolean(v)));

    const { data, error } = await this.#db.from('onyx_assessments').insert({
      tenant_id: tenantId, course_id: input.course_id ?? null, title: input.title.trim(),
      section_id: input.section_id ?? null,
      opens_at: input.opens_at ?? null, closes_at: input.closes_at ?? null,
      duration_minutes: duration,
      attempts_allowed: input.attempts_allowed ?? 1,
      pass_mark: input.pass_mark ?? null,
      shuffle_questions: flag(input.shuffle_questions, true),
      shuffle_options: flag(input.shuffle_options, true),
      proctoring: flag(input.proctoring, true),
      require_camera: flag(input.require_camera, true),
      require_screen: flag(input.require_screen, true),
      // A live camera feed is the one switch here with a person on the other
      // end of it, and an invigilator watching is the point of an invigilated
      // examination -- so it follows monitoring rather than sitting off.
      watch_camera: flag(input.watch_camera, true),
      anonymous_marking: flag(input.anonymous_marking, true),
      moderation_required: flag(input.moderation_required, false),
      instant_results: flag(input.instant_results, true),
      status: 'draft', created_by: actorId,
      // Three: warn, warn, hand it in. An institution setting a paper from the
      // console means an examination, and this is the rule they asked for.
      breach_limit: input.breach_limit ?? 3,
      // With `section_id`: the row is written with one and the response did
      // not carry it back, so nothing could confirm which division a paper had
      // just been set for -- including the form that had only asked.
    }).select('id, title, course_id, section_id, opens_at, closes_at, status').maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the assessment: ' + error.message);
    await this.#log(actorId, 'assessment.created', 'assessment', Number(data!.id), null,
      { title: data!.title, course_id: input.course_id ?? null });
    return data;
  }

  /**
   * Edit a paper, its monitoring switches included.
   *
   * A switch is stored as 0/1 and arrives as a boolean, so the comparison that
   * decides "did this change" has to be made on the same footing -- otherwise
   * `true !== 1` is always true and every save rewrites every switch and logs a
   * change nobody made.
   */
  async updateAssessment(tenantId: number, assessmentId: number, actorId: string | null, patch: {
    title?: string; opens_at?: string | null; closes_at?: string | null;
    pass_mark?: number | null; duration_minutes?: number; status?: string;
    attempts_allowed?: number;
    shuffle_questions?: boolean; shuffle_options?: boolean;
    proctoring?: boolean; require_camera?: boolean; require_screen?: boolean;
    watch_camera?: boolean; anonymous_marking?: boolean; moderation_required?: boolean;
    instant_results?: boolean;
    /**
     * Departures allowed before the paper is handed in. Zero is off.
     *
     * Changeable after the fact on purpose: every paper written before 0040
     * has it at zero, and an institution deciding to apply the rule should not
     * have to rebuild the paper to do it.
     */
    breach_limit?: number;
  }) {
    // eslint-disable-next-line max-len -- one literal; a concatenated select collapses the row type.
    const { data: a } = await this.#db.from('onyx_assessments').select('id, tenant_id, title, opens_at, closes_at, pass_mark, duration_minutes, attempts_allowed, breach_limit, status, shuffle_questions, shuffle_options, proctoring, require_camera, require_screen, watch_camera, anonymous_marking, moderation_required, instant_results').eq('id', assessmentId).maybeSingle();
    if (!a || Number(a.tenant_id) !== tenantId) throw new HttpError(404, 'No such assessment.');

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of
      ['title', 'opens_at', 'closes_at', 'pass_mark', 'duration_minutes',
        // A number, not a switch: it goes in the first loop, where a value is
        // compared as it is rather than coerced to 0 or 1.
        'attempts_allowed', 'breach_limit', 'status'] as const) {
      const value = patch[key];
      if (value !== undefined && value !== a[key]) { before[key] = a[key]; after[key] = value; }
    }
    for (const key of
      ['shuffle_questions', 'shuffle_options', 'proctoring', 'require_camera',
        'require_screen', 'watch_camera', 'anonymous_marking', 'moderation_required',
        'instant_results'] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      const now = Number(Boolean(value));
      if (now !== Number(a[key] ?? 0)) { before[key] = a[key]; after[key] = now; }
    }
    if (!Object.keys(after).length) return a;
    await this.#db.from('onyx_assessments')
      .update({ ...after, updated_at: new Date().toISOString() }).eq('id', assessmentId);
    await this.#log(actorId, 'assessment.updated', 'assessment', assessmentId, before, after);
    return { ...a, ...after };
  }

  // -------------------------------------------------------------------------
  // Fees (CMP-03) -- fee heads, structures and what is outstanding. Not read
  // through FinanceService: every one of its methods takes an `actor`/`viewer`
  // shaped for a tenant token's role, which platform routes never have (same
  // reason every other method in this file writes its own queries).
  // -------------------------------------------------------------------------

  /** Heads, structures (with their line totals) and what is outstanding, in
   * one call -- the platform Fees page is one screen, not three round trips. */
  async tenantFees(id: number) {
    const tenant = await this.#requireTenant(id);
    const [{ data: heads }, { data: structures }, { data: lines }, { data: invoices }] =
      await Promise.all([
        this.#db.from('onyx_fee_heads')
          .select('id, code, name, category, refundable').eq('tenant_id', id)
          .order('code', { ascending: true }),
        this.#db.from('onyx_fee_structures')
          .select('id, name, currency, instalments, status, created_at').eq('tenant_id', id)
          .order('created_at', { ascending: false }),
        this.#db.from('onyx_fee_structure_lines')
          .select('structure_id, amount_minor').eq('tenant_id', id).limit(SCAN_CAP),
        this.#db.from('onyx_invoices')
          .select('id, user_id, structure_id, number, total_minor, paid_minor, status, due_at')
          .eq('tenant_id', id).in('status', ['issued', 'part_paid'])
          .order('due_at', { ascending: true, nullsFirst: false }).limit(ROW_CAP),
      ]);

    const totalByStructure = new Map<number, number>();
    for (const l of lines ?? []) {
      const s = num(l.structure_id);
      totalByStructure.set(s, (totalByStructure.get(s) ?? 0) + num(l.amount_minor));
    }
    const rows = invoices ?? [];
    const users = await this.#usersById([...new Set(rows.map((r) => String(r.user_id)))]);
    const now = Date.now();

    return {
      tenant: { id: num(tenant.id), name: String(tenant.name), slug: String(tenant.slug) },
      heads: heads ?? [],
      structures: (structures ?? []).map((s) => ({
        ...s, total_minor: totalByStructure.get(num(s.id)) ?? 0,
      })),
      outstanding: {
        total_minor: rows.reduce((sum, r) => sum + (num(r.total_minor) - num(r.paid_minor)), 0),
        invoices: rows.map((r) => ({
          ...r,
          student: users.get(String(r.user_id)) ?? null,
          balance_minor: num(r.total_minor) - num(r.paid_minor),
          overdue: Boolean(r.due_at && Date.parse(String(r.due_at)) < now),
        })),
      },
    };
  }

  async createFeeHead(tenantId: number, actorId: string | null, input: {
    code: string; name: string;
    category?: 'tuition' | 'exam' | 'hostel' | 'transport' | 'library' | 'misc';
    refundable?: boolean;
  }) {
    const code = input.code.trim().toUpperCase();
    if (!code) throw new HttpError(422, 'A fee head needs a code.');
    const { data, error } = await this.#db.from('onyx_fee_heads').insert({
      tenant_id: tenantId, code, name: input.name.trim(),
      category: input.category ?? 'tuition', refundable: input.refundable ? 1 : 0,
    }).select('id, code, name, category, refundable').maybeSingle();
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw new HttpError(409, 'A fee head with the code ' + code + ' already exists.');
      }
      throw new HttpError(500, 'Could not create the fee head: ' + error.message);
    }
    await this.#log(actorId, 'fee_head.created', 'fee_head', Number(data!.id), null,
      { code: data!.code, name: data!.name });
    return data;
  }

  async createFeeStructure(tenantId: number, actorId: string | null, input: {
    name: string; instalments?: number; currency?: string;
    lines: { head_id: number; amount_minor: number }[];
  }) {
    if (!input.lines.length) throw new HttpError(422, 'A fee structure needs at least one line.');
    const instalments = input.instalments ?? 1;
    if (instalments < 1 || instalments > 12) {
      throw new HttpError(422, 'Instalments must be between 1 and 12.');
    }
    const { data: heads } = await this.#db.from('onyx_fee_heads')
      .select('id').eq('tenant_id', tenantId);
    const known = new Set((heads ?? []).map((h) => Number(h.id)));
    for (const line of input.lines) {
      if (!known.has(Number(line.head_id))) {
        throw new HttpError(422, 'No such fee head: ' + line.head_id + '.');
      }
      if (!Number.isInteger(line.amount_minor) || line.amount_minor < 0) {
        throw new HttpError(422, 'An amount is a whole number of paise, and not negative.');
      }
    }

    const { data, error } = await this.#db.from('onyx_fee_structures').insert({
      tenant_id: tenantId, name: input.name.trim(), currency: input.currency ?? 'INR',
      instalments, status: 'draft',
    }).select('id, name, currency, instalments, status, created_at').maybeSingle();
    if (error || !data) {
      throw new HttpError(500, 'Could not create the structure: ' + (error?.message ?? 'no row'));
    }
    const { error: lineError } = await this.#db.from('onyx_fee_structure_lines').insert(
      input.lines.map((l) => ({
        tenant_id: tenantId, structure_id: Number(data.id),
        head_id: l.head_id, amount_minor: l.amount_minor,
      })));
    if (lineError) throw new HttpError(500, 'Could not write the lines: ' + lineError.message);

    await this.#log(actorId, 'fee_structure.created', 'fee_structure', Number(data.id), null,
      { name: data.name, lines: input.lines.length });
    return data;
  }

  /** A structure moves out of draft once it can be invoiced against -- the
   * same "status is the delete equivalent" pattern as courses/assignments/
   * assessments/exams: nothing here is ever hard-deleted once it might be
   * referenced by an invoice, so the platform surface for retiring one is
   * the same status flip the tenant side uses. */
  async updateFeeStructureStatus(tenantId: number, structureId: number, actorId: string | null,
    status: 'draft' | 'published' | 'archived') {
    const { data: structure } = await this.#db.from('onyx_fee_structures')
      .select('id, tenant_id, status').eq('id', structureId).maybeSingle();
    if (!structure || Number(structure.tenant_id) !== tenantId) {
      throw new HttpError(404, 'No such fee structure.');
    }
    if (structure.status === status) return structure;
    await this.#db.from('onyx_fee_structures')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', structureId);
    await this.#log(actorId, 'fee_structure.status_changed', 'fee_structure', structureId,
      { status: structure.status }, { status });
    return { ...structure, status };
  }

  // -------------------------------------------------------------------------

  async auditLog(filters: { limit?: number; action?: string; entityType?: string } = {}) {
    let q = this.#db.from('onyx_platform_audit_logs')
      .select('id, actor_id, action, entity_type, entity_id, before, after, created_at');
    if (filters.action) q = q.eq('action', filters.action);
    if (filters.entityType) q = q.eq('entity_type', filters.entityType);
    const { data } = await q.order('created_at', { ascending: false }).limit(filters.limit ?? 100);
    const rows = data ?? [];
    if (!rows.length) return [];

    const actors = await this.#usersById([...new Set(
      rows.map((r) => r.actor_id).filter((id): id is string => id != null).map(String))]);
    return rows.map((r) => ({
      ...r, actor: r.actor_id == null ? null : actors.get(String(r.actor_id)) ?? null,
    }));
  }

  /**
   * Every distinct action and entity type recorded, for the audit page's two
   * filter dropdowns -- read off the data itself, not guessed from splitting
   * the action string on its dot (that undercounts: "marks.overridden"'s
   * entity_type is "exam_mark", not "marks" -- the column is the only source
   * of truth for what #log() actually wrote).
   */
  async auditFilterOptions() {
    const { data } = await this.#db.from('onyx_platform_audit_logs')
      .select('action, entity_type').limit(5000);
    const rows = data ?? [];
    return {
      actions: [...new Set(rows.map((r) => String(r.action)))].sort(),
      entityTypes: [...new Set(rows.map((r) => String(r.entity_type)))].sort(),
    };
  }

  /**
   * Write a platform audit row for work another service did.
   *
   * Most methods here log their own act. A few platform ROUTES delegate to a
   * tenant-side service -- setting one person's permissions, say -- and still
   * owe the record: an operator changing a customer's institution is an act of
   * the platform, and it belongs in the platform's log rather than the
   * institution's.
   */
  async recordAction(actorId: string | null, action: string, entityType: string,
    entityId: number | null, before: unknown, after: unknown) {
    await this.#log(actorId, action, entityType, entityId, before, after);
  }

  async #log(actorId: string | null, action: string, entityType: string, entityId: number | null,
    before: unknown, after: unknown) {
    // Never throw: an audit row describes work that already happened.
    await this.#db.from('onyx_platform_audit_logs').insert({
      actor_id: actorId, action, entity_type: entityType, entity_id: entityId,
      before: before as never, after: after as never,
    });
  }

  // -------------------------------------------------------------------------
  // Live Classes, and the modules inside a course
  //
  // Both exist on the institution side and neither was reachable from the
  // platform console, so an operator standing an institution up had to sign in
  // AS that institution to finish the job. For Live Classes there was no
  // console route at all -- the section simply was not there.
  // -------------------------------------------------------------------------

  /** Every Live Class, published or not: the console is the operator's view. */
  async domains(tenantId: number) {
    const { data } = await this.#db.from('onyx_domains')
      // eslint-disable-next-line max-len -- one literal: a concatenated select collapses the client's row type to an error type.
      .select('id, tenant_id, title, summary, curriculum_url, image_path, certificate, duration_label, price_minor, currency, sort, status, created_at')
      .eq('tenant_id', tenantId).order('sort').order('id');
    return data ?? [];
  }

  async createDomain(tenantId: number, actorId: string | null, input: {
    title: string; summary?: string | null; curriculum_url?: string | null;
    certificate?: string | null; duration_label?: string | null;
    price_minor?: number; sort?: number; status?: number;
    /** A storage KEY from the sign route, never a URL. See DomainsService. */
    image_path?: string | null;
  }) {
    const { data, error } = await this.#db.from('onyx_domains').insert({
      tenant_id: tenantId,
      title: input.title.trim(),
      summary: input.summary ?? '',
      curriculum_url: normaliseCurriculumUrl(input.curriculum_url),
      image_path: input.image_path ?? null,
      certificate: input.certificate ?? '',
      duration_label: input.duration_label ?? '',
      price_minor: input.price_minor ?? 0,
      sort: input.sort ?? 0,
      // Draft by default, exactly as a course is. A Live Class appearing on
      // every learner's screen the instant somebody typed a title is not a
      // default anyone would choose deliberately.
      status: input.status ?? 0,
      created_by: actorId,
    }).select('id, title, status, price_minor').maybeSingle();
    if (error) throw new HttpError(500, 'Could not create that Live Class: ' + error.message);
    await this.#log(actorId, 'domain.created', 'domain', Number(data!.id), null,
      { title: data!.title });
    return data;
  }

  async updateDomain(tenantId: number, domainId: number, actorId: string | null, patch: {
    title?: string; summary?: string | null; curriculum_url?: string | null;
    certificate?: string | null; duration_label?: string | null;
    price_minor?: number; sort?: number; status?: number;
    image_path?: string | null;
  }) {
    const before = await this.#domainRow(tenantId, domainId);
    const next: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.summary !== undefined) next.summary = patch.summary ?? '';
    if (patch.curriculum_url !== undefined) {
      next.curriculum_url = normaliseCurriculumUrl(patch.curriculum_url);
    }
    if (patch.image_path !== undefined) next.image_path = patch.image_path ?? null;
    if (patch.certificate !== undefined) next.certificate = patch.certificate ?? '';
    if (patch.duration_label !== undefined) next.duration_label = patch.duration_label ?? '';
    if (patch.price_minor !== undefined) next.price_minor = patch.price_minor;
    if (patch.sort !== undefined) next.sort = patch.sort;
    if (patch.status !== undefined) next.status = patch.status;

    const { error } = await this.#db.from('onyx_domains')
      .update(next).eq('tenant_id', tenantId).eq('id', domainId);
    if (error) throw new HttpError(500, 'Could not update that Live Class: ' + error.message);
    await this.#log(actorId, 'domain.updated', 'domain', domainId,
      { title: before.title, status: before.status }, next);
    return this.#domainRow(tenantId, domainId);
  }

  async removeDomain(tenantId: number, domainId: number, actorId: string | null) {
    const before = await this.#domainRow(tenantId, domainId);
    const { error } = await this.#db.from('onyx_domains')
      .delete().eq('tenant_id', tenantId).eq('id', domainId);
    if (error) throw new HttpError(500, 'Could not remove that Live Class: ' + error.message);
    await this.#log(actorId, 'domain.deleted', 'domain', domainId,
      { title: before.title }, null);
    return { id: domainId, removed: true };
  }

  async #domainRow(tenantId: number, domainId: number) {
    const { data } = await this.#db.from('onyx_domains')
      // eslint-disable-next-line max-len -- one literal, same reason as above.
      .select('id, tenant_id, title, summary, curriculum_url, certificate, duration_label, price_minor, currency, sort, status')
      .eq('tenant_id', tenantId).eq('id', domainId).maybeSingle();
    if (!data) throw new HttpError(404, 'No Live Class at that address.');
    return data;
  }

  /**
   * One course as an operator needs to see it: its modules, and the lessons
   * inside each.
   *
   * The console could create a course and rename it and never open it, so
   * "add a module" had nowhere to happen.
   */
  async courseOutline(tenantId: number, courseId: number) {
    const { data: course } = await this.#db.from('onyx_courses')
      .select('id, code, title, credits, status, access, price_minor, currency, slug')
      .eq('tenant_id', tenantId).eq('id', courseId).maybeSingle();
    if (!course) throw new HttpError(404, 'No such course.');

    const { data: modules } = await this.#db.from('onyx_modules')
      .select('id, course_id, title, summary, sort')
      .eq('tenant_id', tenantId).eq('course_id', courseId).order('sort').order('id');
    const { data: lessons } = await this.#db.from('onyx_lessons')
      .select('id, module_id, title, type, duration_seconds, sort, is_preview')
      .eq('tenant_id', tenantId).eq('course_id', courseId).order('sort').order('id');

    const byModule = new Map<number, Record<string, unknown>[]>();
    for (const l of lessons ?? []) {
      const key = Number(l.module_id);
      byModule.set(key, [...(byModule.get(key) ?? []), l as Record<string, unknown>]);
    }
    return {
      course,
      modules: (modules ?? []).map((m) => ({
        ...m, lessons: byModule.get(Number(m.id)) ?? [],
      })),
    };
  }

  async createCourseModule(tenantId: number, courseId: number, actorId: string | null, input: {
    title: string; summary?: string | null; sort?: number;
  }) {
    const { data: course } = await this.#db.from('onyx_courses')
      .select('id').eq('tenant_id', tenantId).eq('id', courseId).maybeSingle();
    if (!course) throw new HttpError(404, 'No such course.');

    // Appended, not stacked at zero. Every module created from here would
    // otherwise share sort 0, and the order a learner reads them in would be
    // whatever the database felt like that day.
    let sort = input.sort;
    if (sort === undefined) {
      const { data: existing } = await this.#db.from('onyx_modules')
        .select('sort').eq('tenant_id', tenantId).eq('course_id', courseId);
      sort = (existing ?? []).reduce((max, m) => Math.max(max, Number(m.sort ?? 0)), -1) + 1;
    }

    const { data, error } = await this.#db.from('onyx_modules').insert({
      tenant_id: tenantId, course_id: courseId,
      title: input.title.trim(), summary: input.summary ?? null, sort,
      // The operator who did it (0042). They hold no membership at this
      // institution, which is exactly how a screen tells "the platform added
      // this" from "we added this" -- see authorship.ts.
      created_by: actorId,
    }).select('id, course_id, title, summary, sort, created_by').maybeSingle();
    if (error) throw new HttpError(500, 'Could not create that module: ' + error.message);
    await this.#log(actorId, 'module.created', 'module', Number(data!.id), null,
      { course_id: courseId, title: data!.title });
    return data;
  }

  async updateCourseModule(tenantId: number, moduleId: number, actorId: string | null, patch: {
    title?: string; summary?: string | null; sort?: number;
  }) {
    const before = await this.#courseModule(tenantId, moduleId);
    const next: Record<string, unknown> = {};
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.summary !== undefined) next.summary = patch.summary ?? null;
    if (patch.sort !== undefined) next.sort = patch.sort;
    if (!Object.keys(next).length) return before;

    const { error } = await this.#db.from('onyx_modules')
      .update(next).eq('tenant_id', tenantId).eq('id', moduleId);
    if (error) throw new HttpError(500, 'Could not update that module: ' + error.message);
    await this.#log(actorId, 'module.updated', 'module', moduleId,
      { title: before.title }, next);
    return this.#courseModule(tenantId, moduleId);
  }

  async removeCourseModule(tenantId: number, moduleId: number, actorId: string | null) {
    const before = await this.#courseModule(tenantId, moduleId);
    /*
     * Refused while it still holds lessons, rather than cascading in silence.
     *
     * A module with lessons in it is somebody's teaching, and this console sits
     * two levels away from the person who wrote it. The database would happily
     * take the whole subtree; making it a deliberate second step is the
     * difference between deleting a heading and deleting a term's work.
     */
    const { data: lessons } = await this.#db.from('onyx_lessons')
      .select('id').eq('tenant_id', tenantId).eq('module_id', moduleId);
    const count = (lessons ?? []).length;
    if (count) {
      throw new HttpError(422, 'That module still holds ' + count
        + (count === 1 ? ' lesson' : ' lessons')
        + '. Remove them from the course itself first.');
    }
    const { error } = await this.#db.from('onyx_modules')
      .delete().eq('tenant_id', tenantId).eq('id', moduleId);
    if (error) throw new HttpError(500, 'Could not remove that module: ' + error.message);
    await this.#log(actorId, 'module.deleted', 'module', moduleId,
      { title: before.title }, null);
    return { id: moduleId, removed: true };
  }

  /**
   * A lesson, added from the console.
   *
   * The same five kinds the course's own composer offers, and the same rules:
   * anything that points at something needs a `path`, and text carries its own
   * body. The rules live here rather than only in the form, because a form is
   * a convenience and an API is a contract.
   *
   * The file itself never passes through this server. The browser gets a
   * signed ticket and PUTs straight to storage -- Vercel rejects request
   * bodies over about 4.5 MB and a lecture recording is comfortably larger.
   */
  async createCourseLesson(tenantId: number, moduleId: number, actorId: string | null, input: {
    title: string; type: string; path?: string | null; body?: string | null;
    duration_seconds?: number; is_preview?: boolean;
  }) {
    const mod = await this.#courseModule(tenantId, moduleId);
    const type = input.type;
    if (!['video', 'document', 'image', 'text', 'link'].includes(type)) {
      throw new HttpError(422, 'That is not a lesson type.');
    }
    // A video lesson with nothing to play is the commonest authoring mistake,
    // and it only shows up when a learner opens it.
    if (type !== 'text' && !String(input.path ?? '').trim()) {
      throw new HttpError(422, type === 'link'
        ? 'A link lesson needs an address to point at.'
        : 'A ' + type + ' lesson needs a file.');
    }
    if (type === 'text' && !String(input.body ?? '').trim()) {
      throw new HttpError(422, 'A text lesson needs some text.');
    }

    // Appended, for the reason a module is: everything created here would
    // otherwise share sort 0 inside its module.
    const { data: siblings } = await this.#db.from('onyx_lessons')
      .select('sort').eq('tenant_id', tenantId).eq('module_id', moduleId);
    const sort = (siblings ?? []).reduce((max, l) => Math.max(max, Number(l.sort ?? 0)), -1) + 1;

    const { data, error } = await this.#db.from('onyx_lessons').insert({
      tenant_id: tenantId,
      // Denormalised from the module, exactly as ContentService does it, so
      // the enrolment check on the learner's side stays one read.
      course_id: mod.course_id,
      module_id: moduleId,
      title: input.title.trim(),
      type,
      path: type === 'text' ? null : String(input.path ?? '').trim(),
      body: type === 'text' ? input.body : null,
      duration_seconds: input.duration_seconds ?? 0,
      sort,
      is_preview: input.is_preview ? 1 : 0,
    }).select('id, module_id, title, type, sort, is_preview').maybeSingle();
    if (error) throw new HttpError(500, 'Could not add that lesson: ' + error.message);
    await this.#log(actorId, 'lesson.created', 'lesson', Number(data!.id), null,
      { module_id: moduleId, title: data!.title, type });
    return data;
  }

  async removeCourseLesson(tenantId: number, lessonId: number, actorId: string | null) {
    const { data: lesson } = await this.#db.from('onyx_lessons')
      .select('id, title, module_id').eq('tenant_id', tenantId).eq('id', lessonId).maybeSingle();
    if (!lesson) throw new HttpError(404, 'No such lesson.');
    const { error } = await this.#db.from('onyx_lessons')
      .delete().eq('tenant_id', tenantId).eq('id', lessonId);
    if (error) throw new HttpError(500, 'Could not remove that lesson: ' + error.message);
    await this.#log(actorId, 'lesson.deleted', 'lesson', lessonId, { title: lesson.title }, null);
    return { id: lessonId, removed: true };
  }

  /** Rename a lesson, or change whether it is open before enrolment. */
  async updateCourseLesson(tenantId: number, lessonId: number, actorId: string | null, patch: {
    title?: string; body?: string | null; is_preview?: boolean; sort?: number;
  }) {
    const { data: before } = await this.#db.from('onyx_lessons')
      .select('id, title, type, is_preview').eq('tenant_id', tenantId)
      .eq('id', lessonId).maybeSingle();
    if (!before) throw new HttpError(404, 'No such lesson.');

    const next: Record<string, unknown> = {};
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.sort !== undefined) next.sort = patch.sort;
    if (patch.is_preview !== undefined) next.is_preview = patch.is_preview ? 1 : 0;
    if (patch.body !== undefined) {
      // Only a written lesson has a body. Setting one on a video would leave a
      // lesson whose text nothing renders.
      if (before.type !== 'text') throw new HttpError(422, 'Only a written lesson has text.');
      if (!String(patch.body ?? '').trim()) {
        throw new HttpError(422, 'A text lesson needs some text.');
      }
      next.body = patch.body;
    }
    if (!Object.keys(next).length) return before;

    const { error } = await this.#db.from('onyx_lessons')
      .update(next).eq('tenant_id', tenantId).eq('id', lessonId);
    if (error) throw new HttpError(500, 'Could not update that lesson: ' + error.message);
    await this.#log(actorId, 'lesson.updated', 'lesson', lessonId,
      { title: before.title }, next);
    return { ...before, ...next };
  }

  /**
   * The question banks an institution has, and how much is in each.
   *
   * A paper drawn from a bank needs the bank to exist, and the console had no
   * way to see whether one did -- so "add sections" would have been a form
   * with nothing to choose from and no explanation.
   */
  /**
   * The banks a paper can draw from, and how much of each a machine can mark.
   *
   * `needs_marking` is the count worth reading twice. A section says "take two
   * from this bank" and the draw is random, so ONE question in the bank that
   * needs a person is enough to decide the experience of a candidate who is
   * unlucky enough to be dealt it: the paper stops releasing at hand-in and
   * waits for a marker.
   *
   * That is correct behaviour and it is not the surprising part. The surprising
   * part is that an essay ANNOUNCES itself and an unkeyed multiple-choice does
   * not -- a question authored without a correct option set reads as objective
   * everywhere it is listed, and marks exactly like an essay. So an operator
   * builds a paper of "four MCQs", switches instant results on, and the results
   * do not come instantly, with nothing on any screen saying why.
   *
   * Counted here rather than at publish, because this is the moment the choice
   * is made: the section editor is where a bank is picked.
   */
  async questionBanks(tenantId: number) {
    /*
     * Delegated, not duplicated.
     *
     * This used to hold its own copy of the counting -- the same query, the
     * same two marking tests, the same set tally -- beside AssessService's
     * bare `banks()`. Two copies of "how many sets does this bank hold" is
     * how the console and the institution's own screen come to disagree
     * about whether a bank can be scheduled.
     */
    if (!this.#assess) {
      throw new HttpError(500, 'The question bank service is not available here.');
    }
    return await this.#assess.banks(tenantId);
  }

  /**
   * Which questions a paper draws, and from where.
   *
   * `createAssessment` deliberately made a paper with no sections -- "course
   * faculty add sections once a bank exists" -- which left an operator able to
   * create a paper nobody could ever sit, with nothing on the screen saying
   * so. A paper with no questions is refused at `start()` with "this
   * assessment has no questions", at the moment a candidate presses the
   * button. That is far too late to find out.
   */
  async setAssessmentSections(tenantId: number, assessmentId: number, actorId: string | null,
    sections: { id: string; title: string; bank_id: number; take: number }[]) {
    const { data: assessment } = await this.#db.from('onyx_assessments')
      .select('id, title, sections, status').eq('tenant_id', tenantId)
      .eq('id', assessmentId).maybeSingle();
    if (!assessment) throw new HttpError(404, 'No such assessment.');

    // Every bank named has to belong to this institution, and hold enough to
    // draw from. Both are checked here rather than discovered at sitting time.
    const banks = await this.questionBanks(tenantId);
    const byId = new Map(banks.map((b) => [Number(b.id), b]));
    for (const section of sections) {
      const bank = byId.get(Number(section.bank_id));
      if (!bank) throw new HttpError(422, 'That question bank is not at this institution.');
      if (section.take > Number(bank.question_count)) {
        throw new HttpError(422, '“' + bank.name + '” holds ' + bank.question_count
          + ' question(s); a section cannot draw ' + section.take + '.');
      }
    }

    const { error } = await this.#db.from('onyx_assessments')
      .update({ sections: sections as never, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('id', assessmentId);
    if (error) throw new HttpError(500, 'Could not save those sections: ' + error.message);
    await this.#log(actorId, 'assessment.sections_set', 'assessment', assessmentId,
      { sections: assessment.sections }, { sections });
    return { id: assessmentId, sections };
  }

  async publishAssessment(tenantId: number, assessmentId: number, actorId: string | null) {
    const { data: assessment } = await this.#db.from('onyx_assessments')
      .select('id, title, sections, status').eq('tenant_id', tenantId)
      .eq('id', assessmentId).maybeSingle();
    if (!assessment) throw new HttpError(404, 'No such assessment.');

    const sections = (assessment.sections ?? []) as { take?: number }[];
    const drawn = sections.reduce((n, sec) => n + Number(sec.take ?? 0), 0);
    if (!drawn) {
      throw new HttpError(422, 'This paper draws no questions yet. '
        + 'Add a section from a question bank before publishing it.');
    }

    const { error } = await this.#db.from('onyx_assessments')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('id', assessmentId);
    if (error) throw new HttpError(500, 'Could not publish that paper: ' + error.message);
    await this.#log(actorId, 'assessment.published', 'assessment', assessmentId,
      { status: assessment.status }, { status: 'published' });
    return { id: assessmentId, status: 'published' };
  }

  /**
   * Cancel a paper.
   *
   * Refused once anybody has sat it. An attempt is a person's work and their
   * mark; deleting the paper takes both with it, and an operator two levels
   * away from the candidate should not be able to do that with one click. The
   * way to stop a paper nobody should sit any more is to close it, which is
   * what the window is for.
   */
  /**
   * Cancel a paper.
   *
   * The rule -- refused once anybody has sat it, because their answers and
   * marks hang off the row -- now lives in `AssessService.deleteAssessment`,
   * where the institution's own routes can reach it too. It was here, which is
   * why a lecturer had no way to remove a paper at all.
   *
   * What stays here is the console's own audit record: an operator deleting a
   * customer's paper is an act of the platform and should read as one.
   */
  async deleteAssessment(tenantId: number, assessmentId: number, actorId: string | null) {
    const { data: before } = await this.#db.from('onyx_assessments')
      .select('id, title, status').eq('tenant_id', tenantId).eq('id', assessmentId).maybeSingle();
    if (!before) throw new HttpError(404, 'No such assessment.');

    if (!this.#assess) {
      throw new HttpError(500, 'This deployment cannot cancel a paper from the console.');
    }
    const result = await this.#assess.deleteAssessment(tenantId, assessmentId);
    await this.#log(actorId, 'assessment.deleted', 'assessment', assessmentId,
      { title: before.title, status: before.status }, null);
    return { id: result.id, removed: true };
  }

  /**
   * Cancel a sitting.
   *
   * Refused once marks have been entered against it, for the reason above: a
   * mark is a record of what somebody scored, and it does not belong to
   * whoever is tidying the calendar.
   */
  async deleteExam(tenantId: number, examId: number, actorId: string | null) {
    const { data: exam } = await this.#db.from('onyx_exams')
      .select('id, title, status').eq('tenant_id', tenantId).eq('id', examId).maybeSingle();
    if (!exam) throw new HttpError(404, 'No such examination.');

    const { data: marks } = await this.#db.from('onyx_exam_marks')
      .select('id').eq('tenant_id', tenantId).eq('exam_id', examId);
    const entered = (marks ?? []).length;
    if (entered) {
      throw new HttpError(422, entered + (entered === 1 ? ' mark has' : ' marks have')
        + ' been entered for this sitting. Removing it would take them with it.');
    }

    // Seat allocations are this sitting's own and go with it.
    await this.#db.from('onyx_exam_seats').delete().eq('tenant_id', tenantId).eq('exam_id', examId);
    const { error } = await this.#db.from('onyx_exams')
      .delete().eq('tenant_id', tenantId).eq('id', examId);
    if (error) throw new HttpError(500, 'Could not remove that examination: ' + error.message);
    await this.#log(actorId, 'exam.deleted', 'exam', examId,
      { title: exam.title, status: exam.status }, null);
    return { id: examId, removed: true };
  }

  /**
   * One paper, and everybody who sat it.
   *
   * The console could list papers, and could open a single attempt if somebody
   * already had its id -- which nothing on any screen gave them. So a paper's
   * results were unreachable from the platform side even though every row was
   * already in the database.
   */
  async assessmentDetail(tenantId: number, assessmentId: number) {
    const { data: assessment } = await this.#db.from('onyx_assessments')
      // eslint-disable-next-line max-len -- one literal, same reason as above.
      .select('id, tenant_id, course_id, section_id, title, instructions, opens_at, closes_at, duration_minutes, attempts_allowed, pass_mark, status, sections, shuffle_questions, shuffle_options, proctoring, require_camera, require_screen, watch_camera, anonymous_marking, moderation_required, instant_results, breach_limit, results_published_at, created_at')
      .eq('tenant_id', tenantId).eq('id', assessmentId).maybeSingle();
    if (!assessment) throw new HttpError(404, 'No such assessment.');

    const { data: attempts } = await this.#db.from('onyx_assessment_attempts')
      // eslint-disable-next-line max-len -- one literal, same reason as above.
      .select('id, user_id, attempt, status, started_at, submitted_at, auto_score, manual_score, score, max_score')
      .eq('tenant_id', tenantId).eq('assessment_id', assessmentId).order('id');

    const rows = attempts ?? [];
    const users = await this.#usersById(rows.map((a) => String(a.user_id)));
    /*
     * The roll number and the section, alongside the name.
     *
     * A console operator asked how a paper went is asked back "for whom" --
     * and the answer an institution gives is a roll number and a section, not
     * an email address. Anonymous marking is not honoured here on purpose:
     * this is the platform console, not a marker's queue, and its whole job is
     * to see who is who. What a MARKER sees is decided in `markingQueue`,
     * which strips all three.
     */
    const people = await peopleFor(this.#db, tenantId, rows.map((a) => a.user_id));

    // Integrity in one query rather than one per attempt.
    const { data: events } = rows.length
      ? await this.#db.from('onyx_proctor_events').select('attempt_id, weight')
        .eq('tenant_id', tenantId).in('attempt_id', rows.map((a) => Number(a.id)))
      : { data: [] as { attempt_id: number; weight: number }[] };
    const flagged = new Map<number, number>();
    for (const e of events ?? []) {
      const key = Number(e.attempt_id);
      flagged.set(key, (flagged.get(key) ?? 0) + Number(e.weight ?? 0));
    }

    const { data: course } = assessment.course_id
      ? await this.#db.from('onyx_courses').select('id, code, title')
        .eq('tenant_id', tenantId).eq('id', Number(assessment.course_id)).maybeSingle()
      : { data: null };

    const scored = rows.filter((a) => a.score != null).map((a) => Number(a.score));
    return {
      assessment: { ...assessment, course: course ?? null },
      attempts: rows.map((a) => ({
        ...a,
        student: users.get(String(a.user_id)) ?? null,
        roll_number: people.get(String(a.user_id))?.roll_number ?? null,
        section: people.get(String(a.user_id))?.section ?? null,
        integrity_score: flagged.get(Number(a.id)) ?? 0,
      })),
      summary: {
        sat: rows.filter((a) => a.status !== 'in_progress').length,
        in_progress: rows.filter((a) => a.status === 'in_progress').length,
        marked: scored.length,
        mean: mean(scored),
        passed: assessment.pass_mark == null
          ? null
          : scored.filter((v) => v >= Number(assessment.pass_mark)).length,
      },
    };
  }

  /**
   * One sitting, with everything hanging off it.
   *
   * The marks entered by hand, the seat allocations, the online paper it is
   * tied to, and every attempt on that paper -- which is where the responses
   * and the invigilation record actually live. "How did this exam go" was
   * previously answered with a row on a list.
   */
  async examDetail(tenantId: number, examId: number) {
    const { data: exam } = await this.#db.from('onyx_exams')
      // eslint-disable-next-line max-len -- one literal, same reason as above.
      .select('id, tenant_id, course_id, semester_id, assessment_id, title, starts_at, duration_minutes, max_marks, pass_marks, status, created_at')
      .eq('tenant_id', tenantId).eq('id', examId).maybeSingle();
    if (!exam) throw new HttpError(404, 'No such examination.');

    const [{ data: marks }, { data: seats }, { data: course }] = await Promise.all([
      this.#db.from('onyx_exam_marks')
        // eslint-disable-next-line max-len -- one literal, same reason as above.
        .select('id, user_id, raw_marks, moderation_delta, final_marks, grade, grade_points, status')
        .eq('tenant_id', tenantId).eq('exam_id', examId),
      this.#db.from('onyx_exam_seats')
        .select('id, user_id, room_id, seat_no').eq('tenant_id', tenantId).eq('exam_id', examId),
      exam.course_id
        ? this.#db.from('onyx_courses').select('id, code, title')
          .eq('tenant_id', tenantId).eq('id', Number(exam.course_id)).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    /*
     * The paper and the people, together rather than one after the other.
     *
     * These were three sequential rounds -- fetch the paper, wait; look up
     * every user, wait; look up the same people again for their roll numbers.
     * None of the three depends on another's result, and each is a full round
     * trip to the database, so the page paid for all three in series. Measured
     * on a sitting with a handful of candidates that was the difference
     * between a second and a third of one.
     *
     * `#usersById` and `peopleFor` overlap -- both read `onyx_users` -- but
     * they answer different questions (an email against a roll number and a
     * section) and merging them is a change to a helper six other screens
     * share. Run side by side they cost one round trip, not two.
     */
    const everyone = [
      ...(marks ?? []).map((m) => String(m.user_id)),
      ...(seats ?? []).map((x) => String(x.user_id)),
    ];
    const [paper, users, peopleSeen] = await Promise.all([
      exam.assessment_id
        ? this.assessmentDetail(tenantId, Number(exam.assessment_id)).catch(() => null)
        : Promise.resolve(null),
      this.#usersById(everyone),
      peopleFor(this.#db, tenantId, everyone),
    ]);

    /*
     * ONE ROW PER CANDIDATE, which is how a sitting is actually read.
     *
     * The three records a sitting produces -- the attempt sat in the browser,
     * the mark an examiner entered, the seat they were given -- were returned
     * as three separate lists, and the screen showed three separate tables. So
     * "how did Meghana do" meant finding her name three times and holding the
     * answer together in your head, and a candidate who sat the paper but was
     * never marked appeared in one table and not the next with nothing saying
     * why.
     *
     * They are joined here rather than on the page because the join needs the
     * roll number and the section, which are on a fourth table, and doing it
     * per screen is how the console came to show raw uuids in the first place.
     *
     * The union is deliberate: somebody with a mark and no attempt sat it in a
     * hall, and somebody with an attempt and no mark is waiting on a marker.
     * Both are real states and both have to be visible.
     */
    const onTheSitting = [...new Set([
      ...everyone,
      ...(paper?.attempts ?? []).map((a) => String(a.user_id)),
    ])];
    /*
     * Only the people the first pass did not already cover.
     *
     * Marks and seats were looked up above, in parallel with the paper; the
     * attempts were not, because the paper had to arrive before their user ids
     * were known. Asking again for everybody would be a second read of rows
     * already in hand, so this asks only for the difference -- and where there
     * is none, it does not ask at all.
     */
    const missing = onTheSitting.filter((id) => !peopleSeen.has(id));
    const people = missing.length
      ? new Map([...peopleSeen, ...await peopleFor(this.#db, tenantId, missing)])
      : peopleSeen;
    const markOf = new Map((marks ?? []).map((m) => [String(m.user_id), m]));
    const seatOf = new Map((seats ?? []).map((x) => [String(x.user_id), x]));
    // The LAST attempt, which is the one that counts where a paper allows more
    // than one: attempts are read in id order, so the later write wins.
    const attemptOf = new Map((paper?.attempts ?? []).map((a) => [String(a.user_id), a]));

    const register = onTheSitting.map((userId) => {
      const person = people.get(userId);
      const mark = markOf.get(userId);
      const sat = attemptOf.get(userId);
      const final = mark ? Number(mark.final_marks ?? 0) : null;
      return {
        user_id: userId,
        name: person?.name ?? users.get(userId)?.name ?? 'Unknown',
        email: users.get(userId)?.email ?? null,
        roll_number: person?.roll_number ?? null,
        section: person?.section ?? null,
        seat_no: seatOf.get(userId)?.seat_no ?? null,
        room_id: seatOf.get(userId)?.room_id ?? null,
        attempt_id: sat ? Number(sat.id) : null,
        status: sat ? String(sat.status) : null,
        submitted_at: sat?.submitted_at ?? null,
        score: sat?.score ?? null,
        max_score: sat?.max_score ?? null,
        integrity_flags: sat ? Number(sat.integrity_score ?? 0) : 0,
        raw_marks: mark ? Number(mark.raw_marks ?? 0) : null,
        moderation_delta: mark ? Number(mark.moderation_delta ?? 0) : null,
        final_marks: final,
        grade: mark?.grade ?? null,
        /*
         * Pass or fail, from whichever mark this candidate actually has.
         *
         * A sitting produces a mark one of two ways: an examiner enters it in
         * the ledger, or the engine scores the paper the candidate sat in a
         * browser. This read only knew about the first, so a candidate who
         * sat online and scored full marks was reported with no result at all
         * -- on the very screen the client asked to show grades and results.
         *
         * The examiner's entry wins where there is one: a moderated or
         * hand-corrected mark is a decision about this candidate, and the raw
         * engine score is not allowed to overrule it. Where there is none, the
         * attempt's own score is judged against the paper's own total, because
         * the sitting's `max_marks` is what a hall paper is out of and an
         * online paper is out of what its questions are worth.
         *
         * Still null where there is genuinely nothing to judge: an unmarked
         * script is not a fail, and saying otherwise on a screen somebody
         * reads a grade off is the worst way to be wrong.
         */
        result: passFail(
          final, exam.pass_marks == null ? null : Number(exam.pass_marks),
          Number(exam.max_marks ?? 0),
          sat?.score == null ? null : Number(sat.score),
          sat?.max_score == null ? null : Number(sat.max_score)),
      };
    }).sort(byRoll2);

    const finals = (marks ?? []).map((m) => Number(m.final_marks ?? 0));
    return {
      exam: { ...exam, course: course ?? null },
      marks: (marks ?? []).map((m) => ({
        ...m,
        student: users.get(String(m.user_id)) ?? null,
        roll_number: people.get(String(m.user_id))?.roll_number ?? null,
        section: people.get(String(m.user_id))?.section ?? null,
      })),
      seats: (seats ?? []).map((x) => ({
        ...x,
        student: users.get(String(x.user_id)) ?? null,
        roll_number: people.get(String(x.user_id))?.roll_number ?? null,
        section: people.get(String(x.user_id))?.section ?? null,
      })),
      register,
      paper,
      summary: {
        entered: (marks ?? []).length,
        seated: (seats ?? []).length,
        mean: mean(finals),
        passed: exam.pass_marks == null
          ? null
          : finals.filter((v) => v >= Number(exam.pass_marks)).length,
      },
    };
  }

  /**
   * ONE STUDENT, and everything the institution has of them.
   *
   * The console could list a roll and open a course and open a sitting, and
   * had no way to answer the question anybody actually arrives with: what is
   * going on with this person. Their section, their number, what they are
   * enrolled in, what they have sat and what they were given for it -- four
   * screens and a lot of scrolling, or this.
   *
   * Assembled from four reads rather than a join, the same way every other
   * detail in this file is: the tables have no foreign key PostgREST can
   * traverse in one request, and this is read one student at a time by a
   * person, not per row of a list.
   */
  async studentRecord(tenantId: number, userId: string) {
    const { data: membership } = await this.#db.from('onyx_memberships')
      .select('id, tenant_id, user_id, role, status, roll_number, section_id, created_at')
      .eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    if (!membership) throw new HttpError(404, 'Nobody at this institution has that id.');

    const [people, { data: section }] = await Promise.all([
      peopleFor(this.#db, tenantId, [userId]),
      membership.section_id
        ? this.#db.from('onyx_sections').select('id, name, code')
          .eq('tenant_id', tenantId).eq('id', Number(membership.section_id)).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const users = await this.#usersById([userId]);

    const [{ data: enrolments }, { data: attempts }, { data: marks }] = await Promise.all([
      this.#db.from('onyx_enrollments')
        .select('id, course_id, status, created_at')
        .eq('tenant_id', tenantId).eq('user_id', userId).limit(SCAN_CAP),
      // eslint-disable-next-line max-len -- one literal; a concatenated select collapses the row type.
      this.#db.from('onyx_assessment_attempts').select('id, assessment_id, attempt, status, started_at, submitted_at, score, max_score, integrity_flags, integrity_status, terminated_at, breach_count')
        .eq('tenant_id', tenantId).eq('user_id', userId).order('id', { ascending: false })
        .limit(SCAN_CAP),
      this.#db.from('onyx_exam_marks')
        .select('id, exam_id, raw_marks, moderation_delta, final_marks, grade, status')
        .eq('tenant_id', tenantId).eq('user_id', userId).limit(SCAN_CAP),
    ]);

    /*
     * The names of the things above, in one read each.
     *
     * A course id on an enrolment row is not an answer to "what are they
     * enrolled in", and looking each one up per row is how a page about one
     * person becomes forty round trips.
     */
    const courseIds = [...new Set((enrolments ?? []).map((e) => Number(e.course_id)))];
    const paperIds = [...new Set((attempts ?? []).map((a) => Number(a.assessment_id)))];
    const examIds = [...new Set((marks ?? []).map((m) => Number(m.exam_id)))];

    const [{ data: courses }, { data: papers }, { data: exams }] = await Promise.all([
      courseIds.length
        ? this.#db.from('onyx_courses').select('id, code, title, access, status')
          .eq('tenant_id', tenantId).in('id', courseIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      paperIds.length
        ? this.#db.from('onyx_assessments')
          .select('id, title, course_id, duration_minutes, pass_mark, status')
          .eq('tenant_id', tenantId).in('id', paperIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      examIds.length
        ? this.#db.from('onyx_exams').select('id, title, course_id, starts_at, max_marks, pass_marks')
          .eq('tenant_id', tenantId).in('id', examIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);
    const courseById = new Map((courses ?? []).map((c) => [Number(c.id), c]));
    const paperById = new Map((papers ?? []).map((a) => [Number(a.id), a]));
    const examById = new Map((exams ?? []).map((e) => [Number(e.id), e]));

    /*
     * Which sitting a paper belongs to, so an attempt reads as "the Python
     * mid-term" rather than as an assessment id.
     */
    const { data: sittings } = paperIds.length
      ? await this.#db.from('onyx_exams').select('id, title, assessment_id')
        .eq('tenant_id', tenantId).in('assessment_id', paperIds)
      : { data: [] as Record<string, unknown>[] };
    const examOfPaper = new Map((sittings ?? [])
      .map((e) => [Number(e.assessment_id), { id: Number(e.id), title: String(e.title) }]));

    const person = people.get(userId);
    return {
      student: {
        user_id: userId,
        membership_id: Number(membership.id),
        name: person?.name ?? users.get(userId)?.name ?? 'Unknown',
        email: users.get(userId)?.email ?? null,
        phone: users.get(userId)?.phone ?? null,
        role: String(membership.role),
        status: num(membership.status),
        roll_number: person?.roll_number ?? null,
        section: section ? { id: Number(section.id), name: String(section.name) } : null,
        joined_at: membership.created_at ?? null,
      },
      enrolments: (enrolments ?? []).map((e) => ({
        id: Number(e.id),
        course_id: Number(e.course_id),
        course: courseById.get(Number(e.course_id)) ?? null,
        status: num(e.status),
        since: e.created_at ?? null,
      })).sort((a, b) => String(a.course?.code ?? '').localeCompare(String(b.course?.code ?? ''))),
      attempts: (attempts ?? []).map((a) => ({
        id: Number(a.id),
        assessment_id: Number(a.assessment_id),
        paper: paperById.get(Number(a.assessment_id)) ?? null,
        // Where the paper is one an examination is sat on, the examination is
        // what a person calls it.
        exam: examOfPaper.get(Number(a.assessment_id)) ?? null,
        attempt: num(a.attempt),
        status: String(a.status),
        started_at: a.started_at ?? null,
        submitted_at: a.submitted_at ?? null,
        score: a.score == null ? null : Number(a.score),
        max_score: a.max_score == null ? null : Number(a.max_score),
        integrity_flags: num(a.integrity_flags),
        integrity_status: String(a.integrity_status ?? 'clean'),
        terminated_at: a.terminated_at ?? null,
        breaches: num(a.breach_count),
      })),
      exam_marks: (marks ?? []).map((m) => ({
        id: Number(m.id),
        exam_id: Number(m.exam_id),
        exam: examById.get(Number(m.exam_id)) ?? null,
        raw_marks: Number(m.raw_marks ?? 0),
        moderation_delta: Number(m.moderation_delta ?? 0),
        final_marks: Number(m.final_marks ?? 0),
        grade: m.grade ?? null,
        status: String(m.status ?? ''),
      })),
    };
  }

  /**
   * One Live Class, and who signed up for it.
   *
   * Who registered is the only thing anybody wants from this screen, and the
   * console listed the class without it.
   */
  async domainRegistrations(tenantId: number, domainId: number) {
    await this.#domainRow(tenantId, domainId);
    const { data: registrations } = await this.#db.from('onyx_domain_registrations')
      // eslint-disable-next-line max-len -- one literal, same reason as above.
      .select('id, user_id, name, email, phone, amount_minor, currency, gateway, reference, status, created_at')
      .eq('tenant_id', tenantId).eq('domain_id', domainId).order('id', { ascending: false });

    const rows = registrations ?? [];
    const users = await this.#usersById(
      rows.map((r) => String(r.user_id)).filter((x) => x && x !== 'null'));
    const paid = rows.filter((r) => ['paid', 'captured'].includes(String(r.status)));
    return {
      registrations: rows.map((r) => ({
        ...r, student: r.user_id ? users.get(String(r.user_id)) ?? null : null,
      })),
      summary: {
        total: rows.length,
        paid: paid.length,
        taken_minor: paid.reduce((n, r) => n + Number(r.amount_minor ?? 0), 0),
      },
    };
  }

  /**
   * The examinations and paper windows in a date range, for the console grid.
   *
   * The console's timetable was a flat table of recurring CLASS slots, with
   * rooms and lecturers in it -- the institution's own operational view. An
   * operator does not allocate rooms; they want the week a candidate would
   * see, which in this product is examinations and papers. This is that week.
   *
   * Drafts are included and marked. A learner's own calendar hides them, which
   * is right there and wrong here: an operator watching a build-out needs to
   * see the sitting that exists but has not been announced.
   */
  async examWeek(tenantId: number, from: string, to: string) {
    const [{ data: exams }, { data: papers }, { data: courses }] = await Promise.all([
      this.#db.from('onyx_exams')
        // eslint-disable-next-line max-len -- one literal: a concatenated select collapses the client's row type.
        .select('id, course_id, assessment_id, title, starts_at, duration_minutes, max_marks, pass_marks, status')
        .eq('tenant_id', tenantId).gte('starts_at', from).lte('starts_at', to)
        .order('starts_at'),
      this.#db.from('onyx_assessments')
        // eslint-disable-next-line max-len -- one literal, same reason as above.
        .select('id, course_id, title, opens_at, closes_at, duration_minutes, attempts_allowed, pass_mark, status')
        .eq('tenant_id', tenantId).not('closes_at', 'is', null)
        .gte('closes_at', from).lte('closes_at', to),
      this.#db.from('onyx_courses').select('id, code, title').eq('tenant_id', tenantId),
    ]);

    const byId = new Map((courses ?? []).map((c) => [Number(c.id), c]));
    const label = (id: unknown) => {
      const c = byId.get(Number(id));
      return c ? { id: Number(c.id), code: String(c.code), title: String(c.title) } : null;
    };
    return {
      exams: (exams ?? []).map((e) => ({ ...e, course: label(e.course_id) })),
      assessments: (papers ?? []).map((a) => ({ ...a, course: label(a.course_id) })),
    };
  }

  async #courseModule(tenantId: number, moduleId: number) {
    const { data } = await this.#db.from('onyx_modules')
      .select('id, course_id, title, summary, sort')
      .eq('tenant_id', tenantId).eq('id', moduleId).maybeSingle();
    if (!data) throw new HttpError(404, 'No such module.');
    return data;
  }
}

