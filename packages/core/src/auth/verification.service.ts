/**
 * A-03 -- email verification.
 *
 * Laravel used signed URLs plus `throttle:6,1` on resend. Same here: the link
 * carries an HMAC and an expiry, and the fingerprint covers the user's email so
 * a link stops working the moment the address changes.
 */
import type { Db } from '../db/client.ts';
import { createSignedToken, verifySignedToken, fingerprint } from './signed-token.ts';
import { HttpError } from '../http/errors.ts';

const DEFAULT_TTL_SECONDS = 60 * 60; // Laravel's default is 60 minutes.

export class VerificationService {
  #db: Db;
  #secret: string;
  constructor(db: Db, secret = process.env.SUPABASE_JWT_SECRET ?? '') {
    this.#db = db;
    this.#secret = secret;
  }

  async issue(userId: number, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<string> {
    const { data } = await this.#db
      .from('users').select('id, email, email_verified_at').eq('id', userId).maybeSingle();
    if (!data) throw new HttpError(404, 'User not found.');
    if (data.email_verified_at) throw new HttpError(422, 'Email already verified.');

    return createSignedToken({
      purpose: 'verify-email',
      userId: data.id,
      fingerprint: fingerprint([data.email], this.#secret),
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    }, this.#secret);
  }

  /** @returns true on first verification, false if it was already verified. */
  async consume(token: string): Promise<boolean> {
    const payload = verifySignedToken(token, this.#secret, 'verify-email');
    if (!payload) throw new HttpError(403, 'Invalid or expired verification link.');

    const { data } = await this.#db
      .from('users').select('id, email, email_verified_at').eq('id', payload.userId).maybeSingle();
    if (!data) throw new HttpError(404, 'User not found.');

    // Email changed since the link was sent -> the link is void.
    if (fingerprint([data.email], this.#secret) !== payload.fingerprint) {
      throw new HttpError(403, 'Invalid or expired verification link.');
    }
    if (data.email_verified_at) return false;

    const { error } = await this.#db.from('users')
      .update({ email_verified_at: new Date().toISOString() }).eq('id', data.id);
    if (error) throw new HttpError(500, `Verification failed: ${error.message}`);
    return true;
  }
}
