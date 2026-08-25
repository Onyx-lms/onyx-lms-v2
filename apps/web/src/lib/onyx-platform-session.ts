import { cookies } from 'next/headers';
import { callApi } from '@/lib/onyx-inprocess';
import { redirect } from 'next/navigation';
import { appOrigin } from '@/lib/app-origin';

/**
 * A platform admin's session -- deliberately its own cookie and its own
 * decode, not a variant of onyx-session.ts.
 *
 * A platform token carries no tenant_id (see packages/core/src/onyx/auth.ts),
 * so `OnyxClaims` -- which requires one -- cannot represent it, and should
 * not be made to: a type that can express both "in institution 12" and
 * "above every institution" is a type where confusing the two compiles.
 *
 * Holds both the access and refresh token as JSON, same as onyx-session.ts
 * and for the same reason (docs/ADR-011-supabase-auth-migration.md) -- the
 * refresh token is unused today (there is no platform equivalent of tenant
 * switching), kept only for parity and in case a future platform-console
 * feature needs it.
 */
export const PLATFORM_COOKIE = 'onyx_platform_session';

export interface PlatformClaims {
  user_id: string;
  email: string;
  platform: true;
  exp: number;
}

export interface PlatformSessionCookie {
  token: string;
  refresh_token: string;
  expires_at: number;
}

const API = appOrigin();

function decodeClaims(token: string): PlatformClaims | null {
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as PlatformClaims;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    if (claims.platform !== true) return null;
    return claims;
  } catch {
    return null;
  }
}

async function readCookie(): Promise<PlatformSessionCookie | null> {
  const raw = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PlatformSessionCookie;
    return parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export async function getPlatformToken(): Promise<string | null> {
  return (await readCookie())?.token ?? null;
}

export async function getPlatformSession(): Promise<PlatformClaims | null> {
  const token = await getPlatformToken();
  return token ? decodeClaims(token) : null;
}

export async function requirePlatformSession(): Promise<PlatformClaims> {
  const session = await getPlatformSession();
  if (!session) redirect('/onyx/platform/login');
  return session;
}

export async function platformApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getPlatformToken();
  // In process rather than over the application's own public hostname -- the
  // console reads three or four times per screen and each one was paying for a
  // CDN hop, a TLS handshake and a second invocation. See lib/onyx-inprocess.ts.
  const res = await callApi(path, { ...init, token });
  const body = await res.json().catch(() => ({ ok: false, message: 'Bad response' }));
  if (!body.ok) throw new Error(body.message || 'Request failed: ' + path);
  return body.data as T;
}
