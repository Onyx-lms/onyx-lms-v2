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

export function OnyxLoginForm() {
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
          // shell moves you between the rest.
          router.push('/onyx/dashboard');
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

export function OnyxSignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const email = String(data.get('email') ?? '');
        const password = String(data.get('password') ?? '');
        setError(null);
        start(async () => {
          const created = await post('signup', {
            name: String(data.get('name') ?? ''),
            slug: String(data.get('slug') ?? '') || undefined,
            admin: { name: String(data.get('admin_name') ?? ''), email, password },
          });
          if (!created.ok) { setError(created.message ?? 'Could not create it.'); return; }
          // Creating an institution does not sign you in -- the token has to
          // carry the new tenant, so it comes from a fresh login.
          const signedIn = await post('login', { email, password });
          if (!signedIn.ok) { router.push('/onyx/login'); return; }
          router.push('/onyx/dashboard');
          router.refresh();
        });
      }}
    >
      <Error_ message={error} />
      <div>
        <label className={label} htmlFor="name">Institution name</label>
        <input id="name" name="name" required maxLength={255} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="slug">Address</label>
        <input id="slug" name="slug" maxLength={255} className={field}
          placeholder="Left blank, this is taken from the name" />
      </div>
      <hr className="border-line" />
      <div>
        <label className={label} htmlFor="admin_name">Your name</label>
        <input id="admin_name" name="admin_name" required maxLength={255} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="signup_email">Your email address</label>
        <input id="signup_email" name="email" type="email" required
          autoComplete="email" className={field} />
      </div>
      <div>
        <label className={label} htmlFor="signup_password">Password</label>
        <input id="signup_password" name="password" type="password" required minLength={8}
          autoComplete="new-password" className={field} />
        <p className="mt-1 text-xs text-muted">
          At least 8 characters. You will be this institution&rsquo;s first administrator.
        </p>
      </div>
      <button type="submit" disabled={pending} className={button}>
        {pending ? 'Creating…' : 'Create the institution'}
      </button>
    </form>
  );
}
