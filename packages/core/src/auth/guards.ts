/**
 * A-05 -- role guards.
 *
 * Ports the admin / instructor / auth / verified middleware. Reads the
 * `app_role` claim, never `role` (see ADR-001).
 */
import { verifyAccessToken, type AppRole, type OnyxClaims } from './jwt.ts';
import { unauthorized, forbidden } from '../http/errors.ts';

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}

export function extractToken(req: RequestLike): string | null {
  const header = req.headers['authorization'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw && raw.toLowerCase().startsWith('bearer ')) return raw.slice(7).trim();
  return req.cookies?.['onyx_token'] ?? null;
}

export function requireAuth(req: RequestLike, secret: string): OnyxClaims {
  const token = extractToken(req);
  if (!token) throw unauthorized();
  const claims = verifyAccessToken(token, secret);
  if (!claims) throw unauthorized();
  // A scoped token (currently only 'realtime') is issued for one narrow job and
  // is readable by browser JS. It must never authenticate an API call.
  if (claims.scope) throw unauthorized();
  return claims;
}

export function requireRole(req: RequestLike, secret: string, ...allowed: AppRole[]): OnyxClaims {
  const claims = requireAuth(req, secret);
  if (!allowed.includes(claims.app_role)) throw forbidden();
  return claims;
}

export const requireAdmin = (req: RequestLike, secret: string) =>
  requireRole(req, secret, 'admin');
export const requireInstructor = (req: RequestLike, secret: string) =>
  requireRole(req, secret, 'instructor');
