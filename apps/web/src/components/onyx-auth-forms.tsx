'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/**
 * F-06 -- signing in, and standing up a new institution.
 *
 * Both post to /api/onyx/*, which stores the returned token in an httpOnly
 * cookie this origin owns, so no token ever touches page scripts.
 */

/*
 * The controls, given the same weight as the rest of the product.
 *
 * `min-h-[46px]` rather than `py-2`: a sign-in field is the first thing a
 * candidate touches on a phone, and 44px is the floor a target should meet.
 * The focus ring is brand-600 (7.11:1) instead of the old `focus:border-
 * slate-900`, which moved a 1px border and was easy to miss -- WCAG 2.4.7
 * wants focus to be visible, not merely present.
 */
const field = 'mt-1.5 block min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 '
  + 'text-[15px] text-ink transition placeholder:text-muted '
  + 'hover:border-slate-300 focus:border-brand-500 focus:outline-none focus:ring-2 '
  + 'focus:ring-brand-600/25';
const label = 'block text-[13.5px] font-semibold text-slate-700';
const button = 'inline-flex min-h-[46px] w-full items-center justify-center rounded-xl '
  + 'bg-brand-600 px-4 text-[15px] font-bold text-white shadow-card transition '
  + 'hover:bg-brand-700 disabled:opacity-50';

function Error_({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {message}
    </p>
  );
}

async function post(action: string, body: unknown) {
  const res = await fetch('/api/web/onyx/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false, message: 'Something went wrong.' }));
}

/**
 * `next` is where to land after signing in, and it is only ever a path this
 * app owns -- see `safeNext` in the login page. It exists for one flow: a
 * learner scans an attendance QR on a phone whose session has lapsed, and
 * sending them to the dashboard would lose the code in the URL, which rotates
 * within seconds and cannot be recovered by going back.
 */
/*
 * OnyxSignupForm used to live below this one and was imported by nobody: the
 * signup page renders OnyxSignUpForm (different capitalisation) from
 * onyx-signup-form.tsx, which asks for the roll number, phone and organisation
 * email that registration actually needs. Two signup forms that could drift
 * apart, one of which could never render, deleted down to the one that does.
 */

/**
 * True once this component has hydrated.
 *
 * Between the server's HTML arriving and React attaching, a form is inert
 * markup: pressing Enter submits it the browser's way, not the app's. For a
 * form carrying credentials that is worth blocking outright -- the request
 * would reach a route that does not handle it, and the person would be left
 * looking at a 405 wondering what they did. Disabled until ready is the honest
 * state, and it lasts milliseconds.
 */
function useHydrated(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

export function OnyxLoginForm({ next }: { next?: string } = {}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = useHydrated();

  return (
    <form
      /*
       * `method="post"`, on a form that is submitted by JavaScript and never
       * by the browser.
       *
       * It matters for the window before hydration. A form with no method is a
       * GET form, so a submit that lands in that window -- a fast typist
       * pressing Enter, a slow connection, a cold serverless start -- is
       * handled natively by the browser, which appends every field to the URL.
       * The password ends up in the address bar, in browser history, in the
       * referrer of the next request, and in the access log of anything in
       * front of this app. It reproduces: `/onyx/login?email=…&password=…`.
       *
       * As a POST the same accidental submit carries the fields in a body that
       * goes nowhere (Next answers 405) and the credentials stay out of the
       * URL entirely. The onSubmit below still does the real work.
       */
      method="post"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const body = await post('login', {
            email: String(data.get('email') ?? ''),
            password: String(data.get('password') ?? ''),
          });
          if (!body.ok) { setError(body.message ?? 'Those details do not match.'); return; }
          // Sign-in lands you in your first institution; the switcher in the
          // shell moves you between the rest. Unless something sent you here
          // from a page you were trying to reach, in which case you go back
          // to it.
          router.push(next || '/onyx/dashboard');
          router.refresh();
        });
      }}
    >
      <Error_ message={error} />
      <div>
        <label className={label} htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" required autoComplete="email" className={field} />
      </div>
      <div>
        <label className={label} htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required
          autoComplete="current-password" className={field} />
      </div>
      <button type="submit" disabled={pending || !ready} className={button}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

