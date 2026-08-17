import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ONYX_COOKIE, getOnyxToken, getOnyxRefreshToken } from '@/lib/onyx-session';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000';

/**
 * Onyx auth, proxied so the token can be stored in a cookie this origin owns.
 *
 * An allow-list rather than a passthrough: `login` is open by design, `switch`
 * needs the caller's current session, and nothing else is reachable through
 * here at all.
 *
 * `signup` used to sit here, open, pointing at POST /api/onyx/tenants — which
 * meant anyone who could load the sign-in page could create an institution and
 * make themselves its administrator. Institutions are now created only by a
 * platform admin, only from the platform console, so the entry is gone rather
 * than merely hidden: a route that is not in this map is not reachable.
 */
const ROUTES: Record<string, { path: string; authed: boolean }> = {
  login: { path: '/api/onyx/auth/login', authed: false },
  switch: { path: '/api/onyx/auth/switch', authed: true },
};

export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const route = ROUTES[action];
  if (!route) return NextResponse.json({ ok: false, message: 'Unknown action.' }, { status: 404 });

  const token = route.authed ? await getOnyxToken() : null;
  if (route.authed && !token) {
    return NextResponse.json({ ok: false, message: 'Unauthenticated.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  // `switch` needs the caller's refresh token to mint a session scoped to
  // the newly chosen tenant (docs/ADR-011-supabase-auth-migration.md) -- the
  // browser never holds it (httpOnly), so this Route Handler reads it from
  // the cookie itself rather than trusting the request body for it.
  if (action === 'switch') {
    const refreshToken = await getOnyxRefreshToken();
    if (!refreshToken) return NextResponse.json({ ok: false, message: 'Unauthenticated.' }, { status: 401 });
    body.refresh_token = refreshToken;
  }

  const res = await fetch(API + route.path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({ ok: false, message: 'Bad response' }));

  // The session carries the tenant, so switching institutions replaces the
  // cookie. Anything less and the new tenant would be shown through the old
  // session's scope.
  if (res.ok && payload?.data?.token) {
    (await cookies()).set(ONYX_COOKIE, JSON.stringify({
      token: payload.data.token,
      refresh_token: payload.data.refresh_token,
      expires_at: payload.data.expires_at,
    }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Number(process.env.ACCESS_TOKEN_TTL ?? 3600),
    });
    delete payload.data.token;
    delete payload.data.refresh_token;
    delete payload.data.expires_at;
  }
  return NextResponse.json(payload, { status: res.status });
}

export async function DELETE() {
  (await cookies()).delete(ONYX_COOKIE);
  return NextResponse.json({ ok: true, data: {} });
}
