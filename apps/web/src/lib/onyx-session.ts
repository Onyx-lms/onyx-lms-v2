import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { appOrigin } from '@/lib/app-origin';

/**
 * Onyx's server-side session (F-03 / F-06).
 *
 * Same arrangement as the port's lib/session.ts -- the token lives in an
 * httpOnly cookie this origin owns and is forwarded as a Bearer header, so it
 * never reaches page scripts.
 *
 * The cookie is deliberately NOT the port's `onyx_session`. Two products share
 * this origin in development, and a session for one must never be mistaken for
 * a session in the other.
 *
 * Since docs/ADR-011-supabase-auth-migration.md, the token is Supabase
 * Auth-issued, not signed by this app -- and Supabase Auth sessions come in
 * pairs (a short-lived access token, a refresh token to mint the next one),
 * so the cookie now holds both as JSON rather than a bare token string.
 * Nothing here uses the refresh token to auto-refresh mid-render: Next only
 * allows writing cookies from a Server Action or Route Handler, not during a
 * page's render, so a session's lifetime is still bounded by the access
 * token's TTL, same as before this migration -- only `/api/onyx/switch`
 * (a Route Handler) reads the refresh token, to mint a session scoped to the
 * newly chosen tenant.
 */
export const ONYX_COOKIE = 'onyx_tenant_session';

export type Role =
  | 'student' | 'faculty' | 'exams' | 'placement' | 'employer' | 'admin' | 'guardian';

export interface OnyxClaims {
  user_id: string;
  tenant_id: number;
  tenant_role: Role;
  email: string;
  exp: number;
}

export interface Tenant {
  id: number; name: string; slug: string; plan: string | null;
  /** Whether faculty may schedule an exam themselves, or every one has to
   *  come from admin or the exams office. Set from Settings, admin only. */
  faculty_can_schedule_exams?: boolean;
  /** Whether learners may register themselves, and from which email domains. */
  student_signup?: boolean;
  signup_domains?: string;
  /**
   * How a student may self-register: 'domain' (their address decides, and
   * admits them at once) or 'request' (they pick this institution and somebody
   * here approves). Only meaningful while `student_signup` is on.
   */
  signup_mode?: string;
  /** The community an institution runs, shown on Jobs. See 0036. */
  community_url?: string | null;
  community_label?: string | null;
}

export interface Me {
  /**
   * Their profile picture, already resolved to a URL, or null.
   *
   * On /me because every screen fetches it, so the header can draw an avatar
   * without a second request on every page in the product.
   */
  photo_url?: string | null;
  user_id: string;
  /** Null for an account somehow missing a name row -- email is the fallback. */
  name: string | null;
  email: string;
  role: Role;
  /** This institution's own number for them. Null where it does not use them. */
  roll_number: string | null;
  tenant: Tenant;
  memberships: { tenant: Tenant; role: Role }[];
}

export interface OnyxSessionCookie {
  token: string;
  refresh_token: string;
  expires_at: number;
}

const API = appOrigin();

function decodeClaims(token: string): OnyxClaims | null {
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as OnyxClaims;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    // A session without a tenant cannot be scoped to one, so it is not a
    // session. The API refuses it too; this only decides what to render.
    if (!claims.tenant_id || !claims.tenant_role) return null;
    return claims;
  } catch {
    return null;
  }
}

async function readCookie(): Promise<OnyxSessionCookie | null> {
  const raw = (await cookies()).get(ONYX_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OnyxSessionCookie;
    return parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export async function getOnyxToken(): Promise<string | null> {
  return (await readCookie())?.token ?? null;
}

/** Only /api/onyx/switch (a Route Handler) needs this -- see the module comment. */
export async function getOnyxRefreshToken(): Promise<string | null> {
  return (await readCookie())?.refresh_token ?? null;
}

export async function getOnyxSession(): Promise<OnyxClaims | null> {
  const token = await getOnyxToken();
  return token ? decodeClaims(token) : null;
}

export async function onyxApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getOnyxToken();
  const res = await fetch(API + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({ ok: false, message: 'Bad response' }));
  if (!body.ok) throw new Error(body.message || 'Request failed: ' + path);
  return body.data as T;
}

export async function onyxApiSafe<T>(path: string): Promise<T | null> {
  try { return await onyxApi<T>(path); } catch { return null; }
}

/**
 * `returnTo` sends the visitor back where they were trying to go once they
 * have signed in. Pass it only where losing the URL actually costs something:
 * for most pages the dashboard is a fine landing spot, but the attendance
 * check-in carries a code in its query string that rotates within seconds, so
 * dropping it means the learner has to find the projector again.
 *
 * The login page validates the value before using it -- see `safeNext` there.
 */
export async function requireOnyxSession(returnTo?: string): Promise<OnyxClaims> {
  const session = await getOnyxSession();
  if (!session) {
    // Where they were trying to go, ALWAYS -- not only where a caller
    // remembered to pass it.
    //
    // This used to take `returnTo` from the caller and almost nobody passed
    // one, so a lecturer sharing a link to a paper sent their students to the
    // sign-in page and then to the dashboard, with no way back to the thing
    // they had been sent. The path is already on the request (middleware.ts
    // sets it for every route); reading it here means every gated page keeps
    // its destination without each one having to remember to.
    const head = await headers();
    const here = returnTo
      ?? ((head.get('x-pathname') ?? '') + (head.get('x-search') ?? ''));
    redirect(here && here.startsWith('/onyx')
      ? '/onyx/login?next=' + encodeURIComponent(here)
      : '/onyx/login');
  }
  return session;
}

/**
 * F-04 at the page level. The API enforces this too -- this only keeps someone
 * from being shown a page whose every request would then fail.
 */
export async function requireOnyxPageRole(...allowed: Role[]): Promise<OnyxClaims> {
  const session = await requireOnyxSession();
  // Signed in, but not for this. The link was still worth following -- it is
  // the role that is wrong, not the address -- so this is /onyx/denied rather
  // than a sign-in page that would ask them to prove something they have
  // already proved.
  if (!allowed.includes(session.tenant_role)) redirect('/onyx/denied');
  return session;
}

// Role labels live in lib/onyx-nav.ts: client components need them, and this
// module pulls in next/headers, which they cannot import.
