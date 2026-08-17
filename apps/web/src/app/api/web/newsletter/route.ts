import { NextResponse } from 'next/server';
import { appOrigin } from '@/lib/app-origin';

/** Proxy so the API base URL and its rate limiting stay server-side. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const res = await fetch(appOrigin() + '/api/newsletter/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await res.json().catch(() => ({ message: 'Unexpected response.' }));
  return NextResponse.json(payload, { status: res.status });
}
