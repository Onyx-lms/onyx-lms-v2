/**
 * Shared setup for the browser suite.
 *
 * Seeding (creating institutions and members) goes straight through the API --
 * that is not what these tests are proving. Signing in goes through the real
 * login form in a real page, because that is exactly what they are proving.
 *
 * Reuses tests/e2e/harness.ts for the pieces that do not care whether the
 * caller is node:test or Playwright: the API client, the run-unique suffix,
 * and direct database cleanup.
 */
import type { Page } from '@playwright/test';
import { api, withDb, RUN, WEB, env, createTenant as createTenantAsPlatform } from '../e2e/harness.ts';

export { RUN, WEB, withDb, api };

/** One password for every seeded account; nothing here tests password policy. */
export const PASSWORD = 'OnyxBrowser#2026';

/** A run-unique, collision-free email for a given suite and role. */
export function mail(suite: string, who: string): string {
  return suite + '.' + who + '.' + RUN + '@onyx.test';
}

/**
 * Creates an institution and its first administrator, via the API.
 *
 * Goes through the harness helper because POST /api/onyx/tenants is no longer
 * open: it requires a platform-admin token, which the harness mints and caches.
 */
export async function createTenant(
  name: string, slug: string, adminName: string, adminEmail: string,
): Promise<number> {
  const res = await createTenantAsPlatform({
    name, slug, admin: { name: adminName, email: adminEmail, password: PASSWORD },
  });
  if (!res.ok) throw new Error('createTenant(' + slug + ') failed: ' + res.message);
  return Number(res.data.tenant.id);
}

/**
 * An admin's API bearer token, so members can be seeded without a browser.
 *
 * Cached per address for the life of the worker. Signing in costs TWO calls to
 * GoTrue -- the password grant and the refresh that scopes the session to an
 * institution -- and a full run of this suite makes hundreds of them, which is
 * enough to reach the project's auth rate limit partway through and fail a
 * scattering of unrelated specs with "too many people are signing in at once".
 *
 * Safe to cache precisely because it is the seeding path: the token is used to
 * create fixtures over the seconds after it is minted, never to assert
 * anything about sessions. Anything TESTING sign-in goes through
 * `signInViaForm` and a real browser, which is not cached and must not be.
 */
const seedTokens = new Map<string, Promise<string>>();

export async function adminToken(email: string): Promise<string> {
  const held = seedTokens.get(email);
  if (held) return held;
  const minted = (async () => {
    const res = await api<{ token: string }>('/api/onyx/auth/login', {
      body: { email, password: PASSWORD },
    });
    if (!res.ok) {
      // Not left in the map: a refusal cached is a spec that can never
      // recover, and the commonest refusal here is a temporary rate limit.
      seedTokens.delete(email);
      throw new Error('adminToken(' + email + ') failed: ' + res.message);
    }
    return res.data.token;
  })();
  seedTokens.set(email, minted);
  return minted;
}

export async function addMember(
  token: string, name: string, email: string, role: string,
): Promise<void> {
  const res = await api('/api/onyx/members', {
    token, body: { name, email, role, password: PASSWORD },
  });
  if (!res.ok) throw new Error('addMember(' + email + ') failed: ' + res.message);
}

/**
 * Signs in through the real login form: types into the fields, clicks submit,
 * and waits for the client-side redirect the form does on success. This is
 * the thing the whole suite exists to exercise, so every test that needs a
 * signed-in page goes through here rather than setting a cookie directly.
 */
export async function signInViaForm(page: Page, email: string, password = PASSWORD): Promise<void> {
  /*
   * Whoever was signed in before is signed out first.
   *
   * Without this, signing in as a SECOND person in one test hangs in a way
   * that reads as a broken login page: `/onyx/login` redirects a caller who
   * already has a session to their dashboard, so "Email address" never
   * appears and the fill times out thirty seconds later pointing at the wrong
   * thing entirely. Several specs already did this by hand before calling
   * here; doing it here means the rest cannot forget.
   */
  await page.context().clearCookies();
  await page.goto('/onyx/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/onyx/dashboard');
}

