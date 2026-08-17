import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Server-side session.
 *
 * The API sets its cookie on the API origin, which the browser will not send to
 * the web origin. So the web app proxies auth through its own route handlers and
 * keeps the token in a cookie it owns, forwarding it as a Bearer header. The
 * token never reaches client JavaScript.
 */
export const TOKEN_COOKIE = 'onyx_session';

export type AppRole = 'admin' | 'instructor' | 'student' | 'user';

export interface Claims { user_id: number; app_role: AppRole; email: string; exp: number }

function decodeClaims(token: string): Claims | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as Claims;
    // The API verifies the signature on every call; this read only decides which
    // chrome to render and never grants access on its own.
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getToken(): Promise<string | null> {
  return (await cookies()).get(TOKEN_COOKIE)?.value ?? null;
}

export async function getSession(): Promise<Claims | null> {
  const token = await getToken();
  return token ? decodeClaims(token) : null;
}

export async function apiAuth<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const res = await fetch((process.env.API_URL ?? 'http://127.0.0.1:4000') + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({ ok: false, message: 'Bad response' }));
  if (!body.ok) throw new Error(body.message || `Request failed: ${path}`);
  return body.data as T;
}

export async function apiAuthSafe<T>(path: string): Promise<T | null> {
  try { return await apiAuth<T>(path); } catch { return null; }
}

export async function requireSession(): Promise<Claims> {
  const session = await getSession();
  // The STOREFRONT's sign-in, not Onyx's. This guard protects storefront pages
  // -- cart, checkout, purchases, messages -- and they run on this session,
  // which Onyx's cookie is not. Sending them to /login would bounce them to
  // Onyx, where a correct storefront password is refused and the page they
  // wanted stays out of reach.
  if (!session) redirect('/login/store');
  return session;
}

export async function requireRole(...allowed: AppRole[]): Promise<Claims> {
  const session = await requireSession();
  if (!allowed.includes(session.app_role)) redirect('/denied');
  return session;
}

/** Where each role lands after signing in, matching routes/web.php. */
export function homeForRole(role: AppRole): string {
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'instructor') return '/instructor/dashboard';
  if (role === 'student') return '/my-courses';
  return '/';
}
