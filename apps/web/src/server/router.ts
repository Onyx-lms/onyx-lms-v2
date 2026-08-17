/**
 * A Fastify-shaped router, so 574 route handlers do not have to be rewritten.
 *
 * v2 serves the API from Next.js on Vercel instead of a separately hosted
 * Fastify process (docs/ADR-012). The route files were the obvious casualty of
 * that move -- 33 files, 574 handlers, 3,872 lines -- but they turn out to be
 * portable already: they call `requireOnyx(asReq(req), ...)`, read
 * `req.body/query/params/headers/cookies/ip`, and `return ok(...)`. None of that
 * is Fastify, it is just shaped like it. Across all 574 handlers `reply` is
 * touched 22 times.
 *
 * So this reproduces the shape rather than porting the routes: the files import
 * `Router` instead of `FastifyInstance` and are otherwise untouched. Hand-porting
 * would have meant 574 new files and 574 chances to fumble a guard, in a diff
 * nobody could review.
 *
 * The matcher below is the load-bearing part and the only place with real logic,
 * which is why it has its own tests (router.test.ts). A precedence bug here does
 * not fail loudly -- it silently routes a request to the wrong handler.
 */
import { HttpError } from '@onyx/core';

export interface ReqLike {
  method: string;
  url: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  cookies: Record<string, string | undefined>;
  ip: string | null;
  /** The exact bytes received. Webhook signatures are computed over these, so
   *  re-serialising `body` would fail every check -- same reason the Fastify
   *  server kept a custom content-type parser. */
  rawBody: string;
  log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  /**
   * The uploaded file, for the two multipart routes.
   *
   * `@fastify/multipart`'s shape, reproduced: `POST /api/media` and
   * `POST /api/onyx/courses/:id/resources/upload` both call `req.file()` and
   * then `file.toBuffer()`.
   *
   * This was the one Fastify API the shim missed, and it hid from every check
   * that should have caught it: both routes reach it through
   * `(req as unknown as { file: ... }).file()`, so the compiler saw nothing, and
   * a grep for `req.file` found nothing either -- the cast breaks the token up.
   * The result was a 500 on every upload, which the parity probes never exercised
   * because they are all JSON.
   *
   * Optional so nothing else has to know it exists; the two routes cast to a type
   * that requires it and would fail loudly rather than silently if it vanished.
   */
  file?: () => Promise<MultipartFile | undefined>;
}

export interface MultipartFile {
  filename: string;
  mimetype: string;
  toBuffer: () => Promise<Buffer>;
}

export interface CookieOptions {
  httpOnly?: boolean;
  sameSite?: 'lax' | 'strict' | 'none' | boolean;
  secure?: boolean;
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
}

/**
 * The 22 `reply` calls that exist, and nothing more.
 *
 * Every method returns `this` because the routes chain them, and `send()`
 * returns a sentinel rather than a Response: the catch-all decides how to
 * serialise, since a Buffer has to become a stream to escape Vercel's 4.5 MB
 * response cap while a string can go out directly.
 */
export interface ReplyLike {
  header(name: string, value: string): ReplyLike;
  status(code: number): ReplyLike;
  code(code: number): ReplyLike;
  type(contentType: string): ReplyLike;
  setCookie(name: string, value: string, opts?: CookieOptions): ReplyLike;
  clearCookie(name: string, opts?: CookieOptions): ReplyLike;
  send(payload?: unknown): unknown;
}

export type Handler = (req: ReqLike, reply: ReplyLike) => unknown | Promise<unknown>;
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * What the route files are handed in place of a FastifyInstance.
 *
 * The unused type parameter exists so `app.get<{ Params: { language: string } }>`
 * still compiles. Exactly one of the 574 registrations annotates itself that
 * way (platform.routes.ts:37) and the point of this shim is that no route file
 * has to be edited beyond its import line -- accepting and discarding the
 * parameter is cheaper than making that one route the exception.
 */
export interface Router {
  get<_T = unknown>(path: string, handler: Handler): void;
  post<_T = unknown>(path: string, handler: Handler): void;
  put<_T = unknown>(path: string, handler: Handler): void;
  patch<_T = unknown>(path: string, handler: Handler): void;
  delete<_T = unknown>(path: string, handler: Handler): void;
}

interface Route {
  method: Method;
  /** As declared, e.g. `/api/onyx/courses/:id/outline`. Also the metrics label. */
  pattern: string;
  segments: string[];
  /** Count of literal (non-`:param`) segments -- the specificity tie-break. */
  statics: number;
  handler: Handler;
}

export interface RouteTable extends Router {
  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null;
  readonly routes: readonly Route[];
}

