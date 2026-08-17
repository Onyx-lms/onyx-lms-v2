/**
 * F-03 / F-04 -- Onyx access tokens and guards.
 *
 * Supabase Auth (GoTrue) issues and signs these now (see
 * docs/ADR-011-supabase-auth-migration.md) -- this file only verifies them
 * and reads the claims, exactly as it always did, just against the
 * project's real JWKS instead of a shared HS256 secret this code minted
 * itself. `role` stays fixed at 'authenticated' so PostgREST performs the
 * right SET ROLE; `tenant_id`/`tenant_role`/`platform` are stamped on at
 * mint time by the Custom Access Token Hook
 * (supabase/onyx/migrations/0015_auth_claims_hook.sql), not by this file.
 *
 * `sub`/`user_id` are now real auth.users uuids, not the bigint ids this
 * project signed for itself before the migration -- `auth.uid()` is safe to
 * use in RLS for the first time, and 0014's cutover is what makes every
 * onyx_-table policy that reads a person's id compare uuid to uuid.
 *
 * What is new here is `tenant_id`. It is the whole basis of isolation:
 * onyx.current_tenant_id() reads it inside every RLS policy, so a token without
 * one can read nothing, and a token for one institution can never read another.
 * Because that is load-bearing, a token missing the claim is refused outright
 * rather than treated as "no tenant yet".
 */
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { Role } from '@onyx/types';
import { unauthorized, forbidden } from '../http/errors.ts';
import type { RequestLike } from '../auth/guards.ts';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error('Missing required env var ' + name + ' (see .env.example)');
  return v;
}

let _jwks: JWTVerifyGetKey | null = null;

/** The project's real signing keys (confirmed ES256 -- see the auth migration ADR), fetched once and cached. */
function jwks(): JWTVerifyGetKey {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(required('SUPABASE_URL') + '/auth/v1/.well-known/jwks.json'));
  }
  return _jwks;
}

export interface OnyxTokenClaims {
  sub: string;
  /** A real auth.users uuid since the migration -- was a bigint before it. */
  user_id: string;
  tenant_id: number;
  role: 'authenticated';
  /** The role WITHIN this tenant. Held on the membership, not on the user. */
  tenant_role: Role;
  email: string;
  aud: 'authenticated';
  iat: number;
  exp: number;
}

/**
 * Verifies a Supabase Auth-issued access token against the project's JWKS.
 *
 * Cryptographic verification is inherently async (jose calls into the
 * platform's WebCrypto, which has no synchronous form) -- unlike the old
 * jsonwebtoken-based verifyOnyxToken(), and unlike it, there is no `secret`
 * parameter: the signing keys come from the project itself, not a value
 * this code ever held.
 */
export async function verifyOnyxToken(token: string): Promise<OnyxTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, jwks(), {
      issuer: required('SUPABASE_URL') + '/auth/v1',
      audience: 'authenticated',
    });
    return payload as unknown as OnyxTokenClaims;
  } catch {
    return null;
  }
}

export function extractOnyxToken(req: RequestLike): string | null {
  const header = req.headers['authorization'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw && raw.toLowerCase().startsWith('bearer ')) return raw.slice(7).trim();
  return req.cookies?.['onyx_session'] ?? null;
}

/**
 * The claim-shape checks requireOnyx() applies once a token has already
 * verified cryptographically -- split out as its own pure function so it
 * can be unit-tested against a hand-built claims object. Nothing outside
 * GoTrue can produce a token that actually passes verifyOnyxToken(), so
 * that step itself is e2e-only coverage; this is the part a unit test can
 * reach.
 */
export function assertUsableOnyxClaims(claims: OnyxTokenClaims): OnyxTokenClaims {
  if (!Number.isInteger(claims.tenant_id) || claims.tenant_id <= 0) throw unauthorized();
  if (!claims.tenant_role) throw unauthorized();
  return claims;
}

/**
 * Every Onyx request runs inside exactly one tenant. A token that does not name
 * one cannot be scoped, so it is rejected rather than defaulted -- defaulting is
 * how a request ends up reading the wrong institution.
 *
 * `secret` is kept as a parameter only so the ~250 existing call sites
 * (`requireOnyx(req, ctx.jwtSecret)`) did not all need editing when this
 * became JWKS-verified -- it is unused. New code should not pass one.
 */
export async function requireOnyx(req: RequestLike, secret?: string): Promise<OnyxTokenClaims> {
  void secret;
  const token = extractOnyxToken(req);
  if (!token) throw unauthorized();
  const claims = await verifyOnyxToken(token);
  if (!claims) throw unauthorized();
  return assertUsableOnyxClaims(claims);
}

/** F-04 -- role check, resolved per tenant because that is where roles live. */
export async function requireOnyxRole(req: RequestLike, secret: string | undefined, ...allowed: Role[]): Promise<OnyxTokenClaims> {
  const claims = await requireOnyx(req, secret);
  if (!allowed.includes(claims.tenant_role)) throw forbidden();
  return claims;
}

/**
 * Guards a tenant id taken from a path or body against the caller's own.
 *
 * Routes should prefer the claim outright. Where an id has to be accepted --
 * an admin console addressing its own tenant, say -- this makes the mismatch a
 * 403 rather than a silent cross-tenant read.
 */
export function assertSameTenant(claims: OnyxTokenClaims, tenantId: number): void {
  if (Number(tenantId) !== claims.tenant_id) throw forbidden();
}

/**
 * A platform admin's token -- deliberately a different shape, not a wider
 * version of OnyxTokenClaims. It carries no tenant_id at all, because a
 * platform admin is not scoped to one institution; they sit above all of
 * them. That absence is what keeps the two token kinds from ever being
 * confused for each other: requireOnyx() rejects a token with no tenant_id
 * outright (see its own comment), so a platform token is structurally unable
 * to pass as a tenant token, and there is no shared "requireEither" path
 * where a bug could blur the line between them.
 *
 * The `platform: true` claim is stamped on by the same Custom Access Token
 * Hook that stamps tenant_id/tenant_role -- see auth.ts's module comment.
 */
export interface PlatformTokenClaims {
  sub: string;
  user_id: string;
  platform: true;
  email: string;
  aud: 'authenticated';
  iat: number;
  exp: number;
}

/** The platform equivalent of requireOnyx(). Accepts only a platform token. */
export async function requirePlatformAdmin(req: RequestLike, secret?: string): Promise<PlatformTokenClaims> {
  void secret;
  const header = req.headers['authorization'];
  const raw = Array.isArray(header) ? header[0] : header;
  const token = (raw && raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : null)
    ?? req.cookies?.['onyx_platform_session'] ?? null;
  if (!token) throw unauthorized();
  const claims = await verifyOnyxToken(token) as unknown as PlatformTokenClaims | null;
  if (!claims) throw unauthorized();
  // Belt and braces: a tenant token forged or replayed here is rejected on
  // shape even though in practice a JWT signed for one purpose never
  // decodes to a plausible claims object for the other.
  if (claims.platform !== true) throw unauthorized();
  return claims;
}
