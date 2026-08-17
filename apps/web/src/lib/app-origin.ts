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
 *   API_URL      set deliberately, and it wins. Also the escape hatch for
 *                pointing a preview build at another environment.
 *   VERCEL_URL   injected by Vercel per deployment, without a scheme. This is
 *                what makes a deployment self-configuring rather than needing a
 *                variable set to its own address -- and it is per-deployment, so
 *                a preview build calls its own preview rather than production.
 *   localhost    the dev server's port, which this project runs on 5175.
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
