'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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
export function OnyxLoginForm({ next }: { next?: string } = {}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
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
      <button type="submit" disabled={pending} className={button}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

