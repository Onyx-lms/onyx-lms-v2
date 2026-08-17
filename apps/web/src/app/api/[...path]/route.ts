/**
 * The API, served from Next.js instead of a separately hosted Fastify process.
 *
 * One handler for all 574 routes. It matches the request against the table the
 * route files registered into (see src/server/routes.ts), builds the request
 * shape those handlers already expect, and maps the result -- or the thrown
 * HttpError -- into the single response envelope P-08 requires.
 *
 * Nothing under `api/web/**` reaches here: Next prefers a more specific
 * segment over a catch-all, which is also why those five hand-written handlers
 * had to move. `api/web/onyx/[action]` would otherwise have captured
 * /api/onyx/me, /api/onyx/courses, /api/onyx/members and every other
 * single-segment Onyx route.
 */
import { NextResponse, after } from 'next/server';
import { cookies } from 'next/headers';
import { routeTable } from '@/server/routes';
import { ctx } from '@/server/context';
import { bearerFor } from '@/server/auth-adapter';
import { afterFor } from '@/server/after-dispatch';
import {
  createReply, errorBody, NOT_FOUND_BODY, REPLY_SENT,
  type ReqLike, type CapturedReply,
} from '@/server/router';

/**
 * Node, not Edge, and not negotiable: `nodemailer`, `pg`, `bcryptjs` and
 * `node:crypto`'s HMAC / timingSafeEqual / randomBytes are all unavailable on
 * the Edge runtime, and they are load-bearing (attendance QR codes, checkout
 * intent signing, transcript checksums).
 */
export const runtime = 'nodejs';
/** Every route is request-scoped; caching one would serve another tenant's read. */
export const dynamic = 'force-dynamic';

/** Repeated query keys collapse to an array, which is what Fastify hands over. */
function queryFrom(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    out[key] = all.length > 1 ? all : all[0]!;
  }
  return out;
}

function headersFrom(request: Request): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  request.headers.forEach((value, key) => { out[key.toLowerCase()] = value; });
  return out;
}

/**
 * The client's address, for the rate limiter and the audit log.
 *
 * Vercel sets `x-forwarded-for`; the first entry is the client and the rest are
 * proxies. Taking the whole header would key the limiter on a string that
 * changes with the proxy path.
 */
function ipFrom(request: Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip');
}

/**
 * Serialises whatever the handler produced.
 *
 * A Buffer becomes a stream rather than a body: Vercel caps a *response* at
 * 4.5 MB but exempts streamed ones, and the five CSV/PDF export routes can
 * exceed it on a large cohort. Everything else is JSON, which is what the 567
 * handlers that just `return ok(...)` produce.
 */
function respond(payload: unknown, captured: CapturedReply): Response {
  const headers = new Headers(captured.headers);
  const status = captured.status;

  let body: BodyInit | null;
  if (payload === undefined || payload === null) {
    body = null;
  } else if (payload instanceof Uint8Array) {
    body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(payload); controller.close(); },
    });
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
  } else if (typeof payload === 'string') {
    body = payload;
    if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');
  } else {
    body = JSON.stringify(payload);
    headers.set('content-type', 'application/json; charset=utf-8');
  }

  const res = new NextResponse(body, { status, headers });
  for (const c of captured.cookies) {
    res.cookies.set({
      name: c.name,
      value: c.value,
      httpOnly: c.opts.httpOnly,
      sameSite: c.opts.sameSite === true ? 'lax'
        : c.opts.sameSite === false ? undefined : c.opts.sameSite,
      secure: c.opts.secure,
      path: c.opts.path,
      domain: c.opts.domain,
      maxAge: c.opts.maxAge,
      expires: c.opts.expires,
    });
  }
  return res;
}

async function handle(request: Request, params: Promise<{ path: string[] }>): Promise<Response> {
  const { path: segments } = await params;
  const url = new URL(request.url);
  const table = routeTable();
  const hit = table.match(request.method, url.pathname);
  if (!hit) return NextResponse.json(NOT_FOUND_BODY, { status: 404 });

  /**
   * The body is read as text once and parsed from that, never re-read.
   *
   * Two reasons, both inherited from the Fastify server's custom content-type
   * parser (apps/api/src/server.ts:52-62). Webhook signatures are computed over
   * the exact bytes the gateway sent, so `rawBody` has to survive; and an empty
   * body must arrive as `undefined` rather than `''`, because several bodyless
   * POSTs distinguish the two and `JSON.parse('')` throws.
   *
   * Multipart is left alone: `request.formData()` is the only way to read it
   * here, and the one route that needs it reads it itself.
   */
  const contentType = request.headers.get('content-type') ?? '';
  let rawBody = '';
  let body: unknown;
  if (request.method !== 'GET' && !contentType.startsWith('multipart/')) {
    rawBody = await request.text();
    if (rawBody !== '') {
      if (contentType.includes('application/json') || contentType === '') {
        try {
          body = JSON.parse(rawBody);
        } catch {
          return NextResponse.json(
            { ok: false, level: 'error', message: 'Malformed JSON body.' }, { status: 400 });
        }
      } else {
        body = rawBody;
      }
    }
  }

  const jar = await cookies();
  const authorization = bearerFor(segments, request.headers.get('authorization'),
    (name) => jar.get(name)?.value);

  const headers = headersFrom(request);
  if (authorization) headers.authorization = authorization;
  else delete headers.authorization;

  const req: ReqLike = {
    method: request.method,
    url: url.pathname + url.search,
    params: hit.params,
    query: queryFrom(url),
    body,
    headers,
    // Deliberately empty -- see server/auth-adapter.ts for why handing the
    // browser's cookies to a handler would cross the port's token with Onyx's.
    cookies: {},
    ip: ipFrom(request),
    rawBody,
    log: {
      info: (...a) => console.log('[api]', ...a),
      warn: (...a) => console.warn('[api]', ...a),
      error: (...a) => console.error('[api]', ...a),
    },
  };

  const { reply, captured } = createReply();
  try {
    const result = await hit.route.handler(req, reply);

    /**
     * Follow-up work, after the response and only when the handler succeeded.
     *
     * Registered per route in server/after-dispatch.ts -- today that is the code
     * submission route draining the grading queue it just enqueued into. Placed
     * after the handler resolved so a failed submit does not trigger a drain for
     * a job that was never created, and inside `after()` so the platform keeps
     * the invocation alive rather than killing the work when the body flushes.
     *
     * Failures here are logged, never surfaced: the response has already gone,
     * and the cron endpoint will retry whatever this pass missed.
     */
    const follow = afterFor(req.method, hit.route.pattern);
    if (follow) {
      after(async () => {
        try {
          await follow(ctx());
        } catch (err) {
          console.error('[after] ' + req.method + ' ' + hit.route.pattern + ' follow-up failed', err);
        }
      });
    }

    // `send()` returns a sentinel, so "the handler used reply" is distinguishable
    // from "the handler returned undefined".
    const payload = result === REPLY_SENT || (result === undefined && captured.didSend)
      ? captured.body
      : result;
    return respond(payload, captured);
  } catch (err) {
    const { status, body: errBody } = errorBody(err);
    // Headers set before the throw are kept, because Fastify keeps them -- the
    // login route sets Retry-After and then throws tooManyRequests().
    return respond(errBody, { ...captured, status, cookies: captured.cookies });
  }
}

export const GET = (req: Request, c: { params: Promise<{ path: string[] }> }) => handle(req, c.params);
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
