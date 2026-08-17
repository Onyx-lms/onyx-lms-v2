/**
 * A-02 -- registration.
 *
 * Mirrors RegisteredUserController::store:
 *   role = 'student', status = 1, password bcrypt-hashed with a $2y$ prefix,
 *   and email_verified_at stamped immediately UNLESS the
 *   `student_email_verification` setting is exactly '1'.
 */
import type { Db } from '../db/client.ts';
import { hashPassword } from './password.ts';
import { HttpError } from '../http/errors.ts';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface RegisteredUser {
  id: number;
  name: string | null;
  email: string;
  role: string;
  emailVerified: boolean;
}

export class RegistrationService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async register(input: RegisterInput, requireVerification: boolean): Promise<RegisteredUser> {
    const email = input.email.trim().toLowerCase();

    const { data: existing } = await this.#db
      .from('users').select('id').eq('email', email).maybeSingle();
    if (existing) {
      throw new HttpError(422, 'The given data was invalid.', {
        errors: { email: ['The email has already been taken.'] },
      });
    }

    const now = new Date().toISOString();
    const row = {
      name: input.name.trim(),
      email,
      role: 'student',
      status: 1,
      password: await hashPassword(input.password),
      email_verified_at: requireVerification ? null : now,
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await this.#db
      .from('users').insert(row).select('id, name, email, role, email_verified_at').maybeSingle();
    if (error) throw new HttpError(500, `Registration failed: ${error.message}`);
    if (!data) throw new HttpError(500, 'Registration failed: no row returned.');

    return {
      id: data.id,
      name: data.name ?? null,
      email: data.email,
      role: data.role,
      emailVerified: Boolean(data.email_verified_at),
    };
  }
}
