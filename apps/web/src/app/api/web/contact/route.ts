import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const res = await fetch((process.env.API_URL ?? 'http://127.0.0.1:4000') + '/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await res.json().catch(() => ({ message: 'Unexpected response.' }));
  return NextResponse.json(payload, { status: res.status });
}
