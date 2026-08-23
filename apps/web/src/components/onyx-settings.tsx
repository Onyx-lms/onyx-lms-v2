'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/onyx-ui';

/**
 * F-07 -- one institution-level switch: can faculty schedule an exam
 * themselves, or does every one have to come from admin or the exams
 * office. Admin only, which is who requireOnyxPageRole gates the page to.
 *
 * A plain checkbox would work exactly the same way, but this reads as "on
 * or off for the whole institution" at a glance, which a checkbox styled
 * like a form field does not -- the same reason a light switch and not a
 * checkbox is on the wall.
 */
export function FacultyExamPermissionToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/tenant/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faculty_can_schedule_exams: !enabled }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setError(body.message ?? 'Could not change that.'); return; }
    router.refresh();
  });

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold">Faculty can schedule examinations</h3>
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted">
            {enabled
              ? 'On -- any faculty member can schedule an exam for a course they teach, the '
                + 'same as admin and the examinations office already can.'
              : 'Off -- only admin and the examinations office can schedule an exam. Faculty '
                + 'still mark and publish results for exams exactly as before; this only '
                + 'gates who can put a new one on the calendar.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Faculty can schedule examinations"
          disabled={pending}
          onClick={toggle}
          className={'relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 '
            + (enabled ? 'bg-brand-600' : 'bg-slate-300')}
        >
          <span
            aria-hidden="true"
            className={'absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform '
              + (enabled ? 'translate-x-7' : 'translate-x-1')}
          />
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </Card>
  );
}

/**
 * Whether learners may register themselves, and from which addresses.
 *
 * The two belong on one card because neither works alone: registration open
 * with no domains means an institution nobody can find, and domains listed
 * with registration closed means a list that does nothing. Saving them
 * together is also what stops the window in between, where the door is open
 * and any address in the world matches.
 *
 * The domain is doing real work, not validation theatre: signup resolves the
 * institution FROM it, so this list is the only thing that connects a stranger
 * with an email address to this institution rather than another one.
 */
