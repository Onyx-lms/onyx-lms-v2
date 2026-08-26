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
import { dispatchApi } from '@/server/api-dispatch';

/**
 * Node, not Edge, and not negotiable: `nodemailer`, `pg`, `bcryptjs` and
 * `node:crypto`'s HMAC / timingSafeEqual / randomBytes are all unavailable on
 * the Edge runtime, and they are load-bearing (attendance QR codes, checkout
 * intent signing, certificate checksums).
 */
export const runtime = 'nodejs';
/** Every route is request-scoped; caching one would serve another tenant's read. */
export const dynamic = 'force-dynamic';


/**
 * The API over HTTP, for the browser.
 *
 * The dispatch itself lives in `server/api-dispatch.ts` so a Server Component
 * can call it without a network round trip -- see that file's header. This
 * module is the HTTP door onto the same function.
 */
export const GET = (req: Request, c: { params: Promise<{ path: string[] }> }) =>
  dispatchApi(req, c.params);
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
