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
import { onyxAuthAdmin, onyxAuthClientFresh } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import { onyxAssetKey } from './content.service.ts';
import { slugify } from '../authoring/slug.ts';
import type { PermissionOverrides } from './permissions.ts';

const TENANT_COLUMNS = 'id, name, slug, status, plan, faculty_can_schedule_exams, permissions, student_signup, signup_domains, signup_mode, created_at, updated_at';
/**
 * The slice of StorageService a profile picture needs.
 *
 * Named structurally rather than imported, the same way ContentService names
 * its own: this file has no business knowing which storage implementation is
 * behind it, and a test can hand it three functions.
 */
export interface AvatarStorage {
  signedUpload?(key: string): Promise<{ path: string; token: string; signedUrl: string }>;
  publicUrl?(path: string): string | null;
  remove?(path: string): Promise<void>;
}

const USER_COLUMNS = 'id, email, name, phone, photo, status, email_verified_at, created_at';
const PROFILE_COLUMNS = 'id, email, name, phone, photo, status, created_at, username, headline, bio, skills_text, interests, experience, website, profile_public';
const MEMBERSHIP_COLUMNS = 'id, tenant_id, user_id, role, status, roll_number, created_at';

/**
 * Mailboxes anyone can open in thirty seconds, under any name.
 *
 * Used ONLY by `TenancyService.isConsumerDomain`, and only where an
 * institution has declared no domains of its own -- read that method's comment
 * before adding to this list, because the list is the weaker of the two rules
 * and adding to it is rarely the right fix.
 *
 * Weighted towards what students in India actually use, because that is who
 * registers here: rediffmail and the yahoo.co.in family are as common in a
 * first-year intake as outlook.com, and a list copied from an American blog
 * post would miss both.
 *
 * Deliberately NOT included: `zoho.com` and `fastmail.com`. Both sell hosting
 * on an organisation's own domain, and a genuine institution using them
 * arrives on that domain rather than this one -- but both also run free
 * personal tiers, so this is a judgement call rather than an oversight.
 */