/**
 * A valid six-digit signup code for an address, without sending any email.
 *
 * A test cannot read an inbox, and the alternative -- letting the suite mail
 * real codes -- would be worse than inconvenient. Supabase's built-in SMTP
 * allows only a handful of messages an hour, so a suite that sent one per run
 * would start failing for reasons that have nothing to do with the code under
 * test, and would fail differently depending on what else had run that hour.
 *
 * `generateLink` mints a token and returns it INSTEAD of sending it -- it is
 * the admin call meant for services that deliver their own mail. So this
 * stands in for the mail server: it obtains a code exactly as GoTrue would
 * have mailed one, and the product's own verification path is what is then
 * being exercised.
 *
 * Magic-link first, signup second: an address GoTrue has already seen (a
 * previous attempt, or `signup/start` having run) cannot be issued a signup
 * token, and one it has never seen cannot be issued a magic link.
 */
export async function otpFor(email: string, password = PASSWORD): Promise<string> {
  const { createClient } = await import('@supabase/supabase-js');
  // From the harness's own .env reader rather than process.env: Playwright
  // starts its workers without the file loaded, so the variables the app has
  // at runtime are simply not there in a spec.
  const admin = createClient(
    env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });

  for (const attempt of [
    { type: 'magiclink' as const, email },
    { type: 'signup' as const, email, password },
  ]) {
    const { data, error } = await admin.auth.admin.generateLink(attempt);
    const otp = data?.properties?.email_otp;
    if (!error && otp) return otp;
  }
  throw new Error('otpFor(' + email + ') could not mint a code');
}

/**
 * An authenticated request made BY the page rather than beside it.
 *
 * `page.request` looks like the obvious way to call the API as a signed-in
 * person, and it is a trap here: it will not send a `Secure` cookie over plain
 * http, and this suite runs a production build on http://127.0.0.1. Chromium
 * itself sends it -- 127.0.0.1 counts as a trustworthy origin -- so the page
 * gets 200 for the very request `page.request` gets 401 for, in the same
 * browser, with the same cookie.
 *
 * That failed silently for a long time in the worst possible way: a test
 * asserting a call is REFUSED still passed, because 401 is a refusal. Only the
 * tests expecting success ever noticed.
 *
 * Running the request inside the page fixes it and is also the more honest
 * simulation -- it is exactly what the product's own client code does.
 *
 * Returns the status and headers as well as the body, because two callers care
 * about content-type and content-disposition rather than content.
 */
export async function pageFetch(page: Page, path: string, init: {
  method?: string; data?: unknown; headers?: Record<string, string>;
} = {}): Promise<{ status: number; headers: Record<string, string>; text: string; body: any }> {
  return page.evaluate(async ([p, i]) => {
    const opts = i as { method?: string; data?: unknown; headers?: Record<string, string> };
    const res = await fetch(p as string, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.data !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers ?? {}),
      },
      ...(opts.data !== undefined ? { body: JSON.stringify(opts.data) } : {}),
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* not json, and that is fine */ }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    // Capped rather than whole: one caller fetches a PDF and only asserts on
    // its headers, and returning a megabyte of binary through evaluate() helps
    // nobody. Generous enough for the CSV another caller reads in full.
    return { status: res.status, headers, text: text.slice(0, 100_000), body };
  }, [path, init] as const);
}

/** Deletes a run's tenants and users straight from the database, not through the API. */
export async function cleanupTenants(slugs: string[], emailLikePattern: string): Promise<void> {
  await withDb(async (c) => {
    await c.query('DELETE FROM public."onyx_tenants" WHERE slug = ANY($1)', [slugs]);
    await c.query('DELETE FROM public."onyx_users" WHERE email LIKE $1', [emailLikePattern]);
  });
}
