import fs from 'node:fs';

/**
 * The repository-root `.env`, for local development only.
 *
 * Next reads `.env*` from the app directory, not the workspace root. The API now
 * runs inside this app, so it needs SUPABASE_URL, the service-role key, the
 * Judge0 settings and the rest -- all of which live in the root `.env` that
 * every tool under tools/ reads, and that the Fastify server used to read before
 * the API moved into this app.
 * Duplicating them into apps/web/.env.local would mean two files holding the same
 * service-role key and one of them going stale.
 *
 * Deliberately does not overwrite anything already set: in deployment the values
 * come from Vercel's environment and no `.env` exists at all, so this is a no-op
 * there rather than something to remember to disable.
 */
function loadRootEnv() {
  const path = new URL('../../.env', import.meta.url);
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}
loadRootEnv();

/**
 * QA F1 -- the response headers the deployment was not sending.
 *
 * Vercel adds HSTS and nothing else, so the login form and the invigilation
 * console could both be framed by a third-party page: the standard setup for
 * clickjacking a credential form.
 *
 * **`Permissions-Policy` is the one to read carefully.** It governs camera and
 * microphone delegation, which is exactly what live invigilation depends on --
 * a copied-in policy of `camera=()` would switch that feature off across the
 * product and the failure would look like a broken WebRTC connection rather
 * than a header. So `camera=(self)`, and `microphone=()` because nothing here
 * asks for audio and the day something does is the day to decide it on
 * purpose.
 *
 * **`frame-ancestors 'self'` rather than `X-Frame-Options: DENY`.** Certificate
 * verification pages are public and meant to be linked to; an employer
 * embedding one is a use, not an attack. `SAMEORIGIN`/`'self'` stops the
 * clickjacking case without breaking that.
 *
 * **No full Content-Security-Policy, deliberately.** App Router hydration needs
 * inline scripts, so a CSP without per-request nonces has to allow
 * `'unsafe-inline'` -- which is a header that looks like protection and is not.
 * Doing it properly means generating a nonce in middleware and threading it
 * through every inline script, which is a real piece of work rather than a
 * config line. `frame-ancestors` is the part that is both meaningful and
 * impossible to get subtly wrong, so it ships now and the rest is honest about
 * being outstanding.
 */
const SECURITY_HEADERS = [
  // Stop a browser second-guessing a declared content type -- the reason an
  // uploaded file served as text/plain can be executed as script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  // Send the full URL within this site and only the origin off it: paths here
  // carry attempt ids, credential ids and tenant slugs.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: [
      'camera=(self)',        // live invigilation and the proctoring preflight
      'microphone=()',        // nothing asks for audio
      'geolocation=()',
      'payment=(self)',       // the gateway widget runs on our own page
      'interest-cohort=()',
    ].join(', '),
  },
];

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },

  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },

  /**
   * `@onyx/core`'s entry point is `./src/index.ts` -- raw TypeScript, relying on
   * Node's built-in type stripping rather than a build step. Next will not
   * transpile a workspace package by default, so without this the API routes
   * fail to compile the moment they import a service.
   */
  transpilePackages: ['@onyx/core', '@onyx/types'],

  /**
   * Kept out of the bundle and required at runtime instead.
   *
   * `pg` resolves `pg-native` dynamically and breaks when bundled; `nodemailer`
   * and `bcryptjs` reach for Node internals the bundler cannot follow. All three
   * arrive transitively through `@onyx/core`.
   *
   * `pg` is listed defensively rather than because a request needs it:
   * QueueService moved to PostgREST plus three RPCs (migration 0019), so nothing
   * on a request path opens a Postgres socket. It still reaches the bundler
   * through @onyx/core's barrel export of pool.ts, which tools/db/* rely on.
   */
  serverExternalPackages: ['pg', 'nodemailer', 'bcryptjs'],
};
