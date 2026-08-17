/**
 * A pending order, signed into the reference itself.
 *
 * Laravel kept this in `session('payment_details')`, which is why no orders
 * table exists in the schema. A stateless API cannot use a PHP session, and
 * adding a table would break the 61-table parity, so the order snapshot travels
 * as an HMAC-signed token that the gateway echoes back to us.
 *
 * The signature is what stops a customer editing the price on the way through.
 */
import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto';

export interface PendingOrder {
  userId: number;
  gateway: string;
  items: { course_id: number; title: string; price: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  taxRate: number;
  total: number;
  currency: string;
  couponCode: string | null;
  nonce: string;
  issuedAt: number;
}

const MAX_AGE_SECONDS = 60 * 60 * 2; // a checkout older than two hours is stale

export function signOrder(
  order: Omit<PendingOrder, 'nonce' | 'issuedAt'>, secret: string,
): string {
  const payload: PendingOrder = {
    ...order,
    nonce: randomBytes(9).toString('base64url'),
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

export function readOrder(reference: string, secret: string): PendingOrder | null {
  const parts = (reference ?? '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];

  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let order: PendingOrder;
  try {
    order = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
  if (Math.floor(Date.now() / 1000) - order.issuedAt > MAX_AGE_SECONDS) return null;
  return order;
}

/**
 * A short, stable key for a reference.
 *
 * The signed token runs to several hundred characters, but
 * payment_histories.session_id is varchar(255) -- writing the raw reference
 * there fails with 'value too long'. The digest fits, is deterministic, and is
 * still unique per order, which is all the idempotency check needs.
 */
export function referenceKey(reference: string): string {
  return createHash('sha256').update(reference).digest('hex'); // 64 chars
}
