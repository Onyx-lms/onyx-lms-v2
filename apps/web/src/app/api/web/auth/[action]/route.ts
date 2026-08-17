import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { TOKEN_COOKIE } from '@/lib/session';
import { appOrigin } from '@/lib/app-origin';

const API = appOrigin();

/** Allow-list, not a passthrough proxy. */
const ROUTES: Record<string, string> = {
  login: '/api/auth/login',
  register: '/api/auth/register',
  forgot: '/api/auth/password/forgot',
  reset: '/api/auth/password/reset',
  verify: '/api/auth/email/verify',
  resend: '/api/auth/email/resend',
};

export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const target = ROUTES[action];
  if (!target) return NextResponse.json({ ok: false, message: 'Unknown action.' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const res = await fetch(API + target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({ ok: false, message: 'Bad response' }));

  // Store the token in a cookie this origin owns, httpOnly so page scripts
  // cannot read it, then strip it from the response body.
  if (res.ok && payload?.data?.token) {
    (await cookies()).set(TOKEN_COOKIE, payload.data.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Number(process.env.ACCESS_TOKEN_TTL ?? 3600),
    });
    delete payload.data.token;
  }
  return NextResponse.json(payload, { status: res.status });
}

export async function DELETE() {
  (await cookies()).delete(TOKEN_COOKIE);
  return NextResponse.json({ ok: true, data: {} });
}
