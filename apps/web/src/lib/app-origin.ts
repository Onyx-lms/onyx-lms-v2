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

/**
 * Where a *person* reaches this deployment, for the URLs we print rather than
 * fetch.
 *
 * Not `appOrigin()`. That one answers "where does this server call its own
 * API", and on Vercel it resolves to `API_URL` — an alias chosen so that
 * server-to-server calls dodge the SSO wall. This one answers "what should we
 * write on a certificate", and the two are only incidentally the same string.
 *
 * WHY THIS EXISTS. `GET /certificates/:id/document.pdf` passed
 * `process.env.WEB_URL` straight through, and `WEB_URL` is set nowhere — so
 * `certificatePdf` fell back to its own literal and every certificate this
 * product has ever issued was printed with
 * `Verify at http://127.0.0.1:5173/onyx/verify/<id>` across its foot. The
 * document whose entire job is to carry a reader to the verification page was
 * sending them to their own machine. The identical bug was found and fixed for
 * payment return URLs (see `app-context.ts`, `baseUrl`); this is the same fact
 * under a third name, so it is resolved once here instead of a fourth time.
 *
 * Resolution order, most explicit first:
 *
 *   WEB_URL                        set deliberately for this purpose.
 *   WEB_ORIGIN                     the same fact under the name that is
 *                                  actually set in production.
 *   VERCEL_PROJECT_PRODUCTION_URL  the stable production alias Vercel injects.
 *                                  Unlike VERCEL_URL this is not the
 *                                  deployment-specific hostname, so it does
 *                                  not sit behind Deployment Protection and it
 *                                  does not change every push — both of which
 *                                  matter for a string printed on paper that
 *                                  somebody may type in a year from now.
 *   localhost                      development, where 5173 is correct.
 *
 * `|| not ??` throughout: an env var present but blank is unset, and blank is
 * exactly how these arrive from a .env file with nothing after the `=`.
 */
export function publicOrigin(): string {
  const explicit = process.env.WEB_URL || process.env.WEB_ORIGIN;
  if (explicit) return explicit.replace(/\/+$/, '');

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  // Vercel's system variables carry no scheme, and its deployments are https.
  if (production) return 'https://' + production.replace(/\/+$/, '');

  return 'http://127.0.0.1:5173';
}
