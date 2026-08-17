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

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
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