export function StudentSignupSettings({ enabled, domains, mode }: {
  enabled: boolean; domains: string;
  /** 'domain' -- only your own addresses. 'open' -- anyone may pick you. */
  mode: 'domain' | 'open';
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [on, setOn] = useState(enabled);
  const [list, setList] = useState(domains);
  const [how, setHow] = useState<'domain' | 'open'>(mode);

  const save = () => start(async () => {
    setError(null);
    setSaved(false);
    const res = await fetch('/api/proxy/onyx/tenant/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_signup: on, signup_domains: list, signup_mode: how }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setError(body.message ?? 'Could not save that.'); return; }
    setSaved(true);
    router.refresh();
  });

  return (
    <Card className="p-4 sm:p-5">
      <h3 className="text-[15px] font-bold">Learners may create their own account</h3>
      <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted">
        {on
          ? 'On — anyone with an email address at the domains below can register as a student '
            + 'and is enrolled by you afterwards. They cannot choose a role, a programme or a '
            + 'course.'
          : 'Off — every learner is added by somebody here. This is how the institution '
            + 'started, and nothing changes until you switch it on.'}
      </p>

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Learners may create their own account"
          onClick={() => setOn((v) => !v)}
          className={'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition '
            + (on ? 'bg-brand-600' : 'bg-slate-300')}
        >
          <span className={'inline-block h-5 w-5 transform rounded-full bg-white transition '
            + (on ? 'translate-x-6' : 'translate-x-1')} />
        </button>
        <span className="text-[13px] font-semibold">{on ? 'Open' : 'Closed'}</span>
      </div>

      {/*
        * Who may join, which is a real decision rather than a preference.
        *
        * An address at a domain you own is evidence of belonging here, and
        * that mode accepts nothing else. The second mode accepts anybody who
        * picks this institution from a list -- there is no check behind it at
        * all, so the copy says so in those words rather than dressing it as
        * convenience. An institution that does not issue addresses has no
        * other way to let its own students in; one that does should leave this
        * alone.
        */}
      {on ? (
        <fieldset className="mt-4">
          <legend className="text-[13.5px] font-semibold text-slate-700">
            How somebody joins
          </legend>
          <div className="mt-2 space-y-2">
            {([
              ['domain', 'By their email address',
                'Only addresses at the domains below. They are in straight away, and '
                + 'nobody here has to approve anything.'],
              ['open', 'Anyone may choose this institution',
                'You appear in a list on the sign-up page, and anybody who picks you is in '
                + 'straight away — nobody here checks. Switch this on only if that is what '
                + 'you want.'],
            ] as const).map(([value, title, detail]) => (
              <label key={value}
                className={'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 '
                  + (how === value ? 'border-brand-500 bg-brand-50' : 'border-line')}>
                <input
                  type="radio" name="signup_mode" value={value}
                  checked={how === value}
                  onChange={() => setHow(value)}
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 focus:ring-brand-600"
                />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ink">{title}</span>
                  <span className="block text-[12.5px] leading-relaxed text-muted">{detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <label className="mt-4 block text-[13.5px] font-semibold text-slate-700"
        htmlFor="signup-domains">
        Email domains that register here
      </label>
      <input
        id="signup-domains"
        value={list}
        onChange={(e) => setList(e.target.value)}
        placeholder="demo.onyx, students.demo.onyx"
        className="mt-1.5 block min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5
                   text-[14px] focus:border-brand-500 focus:outline-none"
      />
      <p className="mt-1.5 text-[12.5px] text-muted">
        Separated by commas or spaces, no @. Subdomains count: listing
        <code className="mx-1">example.edu</code>
        also accepts <code>cse.example.edu</code>. Write
        <code className="mx-1">*.example.edu</code>
        for subdomains only.
        {how === 'open'
          ? ' People at these addresses find you without picking from the list.'
          : ' Anything else is told that no institution accepts it, without naming any.'}
      </p>

      {error ? <p role="alert" className="mt-3 text-[13px] text-red-700">{error}</p> : null}
      {saved && !error ? (
        <p role="status" className="mt-3 text-[13px] text-emerald-700">Saved.</p>
      ) : null}

      <button type="button" onClick={save} disabled={pending}
        className="mt-4 min-h-[42px] rounded-xl bg-brand-600 px-4 text-sm font-bold text-white
                   hover:bg-brand-700 disabled:opacity-50">
        {pending ? 'Saving…' : 'Save registration settings'}
      </button>
    </Card>
  );
}

/**
 * The community an institution runs, and where its learners can join it.
 *
 * Every institution here already has a WhatsApp group; what it did not have
 * was anywhere in the product to put the link, so it lived in somebody's
 * pinned message and reached whoever happened to be in the group already. It
 * belongs beside the jobs, which is where people go looking for it.
 *
 * Not WhatsApp-only. An institution running its community on Telegram or
 * Discord is not doing anything wrong, and a host allow-list would break the
 * first time somebody pasted a `chat.whatsapp.com` short link anyway. What IS
 * checked, on the server, is the scheme: this becomes an anchor to a third
 * party, and `javascript:` in an href is stored XSS with extra steps.
 */
export function CommunityLinkForm({ url, label }: { url: string; label: string }) {
  const [value, setValue] = useState(url);
  const [name, setName] = useState(label);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setNote(null);
        start(async () => {
          const res = await fetch('/api/proxy/onyx/tenant/community', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              community_url: value.trim(),
              community_label: name.trim() || null,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!body.ok) { setError(body.message ?? 'That did not save.'); return; }
          setNote(value.trim() ? 'Saved. Learners will see it on Jobs.' : 'Link removed.');
          router.refresh();
        });
      }}
    >
      <div>
        <label className="block text-[13px] font-semibold text-slate-700" htmlFor="cm-url">
          Community invite link
        </label>
        <input id="cm-url" type="url" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="https://chat.whatsapp.com/…"
          className="mt-1.5 block min-h-[42px] w-full rounded-xl border border-line bg-white
                     px-3.5 text-[14px] focus:border-brand-500 focus:outline-none
                     focus:ring-2 focus:ring-brand-600/20" />
        <p className="mt-1 text-[12.5px] text-muted">
          Shown to everybody here on the Jobs page. Leave it empty to take it down.
        </p>
      </div>

      <div>
        <label className="block text-[13px] font-semibold text-slate-700" htmlFor="cm-label">
          Button text
        </label>
        <input id="cm-label" value={name} onChange={(e) => setName(e.target.value)}
          maxLength={120} placeholder="Join our WhatsApp community"
          className="mt-1.5 block min-h-[42px] w-full rounded-xl border border-line bg-white
                     px-3.5 text-[14px] focus:border-brand-500 focus:outline-none
                     focus:ring-2 focus:ring-brand-600/20" />
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          {error}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="rounded-xl bg-green-50 px-3 py-2 text-[13px] text-green-800">
          {note}
        </p>
      ) : null}

      <button type="submit" disabled={pending}
        className="min-h-[40px] rounded-xl bg-brand-600 px-4 text-[14px] font-bold text-white
                   hover:bg-brand-700 disabled:opacity-50">
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
