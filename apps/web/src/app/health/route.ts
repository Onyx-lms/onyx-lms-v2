/**
 * `/health`, the one registered route that does not live under `/api/`.
 *
 * The catch-all is mounted at `app/api/[...path]`, so it cannot see a root path.
 * Rather than move the endpoint -- `tools/e2e-run.mjs` waits on it, and a health
 * check that changed address during a migration is a health check that reports
 * the migration as an outage -- it gets its own handler and delegates into the
 * same route table.
 *
 * Answers 503 when a probe fails, because the point of SCL-03's version of this
 * endpoint is that a load balancer can act on the status line without parsing
 * the body.
 */
import { NextResponse } from 'next/server';
import { routeTable } from '@/server/routes';
import { createReply, errorBody, NOT_FOUND_BODY } from '@/server/router';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const hit = routeTable().match('GET', '/health');
  if (!hit) return NextResponse.json(NOT_FOUND_BODY, { status: 404 });

  const { reply, captured } = createReply();
  try {
    const result = await hit.route.handler({
      method: 'GET',
      url: '/health',
      params: {},
      query: {},
      body: undefined,
      headers: {},
      cookies: {},
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      rawBody: '',
      log: {
        info: (...a) => console.log('[api]', ...a),
        warn: (...a) => console.warn('[api]', ...a),
        error: (...a) => console.error('[api]', ...a),
      },
    }, reply);
    const payload = captured.didSend ? captured.body : result;
    return NextResponse.json(payload, { status: captured.status, headers: captured.headers });
  } catch (err) {
    const { status, body } = errorBody(err);
    return NextResponse.json(body, { status });
  }
}
