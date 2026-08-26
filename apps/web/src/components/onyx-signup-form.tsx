'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PasswordField } from '@/components/onyx-password-field';

const field = 'mt-1.5 block min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 '
  + 'text-[15px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-600/20';
const label = 'block text-[13.5px] font-semibold text-slate-700';

/**
 * A learner registering themselves, in two steps.
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
 * is the one answer worth giving before somebody fills in the rest.
 *
 * **Why the password is on the second screen.** It would be easy to ask for
 * everything at once and verify afterwards, and it would mean this product
 * held a password for an address nobody had yet proved they owned. Asking for
 * it after the code means nothing is stored in between: the first step sends a
 * code and keeps nothing at all.
 */

/** True once this component has hydrated. See OnyxLoginForm's copy for why a
 *  credential form stays disabled until then. */
function useHydrated(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

interface Details {
  name: string; email: string; phone: string; roll_number: string;
  tenant_id: number | null;
  /** The teaching division they picked. Null where the institution runs none. */
  section_id: number | null;
}

export function OnyxSignUpForm({ next }: { next?: string } = {}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ready = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [institution, setInstitution] = useState<{ name: string } | null | 'unknown'>('unknown');

  /**
   * The details from step one, held here while the code is in the post.
   *
   * In component state and nowhere else -- not a cookie, not a table. If the
   * applicant closes the tab they start again, which is the correct cost for
   * a registration that was never completed.
   */
  const [details, setDetails] = useState<Details | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * The institutions somebody may pick when their address names none.
   *
   * Fetched once, on mount, rather than when the address turns out not to
   * match: by then the person is already reading a refusal, and a list that
   * appears a moment later reads as the page changing its mind.
   */
  const [choices, setChoices] = useState<{ id: number; name: string }[]>([]);
  const [picked, setPicked] = useState('');
  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/web/onyx/signup-institutions').catch(() => null);
      const body = await res?.json().catch(() => ({}));
      if (body?.ok && Array.isArray(body.data)) setChoices(body.data);
    })();
  }, []);

  /*
   * The teaching divisions of whichever institution this person is joining.
   *
   * Fetched when the institution is known and not before, because it is the
   * institution that decides them: Alpha, Beta and Gamma at one, Section A, B
   * and C at the next. Re-fetched whenever that changes, so somebody who picks
   * the wrong institution and corrects it is never offered the first one's
   * divisions.
   *
   * `tenantId` is whichever is settled: the one their address named, or the
   * one they picked. Null while neither is, and then nothing is asked.
   */
  const tenantId = institution && institution !== 'unknown'
    ? (institution as { id?: number }).id ?? null
    : (picked ? Number(picked) : null);
  const [sections, setSections] = useState<{ id: number; name: string }[]>([]);
  const [section, setSection] = useState('');
  useEffect(() => {
    if (!tenantId) { setSections([]); setSection(''); return; }
    let live = true;
    void (async () => {
      const res = await fetch('/api/web/onyx/signup-sections?tenant_id=' + tenantId)
        .catch(() => null);
      const body = await res?.json().catch(() => ({}));
      if (!live) return;
      setSections(body?.ok && Array.isArray(body.data) ? body.data : []);
      // Cleared rather than kept: a division id from the previous institution
      // would be refused on submit, and the refusal would name a field the
      // person can no longer see the wrong value in.
      setSection('');
    })();
    return () => { live = false; };
  }, [tenantId]);

  /**
   * Seconds until another code may be asked for.
   *
   * Sixty because that is Supabase's own "minimum interval per user" default,
   * and the two have to agree. This was thirty, which re-enabled the button
   * half a minute before the server would honour it -- so the one thing a
   * student does when a code has not arrived produced an error for doing
   * exactly what the screen invited. A control that is enabled must work.
   *
   * If that interval is changed in the Supabase dashboard, change it here too.
   */
  const RESEND_SECONDS = 60;
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    timer.current = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [cooldown]);

  const lookUp = async (email: string) => {
    if (!email.includes('@') || !email.split('@')[1]?.includes('.')) {
      setInstitution('unknown');
      return;
    }
    const res = await fetch('/api/web/onyx/signup-institution?email=' + encodeURIComponent(email));
    const body = await res.json().catch(() => ({}));
    setInstitution(body.ok ? (body.data ?? null) : null);
  };

  /** Asks the server to send a code. Shared by step one and the resend link. */
  const sendCode = async (to: Details): Promise<boolean> => {
    const res = await fetch('/api/web/onyx/signup-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: to.email, tenant_id: to.tenant_id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setError(body.message ?? 'That did not work.'); return false; }
    setSentTo(to.email);
    setCooldown(RESEND_SECONDS);
    return true;
  };

  // ---------------------------------------------------------------- step two

  if (details && sentTo) {
    return (
      <form
        method="post"
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          setNotice(null);
          start(async () => {
            const res = await fetch('/api/web/onyx/signup-verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...details,
                code: String(data.get('code') ?? '').trim(),
                password: String(data.get('password') ?? ''),
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
        {notice ? (
          <p role="status" className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-[13px]
                                      text-emerald-800">
            {notice}
          </p>
        ) : null}

        <div className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-[13px] text-slate-700">
          We sent a code to <strong className="break-all">{sentTo}</strong>. It is good for a
          few minutes.
        </div>

        <div>
          <label className={label} htmlFor="su-code">Verification code</label>
          {/* No length is claimed anywhere on this screen. GoTrue's OTP length
              is configuration -- this project sends eight digits, the default
              is six -- so a field that says "six-digit" and stops at six
              characters would silently truncate every real code here. */}
          <input id="su-code" name="code" required
            inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,10}"
            maxLength={10} placeholder="Code from your email"
            className={field + ' tracking-[0.3em] font-semibold'} />
          <p className="mt-1.5 text-[12.5px] text-muted">
            Check your spam folder if it has not arrived.
          </p>
        </div>

        <div>
          <label className={label} htmlFor="su-password">Choose a password</label>
          <PasswordField id="su-password" name="password" required minLength={8}
            autoComplete="new-password" className={field} />
          <p className="mt-1.5 text-[12.5px] text-muted">At least 8 characters.</p>
        </div>

        <button type="submit" disabled={pending || !ready}
          className="min-h-[46px] w-full rounded-xl bg-brand-600 px-4 text-[15px] font-bold
                     text-white hover:bg-brand-700 disabled:opacity-50">
          {pending ? 'Creating your account…' : 'Create my account'}
        </button>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
          <button type="button"
            disabled={pending || cooldown > 0}
            onClick={() => start(async () => {
              setError(null);
              setNotice(null);
              if (await sendCode(details)) setNotice('A new code is on its way.');
            })}
            className="font-semibold text-brand-700 hover:underline disabled:text-muted
                       disabled:no-underline">
            {cooldown > 0 ? 'Send a new code in ' + cooldown + 's' : 'Send a new code'}
          </button>
          <button type="button"
            onClick={() => { setDetails(null); setSentTo(null); setError(null); setNotice(null); }}
            className="font-semibold text-slate-600 hover:underline">
            Use a different address
          </button>
        </div>
      </form>
    );
  }

  // ---------------------------------------------------------------- step one

  return (
    <form
      // POST so a submit landing before hydration cannot put anything typed
      // here in the URL. See OnyxLoginForm for the full reasoning.
      method="post"
      className="space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        const collected: Details = {
          name: String(data.get('name') ?? ''),
          email: String(data.get('email') ?? '').trim(),
          phone: String(data.get('phone') ?? ''),
          roll_number: String(data.get('roll_number') ?? ''),
          section_id: section ? Number(section) : null,
          // Only when the address did not name one: an address that
          // matches is the stronger claim and should not be overridden by
          // a dropdown somebody forgot to change.
          tenant_id: institution === null && picked ? Number(picked) : null,
        };
        start(async () => {
          if (await sendCode(collected)) setDetails(collected);
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
            Personal addresses such as gmail.com cannot be used.
          </p>
        ) : institution === null ? (
          /*
           * The address named nobody. That is not the end of the road: plenty
           * of institutions never issue addresses at all, and their students
           * are on personal accounts through no fault of theirs.
           *
           * So a list, where there is one. An institution appears on it only
           * by choosing to, and choosing to means accepting that anybody who
           * picks it is in -- there is no check behind this beyond the code
           * sent to the address, which is why the setting is off by default.
           */
          <div className="mt-1.5">
            <p className="text-[12.5px] text-muted">
              That address does not name an institution.
              {choices.length ? ' Choose yours below.'
                : ' Ask your institution to invite you, or check the address.'}
            </p>
            {/*
              * Why the list is short, said before somebody scrolls it looking
              * for a college that is not on it.
              *
              * The list is not "every institution" and never was: one appears
              * only by opening registration to anybody, because the emailed
              * code is the only check behind it. Most institutions quite
              * rightly leave that off and invite their students instead. Not
              * saying so turned a deliberate setting into what looks like
              * missing data -- somebody reads "choose yours below", does not
              * find theirs, and has no idea whether the product is broken,
              * their college is not a customer, or something else entirely.
              */}
            {choices.length ? (
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Only institutions that have opened registration to anyone appear here. If
                yours is missing it has not — ask them to invite you, and you will get an
                email to set your password.
              </p>
            ) : null}
            {choices.length ? (
              <div className="mt-2">
                <label className={label} htmlFor="su-institution">Your institution</label>
                <select id="su-institution" name="tenant_id" value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                  className={field}>
                  <option value="">Choose your institution…</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-[12.5px] text-muted">
                  We will email you a code to confirm the address is yours.
                </p>
              </div>
            ) : null}
          </div>
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
        {/*
          * Shown only once the institution is known, because it is the
          * institution that decides what the divisions are called. Absent
          * where an institution runs none, rather than an empty dropdown
          * asking for something that does not exist there.
          */}
        {sections.length ? (
          <div className="sm:col-span-2">
            <label className={label} htmlFor="su-section">Your section</label>
            <select id="su-section" name="section_id" required value={section}
              onChange={(e) => setSection(e.target.value)} className={field}>
              <option value="">Choose your section…</option>
              {sections.map((sx) => (
                <option key={sx.id} value={sx.id}>{sx.name}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[12.5px] text-muted">
              The group you are taught with. It decides which timetable and which
              examinations you are given — your institution can move you later.
            </p>
          </div>
        ) : null}
      </div>

      <button type="submit" disabled={pending || !ready}
        className="min-h-[46px] w-full rounded-xl bg-brand-600 px-4 text-[15px] font-bold
                   text-white hover:bg-brand-700 disabled:opacity-50">
        {pending ? 'Sending your code…' : 'Send me a code'}
      </button>
      <p className="text-center text-[12.5px] text-muted">
        We will email you a code to confirm the address is yours.
      </p>
    </form>
  );
}
