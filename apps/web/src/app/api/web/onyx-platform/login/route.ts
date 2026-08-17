import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PLATFORM_COOKIE } from '@/lib/onyx-platform-session';
import { appOrigin } from '@/lib/app-origin';

const API = appOrigin();

/**
 * Platform sign-in, proxied the same way onyx/[action]/route.ts handles
 * tenant sign-in -- so the token lands in an httpOnly cookie this origin
 * owns rather than in a script that could read it back out.
 *
 * A separate file rather than a branch in that one: the two cookies
 * (`onyx_tenant_session`, `onyx_platform_session`) must never be written by
 * the same code path, or a bug in one login flow can plant the wrong kind of
 * token under the other's name.
 */
export async function POST(request: Request) {
  const res = await fetch(API + '/api/onyx/platform/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await request.json().catch(() => ({}))),
  });
  const payload = await res.json().catch(() => ({ ok: false, message: 'Bad response' }));

  if (res.ok && payload?.data?.token) {
    (await cookies()).set(PLATFORM_COOKIE, JSON.stringify({
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
  (await cookies()).delete(PLATFORM_COOKIE);
  return NextResponse.json({ ok: true, data: {} });
}