/** Trailing slashes are equivalent, and `//` is not a segment. */
function split(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

export function createRouter(): RouteTable {
  const routes: Route[] = [];
  let sorted = false;

  const add = (method: Method) => (path: string, handler: Handler): void => {
    const segments = split(path);
    routes.push({
      method,
      pattern: path,
      segments,
      statics: segments.filter((s) => !s.startsWith(':')).length,
      handler,
    });
    sorted = false;
  };

  /**
   * Static segments beat parameters at the same depth.
   *
   * Fastify does this, and several route pairs here depend on it -- register
   * order is not reliable, because the pairs live in different files registered
   * in an order chosen for readability. Concretely:
   *
   *   GET /api/onyx/exams/upcoming   must not be captured by
   *   GET /api/onyx/exams/:id        (which would parse "upcoming" as an id)
   *
   * Sorting by static-segment count descending gets that right regardless of
   * which file registered first. Longer patterns are compared first so a
   * deeper, more specific route wins over a shallower one.
   */
  function ensureSorted(): void {
    if (sorted) return;
    routes.sort((a, b) =>
      b.segments.length - a.segments.length
      || b.statics - a.statics
      || a.pattern.localeCompare(b.pattern));
    sorted = true;
  }

  return {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    patch: add('PATCH'),
    delete: add('DELETE'),
    get routes() { return routes; },

    match(method, pathname) {
      ensureSorted();
      const parts = split(pathname);
      const wanted = method.toUpperCase();

      for (const route of routes) {
        if (route.method !== wanted) continue;
        if (route.segments.length !== parts.length) continue;

        const params: Record<string, string> = {};
        let ok = true;
        for (let i = 0; i < route.segments.length; i += 1) {
          const seg = route.segments[i]!;
          const got = parts[i]!;
          if (seg.startsWith(':')) {
            // A parameter never matches empty, and the value arrives
            // percent-decoded -- `idOf`/`userIdOf` in the route files expect
            // the decoded form, and a uuid or slug can legally contain one.
            if (!got) { ok = false; break; }
            try {
              params[seg.slice(1)] = decodeURIComponent(got);
            } catch {
              params[seg.slice(1)] = got; // malformed %-escape: pass through
            }
          } else if (seg !== got) {
            ok = false;
            break;
          }
        }
        if (ok) return { route, params };
      }
      return null;
    },
  };
}

/* ------------------------------------------------------------------ reply --- */

const SENT = Symbol('reply.sent');

export interface CapturedReply {
  status: number;
  headers: Record<string, string>;
  cookies: { name: string; value: string; opts: CookieOptions }[];
  /** Set only if the handler called `send()`; distinct from `send(undefined)`. */
  body: unknown;
  didSend: boolean;
}

/**
 * A reply whose effects are recorded rather than written.
 *
 * Headers set before a `throw` must survive onto the error response -- the
 * login route does exactly that (`reply.header('Retry-After', ...)` and then
 * `throw tooManyRequests()`), and Fastify keeps them. So the catch-all reads
 * this object on the error path too, not just the success path.
 */
export function createReply(): { reply: ReplyLike; captured: CapturedReply } {
  const captured: CapturedReply = {
    status: 200, headers: {}, cookies: [], body: undefined, didSend: false,
  };
  const reply: ReplyLike = {
    header(name, value) { captured.headers[name.toLowerCase()] = value; return reply; },
    status(code) { captured.status = code; return reply; },
    code(code) { captured.status = code; return reply; },
    type(contentType) { captured.headers['content-type'] = contentType; return reply; },
    setCookie(name, value, opts = {}) { captured.cookies.push({ name, value, opts }); return reply; },
    clearCookie(name, opts = {}) {
      captured.cookies.push({ name, value: '', opts: { ...opts, maxAge: 0, expires: new Date(0) } });
      return reply;
    },
    send(payload) { captured.body = payload; captured.didSend = true; return SENT; },
  };
  return { reply, captured };
}

export const REPLY_SENT = SENT;

/* ------------------------------------------------------------------ errors -- */

/**
 * Is this one of ours?
 *
 * Deliberately structural, not `err instanceof HttpError`. Under Next, the route
 * files reach `@onyx/core` by relative path while this module imports it by
 * package name, and the bundler resolves those to two separate copies -- so a
 * service throws an `HttpError` from one copy and `instanceof` against the other
 * copy's constructor is false. The failure mode was quiet and wrong rather than
 * loud: `GET /api/onyx/me` with no token fell through to the generic branch and
 * answered **500** with the body of a 401, because in development that branch
 * echoes `err.message` and the message happened to be "Unauthenticated."
 *
 * `name`, `status` and `toBody` survive any number of module instances.
 */
function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError
    || (err instanceof Error
      && err.name === 'HttpError'
      && typeof (err as HttpError).status === 'number'
      && typeof (err as HttpError).toBody === 'function');
}

/** P-08: every failure leaves through one envelope -- byte-for-byte the one the
 *  Fastify server's error handler produced, which is why response shapes did not
 *  change when it was removed. */
export function errorBody(err: unknown): { status: number; body: unknown } {
  if (isHttpError(err)) return { status: err.status, body: err.toBody() };
  const production = process.env.NODE_ENV === 'production';
  return {
    status: 500,
    body: {
      ok: false,
      level: 'error',
      message: production ? 'Something went wrong.' : (err as Error)?.message ?? 'Something went wrong.',
    },
  };
}

export const NOT_FOUND_BODY = { ok: false, level: 'error', message: 'Not found.' } as const;
