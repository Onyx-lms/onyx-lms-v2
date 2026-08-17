/**
 * A-04 -- password reset.
 *
 * Writes to `password_reset_tokens`, whose primary key is `email` -- exactly the
 * Laravel table, unchanged. Requesting a second reset replaces the first, and a
 * successful reset deletes the row, so a token is single-use.
 */
import type { Db } from '../db/client.ts';
import { randomResetToken } from './signed-token.ts';
import { hashPassword } from './password.ts';
import { HttpError } from '../http/errors.ts';

const TOKEN_TTL_SECONDS = 60 * 60; // Laravel default: 60 minutes.

export class PasswordResetService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /**
   * Always resolves, whether or not the address exists -- otherwise this
   * endpoint becomes an account-enumeration oracle.
   * @returns the token when a mail should be sent, else null.
   */
  async request(email: string): Promise<string | null> {
    const normalized = email.trim().toLowerCase();
    const { data: user } = await this.#db
      .from('users').select('id, email').eq('email', normalized).maybeSingle();
    if (!user) return null;

    const token = randomResetToken();
    const hashed = await hashPassword(token); // stored hashed, like Laravel
    const created_at = new Date().toISOString();

    const { data: existing } = await this.#db
      .from('password_reset_tokens').select('email').eq('email', normalized).maybeSingle();
    const { error } = existing
      ? await this.#db.from('password_reset_tokens')
          .update({ token: hashed, created_at }).eq('email', normalized)
      : await this.#db.from('password_reset_tokens')
          .insert({ email: normalized, token: hashed, created_at });
    if (error) throw new HttpError(500, `Reset request failed: ${error.message}`);
    return token;
  }

  async reset(email: string, token: string, newPassword: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const { data: row } = await this.#db
      .from('password_reset_tokens').select('email, token, created_at')
      .eq('email', normalized).maybeSingle();

    const invalid = new HttpError(422, 'This password reset token is invalid.', {
      errors: { email: ['This password reset token is invalid.'] },
    });
    if (!row) throw invalid;

    const ageSeconds = (Date.now() - new Date(row.created_at ?? 0).getTime()) / 1000;
    if (ageSeconds > TOKEN_TTL_SECONDS) throw invalid;

    const { verifyPassword } = await import('./password.ts');
    if (!(await verifyPassword(token, row.token ?? ''))) throw invalid;

    const { data: user } = await this.#db
      .from('users').select('id').eq('email', normalized).maybeSingle();
    if (!user) throw invalid;

    const { error } = await this.#db.from('users')
      .update({ password: await hashPassword(newPassword), updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) throw new HttpError(500, `Reset failed: ${error.message}`);

    // Single use.
    await this.#db.from('password_reset_tokens').delete().eq('email', normalized);
  }
}
