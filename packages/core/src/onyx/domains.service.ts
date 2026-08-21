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
}
