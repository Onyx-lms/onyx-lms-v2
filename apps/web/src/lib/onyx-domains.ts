/**
 * What the domains API returns, and the two things every screen does with it.
 *
 * Kept beside the other `onyx-*` client types rather than imported from
 * `@onyx/core`, for the same reason `onyx-learn.ts` exists: a page should not
 * pull a server module in to learn the shape of a JSON response.
 */

export interface OnyxDomainRow {
  id: number;
  tenant_id: number;
  title: string;
  summary: string;
  curriculum_url: string;
  image_path: string | null;
  /** The storage key resolved by the service. Null when no photo was uploaded. */
  image_url: string | null;
  certificate: string;
  duration_label: string;
  price_minor: number;
  currency: string;
  sort: number;
  status: number;
  created_at: string;
}

/**
 * A price a person can read.
 *
 * Free is said in words rather than as "INR 0.00", which reads as a bug. The
 * grouping is `en-IN` and the decimals are always there, matching the `money()`
 * helper the fees screens use -- one product should not have two ideas about
 * what a rupee looks like.
 */
export function domainPrice(d: Pick<OnyxDomainRow, 'price_minor' | 'currency'>): string {
  if (!d.price_minor) return 'Free';
  const currency = d.currency || 'INR';
  return currency + ' ' + Math.floor(d.price_minor / 100).toLocaleString('en-IN')
    + '.' + String(d.price_minor % 100).padStart(2, '0');
}

/**
 * Is this stored link safe to put in an href?
 *
 * The service checks the protocol on write. This checks again here, because a
 * row written before that check existed -- or by some future path that forgets
 * it -- must not become stored XSS on the page that renders it.
 */
export function isExternalHttp(value: string | null | undefined): boolean {
  const s = String(value ?? '');
  return s.startsWith('http://') || s.startsWith('https://');
}
