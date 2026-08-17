/**
 * Which cookie a request's token comes from, and why raw cookies never reach a
 * handler.
 *
 * In v1 the API lived on another origin, so the only way a token could arrive
 * was the `Authorization` header that `api/proxy/[...path]` attached
 * server-side. The cookie fallbacks inside the guards were unreachable dead
 * code. Serving the API from this origin makes them live, and they collide:
 *
 *   packages/core/src/auth/guards.ts:19   port  falls back to cookie `onyx_token`
 *   packages/core/src/onyx/auth.ts:84     onyx  falls back to cookie `onyx_session`
 *
 * while the web app stores:
 *
 *   lib/session.ts:12                TOKEN_COOKIE    = 'onyx_session'   <- the PORT's token
 *   lib/onyx-session.ts:26           ONYX_COOKIE     = 'onyx_tenant_session'
 *   lib/onyx-platform-session.ts:19  PLATFORM_COOKIE = 'onyx_platform_session'
 *
 * So the port's token is stored under exactly the name Onyx's extractor reads.
 * Hand the browser's cookies straight to a handler and a signed-in port user
 * hitting any Onyx route has their port token verified against Supabase's JWKS.
 * It fails closed -- a 401, not a breach -- but it is a 401 that looks like a
 * broken session and would cost a day to find.
 *
 * So: pick the cookie the path actually implies, unwrap it, and present it as a
 * bearer header, exactly as the proxy did. Handlers get `cookies: {}`. This is
 * the same three-way branch as `api/proxy/[...path]/route.ts:22-38`, moved to
 * where it now belongs.
 */
import { TOKEN_COOKIE } from '@/lib/session';
import { ONYX_COOKIE } from '@/lib/onyx-session';
import { PLATFORM_COOKIE } from '@/lib/onyx-platform-session';

/**
 * A platform admin's session is a third case, not a variation of the tenant
 * one: it carries no `tenant_id` for a tenant-scoped route to use, so offering
 * a tenant token to a platform route (or the reverse) must be impossible rather
 * than merely unlikely -- the same separation ADR-006 requires.
 */
export function cookieNameFor(segments: string[]): string {
  if (segments[0] === 'onyx' && segments[1] === 'platform') return PLATFORM_COOKIE;
  if (segments[0] === 'onyx') return ONYX_COOKIE;
  return TOKEN_COOKIE;
}

/**
 * The access token out of a cookie value.
 *
 * The port's cookie is still a bare token string. Onyx's two hold
 * `{ token, refresh_token, expires_at }` JSON since ADR-011; only the access
 * token is wanted here.
 */
export function tokenFromCookie(segments: string[], raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (segments[0] !== 'onyx') return raw;
  try {
    return (JSON.parse(raw) as { token?: string }).token;
  } catch {
    return undefined;
  }
}

/**
 * The `Authorization` value to present to a handler, or undefined.
 *
 * An explicit header always wins: server-to-server callers and the e2e suites
 * send one directly and must not have it second-guessed by whatever cookies
 * happen to be on the request.
 */
export function bearerFor(
  segments: string[],
  incomingAuthorization: string | null,
  cookieGet: (name: string) => string | undefined,
): string | undefined {
  if (incomingAuthorization) return incomingAuthorization;
  const token = tokenFromCookie(segments, cookieGet(cookieNameFor(segments)));
  return token ? 'Bearer ' + token : undefined;
}
