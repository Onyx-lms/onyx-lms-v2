/**
 * Live Classes -- the domains an institution advertises.
 *
 * A domain is a field of study an institution puts in front of people: a name,
 * a photograph, what it covers, what it awards, how long it runs, what it
 * costs, and a link to the curriculum published on the Onyx EduTech site. It is
 * deliberately NOT a course. A course has a roster, an outline, lessons,
 * progress and marks; a domain has none of those. Migration 0027's header sets
 * out why the two are separate tables rather than one table with a flag.
 *
 * Every method takes `tenantId` as its first argument and every query filters
 * on it, the same contract AcademicsService keeps and for the same reason.
 */
import type { OnyxDb } from './db.ts';
import { HttpError } from '../http/errors.ts';
import type { SignedUrlSource } from './content.service.ts';
import { onyxAssetKey } from './content.service.ts';

/*
 * Literals, not concatenations. The database client infers a row shape from
 * this string and a computed one collapses it to an error type that makes
 * every field unknown -- the trap GATEWAY_COLUMNS_WITH_KEYS documents in
 * checkout.service.ts. Over the line length the rest of the file keeps to,
 * and breaking them would cost the types.
 */
/* eslint-disable max-len */
const REGISTRATION_COLUMNS = 'id, tenant_id, domain_id, user_id, amount_minor, currency, gateway, reference, provider_ref, status, created_at, updated_at';
const REGISTRATION_LOOKUP_COLUMNS = 'id, tenant_id, domain_id, user_id, amount_minor, currency, gateway, reference, status';
/* eslint-enable max-len */

const DOMAIN_COLUMNS = 'id, tenant_id, title, summary, curriculum_url, image_path, '
  + 'certificate, duration_label, price_minor, currency, sort, status, created_by, '
  + 'created_at, updated_at';

/** A row as every read returns it: the stored columns plus a resolved image URL. */
export interface OnyxDomain {
  id: number;
  tenant_id: number;
  title: string;
  summary: string;
  curriculum_url: string;
  image_path: string | null;
  image_url: string | null;
  certificate: string;
  duration_label: string;
  price_minor: number;
  currency: string;
  sort: number;
  status: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OnyxDomainInput {
  title: string;
  summary?: string;
  curriculum_url?: string;
  image_path?: string | null;
  certificate?: string;
  duration_label?: string;
  price_minor?: number;
  currency?: string;
  sort?: number;
  status?: number;
}

/**
 * The curriculum link, made safe and made usable.
 *
 * A string that reaches an `href` is a string that can be `javascript:`, and
 * neither React nor Next sanitises one -- so the protocol is checked here, on
 * the way in, where there is exactly one path to guard.
 *
 * A missing scheme is added rather than rejected, because people type
 * `onyxedutech.com/curriculum` and being told off for it teaches them nothing.
 * Anything that survives that and is still not http or https is refused BY NAME
 * in a 422: an author who pasted an `ftp://` link needs to know it was turned
 * down while the form is still open, not to find an empty field later.
 *
 * The host is deliberately not restricted to onyxedutech.com. An allow-list is
 * a support ticket the first time marketing runs a campaign subdomain, and the
 * protocol check is the half that actually prevents harm.
 */
export function normaliseCurriculumUrl(raw: string | null | undefined): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : 'https://' + trimmed;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new HttpError(422, 'That curriculum link is not a web address.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(422, 'A curriculum link has to be an http or https address. '
      + parsed.protocol.replace(':', '') + ' is not one.');
  }
  return parsed.toString();
}

/**
 * Is this stored value safe to put in an href?
 *
 * The service checks on write; this checks again on read. Belt and braces on
 * purpose: a row written before the check existed, or by some future path that
 * forgets it, must not become stored XSS on the page that renders it.
 */
export function isExternalHttpUrl(value: string | null | undefined): boolean {
  const s = String(value ?? '');
  return s.startsWith('http://') || s.startsWith('https://');
}

export class DomainsService {
  #db: OnyxDb;
  #storage: SignedUrlSource;