export const CONSUMER_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'hotmail.com', 'hotmail.co.uk', 'hotmail.co.in', 'outlook.com', 'outlook.in',
  'live.com', 'live.in', 'live.co.uk', 'msn.com',
  // Yahoo and its national mailboxes
  'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de',
  'ymail.com', 'rocketmail.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // India
  'rediffmail.com', 'rediff.com', 'sify.com', 'indiatimes.com', 'in.com',
  // Privacy-focused personal mail
  'protonmail.com', 'protonmail.ch', 'proton.me', 'pm.me', 'tutanota.com', 'tuta.io',
  // Everything else common
  'aol.com', 'gmx.com', 'gmx.net', 'gmx.de', 'yandex.com', 'yandex.ru', 'mail.ru',
  'mail.com', 'email.com', 'inbox.com', 'hushmail.com', 'zoho.in',
  // The throwaway services people reach for when a form is in their way. Not
  // an attempt at a complete list -- there are hundreds -- but the handful
  // that turn up first in a search for "temporary email".
  'mailinator.com', 'guerrillamail.com', 'yopmail.com', '10minutemail.com',
  'temp-mail.org', 'trashmail.com', 'throwawaymail.com', 'sharklasers.com',
]);

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
  #storage: AvatarStorage | undefined;

  /**
   * `authAdmin`/`authClient` exist as constructor parameters only so a test
   * can inject a fake -- FakeDb can simulate Postgrest, but there is no
   * in-memory GoTrue to fall back to for these. Left unset, a real Supabase
   * Auth client is built when a method actually needs one, rather than
   * eagerly in the constructor -- eager construction would require
   * SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY to exist even for a unit test that
   * never touches auth and constructs this with a FakeDb.
   *
   * `storage` is optional for the same reason: every existing caller and test
   * that builds this with a database alone keeps working, and without it a
   * profile picture cannot be uploaded and the route says so plainly rather
   * than failing somewhere further down.
   */
  constructor(db: OnyxDb, authAdmin?: SupabaseClient, authClient?: SupabaseClient,
    storage?: AvatarStorage) {
    this.#db = db;
    this.#authAdminOverride = authAdmin;
    this.#authClientOverride = authClient;
    this.#storage = storage;
  }

  get #authAdmin(): SupabaseClient { return this.#authAdminOverride ?? onyxAuthAdmin(); }
  /**
   * A client for one auth exchange, then thrown away.
   *
   * NOT a shared one: GoTrueClient holds the session it last minted on the
   * instance, so concurrent sign-ins through a single client hand each other's
   * sessions out. See onyxAuthClientFresh in db.ts -- this was reproducible
   * against production with three logins.
   *
   * The override is still honoured, because a test supplying a fake wants that
   * fake used rather than a real client built beside it.
   */
  get #authClient(): SupabaseClient {
    return this.#authClientOverride ?? onyxAuthClientFresh();
  }

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
  async upsertUser(input: {
    name: string; email: string; password?: string;
    /** Only ever set on creation -- an existing account keeps its own. */
    phone?: string | null;
  }) {
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
        if (found) return this.#insertProfile(found.id, email, input.name, input.phone);
      }
      throw new HttpError(422, 'Could not create that account: ' + (authError?.message ?? 'unknown error'));
    }
    return this.#insertProfile(authUser.user.id, email, input.name, input.phone);
  }

  async #insertProfile(authId: string, email: string, name: string, phone?: string | null) {
    const { data, error } = await this.#db.from('onyx_users').insert({
      id: authId, email, name: name.trim(), status: 1,
      ...(phone ? { phone: phone.trim() } : {}),
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
   * Self-registration: a learner asking for an account rather than being given
   * one.
   *
   * The institution is resolved from the EMAIL DOMAIN, never from the request.
   * A form that asked which institution you belong to would have to either
   * show the customer list in a dropdown or trust a stranger to name one; the
   * domain answers it, and an address matching nothing is refused without
   * saying what would have matched. That last part is deliberate -- "no
   * institution accepts this address" leaks nothing, while "Meridian does not
   * accept gmail.com" confirms Meridian exists.
   *
   * Only ever creates a `student`. Every other role is somebody being given
   * authority, and authority is granted, not requested.
   */
  /**
   * The domain half of an address, lower-cased, or '' if there is not one.
   *
   * Takes the LAST @ rather than splitting on the first: a local part may
   * legally contain one inside quotes, and `a@b@example.com` split on the
   * first @ yields "b@example.com", which is not a domain and would never
   * match anything -- a silent refusal rather than a wrong match, but still
   * the wrong answer.
   */
  static domainOf(email: string): string {
    const raw = String(email ?? '');
    const at = raw.lastIndexOf('@');
    // No @, or nothing in front of it. "@meridian.edu" names no person, and
    // resolving a domain for it would say an institution accepts an address
    // that is not one. The route's own `z.string().email()` refuses it too;
    // this does not depend on that.
    if (at < 1 || !raw.slice(0, at).trim()) return '';
    return raw.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  }

  /**
   * Does an address's domain belong to this institution's list?
   *
   * The list is what an administrator typed on Settings, comma separated. Two
   * shapes are understood and nothing else:
   *
   *   meridian.edu     the domain itself, AND any subdomain of it
   *   *.meridian.edu   subdomains only -- staff on the apex are excluded
   *
   * **Subdomains match by default, and that is the point.** Universities issue
   * addresses on department subdomains -- cse.meridian.edu, students.meridian.edu
   * -- and an administrator who lists their institution's domain means those
   * people. Requiring every subdomain to be listed is how a working
   * configuration turns into a support queue on results day.
   *
   * **The dot is load-bearing.** The test is `domain === listed` or
   * `domain.endsWith('.' + listed)`, never `includes` or `endsWith(listed)`:
   * without the dot, `notmeridian.edu` matches `meridian.edu`, and
   * `meridian.edu.attacker.com` matches too. Either would let a stranger pick
   * an institution to join by registering a domain.
   *
   * **No user-supplied regular expressions**, deliberately, though the shape of
   * the ask invites them. A pattern typed into a settings box is a pattern
   * nobody tests: it is one stray `.` from matching every domain on the
   * internet, one nested quantifier from hanging the request that evaluates it,
   * and unreadable to the next administrator who inherits it. Domain and
   * subdomain matching is what the question actually needs, and it cannot be
   * written wrongly in a way that is dangerous rather than merely ineffective.
   */
  static domainMatches(domain: string, list: string): boolean {
    if (!domain) return false;
    return TenancyService.#patternsOf(list).some((pattern) => {
      if (pattern.startsWith('*.')) {
        const base = pattern.slice(2);
        return Boolean(base) && domain.endsWith('.' + base);
      }
      return domain === pattern || domain.endsWith('.' + pattern);
    });
  }

  /** The list as an administrator typed it, cleaned. Commas or whitespace. */
  static #patternsOf(list: string): string[] {
    return String(list ?? '')
      .split(/[,\s]+/)
      .map((d) => d.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, ''))
      .filter(Boolean);
  }

  /**
   * How specifically a list matches a domain, or 0 for not at all.
   *
   * Used to break a tie. Two institutions can both accept an address -- a
   * university listing `example.edu` and one of its colleges listing
   * `cs.example.edu` -- and picking whichever the database returned first
   * would put people in the wrong place depending on row order. The longer
   * pattern is the more specific one and wins.
   */
  static domainSpecificity(domain: string, list: string): number {
    let best = 0;
    for (const pattern of TenancyService.#patternsOf(list)) {
      const base = pattern.startsWith('*.') ? pattern.slice(2) : pattern;
      const hit = pattern.startsWith('*.')
        ? Boolean(base) && domain.endsWith('.' + base)
        : domain === base || domain.endsWith('.' + base);
      if (hit) best = Math.max(best, base.length);
    }
    return best;
  }

  /**
   * Did GoTrue refuse this because the project is over its auth rate limit?
   *
   * Matched on the message because that is all the client surfaces -- the HTTP
   * status is not carried through to `error.message`, and every alternative
   * (counting calls here, reading response headers the SDK discards) is more
   * machinery for the same answer.
   */
  static #isRateLimit(message?: string | null): boolean {
    return /rate limit|too many requests|429/i.test(String(message ?? ''));
  }

  /** One sentence for it, so both places that can hit it say the same thing. */
  static #tooBusy(): HttpError {
    return new HttpError(429,
      'Too many people are signing in at once. Wait a few seconds and try '
      + 'again — your password is fine.');
  }

  /**
   * Is this a consumer mailbox rather than an address an organisation issued?
   *
   * A blocklist, and blocklists are always incomplete -- there is no finite
   * list of free email providers, and one more launches every year. So this is
   * deliberately NOT the primary rule. The primary rule is the institution's
   * own `signup_domains`: an address that matches what an administrator listed
   * is an organisation address BY DEFINITION and never reaches this check. See
   * `#resolveSignup`.
   *
   * This is the fallback for the other case -- an institution that lists no
   * domains at all and takes anyone who picks it from the dropdown. There, the
   * only thing separating "a student at that college" from "anyone on the
   * internet" is whether the address looks issued. Catching the providers that
   * cover the overwhelming majority of personal mail is worth doing even
   * though it cannot be complete, and gmail.com -- the one actually asked
   * about -- is the largest of them by a wide margin.
   *
   * Subdomains count: `foo.gmail.com` is not a thing anyone is issued, and the
   * same `.`-anchored test used by `domainMatches` keeps `notgmail.com` from
   * matching `gmail.com`.
   */
  static isConsumerDomain(domain: string): boolean {
    if (!domain) return false;
    const d = domain.trim().toLowerCase();
    return CONSUMER_EMAIL_DOMAINS.has(d)
      || [...CONSUMER_EMAIL_DOMAINS].some((known) => d.endsWith('.' + known));
  }

  /**
   * A learner registering themselves.
   *
   * Two ways in, and which applies is the INSTITUTION's decision rather than
   * the applicant's:
   *
   *   * They typed an address whose domain a listed institution claims.
   *   * They picked an institution that is `open` -- one that has said anyone
   *     may join it.
   *
   * Either way they are in immediately. An earlier version queued the second
   * kind for an administrator to approve, on the reasoning that a name chosen
   * from a dropdown is a claim rather than evidence. That was overruled, and
   * the consequence is worth stating where somebody will read it: an
   * institution in `open` mode can be joined by anybody who picks it, with no
   * check. It is off by default and `domain` is the mode for anyone who wants
   * the address to prove the claim.
   */
  /**
   * Everything that decides whether an address may register, and where.
   *
   * Extracted so that the two halves of a verified signup -- sending the code
   * and, minutes later, redeeming it -- run the SAME rules rather than two
   * copies that drift. The second call is not a formality: an institution can
   * close its registrations, or somebody else can claim the address, in the
   * gap between the two, and the code in the applicant's inbox proves control
   * of a mailbox and nothing else.
   */
  async #resolveSignup(email: string, tenantId?: number | null) {
    const domain = TenancyService.domainOf(email);
    if (!domain) throw new HttpError(422, 'That does not look like an email address.');

    const { data: tenants } = await this.#db.from('onyx_tenants')
      .select(TENANT_COLUMNS).eq('student_signup', true).eq('status', 1);
    const open = tenants ?? [];

    // The most specific domain match, not the first one the database happened
    // to return -- see domainSpecificity.
    const byDomain = open
      .map((t) => ({ t, score: TenancyService.domainSpecificity(domain, String(t.signup_domains ?? '')) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.t;

    let tenant = byDomain;

    if (tenantId) {
      const picked = open.find((t) => Number(t.id) === Number(tenantId));
      // Not "no such institution": one that exists but does not accept
      // registrations is a different fact, and saying so stops somebody
      // hunting for a typo in a name that was right.
      if (!picked) {
        throw new HttpError(422, 'That institution is not accepting registrations.');
      }
      // A domain-only institution cannot be joined by naming it. Its own
      // learners still get in on their address, which is the case below.
      if (String(picked.signup_mode ?? 'domain') !== 'open'
        && Number(picked.id) !== Number(byDomain?.id)) {
        throw new HttpError(422,
          'That institution only registers people with its own email address.');
      }
      tenant = picked;
    }

    if (!tenant) {
      throw new HttpError(422,
        'No institution here accepts registrations from ' + domain + '. '
        + 'Choose your institution from the list, or use the email address it '
        + 'gave you.');
    }

    /*
     * Organisation addresses only.
     *
     * The strong form of this rule is the institution's own domain list, and
     * where one matched we are already done -- an administrator listing
     * `meridian.edu` has said what a Meridian address looks like, and nothing
     * here second-guesses it.
     *
     * Where nothing matched, the applicant is joining an institution that
     * takes anyone who picks it from the dropdown, and the address is the only
     * evidence of who they are. A free mailbox is no evidence at all: anybody
     * can open one in the name of anybody. So it is refused, and refused
     * BEFORE a code is sent -- there is no point mailing a verification to an
     * address that cannot be used whatever comes back.
     */
    const claimed = TenancyService.domainMatches(domain, String(tenant.signup_domains ?? ''));
    if (!claimed && TenancyService.isConsumerDomain(domain)) {
      throw new HttpError(422,
        'Use the email address your institution gave you. Personal addresses '
        + '(' + domain + ' and the like) cannot be used to register — an '
        + 'institution has no way to tell whose they are.');
    }

    return { domain, tenant, claimed };
  }

  /**
   * Step one of a student registering themselves: prove the address is theirs.
   *
   * Everything is checked BEFORE the code goes out -- the institution, the
   * domain rule, whether somebody already holds the address -- so a refusal
   * arrives while they are still looking at the form rather than after they
   * have gone to their inbox and come back. It also means we never mail a
   * stranger on behalf of a registration that was never going to be accepted.
   *
   * The code itself is Supabase's: `signInWithOtp` writes the one-time token
   * against the address and sends it.
   *
   * **The identity is created here, by the Admin API, rather than by letting
   * `signInWithOtp` create it.** GoTrue will only create a user from that call
   * when the project has public email signups switched ON, and this project
   * has them off -- correctly, because every account in this product is made
   * through the Admin API and an open `signUp()` would let anyone holding the
   * anon key mint auth users. Turning that setting on to make this one call
   * work would widen the front door to fix a window.
   *
   * What it creates is inert: no password, `email_confirm` false, no profile
   * row, no membership. It cannot sign in and belongs to no institution. Only
   * `completeSignUp` turns it into an account.
   */
  async startSignUp(input: { email: string; tenant_id?: number | null }) {
    const email = input.email.trim().toLowerCase();
    const { tenant } = await this.#resolveSignup(email, input.tenant_id);
    await this.#refuseIfTaken(email);

    /*
     * Already there is the normal case on a retry, and is not a failure.
     *
     * `email_confirm: true` is not the product calling the address verified --
     * that is what the code below is for, and no profile or membership exists
     * until it comes back. It is a GoTrue detail: an UNCONFIRMED user asking
     * for an OTP is treated as a signup confirmation, which this project
     * refuses because public signups are off, so the code would never be sent
     * at all. Every other account in this product is created the same way (see
     * upsertUser).
     */
    const { error: createError } = await this.#authAdmin.auth.admin.createUser({
      email, email_confirm: true,
    });
    if (createError && !/already.*(registered|exists)/i.test(createError.message ?? '')) {
      throw new HttpError(502,
        'Could not start that registration: ' + createError.message);
    }

    const { error } = await this.#authClient.auth.signInWithOtp({
      // The address exists by now, so this only ever mints and mails a token.
      email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      // Said as it is rather than as a generic failure. The overwhelmingly
      // common cause is the project's email quota, and "we could not send it"
      // sends somebody hunting for a typo in an address that was correct.
      const message = error.message ?? '';
      const rate = /rate|limit|too many|429/i.test(message);
      if (rate) {
        throw new HttpError(429,
          'Too many codes have been requested for this address. Wait a few '
          + 'minutes and try again.');
      }
      /*
       * Supabase checks that the domain can actually receive mail, and says
       * only "is invalid" when it cannot. Passed through as-is that reads as a
       * typo in the address, which sends somebody looking for one in an
       * address that is spelled correctly -- the real cause is an institution
       * whose domain has no mail server, and the person who can fix it is not
       * the applicant.
       */
      if (/invalid/i.test(message)) {
        throw new HttpError(422,
          'No code could be sent to that address. Its domain does not appear '
          + 'to accept email — check the address, and tell your institution if '
          + 'it is right.');
      }
      throw new HttpError(502, 'The verification code could not be sent: ' + message);
    }

    return {
      sent: true,
      email,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    };
  }

  /**
   * Step two: redeem the code, and only then create anything.
   *
   * The order matters and is the whole point of splitting this in two. Nothing
   * exists until `verifyOtp` has succeeded -- no profile row, no membership,
   * no password. An abandoned registration leaves behind the passwordless
   * auth.users row Supabase made when it sent the code, which grants nothing
   * and which a later attempt on the same address reuses.
   */
  async completeSignUp(input: {
    name: string; email: string; password: string; code: string;
    phone?: string | null; roll_number?: string | null;
    tenant_id?: number | null;
  }) {
    const email = input.email.trim().toLowerCase();
    // Re-checked, not remembered. See #resolveSignup.
    const { tenant } = await this.#resolveSignup(email, input.tenant_id);
    await this.#refuseIfTaken(email);

    const verified = await this.#verifyEmailCode(email, input.code);

    // The account is real from here. The password is set through the Admin API
    // rather than passed to signInWithOtp, which has nowhere to put one.
    const { error: passwordError } = await this.#authAdmin.auth.admin.updateUserById(
      verified.id, { password: input.password, email_confirm: true });
    if (passwordError) {
      throw new HttpError(422, 'Could not set that password: ' + passwordError.message);
    }

    // A retry that got this far once already has the profile row; reuse it
    // rather than colliding on the primary key.
    const user = (await this.userByEmail(email))
      ?? await this.#insertProfile(verified.id, email, input.name, input.phone ?? null);

    const membership = await this.addMember(
      Number(tenant.id), user.id, 'student', input.roll_number ?? null);

    return {
      user: { id: user.id, email: user.email, name: user.name },
      membership,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    };
  }

  /**
   * Checks an emailed code against Supabase, every way round.
   *
   * `verifyOtp` wants to be told which kind of token it is looking at, and the
   * answer depends on something we cannot see: GoTrue issues a `signup` token
   * for an address it had never heard of and a `magiclink` token for one it
   * had. An applicant retrying after an abandoned attempt is in the second
   * case through no action of their own.
   *
   * So both are tried. The alternative -- guessing from whether an auth.users
   * row exists -- means a second round trip to be wrong in a different way,
   * and the failure it produces ("that code is not valid") is the single most
   * confusing thing this form could say to somebody reading the correct code
   * off their screen.
   */
  async #verifyEmailCode(email: string, code: string) {
    /*
     * Digits, but NOT six of them.
     *
     * This was written as `\d{6}` because six is what everybody's mental model
     * of an emailed code is, and this project issues EIGHT -- GoTrue's OTP
     * length is configuration (MAILER_OTP_LENGTH), so hard-coding a number
     * here rejects every correct code on a deployment that chose differently,
     * before Supabase is ever asked. A range that covers what GoTrue can be
     * set to is the only version that is right on somebody else's project too.
     *
     * The length still gets a cheap check, because a blank field or a pasted
     * sentence should not cost a round trip.
     */
    const token = String(code ?? '').trim();
    if (!/^\d{4,10}$/.test(token)) {
      throw new HttpError(422, 'That code should be the digits from your email.');
    }

    let last = '';
    for (const type of ['email', 'signup', 'magiclink'] as const) {
      const { data, error } = await this.#authClient.auth.verifyOtp({
        email, token, type,
      });
      if (!error && data?.user) return data.user;
      last = error?.message ?? 'unknown error';
    }

    /*
     * GoTrue says "Token has expired or is invalid" for BOTH a mistyped code
     * and an expired one, and there is no way from here to tell which.
     *
     * So neither is claimed. Reading `/expire/` out of that string and saying
     * "that code has expired, ask for a new one" would be wrong most of the
     * time -- mistyping the digits is far commoner than sitting on them until
     * they lapse -- and it sends somebody to request a second code when the
     * first one was fine and their typing was not.
     *
     * The combined sentence is longer and is true whichever happened, and it
     * names both ways out.
     */
    const definitelyExpired = /expire/i.test(last) && !/invalid/i.test(last);
    throw new HttpError(422, definitelyExpired
      ? 'That code has expired. Ask for a new one.'
      : 'That code is not right, or it has expired. Check the code and try '
        + 'again, or ask for a new one.');
  }

  /**
   * An address that already belongs to somebody is not told apart from one
   * that does not -- upsertUser would attach the existing account, which is
   * right for an administrator adding a colleague and wrong here, where it
   * would hand a stranger a membership on an account they do not own.
   */
  async #refuseIfTaken(email: string) {
    const { data: existing } = await this.#db.from('onyx_users')
      .select('id').eq('email', email.toLowerCase()).maybeSingle();
    if (existing) {
      throw new HttpError(409,
        'That address already has an account. Sign in instead, or ask your '
        + 'institution to add you to it.');
    }
  }

  /**
   * A ticket to upload a profile picture straight to storage.
   *
   * The browser PUTs to the bucket rather than through this app, because
   * Vercel rejects request bodies over about 4.5 MB and a photograph off a
   * phone is routinely larger than that.
   *
   * The key is minted HERE, from the tenant and the person's own id, never
   * from anything the request supplies -- so a caller cannot write into
   * another institution's prefix or over somebody else's face. The filename is
   * reduced to something safe by `onyxAssetKey` and is only ever decoration on
   * the end of a key that is already unique.
   */
  async signAvatarUpload(tenantId: number, userId: string, filename: string) {
    if (!this.#storage?.signedUpload) {
      throw new HttpError(500, 'This deployment cannot store pictures.');
    }
    const key = onyxAssetKey(tenantId, 'avatars/' + userId, filename);
    return this.#storage.signedUpload(key);
  }

  /** A stored key as something an <img> can use, or null. */
  photoUrl(photo: string | null | undefined): string | null {
    const key = String(photo ?? '').trim();
    if (!key) return null;
    return this.#storage?.publicUrl?.(key) ?? null;
  }

  /** Whether an address could register, and where -- for the signup form. */
  async signupInstitutionFor(email: string) {
    // The SAME rule the sign-up itself applies. Two implementations of "does
    // this address belong here" is a form that says yes and a submit that says
    // no, which is the worst version of this to debug.
    const domain = TenancyService.domainOf(email);
    if (!domain) return null;
    const { data: tenants } = await this.#db.from('onyx_tenants')
      .select('id, name, slug, signup_domains')
      .eq('student_signup', true).eq('status', 1);
    const tenant = (tenants ?? [])
      .map((t) => ({ t, score: TenancyService.domainSpecificity(domain, String(t.signup_domains ?? '')) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.t;
    return tenant ? { id: tenant.id, name: tenant.name } : null;
  }

  /**
   * The institutions a student may pick from.
   *
   * Name and id only, and only those that have said anyone may join. It discloses
   * which institutions exist, which is worth being deliberate about -- and
   * they are already public: the catalogue at /api/onyx/catalogue names the
   * institution behind every course it lists. This adds no fact that a visitor
   * could not already read.
   */
  async openInstitutions() {
    const { data } = await this.#db.from('onyx_tenants')
      .select(TENANT_COLUMNS)
      .eq('student_signup', true).eq('status', 1).order('name');
    return (data ?? [])
      .filter((t) => String(t.signup_mode ?? 'domain') === 'open')
      .map((t) => ({ id: Number(t.id), name: String(t.name), slug: String(t.slug) }));
  }

  /** Whether this institution takes registrations, and from which domains. */
  async setSignupPolicy(tenantId: number, open: boolean, domains: string,
    mode?: 'domain' | 'open') {
    // Split on commas OR whitespace: somebody pasting a list from a document
    // separates it however that document did, and "meridian.edu ashcroft.ac"
    // silently becoming one nonsense entry is a configuration that looks
    // saved and matches nothing. A leading @ is dropped, a trailing dot is
    // dropped, and a leading *. is KEPT -- it means "subdomains only".
    const clean = domains.split(/[,\s]+/)
      .map((d) => d.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, ''))
      .filter(Boolean)
      .filter((d, i, all) => all.indexOf(d) === i)
      .join(',');
    const { data, error } = await this.#db.from('onyx_tenants')
      .update({
        student_signup: open,
        signup_domains: clean,
        // Left alone when not supplied, so a settings form that only toggles
        // registration on and off does not silently reset HOW it works.
        ...(mode ? { signup_mode: mode } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenantId).select(TENANT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not save that: ' + error.message);
    if (!data) throw new HttpError(404, 'Institution not found.');
    return data;
  }

  /**
   * The profile a person writes about themselves, and the address it lives at.
   *
   * Everything on the old profile screen came from somewhere else -- courses,
   * marks, awarded skills -- which made it a record rather than a profile. This
   * is the half only the person can supply, and the half worth sharing.
   */
  async updateProfile(userId: string, input: {
    name?: string; phone?: string | null; photo?: string | null;
    username?: string | null; headline?: string; bio?: string; skills_text?: string;
    interests?: string; experience?: string; website?: string; profile_public?: boolean;
  }) {
    const patch: Record<string, unknown> = {};

    /*
     * Their own name, which they could not change until now.
     *
     * An administrator typed it when the account was created, and people are
     * married, transition, correct a misspelling, or simply go by something
     * else. Refusing to let somebody fix their own name is a small cruelty
     * that a product this size should not be committing.
     *
     * Trimmed and required: a blank name leaves every roster, register and
     * certificate showing an email address instead of a person.
     */
    if (input.name !== undefined) {
      const name = String(input.name ?? '').trim();
      if (!name) throw new HttpError(422, 'A name cannot be blank.');
      if (name.length > 120) throw new HttpError(422, 'That name is too long.');
      patch.name = name;
    }

    // Cleared with an empty string rather than left unclearable -- a number
    // somebody no longer uses is worse than none.
    if (input.phone !== undefined) {
      const phone = String(input.phone ?? '').trim();
      if (phone.length > 40) throw new HttpError(422, 'That phone number is too long.');
      patch.phone = phone || null;
    }

    /*
     * A storage KEY, never a URL.
     *
     * The bucket can move, be renamed or grow a CDN in front of it; the key
     * does not change, and `#photoUrl` resolves one at read time. Refusing a
     * URL here also refuses the obvious attack on a field that ends up in an
     * <img src>: an off-site address that turns every page showing this person
     * into a request to somebody else's server.
     */
    if (input.photo !== undefined) {
      const photo = String(input.photo ?? '').trim();
      if (!photo) {
        patch.photo = null;
      } else {
        if (/^[a-z][a-z0-9+.-]*:/i.test(photo) || photo.startsWith('//')) {
          throw new HttpError(422, 'A profile picture is uploaded, not linked.');
        }
        if (!photo.startsWith('onyx/')) {
          throw new HttpError(422, 'That is not a picture this product uploaded.');
        }
        patch.photo = photo.slice(0, 500);
      }
    }

    if (input.username !== undefined) {
      const handle = (input.username ?? '').trim().toLowerCase();
      if (handle) {
        // Letters, digits, dot, dash, underscore. A handle appears in a URL a
        // person reads out loud, so anything needing percent-encoding is
        // refused rather than silently mangled.
        if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(handle)) {
          throw new HttpError(422,
            'A username is 3-40 characters: letters, numbers, dots, dashes or underscores, '
            + 'starting with a letter or number.');
        }
        const { data: taken } = await this.#db.from('onyx_users')
          .select('id').ilike('username', handle).neq('id', userId).maybeSingle();
        if (taken) throw new HttpError(409, 'That username is already taken.');
        patch.username = handle;
      } else {
        // Clearing it takes the public address away with it: an address that
        // resolves to nobody is worse than no address.
        patch.username = null;
        patch.profile_public = false;
      }
    }

    for (const field of ['headline', 'bio', 'skills_text', 'interests', 'experience', 'website'] as const) {
      if (input[field] !== undefined) patch[field] = String(input[field] ?? '').trim();
    }
    if (input.profile_public !== undefined) patch.profile_public = input.profile_public;

    if (patch.profile_public === true) {
      const { data: current } = await this.#db.from('onyx_users')
        .select('username').eq('id', userId).maybeSingle();
      const handle = patch.username ?? current?.username;
      if (!handle) {
        throw new HttpError(422, 'Choose a username first — that is the address to share.');
      }
    }

    const { data, error } = await this.#db.from('onyx_users')
      .update(patch).eq('id', userId).select(PROFILE_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not save your profile: ' + error.message);
    return data;
  }

  /** The person's own profile, editable fields included. */
  async profileFor(userId: string) {
    const { data } = await this.#db.from('onyx_users')
      .select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
    return data;
  }

  /**
   * A public profile, by handle.
   *
   * Deliberately its own projection rather than the row: an email address and a
   * phone number are on the same record and neither belongs to a stranger. What
   * comes back is what the person wrote plus where they belong -- and only if
   * they have said the page may answer at all.
   */
  async publicProfile(username: string) {
    const handle = username.trim().toLowerCase();
    if (!handle) return null;

    const { data: user } = await this.#db.from('onyx_users')
      .select(PROFILE_COLUMNS).ilike('username', handle).maybeSingle();
    if (!user || !user.profile_public || user.status !== 1) return null;

    // Where they belong, and as what. Institution and role only -- a roll
    // number identifies somebody inside an institution and is not a stranger's
    // business.
    const { data: memberships } = await this.#db.from('onyx_memberships')
      .select('role, created_at, tenant:onyx_tenants(id, name, slug, status)')
      .eq('user_id', user.id).eq('status', 1);

    const places = (memberships ?? [])
      .map((m) => ({
        role: String(m.role),
        since: String(m.created_at),
        institution: (m as unknown as { tenant: { name: string; status: number } | null }).tenant,
      }))
      .filter((m) => m.institution && m.institution.status === 1)
      .map((m) => ({ role: m.role, since: m.since, institution: m.institution!.name }));

    return {
      username: String(user.username),
      name: String(user.name),
      headline: String(user.headline ?? ''),
      bio: String(user.bio ?? ''),
      skills: String(user.skills_text ?? '').split(',').map((x) => x.trim()).filter(Boolean),
      interests: String(user.interests ?? '').split(',').map((x) => x.trim()).filter(Boolean),
      experience: String(user.experience ?? ''),
      website: String(user.website ?? ''),
      since: String(user.created_at),
      places,
    };
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
    /*
     * Members, not applicants.
     *
     * `status = 0` is somebody who has ASKED to join and whom nobody has
     * approved -- see signUpStudent. They are not part of this institution
     * yet, and this list is not only a roster: it fills the "enrol a student"
     * picker, the name lookups behind registers and marks, and the member
     * directory. Somebody nobody has admitted turning up in a course enrolment
     * dropdown is the kind of thing that is noticed after the fact.
     *
     * pendingMembers() is where they are, and the People screen shows that
     * list above this one.
     */
    let query = this.#db.from('onyx_memberships')
      .select(MEMBERSHIP_COLUMNS).eq('tenant_id', tenantId).eq('status', 1);
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
    // One client for BOTH halves of this exchange, and nobody else's. The
    // refresh below trades this sign-in's refresh token for a tenant-scoped
    // session, and reading `#authClient` twice would build two clients -- which
    // works, but says something untrue about how they relate.
    const auth = this.#authClient;
    const { data: signed, error: signError } = await auth.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    });
    if (signError || !signed.session || !signed.user) {
      // A rate limit is not a wrong password, and must never be reported as
      // one. Told "those details do not match", somebody whose password is
      // perfectly correct goes and resets it -- which is another mail through
      // the same throttled service, so the reset does not arrive either. On an
      // exam morning, when a hall signs in at once and the limit is exactly
      // what gets hit, that turns a two-minute wait into a support queue.
      if (TenancyService.#isRateLimit(signError?.message)) throw TenancyService.#tooBusy();
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
    const { data: refreshed, error: refreshError } = await auth.auth.refreshSession({
      refresh_token: signed.session.refresh_token,
    });
    if (refreshError || !refreshed.session) {
      /*
       * Signing in costs TWO calls to GoTrue -- the password grant above and
       * this refresh, which is what scopes the session to one institution. So
       * a burst of sign-ins reaches the project's auth rate limit at half the
       * number of people it looks like it should, and when it does, it lands
       * here rather than above: the password was accepted and the second call
       * was refused.
       *
       * Reported as "too busy" rather than as a 500. It is not a fault in this
       * product and there is nothing for the person to fix -- waiting works.
       */
      if (TenancyService.#isRateLimit(refreshError?.message)) throw TenancyService.#tooBusy();
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
