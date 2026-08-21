'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const field = 'mt-1.5 block min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 '
  + 'text-[15px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-600/20';
const label = 'block text-[13.5px] font-semibold text-slate-700';

/**
 * A learner registering themselves.
 *
 * Four facts, and each one is asked because something downstream needs it: the
 * name a register prints, the address the institution issued (which is also how
 * the institution is identified -- see below), a number to reach them on, and
 * the roll number every mark, seat and register in this product is keyed to.
 * Nothing here asks for a course, a programme or a batch: those are the
 * institution's to assign, and a form that lets a stranger choose them is a
 * form that lets a stranger into a cohort.
 *
 * The institution is resolved from the email DOMAIN, and the form says which
 * one it found as soon as the address looks complete. That check happens
 * on blur rather than at submit, because "no institution accepts this address"
 * is the one answer worth giving before somebody types a password and a phone
 * number they are about to lose.
 */

/** True once this component has hydrated. See OnyxLoginForm's copy for why a
 *  credential form stays disabled until then. */
function useHydrated(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

export function OnyxSignUpForm({ next }: { next?: string } = {}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ready = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [institution, setInstitution] = useState<{ name: string } | null | 'unknown'>('unknown');

  const lookUp = async (email: string) => {
    if (!email.includes('@') || !email.split('@')[1]?.includes('.')) {
      setInstitution('unknown');
      return;
    }
    const res = await fetch('/api/web/onyx/signup-institution?email=' + encodeURIComponent(email));
    const body = await res.json().catch(() => ({}));
    setInstitution(body.ok ? (body.data ?? null) : null);
  };

  return (
    <form
      // POST so a submit landing before hydration cannot put the password
      // in the URL. See OnyxLoginForm for the full reasoning.
      method="post"
      className="space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await fetch('/api/web/onyx/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: String(data.get('name') ?? ''),
              email: String(data.get('email') ?? ''),
              password: String(data.get('password') ?? ''),
              phone: String(data.get('phone') ?? '') || null,
              roll_number: String(data.get('roll_number') ?? '') || null,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
          // Straight in, and straight to whatever they were sent: somebody who
          // followed a link to a paper and had no account yet should land on
          // the paper, not on a dashboard that says nothing about why they came.
          router.push(next || '/onyx/dashboard');
          router.refresh();
        });
      }}
    >
      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">
          {error}
        </p>
      ) : null}

      <div>
        <label className={label} htmlFor="su-name">Full name</label>
        <input id="su-name" name="name" required maxLength={255} autoComplete="name"
          className={field} />
      </div>

      <div>
        <label className={label} htmlFor="su-email">Organisation email</label>
        <input id="su-email" name="email" type="email" required autoComplete="email"
          onBlur={(e) => void lookUp(e.target.value)}
          placeholder="you@yourinstitution.edu"
          className={field} />
        {institution === 'unknown' ? (
          <p className="mt-1.5 text-[12.5px] text-muted">
            Use the address your institution gave you — it is what tells us where you belong.
          </p>
        ) : institution === null ? (
          <p className="mt-1.5 text-[12.5px] text-rose-700">
            No institution here accepts registrations from that address. Ask your institution
            to invite you, or check the address.
          </p>
        ) : (
          <p className="mt-1.5 text-[12.5px] font-semibold text-emerald-700">
            Registers with {institution.name}.
          </p>
        )}
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="su-phone">Mobile number</label>
          <input id="su-phone" name="phone" type="tel" required minLength={6} maxLength={30}
            autoComplete="tel" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="su-roll">Roll number</label>
          <input id="su-roll" name="roll_number" required maxLength={40}
            placeholder="As your institution issued it" className={field} />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="su-password">Password</label>
        <input id="su-password" name="password" type="password" required minLength={8}
          autoComplete="new-password" className={field} />
        <p className="mt-1.5 text-[12.5px] text-muted">At least 8 characters.</p>
      </div>

      <button type="submit" disabled={pending || !ready}
        className="min-h-[46px] w-full rounded-xl bg-brand-600 px-4 text-[15px] font-bold
                   text-white hover:bg-brand-700 disabled:opacity-50">
        {pending ? 'Creating your account…' : 'Create my account'}
      </button>
    </form>
  );
}
