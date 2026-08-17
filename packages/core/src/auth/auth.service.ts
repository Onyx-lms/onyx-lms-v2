/**
 * A-01 -- login against the existing users table.
 *
 * Post-login redirect mirrors routes/web.php:
 *   admin -> admin dashboard, student -> my courses, otherwise -> home.
 */
import type { Db } from '../db/client.ts';
import { verifyPassword } from './password.ts';
import { issueAccessToken, toAppRole, type AppRole } from './jwt.ts';

export interface AuthedUser {
  id: number;
  email: string;
  name: string | null;
  role: AppRole;
  emailVerified: boolean;
}

export interface LoginResult {
  ok: boolean;
  user?: AuthedUser;
  token?: string;
  expiresAt?: number;
  redirectTo?: string;
  reason?: 'invalid_credentials' | 'email_unverified';
}

export function redirectForRole(role: AppRole): string {
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'student') return '/my-courses';
  return '/';
}

export class AuthService {
  #db: Db;
  #secret: string;

  constructor(db: Db, secret = process.env.SUPABASE_JWT_SECRET ?? '') {
    this.#db = db;
    this.#secret = secret;
  }

  async login(email: string, password: string, requireVerified: boolean): Promise<LoginResult> {
    const { data } = await this.#db
      .from('users')
      .select('id, email, name, role, password, email_verified_at')
      .eq('email', email)
      .maybeSingle();

    // Verify against a dummy hash even when the user is absent, so a missing
    // account and a wrong password take the same time.
    const stored = data?.password ?? '$2y$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const passwordOk = await verifyPassword(password, stored);
    if (!data || !passwordOk) return { ok: false, reason: 'invalid_credentials' };

    if (requireVerified && !data.email_verified_at) {
      return { ok: false, reason: 'email_unverified' };
    }

    const role = toAppRole(data.role);
    const { token, expiresAt } = issueAccessToken({
      userId: data.id, email: data.email, appRole: role, secret: this.#secret,
    });

    return {
      ok: true,
      token,
      expiresAt,
      redirectTo: redirectForRole(role),
      user: {
        id: data.id,
        email: data.email,
        name: data.name ?? null,
        role,
        emailVerified: Boolean(data.email_verified_at),
      },
    };
  }
}
