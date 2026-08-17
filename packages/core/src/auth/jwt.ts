/**
 * F-08 -- token issuing.
 *
 * We sign with the SUPABASE JWT SECRET so Postgres/PostgREST trust our tokens
 * without Supabase Auth being involved at all (ADR-001).
 *
 * Two claim rules that are easy to get wrong and expensive to debug:
 *
 *   `role`      MUST be 'authenticated'. PostgREST does SET ROLE from it, so
 *               putting 'admin' here tries to switch to a Postgres role named
 *               admin and the request dies.
 *   `sub`       auth.uid() casts sub to uuid. Our ids are bigint, so nothing
 *               may depend on auth.uid(); RLS reads the `user_id` claim via
 *               onyx.current_user_id() instead.
 *
 * The application role travels as `app_role`.
 */
import jwt from 'jsonwebtoken';

export type AppRole = 'admin' | 'instructor' | 'student' | 'user';

export interface OnyxClaims {
  sub: string;
  user_id: number;
  app_role: AppRole;
  email: string;
  role: 'authenticated';
  aud: 'authenticated';
  iat: number;
  exp: number;
  /**
   * Absent on a session token. 'realtime' marks a token minted for the
   * Supabase Realtime socket, which has to live in browser JS and so cannot be
   * httpOnly. requireAuth() refuses any token that carries a scope, so a
   * realtime token leaked from the page cannot be replayed against the API --
   * it only satisfies the RLS policy on `messages`, for its own rows, for five
   * minutes.
   */
  scope?: 'realtime';
}

export interface IssueInput {
  userId: number;
  email: string;
  appRole: AppRole;
  secret: string;
  ttlSeconds?: number;
}

export function issueAccessToken(input: IssueInput): { token: string; expiresAt: number } {
  const ttl = input.ttlSeconds ?? Number(process.env.ACCESS_TOKEN_TTL ?? 3600);
  const now = Math.floor(Date.now() / 1000);
  const claims: OnyxClaims = {
    sub: String(input.userId),
    user_id: input.userId,
    app_role: input.appRole,
    email: input.email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + ttl,
  };
  return {
    token: jwt.sign(claims, input.secret, { algorithm: 'HS256' }),
    expiresAt: claims.exp,
  };
}

/**
 * M-02 -- a short-lived token for the Supabase Realtime socket only.
 *
 * Same signature and the same user_id / role claims, because Postgres needs
 * them to evaluate RLS. The scope claim is what keeps it out of the API.
 */
export function issueRealtimeToken(
  input: Omit<IssueInput, 'ttlSeconds'> & { ttlSeconds?: number },
): { token: string; expiresAt: number } {
  const ttl = input.ttlSeconds ?? 300;
  const now = Math.floor(Date.now() / 1000);
  const claims: OnyxClaims = {
    sub: String(input.userId),
    user_id: input.userId,
    app_role: input.appRole,
    email: input.email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + ttl,
    scope: 'realtime',
  };
  return {
    token: jwt.sign(claims, input.secret, { algorithm: 'HS256' }),
    expiresAt: claims.exp,
  };
}

export function verifyAccessToken(token: string, secret: string): OnyxClaims | null {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as OnyxClaims;
  } catch {
    return null;
  }
}

/** Maps users.role to the app_role claim. Unknown roles degrade to 'user'
 *  rather than being trusted -- an unrecognised role must never widen access. */
export function toAppRole(dbRole: string | null | undefined): AppRole {
  switch ((dbRole ?? '').toLowerCase()) {
    case 'admin': return 'admin';
    case 'instructor': return 'instructor';
    case 'student': return 'student';
    default: return 'user';
  }
}