  constructor(db: OnyxDb, storage: SignedUrlSource) {
    this.#db = db;
    this.#storage = storage;
  }

  /**
   * The stored key resolved to something a browser can load.
   *
   * `publicUrl` rather than a signed one: the bucket is public for reads
   * (verified by tools/db/verify-storage.mjs), and a thumbnail on a marketing
   * tile is the least private thing in the product. A permanent URL is also
   * cacheable, where a signed one expires and forces a re-render.
   */
  #imageUrl(path: string | null | undefined): string | null {
    if (!path) return null;
    return this.#storage.publicUrl ? this.#storage.publicUrl(path) : null;
  }

  #withUrl(row: Record<string, unknown>): OnyxDomain {
    return {
      ...row,
      image_url: this.#imageUrl(row.image_path as string | null),
    } as unknown as OnyxDomain;
  }

  /**
   * Every domain this institution offers.
   *
   * Hidden ones are left out unless asked for, and the route only honours that
   * request for the roles that could hide one -- the same shape `/courses?all=1`
   * already uses.
   */
  async list(tenantId: number, opts: { includeHidden?: boolean } = {}) {
    const query = this.#db.from('onyx_domains')
      .select(DOMAIN_COLUMNS).eq('tenant_id', tenantId);
    const { data } = await (opts.includeHidden ? query : query.eq('status', 1))
      .order('sort', { ascending: true }).order('id', { ascending: true });
    return (data ?? []).map((row) => this.#withUrl(row as unknown as Record<string, unknown>));
  }

  async domain(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_domains')
      .select(DOMAIN_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No domain at that address.');
    return this.#withUrl(data as unknown as Record<string, unknown>);
  }

  async create(tenantId: number, createdBy: string, input: OnyxDomainInput) {
    const title = input.title.trim();
    if (!title) throw new HttpError(422, 'A domain needs a name.');

    const { data, error } = await this.#db.from('onyx_domains').insert({
      tenant_id: tenantId,
      title,
      summary: input.summary?.trim() ?? '',
      curriculum_url: normaliseCurriculumUrl(input.curriculum_url),
      image_path: input.image_path ?? null,
      certificate: input.certificate?.trim() ?? '',
      duration_label: input.duration_label?.trim() ?? '',
      price_minor: input.price_minor ?? 0,
      currency: (input.currency ?? 'INR').toUpperCase(),
      sort: input.sort ?? 0,
      status: input.status ?? 1,
      created_by: createdBy,
    }).select(DOMAIN_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not add the domain: ' + error.message);
    return this.#withUrl(data as unknown as Record<string, unknown>);
  }

  /**
   * A patch built field by field, exactly as updateCourse builds one: a field
   * absent from the request is left alone rather than written as null. Editing
   * a title must not silently clear a price.
   */
  async update(tenantId: number, id: number, input: Partial<OnyxDomainInput>) {
    await this.domain(tenantId, id);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new HttpError(422, 'A domain needs a name.');
      patch.title = title;
    }
    if (input.summary !== undefined) patch.summary = input.summary.trim();
    if (input.curriculum_url !== undefined) {
      patch.curriculum_url = normaliseCurriculumUrl(input.curriculum_url);
    }
    if (input.image_path !== undefined) patch.image_path = input.image_path;
    if (input.certificate !== undefined) patch.certificate = input.certificate.trim();
    if (input.duration_label !== undefined) patch.duration_label = input.duration_label.trim();
    if (input.price_minor !== undefined) patch.price_minor = input.price_minor;
    if (input.currency !== undefined) patch.currency = input.currency.toUpperCase();
    if (input.sort !== undefined) patch.sort = input.sort;
    if (input.status !== undefined) patch.status = input.status;

    const { error } = await this.#db.from('onyx_domains')
      .update(patch).eq('tenant_id', tenantId).eq('id', id);
    if (error) throw new HttpError(500, 'Could not save the domain: ' + error.message);
    return this.domain(tenantId, id);
  }

  /**
   * Removes a domain, and its thumbnail with it.
   *
   * The storage call is best-effort inside a try/catch: a bucket that is slow,
   * unreachable, or has already lost the object must not leave an administrator
   * unable to delete a row. An orphaned image costs a few kilobytes; a domain
   * that refuses to go away costs a support ticket.
   */
  async remove(tenantId: number, id: number) {
    const existing = await this.domain(tenantId, id);
    const { error } = await this.#db.from('onyx_domains')
      .delete().eq('tenant_id', tenantId).eq('id', id);
    if (error) throw new HttpError(500, 'Could not remove the domain: ' + error.message);

    const path = existing.image_path;
    if (path && this.#storage.remove) {
      try { await this.#storage.remove(path); } catch { /* the row is already gone */ }
    }
    return { id };
  }

  /**
   * A ticket to upload a thumbnail, minted from the tenant alone.
   *
   * No domain id, deliberately. A thumbnail is chosen before the domain exists
   * -- the author is still filling in the form -- and both alternatives were
   * worse: creating a draft row first leaves an orphan record an administrator
   * has to hunt down whenever a form is abandoned, and signing against a course
   * id would need a course a domain does not have.
   *
   * The key is derived here from the tenant in the caller's own token, never
   * from anything the request supplies, so a caller cannot write into another
   * institution's prefix. The route guards this with the same capability that
   * creates a domain, so only somebody who could add one can mint a key. The
   * worst case is an abandoned object under that institution's own prefix.
   */
  async signUpload(tenantId: number, filename: string) {
    if (!this.#storage.signedUpload) {
      throw new HttpError(500, 'This deployment cannot issue upload tickets.');
    }
    return this.#storage.signedUpload(onyxAssetKey(tenantId, 'domains', filename));
  }

  // -------------------------------------------------------------------------
  // Registrations -- who has signed up for a Live Class
  //
  // A registration grants NOTHING. There is no outline to unlock and no roster
  // to join, because a domain is a programme the institution runs off-product.
  // What it does is put a name on a list somebody in the office reads, which is
  // why `registrations()` below is as much of this feature as `register()` is.
  // Migration 0030's header makes the argument at length.
  // -------------------------------------------------------------------------

  /**
   * Records a registration, and is safe to call twice for the same payment.
   *
   * The order of operations is AcademicsService.recordPurchase's, deliberately
   * and for the same reasons -- the redirect back from a gateway and the
   * gateway's webhook race constantly, and whichever arrives second must find
   * the first one's row rather than charge again.
   */
  async register(tenantId: number, domainId: number, userId: string, input: {
    gateway?: string; reference?: string; providerRef?: string; amountMinor?: number;
  } = {}) {
    const domain = await this.domain(tenantId, domainId);
    if (Number(domain.status) !== 1) {
      throw new HttpError(403, 'This is not open for registration.');
    }

    const gateway = input.gateway ?? (Number(domain.price_minor) ? 'mock' : 'free');
    const reference = input.reference
      ?? 'MOCK-D' + tenantId + '-' + domainId + '-' + Date.now().toString(36).toUpperCase();

    // 1. Already recorded under this transaction id? Before any write, which is
    //    what makes the redirect/webhook race harmless.
    const seen = await this.#registrationByReference(tenantId, gateway, reference);
    if (seen && String(seen.status) === 'captured') {
      return { replayed: true, registration: seen };
    }

    const row = {
      tenant_id: tenantId,
      domain_id: domainId,
      user_id: userId,
      // What they were charged, captured HERE and never re-read from the
      // domain -- a price that changes next term must not rewrite what
      // somebody paid last term.
      amount_minor: input.amountMinor ?? Number(domain.price_minor),
      currency: String(domain.currency ?? 'INR'),
      gateway,
      reference,
      provider_ref: input.providerRef ?? null,
      status: 'captured',
      updated_at: new Date().toISOString(),
    };

    // 2. One row per person per domain, guarded so a captured row is never
    //    written back to anything lesser: a late begin() after a webhook has
    //    already captured must not reset it to pending.
    const existing = await this.#registrationFor(tenantId, domainId, userId);
    let error;
    if (existing) {
      if (String(existing.status) === 'captured') {
        return { replayed: true, registration: existing };
      }
      ({ error } = await this.#db.from('onyx_domain_registrations')
        .update(row).eq('tenant_id', tenantId).eq('id', existing.id));
    } else {
      ({ error } = await this.#db.from('onyx_domain_registrations').insert(row));
    }

    // 3. The database had the last word after all -- two clicks racing, or the
    //    webhook arriving mid-write.
    if (error && /duplicate key|unique/i.test(String(error.message))) {
      const original = await this.#registrationByReference(tenantId, gateway, reference)
        ?? await this.#registrationFor(tenantId, domainId, userId);
      return { replayed: true, registration: original };
    }
    if (error) {
      throw new HttpError(500, 'That registration could not be recorded: ' + error.message);
    }
    return { replayed: false, registration: { ...row } };
  }

  /** Whether this person has already signed up. Captured only. */
  async hasRegistered(tenantId: number, domainId: number, userId: string): Promise<boolean> {
    const { data } = await this.#db.from('onyx_domain_registrations')
      .select('id').eq('tenant_id', tenantId).eq('domain_id', domainId)
      .eq('user_id', userId).eq('status', 'captured').maybeSingle();
    return Boolean(data);
  }

  /** Every domain this person has signed up for, for the catalogue to mark. */
  async registeredDomains(tenantId: number, userId: string): Promise<number[]> {
    const { data } = await this.#db.from('onyx_domain_registrations')
      .select('domain_id').eq('tenant_id', tenantId).eq('user_id', userId)
      .eq('status', 'captured');
    return (data ?? []).map((r) => Number(r.domain_id));
  }

  /**
   * The list an administrator acts on: who registered, when, and for how much.
   *
   * Names are joined on rather than left as ids. A list of uuids is a list
   * nobody can ring up, and this exists precisely so somebody can.
   *
   * Pending rows are INCLUDED and labelled. A payment the bank has not
   * confirmed is exactly the case an office needs to see -- hiding it would
   * make somebody who has been charged invisible to the only people who could
   * work out what happened.
   */
  async registrations(tenantId: number, domainId: number) {
    await this.domain(tenantId, domainId);
    const { data } = await this.#db.from('onyx_domain_registrations')
      .select(REGISTRATION_COLUMNS)
      .eq('tenant_id', tenantId).eq('domain_id', domainId)
      .order('created_at', { ascending: false });
    const rows = data ?? [];
    if (!rows.length) return [];

    const ids = [...new Set(rows.map((r) => String(r.user_id)))];
    const { data: users } = await this.#db.from('onyx_users')
      .select('id, name, email, phone').in('id', ids);
    const byId = new Map((users ?? []).map((u) => [String(u.id), u]));

    return rows.map((r) => {
      const user = byId.get(String(r.user_id));
      return {
        ...r,
        name: user ? String(user.name ?? '') : 'Unknown',
        email: user ? String(user.email ?? '') : '',
        // The office rings people. It is on the roster they already read and
        // this is the same institution reading it.
        phone: user ? String(user.phone ?? '') : '',
      };
    });
  }

  async #registrationByReference(tenantId: number, gateway: string, reference: string) {
    const { data } = await this.#db.from('onyx_domain_registrations')
      .select(REGISTRATION_LOOKUP_COLUMNS)
      .eq('tenant_id', tenantId).eq('gateway', gateway).eq('reference', reference)
      .maybeSingle();
    return data as Record<string, unknown> | null;
  }

  async #registrationFor(tenantId: number, domainId: number, userId: string) {
    const { data } = await this.#db.from('onyx_domain_registrations')
      .select('id, status')
      .eq('tenant_id', tenantId).eq('domain_id', domainId).eq('user_id', userId)
      .maybeSingle();
    return data as { id: number; status: string } | null;
  }
}
