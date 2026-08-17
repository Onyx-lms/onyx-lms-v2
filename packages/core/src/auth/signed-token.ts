/**
 * A-03 / A-04 -- signed, expiring links.
 *
 * Laravel signs verification URLs with its app key and stores reset tokens in
 * `password_reset_tokens`. We reproduce both behaviours with HMAC-SHA256 so a
 * link cannot be forged or replayed past its window, and so nothing extra needs
 * to be stored for verification links.
 */
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export interface SignedPayload {
  purpose: 'verify-email' | 'reset-password';
  userId: number;
  /** Ties the link to current state: changing email or password voids it. */
  fingerprint: string;
  expiresAt: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSignedToken(payload: SignedPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  return body + '.' + sign(body, secret);
}

export function verifySignedToken(
  token: string, secret: string, purpose: SignedPayload['purpose'],
): SignedPayload | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];

  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  // Constant-time compare; length check first because timingSafeEqual throws
  // on mismatched lengths and that throw would itself leak length.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let payload: SignedPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
  if (payload.purpose !== purpose) return null;
  if (payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/**
 * Fingerprint over the fields a link should be invalidated by.
 * Verification links die when the email changes; reset links die once the
 * password changes, which is what makes them single-use.
 */
export function fingerprint(parts: (string | null | undefined)[], secret: string): string {
  return sign(parts.map((p) => p ?? '').join('|'), secret).slice(0, 24);
}

/** Opaque token stored in password_reset_tokens, Laravel-style. */
export function randomResetToken(): string {
  return randomBytes(32).toString('hex');
}
