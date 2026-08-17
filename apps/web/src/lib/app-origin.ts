/**
 * This app's own origin, for the server-side code that calls its own API.
 *
 * Eleven modules used to carry the same literal fallback,
 * `process.env.API_URL ?? 'http://127.0.0.1:4000'`, from when the API was a
 * separate Fastify process on that port. That process is gone (docs/ADR-012), so
 * every one of those fallbacks pointed at nothing -- harmless locally, where
 * `API_URL` is always set in apps/web/.env.local, and a silent outage on any
 * deployment where somebody forgot to set it. Eleven copies of a wrong default is
 * also eleven places to fix it, which is why this is one function.
 *
 * Resolution order, most explicit first:
 *
 *   API_URL      set deliberately, and it wins.
 *   VERCEL_URL   injected by Vercel per deployment, without a scheme.
 *   localhost    the dev server's port, which this project runs on 5175.
 *
 * VERCEL_URL IS NOT ENOUGH WHEN DEPLOYMENT PROTECTION IS ON.
 *
 * It looks like the obvious default -- self-configuring, and per-deployment, so a
 * preview would call its own preview rather than production. It does not work on
 * this project, and the failure is nasty: `VERCEL_URL` is the *deployment-specific*
 * hostname, and with Vercel Authentication enabled that hostname 302s to an SSO
 * login page. The public alias does not. So every self-fetch reached Vercel's auth
 * wall instead of the app, and the symptom was a 401 from
 * `/api/web/onyx/login` -- a login page that refused every correct password, while
 * the very same credentials worked against the alias directly.
 *
 * Hence `API_URL` is set explicitly in production, to the alias. Preview
 * deployments are left resolving VERCEL_URL and will hit the same wall until
 * either protection is turned off for them or they are given their own API_URL --
 * recorded here rather than discovered again, and deliberately not "fixed" by
 * pointing previews at production, which would let a preview write to real data.
 *
 * Server-only. The browser must use relative paths (`/api/...`) so the request
 * carries the session cookie; an absolute origin here would be a cross-origin
 * request to itself with the credentials stripped.
 */
export function appOrigin(): string {
  const explicit = process.env.API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercel = process.env.VERCEL_URL;
  // VERCEL_URL has no scheme, and Vercel deployments are always https.
  if (vercel) return 'https://' + vercel.replace(/\/+$/, '');

  return 'http://127.0.0.1:5175';
}
