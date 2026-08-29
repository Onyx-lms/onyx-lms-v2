'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import { Modal } from '@/components/onyx-modal';
import { toLocalInput, fromLocalInput, longWhen, INSTITUTION_TZ } from '@/lib/onyx-time';
import { ROLE_LABELS } from '@/lib/onyx-nav';
import { DangerPanel } from '@/components/onyx-danger';
import { PasswordField } from '@/components/onyx-password-field';
import {
  ProblemDraftFields, blankProblemDraft, createProblemFromDraft, problemDraftError,
  type ProblemDraft,
} from '@/components/onyx-code-problem';

/**
 * The platform console's forms -- signing in, provisioning an institution,
 * suspending one, and granting or revoking who else can do any of this.
 *
 * Every write goes through /api/proxy/onyx/platform/*, which attaches the
 * `onyx_platform_session` cookie server-side (see the proxy route) rather
 * than a tenant cookie -- there is no tenant to attach here.
 */

/* Matched to onyx-auth-forms: two doors that look like different products are
   two doors somebody mistrusts. The button is ink here rather than teal,
   because that is what distinguishes this console everywhere else. */
const field = 'mt-1.5 block min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 '
  + 'text-[15px] text-ink transition placeholder:text-muted '
  + 'hover:border-slate-300 focus:border-slate-500 focus:outline-none focus:ring-2 '
  + 'focus:ring-ink/20';
const label = 'block text-[13.5px] font-semibold text-slate-700';
/*
 * The primary button, and the one place this file used to look amateur.
 *
 * It carried `w-full`, because the first two things that used it -- the two
 * create actions in the 216px sidebar -- want to fill their column. Every
 * later page-level action reused the same constant, so "Add a course", "Add a
 * fee head" and "Grant platform admin" each rendered as a 1,140px teal slab
 * across the top of its page: the single loudest element on screen, wider than
 * the table it belonged to, and the first thing anyone saw when opening the
 * console. Nobody ships an enterprise product with a full-bleed button.
 *
 * It is now sized to its label. The sidebar keeps its own full-width pair
 * (navButton / navButtonQuiet), which is what those two forms already used.
 */
const button = 'inline-flex min-h-[42px] items-center justify-center rounded-xl '
  + 'bg-brand-600 px-4 text-[14.5px] font-bold text-white shadow-card transition '
  + 'hover:bg-brand-700 disabled:opacity-50';

function Error_({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {message}
    </p>
  );
}

async function post(path: string, body?: unknown, method = 'POST') {
  const res = await fetch('/api/proxy/' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  /*
   * An expired session is said in words, not in a status word.
   *
   * The platform cookie lasts an hour and nothing refreshes it, so an operator
   * who leaves the console open and comes back gets 401 on the first thing
   * they save -- and what appeared under the form was the API's own
   * "Unauthenticated.", printed in red beside a filled-in form that looked
   * broken. Nothing was wrong with the form or with what they typed.
   *
   * So the session is named as the problem and the sign-in page is the fix,
   * carrying `?expired=1` so it can say why somebody is looking at it and
   * `?next=` so they land back where they were rather than at the top.
   */
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      // Sent, not merely told. Nothing on this page can be saved until they
      // sign in again, so leaving them on it to read a sentence would be
      // asking them to do the navigation themselves.
      window.location.assign('/onyx/platform/login?expired=1&next='
        + encodeURIComponent(window.location.pathname));
    }
    return { ok: false, message: 'Your session has expired. Sign in again to save this.' };
  }
  return res.json().catch(() => ({ ok: false, message: 'Something went wrong.' }));
}


/** True once this component has hydrated. See OnyxLoginForm's copy for why a
 *  credential form stays disabled until then. */
function useHydrated(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

export function PlatformLoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = useHydrated();

  return (
    <form
      // POST so a submit landing before hydration cannot put the password
      // in the URL. See OnyxLoginForm for the full reasoning.
      method="post"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await fetch('/api/web/onyx-platform/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: String(data.get('email') ?? ''),
              password: String(data.get('password') ?? ''),
            }),
          });
          const body = await res.json().catch(() => ({ ok: false }));
          if (!body.ok) { setError(body.message ?? 'Those details do not match.'); return; }
          /*
           * Back to where they were, when they were sent here by an expired
           * session. `next` is read off OUR OWN url and accepted only when it
           * is a path inside the console -- an open redirect on a sign-in page
           * is how somebody gets sent to a copy of it.
           */
          const next = new URLSearchParams(window.location.search).get('next');
          router.push(next && /^\/onyx\/platform(\/|$)/.test(next) ? next : '/onyx/platform');
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
        <PasswordField id="password" name="password" required
          autoComplete="current-password" className={field} />
      </div>
      <button type="submit" disabled={pending || !ready} className={button + ' w-full'}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export function PlatformSignOut() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        await fetch('/api/web/onyx-platform/login', { method: 'DELETE' });
        router.push('/onyx/platform/login');
        router.refresh();
      })}
      className="min-h-[38px] w-full rounded-2xl border border-line px-3 py-1.5 text-xs
                 font-medium text-slate-700 hover:bg-brand-50 disabled:opacity-50"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

const navButton = 'flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 '
  + 'px-3 py-2.5 text-[13.5px] font-bold text-white hover:bg-brand-700';
const navButtonQuiet = 'flex w-full items-center justify-center gap-2 rounded-xl border '
  + 'border-brand-200 bg-white px-3 py-2.5 text-[13.5px] font-bold text-brand-700 '
  + 'hover:bg-brand-50';

export function CreateTenantForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={navButton}>
        Create an institution
      </button>
      {open ? (
        <Modal title="Create an institution" onClose={() => setOpen(false)}>
          <form
            className="space-y-3"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setError(null);
              start(async () => {
                const res = await post('onyx/platform/tenants', {
                  name: String(data.get('name') ?? ''),
                  admin: {
                    name: String(data.get('admin_name') ?? ''),
                    email: String(data.get('admin_email') ?? ''),
                    password: String(data.get('admin_password') ?? ''),
                  },
                });
                if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <p className="text-xs text-muted">
              Provisioned directly, the way an operator sets one up on someone&rsquo;s
              behalf -- distinct from the self-service form at /onyx/signup.
            </p>
            <div>
              <label className={label} htmlFor="ct-name">Institution name</label>
              <input id="ct-name" name="name" required maxLength={255} autoComplete="off"
                className={field} />
            </div>
            <div>
              <label className={label} htmlFor="ct-admin-name">Administrator&rsquo;s name</label>
              <input id="ct-admin-name" name="admin_name" required maxLength={255}
                autoComplete="off" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="ct-admin-email">Administrator&rsquo;s email</label>
              {/* autoComplete="off" on an email input next to a password input is the
                  difference between the browser treating this as a login form (and
                  offering to fill it with the operator's own saved credentials -- a
                  real, dangerous mistake in a form that CREATES an account) and not. */}
              <input id="ct-admin-email" name="admin_email" type="email" required
                autoComplete="off" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="ct-admin-password">
                Administrator&rsquo;s password
              </label>
              <PasswordField id="ct-admin-password" name="admin_password" required
                minLength={8} autoComplete="new-password" className={field} />
            </div>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={pending} className={button}>
                {pending ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

interface TenantOption { id: number; name: string }
type ProfileType = 'student' | 'faculty' | 'exams' | 'placement' | 'employer' | 'guardian'
  | 'admin' | 'platform';

/**
 * The one place to create any kind of person on the platform -- a student or
 * faculty member or administrator at a specific institution, or another
 * platform admin. Institution profiles and platform admins used to need two
 * different screens (open an institution, then its People tab; or the
 * separate Platform admins page) -- this is the same two writes
 * (POST .../members and POST .../admins, both already real) behind one
 * decision an operator actually starts from: "who am I creating, and for
 * where."
 *
 * Two places this gets rendered:
 *   - Unlocked, in the platform-wide sidebar (present on every screen,
 *     including inside an institution): fetches the institution list itself
 *     when opened, so no page has to thread it through as a prop.
 *   - Locked, inside one institution's own sidebar (`lockedTenant`): skips
 *     the institution picker and the platform-admin option entirely --
 *     "create a profile for THIS institution" has already answered "where".
 *   - Locked to ONE ROLE (`only`), above the table that lists that role: the
 *     Students tab offers "Add a student", the Faculty tab "Add faculty".
 *
 * That third case is why `only` exists. Adding somebody used to mean finding
 * "Create a profile" in the sidebar and then answering "which kind?" from a
 * menu of eight -- a question the operator had already answered by opening
 * the Students tab and looking at a list of students. Where the tab settles
 * the role, the form does not ask again: the picker is not rendered at all,
 * rather than rendered with a default somebody can knock off by accident and
 * so create a guardian on the Faculty tab.
 */
export function CreateProfileForm({ lockedTenant, defaultType, only, cta }: {
  lockedTenant?: { id: number; name?: string };
  defaultType?: ProfileType;
  /** Create this role and nothing else -- no type picker is shown. */
  only?: Exclude<ProfileType, 'platform'>;
  /** Overrides the button's words. Derived from `only` where that is set. */
  cta?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ProfileType>(only ?? defaultType ?? 'student');
  const [tenants, setTenants] = useState<TenantOption[] | null>(null);
  const [loadingTenants, setLoadingTenants] = useState(false);
  /**
   * The institution's teaching divisions, fetched when the dialog opens.
   *
   * Not passed in as a prop: this form is mounted on five different screens
   * and only one of them already holds the section list, so threading it
   * through would mean four callers fetching something they do not otherwise
   * need. One request, on open, only when a student is being added.
   */
  const [sections, setSections] = useState<{ id: number; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function openModal() {
    setOpen(true);
    // The divisions of the institution being added to, where there is one.
    if (lockedTenant && !sections.length) {
      const got = await fetch('/api/proxy/onyx/platform/tenants/'
        + lockedTenant.id + '/sections');
      const rows = await got.json().catch(() => ({ ok: false }));
      if (rows.ok) {
        setSections((rows.data as { id: number; name: string; status: number }[])
          .filter((sx) => sx.status === 1)
          .map((sx) => ({ id: Number(sx.id), name: String(sx.name) })));
      }
    }
    if (lockedTenant || tenants !== null) return;
    setLoadingTenants(true);
    const res = await fetch('/api/proxy/onyx/platform/tenants');
    const body = await res.json().catch(() => ({ ok: false }));
    setLoadingTenants(false);
    if (body.ok) {
      setTenants((body.data as { id: number; name: string }[])
        .map((t) => ({ id: t.id, name: t.name })));
    }
  }

  // "Add a student", not "Create a student profile": the words on the button
  // and the words on the tab it sits above should be the same words.
  const noun = only ? (only === 'admin' ? 'an administrator'
    : only === 'faculty' ? 'a faculty member'
      : only === 'guardian' ? 'a parent or guardian'
        : 'a ' + ROLE_LABELS[only].toLowerCase()) : null;
  const words = cta ?? (noun ? 'Add ' + noun : 'Create a profile');
  const where = lockedTenant?.name ?? 'this institution';
  const title = noun ? 'Add ' + noun + ' to ' + where
    : lockedTenant ? 'Create a profile for ' + where
      : 'Create a profile';

  return (
    <>
      <button type="button" onClick={openModal} className={lockedTenant ? button : navButtonQuiet}>
        {words}
      </button>
      {open ? (
        <Modal title={title} onClose={() => setOpen(false)}>
          <form
            className="space-y-3"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setError(null);
              start(async () => {
                const name = String(data.get('name') ?? '');
                const email = String(data.get('email') ?? '');
                const password = String(data.get('password') ?? '');

                const res = type === 'platform'
                  ? await post('onyx/platform/admins', { name, email, password })
                  : await (async () => {
                    const tenantId = lockedTenant?.id ?? Number(data.get('tenant_id') ?? '');
                    if (!tenantId) return { ok: false, message: 'Choose an institution.' };
                    return post('onyx/platform/tenants/' + tenantId + '/members', {
                      name, email, role: type, password,
                      // Both only mean anything for a learner, and both are
                      // sent as they are typed rather than left for a second
                      // screen: a student added into no division is dealt only
                      // the papers set for everybody, and nothing says so.
                      roll_number: type === 'student'
                        ? (String(data.get('roll_number') ?? '').trim() || null) : null,
                      section_id: type === 'student' && data.get('section_id')
                        ? Number(data.get('section_id')) : null,
                    });
                  })();

                if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
                setOpen(false);
                router.refresh();
              });
            }}
          >
            {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}
            {only ? null : (
              <div>
                <label className={label} htmlFor="cp-type">Profile type</label>
                <select id="cp-type" name="type" value={type}
                  onChange={(e) => setType(e.target.value as ProfileType)} className={field}>
                  <option value="student">{ROLE_LABELS.student}</option>
                  <option value="faculty">{ROLE_LABELS.faculty}</option>
                  <option value="exams">{ROLE_LABELS.exams}</option>
                  <option value="placement">{ROLE_LABELS.placement}</option>
                  <option value="employer">{ROLE_LABELS.employer}</option>
                  <option value="guardian">{ROLE_LABELS.guardian}</option>
                  <option value="admin">Institution admin</option>
                  {lockedTenant ? null : (
                    <option value="platform">Platform admin (superadmin)</option>
                  )}
                </select>
              </div>
            )}
            {type === 'platform' ? (
              <p className="text-[12.5px] text-muted">
                A platform admin belongs to no institution -- they operate the whole platform.
              </p>
            ) : lockedTenant ? null : (
              <div>
                <label className={label} htmlFor="cp-tenant">Institution</label>
                <select id="cp-tenant" name="tenant_id" required defaultValue="" className={field}
                  disabled={loadingTenants}>
                  <option value="" disabled>
                    {loadingTenants ? 'Loading…' : 'Choose one'}
                  </option>
                  {(tenants ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={label} htmlFor="cp-name">Name</label>
              <input id="cp-name" name="name" required maxLength={255} autoComplete="off"
                className={field} />
            </div>
            <div>
              <label className={label} htmlFor="cp-email">Email</label>
              {/* See CreateTenantForm's comment on this same pairing: off, not the
                  default, or Chrome offers the operator's own saved login here. */}
              <input id="cp-email" name="email" type="email" required autoComplete="off"
                className={field} />
            </div>
            <div>
              <label className={label} htmlFor="cp-password">Password</label>
              <PasswordField id="cp-password" name="password" required minLength={8}
                autoComplete="new-password" className={field} />
            </div>

            {/*
              * A learner's number and their division, on the form that creates
              * them.
              *
              * Neither was here, and the division mattered most: somebody added
              * from the console landed in NO division, so every examination set
              * for a section passed them by silently. The alternative was
              * finding them again on the sections screen -- if you knew to.
              *
              * Shown only for a student, because only a learner has either.
              */}
            {type === 'student' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="cp-roll">Roll number</label>
                  <input id="cp-roll" name="roll_number" maxLength={40} autoComplete="off"
                    placeholder="MRD-ALPHA-CSE-001" className={field} />
                  <p className="mt-1 text-[12px] text-muted">
                    Optional. It is what a register and a script are ordered by.
                  </p>
                </div>
                <div>
                  <label className={label} htmlFor="cp-section">Section</label>
                  <select id="cp-section" name="section_id" defaultValue="" className={field}>
                    <option value="">No section yet</option>
                    {sections.map((sx) => (
                      <option key={sx.id} value={sx.id}>{sx.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    {sections.length
                      ? 'A paper set for one section is only sat by the people in it.'
                      : 'This institution runs no sections yet.'}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={pending} className={button}>
                {pending ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export function SuspendToggle({ tenantId, suspended }: { tenantId: number; suspended: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          const res = await post('onyx/platform/tenants/' + tenantId
            + (suspended ? '/activate' : '/suspend'));
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          router.refresh();
        })}
        className={'rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50 ' + (suspended
          ? 'border-emerald-600 text-emerald-700'
          : 'border-red-600 text-red-700')}
      >
        {pending ? 'Working…' : suspended ? 'Reactivate' : 'Suspend'}
      </button>
      {error ? <p role="alert" className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

export function GrantAdminForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={button}>
        Grant platform admin
      </button>
      {open ? (
        <Modal title="Grant platform admin" onClose={() => setOpen(false)}>
          <form
            className="space-y-3"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setError(null);
              start(async () => {
                const res = await post('onyx/platform/admins', {
                  email: String(data.get('email') ?? ''),
                  name: String(data.get('name') ?? '') || undefined,
                  password: String(data.get('password') ?? '') || undefined,
                });
                if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <p className="text-xs text-muted">
              An existing account is reused by email; a new one needs a name and password too.
            </p>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            <div>
              <label className={label} htmlFor="ga-email">Email</label>
              <input id="ga-email" name="email" type="email" required autoComplete="off"
                className={field} />
            </div>
            <div>
              <label className={label} htmlFor="ga-name">Name (new account only)</label>
              <input id="ga-name" name="name" autoComplete="off" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="ga-password">Password (new account only)</label>
              <PasswordField id="ga-password" name="password" minLength={8}
                autoComplete="new-password" className={field} />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={pending} className={button}>
                {pending ? 'Granting…' : 'Grant'}
              </button>
              <button type="button" onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Editing inside an institution -- the platform console's write surface.
//
// Every one of these is a toggle: closed, it costs nothing on the page.
// Opened, it PATCHes through the same proxy as everything above, and on
// success calls router.refresh() rather than trusting its own optimistic
// state -- the page re-reads the institution, the same as after a suspend.
// ---------------------------------------------------------------------------

const smallField = 'block min-h-[36px] w-full rounded-lg border border-line bg-white px-2.5 '
  + 'text-[13px] text-ink focus:border-slate-500 focus:outline-none focus:ring-2 '
  + 'focus:ring-ink/20';
const smallLabel = 'block text-[11px] font-bold uppercase tracking-[.06em] text-muted';
const linkButton = 'text-[12.5px] font-semibold text-brand-700 hover:underline disabled:opacity-50';
const saveButton = 'rounded-lg bg-brand-600 px-3 py-1.5 text-[12.5px] font-bold text-white '
  + 'hover:bg-brand-700 disabled:opacity-50';
const cancelButton = 'rounded-lg border border-slate-300 px-3 py-1.5 text-[12.5px] '
  + 'hover:bg-slate-50';

async function patch(path: string, body: unknown) {
  return post(path, body, 'PATCH');
}


const ROLE_OPTIONS = ['student', 'faculty', 'exams', 'placement', 'employer', 'admin', 'guardian'];

export interface PlatformPerson {
  membership_id: number; user_id: string; name: string; email: string;
  phone: string | null; role: string; membership_status: number; account_status: number;
}

/**
 * A member's identity and standing, edited together: name/email/phone/account
 * status go to onyx_users, role/membership status go to onyx_memberships --
 * PlatformService.updateMember() splits and audits them, this form just
 * collects both in one panel because that is how an operator thinks of "this
 * person's row", not two.
 */
export function MemberEditForm({ tenantId, person, onClose }: {
  tenantId: number; person: PlatformPerson; onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await patch(
            'onyx/platform/tenants/' + tenantId + '/members/' + person.membership_id,
            {
              name: String(data.get('name') ?? ''),
              email: String(data.get('email') ?? ''),
              phone: String(data.get('phone') ?? '') || null,
              role: String(data.get('role') ?? person.role),
              account_status: Number(data.get('account_status')),
              membership_status: Number(data.get('membership_status')),
            },
          );
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          onClose();
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="col-span-full text-[12.5px] text-red-700">{error}</p> : null}
      <div>
        <label className={smallLabel} htmlFor={'m-name-' + person.membership_id}>Name</label>
        <input id={'m-name-' + person.membership_id} name="name" defaultValue={person.name}
          required maxLength={255} className={smallField} />
      </div>
      <div>
        <label className={smallLabel} htmlFor={'m-email-' + person.membership_id}>Email</label>
        <input id={'m-email-' + person.membership_id} name="email" type="email"
          defaultValue={person.email} required className={smallField} />
      </div>
      <div>
        <label className={smallLabel} htmlFor={'m-phone-' + person.membership_id}>Phone</label>
        <input id={'m-phone-' + person.membership_id} name="phone"
          defaultValue={person.phone ?? ''} className={smallField} />
      </div>
      <div>
        <label className={smallLabel} htmlFor={'m-role-' + person.membership_id}>Role</label>
        <select id={'m-role-' + person.membership_id} name="role" defaultValue={person.role}
          className={smallField}>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div>
        <label className={smallLabel} htmlFor={'m-acct-' + person.membership_id}>
          Account
        </label>
        <select id={'m-acct-' + person.membership_id} name="account_status"
          defaultValue={person.account_status} className={smallField}>
          <option value={1}>Active</option>
          <option value={0}>Disabled</option>
        </select>
      </div>
      <div>
        <label className={smallLabel} htmlFor={'m-mem-' + person.membership_id}>
          Membership
        </label>
        <select id={'m-mem-' + person.membership_id} name="membership_status"
          defaultValue={person.membership_status} className={smallField}>
          <option value={1}>Active</option>
          <option value={0}>Suspended</option>
        </select>
      </div>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
        <button type="submit" disabled={pending} className={saveButton}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onClose} className={cancelButton}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * The "Edit" toggle -- used by the Students, Faculty and Other roles tables.
 *
 * Used to expand inline inside its own trailing `<td>`, with a hard-coded
 * `min-w-[280px]` fighting the rest of that row's columns for space -- on a
 * phone, editing a member meant a form squeezed into one narrow slice of an
 * already horizontally-scrolling table. A `Modal` needs no `<td>` at all: it
 * escapes the table and centres itself over the whole viewport, the same
 * idiom the sidebar's own create-forms (`CreateTenantForm`, `GrantAdminForm`)
 * already use.
 */
export function MemberEditToggle({ tenantId, person }: {
  tenantId: number; person: PlatformPerson;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={linkButton}>Edit</button>;
  }
  return (
    <Modal title={'Edit ' + person.name} onClose={() => setOpen(false)}>
      <MemberEditForm tenantId={tenantId} person={person} onClose={() => setOpen(false)} />
      {/* Below the form, not beside the row: by the time this is on screen the
          operator has named the person they are acting on. */}
      <RemoveMemberButton tenantId={tenantId} membershipId={person.membership_id}
        name={person.name} onDone={() => setOpen(false)} />
    </Modal>
  );
}

/** Override one exam mark's raw/final marks -- a dispute or a data-entry fix, not moderation. */
export function ExamMarkEditToggle({ tenantId, markId, rawMarks, finalMarks }: {
  tenantId: number; markId: number; rawMarks: number; finalMarks: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={linkButton}>Edit</button>;
  }
  return (
    <Modal title="Override this mark" onClose={() => setOpen(false)}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const res = await patch('onyx/platform/tenants/' + tenantId + '/exam-marks/' + markId, {
              raw_marks: Number(data.get('raw_marks')),
              final_marks: Number(data.get('final_marks')),
            });
            if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
            setOpen(false);
            router.refresh();
          });
        }}
      >
        {error ? <p role="alert" className="w-full text-[12.5px] text-red-700">{error}</p> : null}
        <div>
          <label className={smallLabel} htmlFor={'raw-' + markId}>Raw</label>
          <input id={'raw-' + markId} name="raw_marks" type="number" step="0.5"
            defaultValue={rawMarks} required className={smallField + ' w-24'} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'final-' + markId}>Final</label>
          <input id={'final-' + markId} name="final_marks" type="number" step="0.5"
            defaultValue={finalMarks} required className={smallField + ' w-24'} />
        </div>
        <button type="submit" disabled={pending} className={saveButton}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={cancelButton}>Cancel</button>
      </form>
    </Modal>
  );
}

/** Override an assessment attempt's score, and open its actual answers -- the "view submission" for CBT. */
export function AssessmentGradeActions({ tenantId, attemptId, score, maxScore }: {
  tenantId: number; attemptId: number; score: number | null; maxScore: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'closed' | 'edit' | 'view'>('closed');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [answers, setAnswers] = useState<Array<{
    id: number; question_id: number; response: unknown;
    auto_points: number | null; manual_points: number | null;
  }> | null>(null);
  const [loadingAnswers, setLoadingAnswers] = useState(false);

  async function openAnswers() {
    setMode('view');
    if (answers !== null) return;
    setLoadingAnswers(true);
    const res = await fetch(
      '/api/proxy/onyx/platform/tenants/' + tenantId + '/attempts/' + attemptId);
    const body = await res.json().catch(() => ({ ok: false }));
    setLoadingAnswers(false);
    if (body.ok) setAnswers(body.data.answers ?? []);
  }

  if (mode === 'closed') {
    return (
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('edit')} className={linkButton}>Edit</button>
        <button type="button" onClick={openAnswers} className={linkButton}>View</button>
      </div>
    );
  }

  if (mode === 'view') {
    return (
      <div className="min-w-[260px] rounded-xl border border-line bg-slate-50 p-3 text-left">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted">
            Answers
          </span>
          <button type="button" onClick={() => setMode('closed')} className={linkButton}>Close</button>
        </div>
        {loadingAnswers ? <p className="text-[12.5px] text-muted">Loading…</p> : null}
        {!loadingAnswers && answers?.length === 0 ? (
          <p className="text-[12.5px] text-muted">No answers recorded.</p>
        ) : null}
        {answers && answers.length > 0 ? (
          <ul className="space-y-2">
            {answers.map((a) => (
              <li key={a.id} className="border-b border-line pb-1.5 text-[12.5px] last:border-0">
                <div className="font-semibold">Question #{a.question_id}</div>
                <div className="break-words text-muted">{JSON.stringify(a.response)}</div>
                <div className="text-muted">
                  {a.manual_points ?? a.auto_points ?? '—'} pts
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await patch('onyx/platform/tenants/' + tenantId + '/attempts/' + attemptId, {
            score: Number(data.get('score')),
          });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setMode('closed');
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="w-full text-[12.5px] text-red-700">{error}</p> : null}
      <div>
        <label className={smallLabel} htmlFor={'score-' + attemptId}>
          Score (of {maxScore})
        </label>
        {/* No defaultValue={0} when score is null: pre-filling "Unmarked" with a
            real 0 means clicking Save without typing anything silently records a
            zero. Leaving it blank makes `required` actually block that submit. */}
        <input id={'score-' + attemptId} name="score" type="number" step="0.5"
          defaultValue={score ?? ''} placeholder={score == null ? 'Unmarked' : undefined}
          required className={smallField + ' w-28'} />
      </div>
      <button type="submit" disabled={pending} className={saveButton}>
        {pending ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={() => setMode('closed')} className={cancelButton}>Cancel</button>
    </form>
  );
}

/**
 * One submission's content, opened from an assignment's row -- body/file,
 * the current score and feedback, and a way to change either. This is what
 * "view submissions" means for coursework: not the count already on the
 * page, the actual thing the student handed in.
 */
function SubmissionCard({ tenantId, submission, onGraded }: {
  tenantId: number;
  submission: {
    id: number; user_id: string; status: string; attempt: number;
    submitted_at: string | null; is_late: number; score: number | null; feedback: string | null;
    student: { id: string; name: string; email: string } | null;
  };
  onGraded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [detail, setDetail] = useState<{ body: string | null; file_path: string | null } | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && detail === null) {
      setLoading(true);
      const res = await fetch(
        '/api/proxy/onyx/platform/tenants/' + tenantId + '/submissions/' + submission.id);
      const body = await res.json().catch(() => ({ ok: false }));
      setLoading(false);
      if (body.ok) setDetail({ body: body.data.body, file_path: body.data.file_path });
    }
  }

  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{submission.student?.name ?? 'Unknown'}</div>
          <div className="break-all text-[12.5px] text-muted">{submission.student?.email}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          <span>{submission.status}</span>
          <span className="tabular-nums">
            {submission.score == null ? 'Unmarked' : submission.score}
          </span>
          <button type="button" onClick={toggle} className={linkButton}>
            {open ? 'Close' : 'Open'}
          </button>
          <button type="button" onClick={() => setEditing((v) => !v)} className={linkButton}>
            {editing ? 'Cancel' : 'Edit grade'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-2 rounded-lg bg-slate-50 p-2.5 text-[13px]">
          {loading ? <p className="text-muted">Loading…</p> : (
            <>
              {detail?.body ? <p className="whitespace-pre-wrap break-words">{detail.body}</p> : null}
              {detail?.file_path ? (
                <p className="break-all font-mono text-[12px] text-muted">{detail.file_path}</p>
              ) : null}
              {!detail?.body && !detail?.file_path
                ? <p className="text-muted">Nothing was submitted in text or file form.</p> : null}
              {submission.feedback ? (
                <p className="mt-2 border-t border-line pt-2 text-muted">
                  Feedback: {submission.feedback}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {editing ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setError(null);
            start(async () => {
              const res = await patch(
                'onyx/platform/tenants/' + tenantId + '/submissions/' + submission.id,
                {
                  score: Number(data.get('score')),
                  feedback: String(data.get('feedback') ?? '') || null,
                },
              );
              if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
              setEditing(false);
              onGraded();
            });
          }}
        >
          {error ? <p role="alert" className="w-full text-[12.5px] text-red-700">{error}</p> : null}
          <div>
            <label className={smallLabel} htmlFor={'sub-score-' + submission.id}>Score</label>
            {/* Same reasoning as AssessmentGradeActions: never pre-fill an
                ungraded submission's score with a literal 0. */}
            <input id={'sub-score-' + submission.id} name="score" type="number" step="0.5"
              defaultValue={submission.score ?? ''}
              placeholder={submission.score == null ? 'Ungraded' : undefined}
              required className={smallField + ' w-24'} />
          </div>
          <div className="flex-1">
            <label className={smallLabel} htmlFor={'sub-fb-' + submission.id}>Feedback</label>
            <input id={'sub-fb-' + submission.id} name="feedback"
              defaultValue={submission.feedback ?? ''} className={smallField} />
          </div>
          <button type="submit" disabled={pending} className={saveButton}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </form>
      ) : null}
    </li>
  );
}

/** The "Submissions" toggle on an assignment row -- fetches the list only once opened. */
export function AssignmentSubmissionsToggle({ tenantId, assignmentId }: {
  tenantId: number; assignmentId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Array<{
    id: number; user_id: string; status: string; attempt: number;
    submitted_at: string | null; is_late: number; score: number | null; feedback: string | null;
    student: { id: string; name: string; email: string } | null;
  }> | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/proxy/onyx/platform/tenants/' + tenantId
      + '/assignments/' + assignmentId + '/submissions');
    const body = await res.json().catch(() => ({ ok: false }));
    setLoading(false);
    if (body.ok) setItems(body.data.submissions ?? []);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => { const next = !open; setOpen(next); if (next) load(); }}
        className={linkButton}
      >
        {open ? 'Hide submissions' : 'View submissions'}
      </button>
      {open ? (
        <div className="mt-2 rounded-xl border border-line bg-white p-3">
          {loading ? <p className="text-[12.5px] text-muted">Loading…</p> : null}
          {!loading && items?.length === 0 ? (
            <p className="text-[12.5px] text-muted">Nothing has been submitted yet.</p>
          ) : null}
          {items && items.length > 0 ? (
            <ul className="space-y-2">
              {items.map((s) => (
                <SubmissionCard key={s.id} tenantId={tenantId} submission={s}
                  onGraded={() => { load(); router.refresh(); }} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Edit a course's title, code, credits or status directly. */
/**
 * How a learner gets onto a course, as one choice.
 *
 * The console had no such choice at all: every course it created landed on the
 * column default, `batch`, so a customer set up from here got courses nobody
 * could join and nobody could buy. The wording matches the institution's own
 * form word for word, because these are the same three options and a customer
 * reading one screen and then the other should not have to work that out.
 */
const ACCESS_OPTIONS = [
  ['open', 'Open — anyone here may start it, free'],
  ['locked', 'Locked — they buy it first'],
  ['batch', 'The institution enrols them'],
] as const;

/** The house price for a locked course, in rupees. Matches the API's default. */
const LOCKED_PRICE_RUPEES = 300;

/**
 * The fields for access and price, shared by the create and edit forms.
 *
 * Price is only rendered when "locked" is chosen, because a price on a free
 * course is a number that does nothing — and a field that does nothing is a
 * field somebody fills in and then wonders about.
 */
function AccessFields({ idPrefix, access, setAccess, priceRupees, setPriceRupees,
  labelClass, fieldClass }: {
  idPrefix: string;
  access: string; setAccess: (v: string) => void;
  priceRupees: string; setPriceRupees: (v: string) => void;
  labelClass: string; fieldClass: string;
}) {
  return (
    <>
      <div>
        <label className={labelClass} htmlFor={idPrefix + '-access'}>How learners get on</label>
        <select id={idPrefix + '-access'} name="access" value={access}
          onChange={(e) => setAccess(e.target.value)} className={fieldClass}>
          {ACCESS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {access === 'locked' ? (
        <div>
          <label className={labelClass} htmlFor={idPrefix + '-price'}>Price (₹)</label>
          {/* Rupees, not paise. The database stores minor units and the form
              converts: nobody setting a price should have to multiply by a
              hundred, and a slip of two zeroes is ₹300 against ₹30,000. */}
          <input id={idPrefix + '-price'} name="price" type="number" min={1} step="1"
            value={priceRupees} onChange={(e) => setPriceRupees(e.target.value)}
            className={fieldClass} />
        </div>
      ) : null}
    </>
  );
}

export function CourseEditToggle({ tenantId, course }: {
  tenantId: number;
  course: { id: number; title: string; code: string; credits: number; status: number;
    access?: string | null; price_minor?: number | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [access, setAccess] = useState(course.access ?? 'batch');
  const [priceRupees, setPriceRupees] = useState(
    String(Math.round(Number(course.price_minor ?? 0) / 100) || LOCKED_PRICE_RUPEES));

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={linkButton}>Edit</button>;
  }
  return (
    <Modal title={'Edit ' + course.title} onClose={() => setOpen(false)}>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const res = await patch('onyx/platform/tenants/' + tenantId + '/courses/' + course.id, {
              title: String(data.get('title') ?? ''),
              code: String(data.get('code') ?? ''),
              credits: Number(data.get('credits')),
              status: Number(data.get('status')),
              access,
              // Sent only when it means something. A price on a free course is
              // a number nobody reads, and the API prices a locked course at
              // the house rate when none is given.
              ...(access === 'locked'
                ? { price_minor: Math.round((Number(priceRupees) || LOCKED_PRICE_RUPEES) * 100) }
                : {}),
            });
            if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
            setOpen(false);
            router.refresh();
          });
        }}
      >
        {error ? <p role="alert" className="col-span-full text-[12.5px] text-red-700">{error}</p> : null}
        <div>
          <label className={smallLabel} htmlFor={'c-title-' + course.id}>Title</label>
          <input id={'c-title-' + course.id} name="title" defaultValue={course.title}
            required className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'c-code-' + course.id}>Code</label>
          <input id={'c-code-' + course.id} name="code" defaultValue={course.code}
            required className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'c-credits-' + course.id}>Credits</label>
          <input id={'c-credits-' + course.id} name="credits" type="number"
            defaultValue={course.credits} required className={smallField} />
        </div>
        <div>
          {/* "Published", not "Open". `status` is whether the course exists for
              anybody to see; `access` below is whether they can join it for
              nothing. Calling the first one "Open" put two different meanings
              on one word, on the same screen, and left an operator setting a
              course "Open" and wondering why nobody could join it. */}
          <label className={smallLabel} htmlFor={'c-status-' + course.id}>Status</label>
          <select id={'c-status-' + course.id} name="status" defaultValue={course.status}
            className={smallField}>
            <option value={1}>Published</option>
            <option value={0}>Draft</option>
          </select>
        </div>
        <AccessFields idPrefix={'c-' + course.id} access={access} setAccess={setAccess}
          priceRupees={priceRupees} setPriceRupees={setPriceRupees}
          labelClass={smallLabel} fieldClass={smallField} />
        <div className="col-span-full flex gap-2">
          <button type="submit" disabled={pending} className={saveButton}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={cancelButton}>Cancel</button>
        </div>
      </form>
      <CourseDeleteButton tenantId={tenantId} course={course} onDone={() => setOpen(false)} />
    </Modal>
  );
}

/**
 * Removes a course outright, from the platform console -- an operator
 * acting on a tenant's behalf. Everything on it (modules, lessons,
 * enrolments, assignments, attendance, exams and their marks) cascades at
 * the database; a bank, assessment, problem or certificate that drew on it
 * survives, unlinked. A course is a smaller blast radius than a whole
 * institution, so this asks a plain yes/no rather than DeleteTenantButton's
 * type-the-name confirmation.
 */
export function CourseDeleteButton({ tenantId, course, onDone }: {
  tenantId: number; course: { id: number; title: string; code?: string }; onDone?: () => void;
}) {
  const router = useRouter();
  return (
    <DangerPanel
      heading="Delete this course"
      what={<>
        Permanent. Every module, lesson, enrolment, assignment, attendance record and exam mark
        belonging to <strong className="text-slate-700">{course.title}</strong> goes with it.
        A question bank, assessment or certificate that drew on the course survives, unlinked.
        To take it out of circulation without losing any of that, set Status to <em>Draft</em>
        {' '}above.
      </>}
      cta="Delete course"
      confirmWith={course.code}
      onConfirm={async () => {
        const res = await post(
          'onyx/platform/tenants/' + tenantId + '/courses/' + course.id, undefined, 'DELETE');
        if (res.ok) { onDone?.(); router.refresh(); }
        return res;
      }}
    />
  );
}

/** Edit an assignment's title, due date, points or status directly. */
export function AssignmentEditToggle({ tenantId, assignment }: {
  tenantId: number;
  assignment: { id: number; title: string; due_at: string | null; total_points: number; status: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={linkButton}>Edit</button>;
  }
  return (
    <Modal title={'Edit ' + assignment.title} onClose={() => setOpen(false)}>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const dueRaw = String(data.get('due_at') ?? '');
            const res = await patch(
              'onyx/platform/tenants/' + tenantId + '/assignments/' + assignment.id,
              {
                title: String(data.get('title') ?? ''),
                due_at: dueRaw ? new Date(dueRaw).toISOString() : null,
                total_points: Number(data.get('total_points')),
                status: String(data.get('status') ?? assignment.status),
              },
            );
            if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
            setOpen(false);
            router.refresh();
          });
        }}
      >
        {error ? <p role="alert" className="col-span-full text-[12.5px] text-red-700">{error}</p> : null}
        <div className="col-span-full">
          <label className={smallLabel} htmlFor={'a-title-' + assignment.id}>Title</label>
          <input id={'a-title-' + assignment.id} name="title" defaultValue={assignment.title}
            required className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'a-due-' + assignment.id}>Due</label>
          <input id={'a-due-' + assignment.id} name="due_at" type="datetime-local"
            defaultValue={assignment.due_at ? assignment.due_at.slice(0, 16) : ''}
            className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'a-points-' + assignment.id}>Out of</label>
          <input id={'a-points-' + assignment.id} name="total_points" type="number"
            defaultValue={assignment.total_points} required className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'a-status-' + assignment.id}>Status</label>
          <select id={'a-status-' + assignment.id} name="status" defaultValue={assignment.status}
            className={smallField}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div className="col-span-full flex gap-2">
          <button type="submit" disabled={pending} className={saveButton}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={cancelButton}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/** Edit an assessment's title, window, pass mark, duration or status directly. */
export function AssessmentEditToggle({ tenantId, assessment }: {
  tenantId: number;
  assessment: {
    id: number; title: string; closes_at: string | null; status: string;
    pass_mark: number | null; duration_minutes: number;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={linkButton}>Edit</button>;
  }
  return (
    <Modal title={'Edit ' + assessment.title} onClose={() => setOpen(false)}>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const closesRaw = String(data.get('closes_at') ?? '');
            const passRaw = String(data.get('pass_mark') ?? '');
            const res = await patch(
              'onyx/platform/tenants/' + tenantId + '/assessments/' + assessment.id,
              {
                title: String(data.get('title') ?? ''),
                closes_at: closesRaw ? new Date(closesRaw).toISOString() : null,
                pass_mark: passRaw ? Number(passRaw) : null,
                duration_minutes: Number(data.get('duration_minutes')),
                status: String(data.get('status') ?? assessment.status),
              },
            );
            if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
            setOpen(false);
            router.refresh();
          });
        }}
      >
        {error ? <p role="alert" className="col-span-full text-[12.5px] text-red-700">{error}</p> : null}
        <div className="col-span-full">
          <label className={smallLabel} htmlFor={'as-title-' + assessment.id}>Title</label>
          <input id={'as-title-' + assessment.id} name="title" defaultValue={assessment.title}
            required className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'as-closes-' + assessment.id}>Closes</label>
          <input id={'as-closes-' + assessment.id} name="closes_at" type="datetime-local"
            defaultValue={assessment.closes_at ? assessment.closes_at.slice(0, 16) : ''}
            className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'as-pass-' + assessment.id}>Pass mark</label>
          <input id={'as-pass-' + assessment.id} name="pass_mark" type="number"
            defaultValue={assessment.pass_mark ?? ''} className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'as-dur-' + assessment.id}>Minutes</label>
          <input id={'as-dur-' + assessment.id} name="duration_minutes" type="number"
            defaultValue={assessment.duration_minutes} required className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'as-status-' + assessment.id}>Status</label>
          <select id={'as-status-' + assessment.id} name="status" defaultValue={assessment.status}
            className={smallField}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div className="col-span-full flex gap-2">
          <button type="submit" disabled={pending} className={saveButton}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={cancelButton}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/** Edit a scheduled exam's title, start time, duration, marks or status directly. */
export function ExamEditToggle({ tenantId, exam }: {
  tenantId: number;
  exam: {
    id: number; title: string; starts_at: string | null; duration_minutes: number;
    max_marks: number; pass_marks: number; status: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Held in state so the echo below the field updates as it is changed, and
  // seeded from the stored instant IN LOCAL TIME -- see `toLocalInput`.
  const [starts, setStarts] = useState(() => toLocalInput(exam.starts_at));

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={linkButton}>Edit</button>;
  }
  return (
    <Modal title={'Edit ' + exam.title} onClose={() => setOpen(false)}>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const startsRaw = String(data.get('starts_at') ?? '');
            const res = await patch('onyx/platform/tenants/' + tenantId + '/exams/' + exam.id, {
              title: String(data.get('title') ?? ''),
              // `new Date('2026-08-25T13:35')` is parsed in the BROWSER's zone,
              // so an operator working from anywhere but India would have
              // stored the wrong instant for a time typed under a heading that
              // says IST. `fromLocalInput` pins it to the institution's.
              starts_at: fromLocalInput(startsRaw),
              duration_minutes: Number(data.get('duration_minutes')),
              max_marks: Number(data.get('max_marks')),
              pass_marks: Number(data.get('pass_marks')),
              status: String(data.get('status') ?? exam.status),
            });
            if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
            setOpen(false);
            router.refresh();
          });
        }}
      >
        {error ? <p role="alert" className="col-span-full text-[12.5px] text-red-700">{error}</p> : null}
        <div className="col-span-full">
          <label className={smallLabel} htmlFor={'ex-title-' + exam.id}>Title</label>
          <input id={'ex-title-' + exam.id} name="title" defaultValue={exam.title}
            required className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'ex-starts-' + exam.id}>Starts</label>
          <input id={'ex-starts-' + exam.id} name="starts_at" type="datetime-local"
            value={starts} onChange={(e) => setStarts(e.target.value)}
            className={smallField} />
          <WhenEcho value={starts} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'ex-dur-' + exam.id}>Minutes</label>
          <input id={'ex-dur-' + exam.id} name="duration_minutes" type="number"
            defaultValue={exam.duration_minutes} required className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'ex-max-' + exam.id}>Out of</label>
          <input id={'ex-max-' + exam.id} name="max_marks" type="number"
            defaultValue={exam.max_marks} required className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'ex-pass-' + exam.id}>Pass mark</label>
          <input id={'ex-pass-' + exam.id} name="pass_marks" type="number"
            defaultValue={exam.pass_marks} required className={smallField} />
        </div>
        <div>
          <label className={smallLabel} htmlFor={'ex-status-' + exam.id}>Status</label>
          <select id={'ex-status-' + exam.id} name="status" defaultValue={exam.status}
            className={smallField}>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="col-span-full flex gap-2">
          <button type="submit" disabled={pending} className={saveButton}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={cancelButton}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/** Edit the institution's own name, address and plan label. */
/**
 * What the operator just typed, read back to them in words.
 *
 * A `datetime-local` control gives no feedback about what it understood, and on
 * a twelve-hour picker "01:35" and "13:35" are one mis-click apart. An
 * examination was scheduled for 1:35 in the morning that way, ten hours before
 * the operator meant, and nothing on the screen said so — not the form, not the
 * list, not the learner's timetable.
 *
 * So the resolved instant is echoed with its weekday, and a time already past
 * is called out. The zone is named because every time in this product is the
 * institution's, and the reader is not obliged to assume that.
 */
function WhenEcho({ value }: { value: string }) {
  const iso = fromLocalInput(value);
  if (!iso) return null;
  const past = Date.parse(iso) < Date.now();
  return (
    <p className={'mt-1 text-[12px] leading-relaxed '
      + (past ? 'font-semibold text-amber-800' : 'text-muted')}>
      {past ? 'That is in the past: ' : ''}{longWhen(iso)}
      <span className="text-muted"> · {INSTITUTION_TZ}</span>
    </p>
  );
}

/**
 * Who a paper or a sitting is for.
 *
 * "Everybody" leads and is the default, because it is both the common case and
 * what every row created before sections existed means — a paper that names no
 * section is for the whole cohort, and that has to stay true.
 *
 * Named `section_id` to match the field it posts. The empty string is the
 * everybody case, which the caller turns into null rather than 0: a zero would
 * be a section id that does not exist.
 */
function SectionChoice({ id, sections, value, onChange }: {
  id: string;
  sections: { id: number; name: string }[];
  value: string;
  onChange: (next: string) => void;
}) {
  if (!sections.length) return null;
  return (
    <div>
      <label className={label} htmlFor={id}>
        Set for <span aria-hidden="true" className="text-red-600">*</span>
      </label>
      {/*
        * A choice that has to be made, not one with a silent default.
        *
        * "Everybody" is still the common answer and is still one click away --
        * what is gone is its being PRE-selected, which let a paper meant for
        * one section reach the whole cohort because nobody touched the field.
        * `required` on a select whose first option has an empty value is what
        * makes the browser insist.
        */}
      <select id={id} name="section_id" value={value} className={field} required
        onChange={(e) => onChange(e.target.value)}>
        <option value="">Who is this for?…</option>
        <option value="all">Everybody on the course</option>
        {sections.map((sx) => (
          <option key={sx.id} value={sx.id}>{sx.name} only</option>
        ))}
      </select>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        {value === 'all'
          ? 'Every student on the course, whichever section they are in.'
          : value
            ? 'Only the students in that section are dealt this, and only they can start it.'
            : 'Pick one before saving — a paper set for the wrong people is not a mistake '
              + 'anybody notices until they sit it.'}
      </p>
    </div>
  );
}

export function TenantEditForm({ tenant }: {
  tenant: {
    id: number; name: string; slug: string; plan: string | null;
    community_url?: string | null; community_label?: string | null;
    student_signup?: boolean; signup_mode?: string; signup_domains?: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
        Edit details
      </button>
    );
  }
  return (
    <form
      className="mt-3 grid min-w-0 gap-3 rounded-xl border border-line bg-slate-50 p-3
                 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await patch('onyx/platform/tenants/' + tenant.id, {
            name: String(data.get('name') ?? ''),
            slug: String(data.get('slug') ?? ''),
            plan: String(data.get('plan') ?? '') || null,
            // Empty clears it, which is why these are sent as '' rather than
            // omitted: an operator deleting the link means to delete it.
            community_url: String(data.get('community_url') ?? ''),
            community_label: String(data.get('community_label') ?? ''),
            /*
             * Registration, which decides whether this institution appears on
             * the public sign-up page at all.
             *
             * Three states from two fields: off is "nobody registers
             * themselves"; on with `domain` is "an address at one of our own
             * domains finds us"; on with `open` is "anybody may pick us from
             * the list". The radio carries all three so an operator never has
             * to reason about which combination they are producing.
             */
            student_signup: String(data.get('registration') ?? 'off') !== 'off',
            signup_mode: String(data.get('registration') ?? 'off') === 'open'
              ? 'open' as const : 'domain' as const,
            signup_domains: String(data.get('signup_domains') ?? ''),
          });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="col-span-full text-[12.5px] text-red-700">{error}</p> : null}
      <div>
        <label className={smallLabel} htmlFor="t-name">Name</label>
        <input id="t-name" name="name" defaultValue={tenant.name} required maxLength={255}
          className={smallField} />
      </div>
      <div>
        <label className={smallLabel} htmlFor="t-slug">Address</label>
        <input id="t-slug" name="slug" defaultValue={tenant.slug} required maxLength={255}
          className={smallField} />
      </div>
      <div>
        <label className={smallLabel} htmlFor="t-plan">Plan</label>
        <input id="t-plan" name="plan" defaultValue={tenant.plan ?? ''} maxLength={50}
          className={smallField} />
      </div>
      {/*
        * The community link, from the console.
        *
        * It was reachable only from an institution's OWN settings screen, so an
        * operator could not set it for an institution whose administrator had
        * not got round to it -- and the Jobs page then showed no button at all,
        * with nothing anywhere saying why. Refused here unless it is an http or
        * https address, by the same check the institution's own route uses.
        */}
      <div className="col-span-full border-t border-line pt-3">
        <label className={smallLabel} htmlFor="t-community">Community link</label>
        <input id="t-community" name="community_url" type="url"
          defaultValue={tenant.community_url ?? ''} maxLength={500}
          placeholder="https://chat.whatsapp.com/…"
          className={smallField} />
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Shown as a button on this institution&rsquo;s Jobs page. A WhatsApp, Telegram or
          Discord invite — anything on http or https. Leave it empty for no button.
        </p>
      </div>
      <div className="col-span-full sm:col-span-2">
        <label className={smallLabel} htmlFor="t-community-label">Button wording</label>
        <input id="t-community-label" name="community_label"
          defaultValue={tenant.community_label ?? ''} maxLength={120}
          placeholder="Join our WhatsApp community"
          className={smallField} />
      </div>

      {/*
        * Registration, from the console.
        *
        * The switch existed only on an institution's OWN settings screen, so
        * the operator fielding "why is my college missing from the sign-up
        * list" could neither see the answer nor change it without being handed
        * that institution's administrator account. The three options are the
        * three real states, named by what happens rather than by which column
        * they set.
        */}
      <fieldset className="col-span-full border-t border-line pt-3">
        <legend className={smallLabel}>Registration</legend>
        <div className="mt-1.5 grid gap-1.5">
          {([
            ['off', 'Closed',
              'Nobody signs themselves up. Every account is created by somebody here.'],
            ['domain', 'By email domain',
              'Not listed publicly, but somebody with an address at one of the domains '
              + 'below finds this institution automatically.'],
            ['open', 'Open to anyone',
              'Listed on the public sign-up page. Anybody may pick this institution and '
              + 'join at once — the emailed code is the only check.'],
          ] as const).map(([value, label, why]) => (
            <label key={value} className="flex items-start gap-2 text-[13px]">
              <input type="radio" name="registration" value={value} className="mt-1"
                defaultChecked={
                  (!tenant.student_signup && value === 'off')
                  || (!!tenant.student_signup
                    && value === (tenant.signup_mode === 'open' ? 'open' : 'domain'))
                } />
              <span className="min-w-0">
                <span className="font-semibold">{label}</span>
                <span className="block text-[12px] leading-relaxed text-muted">{why}</span>
              </span>
            </label>
          ))}
        </div>
        <label className={smallLabel + ' mt-2.5 block'} htmlFor="t-signup-domains">
          Their email domains
        </label>
        <input id="t-signup-domains" name="signup_domains"
          defaultValue={tenant.signup_domains ?? ''} maxLength={500}
          placeholder="mallareddyuniversity.ac.in, *.mru.edu.in"
          className={smallField} />
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Separated by commas or spaces. A leading <span className="font-mono">*.</span> means
          subdomains only. Used when registration is by domain — and switching that on with
          no domains here means nobody can ever register.
        </p>
      </fieldset>

      <div className="col-span-full flex gap-2">
        <button type="submit" disabled={pending} className={saveButton}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={cancelButton}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Permanently delete an institution. Typing the exact name is the confirm --
 * the same "type it to be sure" shape as GitHub's repo delete, because a
 * click is reversible by nobody meaning to and this is not reversible at
 * all. Redirects to the institutions list on success, since the page this
 * button lives on no longer exists once it works.
 */
export function DeleteTenantButton({ tenantId, tenantName }: { tenantId: number; tenantName: string }) {
  const router = useRouter();
  return (
    <DangerPanel
      heading="Delete this institution"
      what={<>
        Permanent, and it takes everything with it: every member, course, enrolment, mark,
        register and invoice belonging to <strong className="text-slate-700">{tenantName}</strong>.
        There is no undo and no export. Suspending sign-in, above, achieves everything except
        the losing.
      </>}
      cta="Delete institution"
      confirmWith={tenantName}
      onConfirm={async () => {
        const res = await post('onyx/platform/tenants/' + tenantId,
          { confirm_name: tenantName }, 'DELETE');
        // The page this ran from stops existing the moment it succeeds.
        if (res.ok) { router.push('/onyx/platform'); router.refresh(); }
        return res;
      }}
    />
  );
}

/**
 * Remove a member from this institution -- distinct from RevokeAdminButton,
 * which removes platform-admin standing rather than institution membership.
 *
 * No longer a red word at the end of every row in the roster. It lives at the
 * foot of that one person's edit panel, which is the only place an operator
 * can be sure WHICH of four hundred near-identical rows they are acting on.
 * Suspending a membership -- the reversible thing, and nearly always the thing
 * actually wanted -- is a dropdown in the form above it.
 */
export function RemoveMemberButton({ tenantId, membershipId, name, onDone }: {
  tenantId: number; membershipId: number; name: string; onDone?: () => void;
}) {
  const router = useRouter();
  return (
    <DangerPanel
      heading="Remove from this institution"
      what={<>
        Takes {name}&rsquo;s membership away: they lose access to this institution and drop off
        its rosters. Their marks, submissions and invoices stay on record. To stop them signing
        in without removing them, set Membership to <em>Suspended</em> above instead.
      </>}
      cta="Remove member"
      onConfirm={async () => {
        const res = await post(
          'onyx/platform/tenants/' + tenantId + '/members/' + membershipId, undefined, 'DELETE');
        if (res.ok) { onDone?.(); router.refresh(); }
        return res;
      }}
    />
  );
}

/** Create a course. */
export function CreateCourseForm({ tenantId }: { tenantId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Open by default: a course somebody can join is the common case, and it was
  // the one the console could not produce at all.
  const [access, setAccess] = useState('open');
  const [priceRupees, setPriceRupees] = useState(String(LOCKED_PRICE_RUPEES));

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={button}>Add a course</button>;
  }
  return (
    <form
      className="grid gap-3 rounded-2xl border border-line bg-slate-50 p-4 sm:grid-cols-2
                 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await post('onyx/platform/tenants/' + tenantId + '/courses', {
            code: String(data.get('code') ?? ''),
            title: String(data.get('title') ?? ''),
            credits: Number(data.get('credits') || 0),
            access,
            ...(access === 'locked'
              ? { price_minor: Math.round((Number(priceRupees) || LOCKED_PRICE_RUPEES) * 100) }
              : {}),
          });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="col-span-full text-[13px] text-red-700">{error}</p> : null}
      <div>
        <label className={label} htmlFor="cc-code">Code</label>
        <input id="cc-code" name="code" required maxLength={50} placeholder="CS101"
          className={field} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="cc-title">Title</label>
        <input id="cc-title" name="title" required maxLength={255} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="cc-credits">Credits</label>
        <input id="cc-credits" name="credits" type="number" min={0} defaultValue={3}
          className={field} />
      </div>
      <AccessFields idPrefix="cc" access={access} setAccess={setAccess}
        priceRupees={priceRupees} setPriceRupees={setPriceRupees}
        labelClass={label} fieldClass={field} />
      <p className="col-span-full -mt-1 text-[12px] text-muted">
        Created as a draft either way — publishing is a separate step. A locked course costs
        ₹{LOCKED_PRICE_RUPEES} unless you change it.
      </p>
      <div className="col-span-full flex gap-2">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

interface CourseOption { id: number; code: string; title: string }

/** Create an assignment against one of this institution's courses. */
export function CreateAssignmentForm({ tenantId, courses }: {
  tenantId: number; courses: CourseOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={!courses.length}
        className={button} title={courses.length ? undefined : 'Add a course first'}>
        Add an assignment
      </button>
    );
  }
  return (
    <form
      className="grid gap-3 rounded-2xl border border-line bg-slate-50 p-4 sm:grid-cols-2
                 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const dueRaw = String(data.get('due_at') ?? '');
          const res = await post('onyx/platform/tenants/' + tenantId + '/assignments', {
            course_id: Number(data.get('course_id')),
            title: String(data.get('title') ?? ''),
            due_at: dueRaw ? new Date(dueRaw).toISOString() : null,
            total_points: Number(data.get('total_points') || 100),
          });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="col-span-full text-[13px] text-red-700">{error}</p> : null}
      <div className="sm:col-span-2">
        <label className={label} htmlFor="ca-title">Title</label>
        <input id="ca-title" name="title" required maxLength={255} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="ca-course">Course</label>
        <select id="ca-course" name="course_id" required className={field}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="ca-points">Out of</label>
        <input id="ca-points" name="total_points" type="number" min={1} defaultValue={100}
          className={field} />
      </div>
      <div>
        <label className={label} htmlFor="ca-due">Due</label>
        <input id="ca-due" name="due_at" type="datetime-local" className={field} />
      </div>
      <div className="col-span-full flex gap-2">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Create an assessment -- no sections/proctoring here, same scope as
 * PlatformService.createAssessment(). */
/**
 * How a paper is sat, and how it is marked.
 *
 * These switches live on the paper and always have. Only faculty's builder
 * offered them, so a paper created from the console came out unproctored and
 * unshuffled with nothing on the screen saying so -- an operator scheduled an
 * examination and got an open-book one.
 *
 * The defaults deliberately differ from faculty's. A paper set by a lecturer is
 * usually coursework, where monitoring is an imposition to opt into; a paper set
 * from the console is the institution's own examination, so monitoring, camera
 * and screen sharing start ON and an operator turns them off for the papers
 * that do not need them. They are shown ticked rather than applied invisibly,
 * because a camera requirement nobody was shown is one nobody agreed to.
 */
export interface PaperSwitchState {
  shuffle_questions: boolean;
  shuffle_options: boolean;
  proctoring: boolean;
  require_camera: boolean;
  require_screen: boolean;
  watch_camera: boolean;
  anonymous_marking: boolean;
  moderation_required: boolean;
  instant_results: boolean;
}

/** What an institution's examination is, before anybody changes anything. */
export const PAPER_SWITCH_DEFAULTS: PaperSwitchState = {
  shuffle_questions: true,
  shuffle_options: true,
  proctoring: true,
  require_camera: true,
  require_screen: true,
  watch_camera: true,
  anonymous_marking: true,
  moderation_required: false,
  instant_results: true,
};

const SWITCHES: {
  k: keyof PaperSwitchState; title: string; note: string; group: string;
  dependent?: boolean;
}[] = [
  { group: 'The sitting', k: 'shuffle_questions', title: 'Shuffle the questions',
    note: 'Each candidate gets them in a different order.' },
  { group: 'The sitting', k: 'shuffle_options', title: 'Shuffle the options',
    note: 'Answer positions differ, so “it was the third one” does not travel.' },
  { group: 'Monitoring', k: 'proctoring', title: 'Monitor the sitting',
    note: 'Records events — tab switches, pastes — and asks for consent first. '
      + 'No video is stored.' },
  { group: 'Monitoring', k: 'require_camera', title: 'Require a camera',
    note: 'The candidate cannot start without one.', dependent: true },
  { group: 'Monitoring', k: 'require_screen', title: 'Require screen sharing',
    note: 'The candidate shares their screen for the whole sitting.', dependent: true },
  { group: 'Monitoring', k: 'watch_camera', title: 'Let an invigilator watch the camera live',
    note: 'An invigilator opens one candidate at a time and sees their camera while they '
      + 'sit. Nothing is recorded, and the candidate is told on their own screen whenever '
      + 'somebody is watching.', dependent: true },
  { group: 'Marking', k: 'anonymous_marking', title: 'Mark anonymously',
    note: 'The marker sees “Candidate 1”, not a name.' },
  { group: 'Marking', k: 'moderation_required', title: 'Require moderation',
    note: 'Results cannot be published until every attempt has a moderator’s mark.' },
  { group: 'Marking', k: 'instant_results', title: 'Show the score as soon as they hand in',
    note: 'Only applies where the paper can be marked without a person. Switch it off for '
      + 'a paper others have not sat yet: the first candidate to finish learns which '
      + 'answers were right.' },
];

export function PaperSwitches({ value, onChange }: {
  value: PaperSwitchState;
  onChange: (next: PaperSwitchState) => void;
}) {
  const groups = [...new Set(SWITCHES.map((sw) => sw.group))];
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <fieldset key={group} className="rounded-xl border border-line">
          <legend className="ml-3 px-1 text-[11px] font-semibold uppercase tracking-wide
                             text-muted">
            {group}
          </legend>
          <div className="divide-y divide-line">
            {SWITCHES.filter((sw) => sw.group === group).map((sw) => {
              // The three device switches do nothing unless monitoring is on,
              // so they say so and disable rather than silently having no
              // effect -- the same rule faculty's builder follows.
              const off = Boolean(sw.dependent) && !value.proctoring;
              return (
                <label key={sw.k}
                  className={'flex cursor-pointer items-start gap-3 px-3 py-2.5 '
                    + (off ? 'opacity-50' : '')}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0"
                    checked={value[sw.k] && !off}
                    disabled={off}
                    onChange={(e) => onChange({ ...value, [sw.k]: e.target.checked })}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-ink">{sw.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">
                      {off ? 'Only applies when monitoring is on.' : sw.note}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/**
 * The switches as the API takes them.
 *
 * The three dependent ones are forced off when monitoring is off, so what is
 * stored matches what the screen showed. Otherwise a paper could carry
 * `watch_camera` while unproctored -- harmless today, and exactly the kind of
 * stored contradiction that becomes a bug when somebody later reads one switch
 * without the other.
 */
export function paperSwitchBody(v: PaperSwitchState) {
  return {
    shuffle_questions: v.shuffle_questions,
    shuffle_options: v.shuffle_options,
    proctoring: v.proctoring,
    require_camera: v.proctoring && v.require_camera,
    require_screen: v.proctoring && v.require_screen,
    watch_camera: v.proctoring && v.watch_camera,
    anonymous_marking: v.anonymous_marking,
    moderation_required: v.moderation_required,
    instant_results: v.instant_results,
  };
}

export function CreateAssessmentForm({ tenantId, courses, sections = [] }: {
  tenantId: number; courses: CourseOption[];
  /** The institution's teaching divisions, so a paper can be set for one. */
  sections?: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [switches, setSwitches] = useState<PaperSwitchState>(PAPER_SWITCH_DEFAULTS);
  const [sectionId, setSectionId] = useState('');

  const form = (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const opensRaw = String(data.get('opens_at') ?? '');
          const closesRaw = String(data.get('closes_at') ?? '');
          const courseRaw = String(data.get('course_id') ?? '');
          const res = await post('onyx/platform/tenants/' + tenantId + '/assessments', {
            title: String(data.get('title') ?? ''),
            course_id: courseRaw ? Number(courseRaw) : null,
            opens_at: opensRaw ? new Date(opensRaw).toISOString() : null,
            closes_at: closesRaw ? new Date(closesRaw).toISOString() : null,
            duration_minutes: Number(data.get('duration_minutes') || 60),
            pass_mark: Number(data.get('pass_mark') || 0) || null,
            // Empty means everybody, and is sent as null rather than 0 -- a
            // zero would be a section id that does not exist.
            // 'all' is the everybody case, which the API expresses as null.
            section_id: sectionId && sectionId !== 'all' ? Number(sectionId) : null,
            ...paperSwitchBody(switches),
          });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="col-span-full text-[13px] text-red-700">{error}</p> : null}
      <div className="sm:col-span-2">
        <label className={label} htmlFor="cs-title">Title</label>
        <input id="cs-title" name="title" required maxLength={255} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="cs-course">Course (optional)</label>
        <select id="cs-course" name="course_id" defaultValue="" className={field}>
          <option value="">Not tied to a course</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="cs-duration">Duration (minutes)</label>
        <input id="cs-duration" name="duration_minutes" type="number" min={1} defaultValue={60}
          className={field} />
      </div>
      <div>
        <label className={label} htmlFor="cs-pass">Pass mark</label>
        <input id="cs-pass" name="pass_mark" type="number" min={0} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="cs-opens">Opens</label>
        <input id="cs-opens" name="opens_at" type="datetime-local" className={field} />
      </div>
      <div>
        <label className={label} htmlFor="cs-closes">Closes</label>
        <input id="cs-closes" name="closes_at" type="datetime-local" className={field} />
      </div>
      {/*
        * Said before the button, not discovered afterwards.
        *
        * A paper is created EMPTY: it draws no questions until sections are
        * set against a question bank, and until then nobody can sit it. The
        * engine refuses it at the moment a candidate presses Start, which is
        * far too late for anybody to do something about it.
        */}
      <SectionChoice id="cs-section" sections={sections}
        value={sectionId} onChange={setSectionId} />

      <div className="col-span-full">
        <PaperSwitches value={switches} onChange={setSwitches} />
      </div>

      <p className="col-span-full text-[12.5px] leading-relaxed text-muted">
        A paper is created as a draft with no questions in it. Add a section from a question
        bank next — the “Add questions” control on its row — and then publish it.
      </p>

      <div className="col-span-full flex gap-2 pt-1">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Creating…' : 'Create the paper'}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={button}>
        Add an assessment
      </button>
      {/* A dialog, for the reason the exam form is one: four columns of fields
          unfolding inside a header row is what put a horizontal scrollbar
          under the whole page. */}
      {open ? (
        <Modal title="New paper" onClose={() => setOpen(false)} wide>
          {form}
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Schedule an exam.
 *
 * A course, a time and a mark scheme. **No semester field**, and that is the
 * whole of the decision: 0037 dropped the NOT NULL on `onyx_exams.semester_id`
 * because a resit, a make-up sitting and a certification exam on a course
 * outside any programme are all real, and the API takes the term from the
 * course when there is one. This form asked anyway, which left an operator
 * choosing between a row they had no reason to think about and a blank
 * labelled "Optional" -- two ways of answering a question the record does not
 * need. The institution's own scheduling form stopped asking some time ago;
 * this is the console catching up, and nothing about the row that gets written
 * changes.
 */
export function CreateExamForm({
  tenantId, courses, papers = [], sections = [], banks = [], basePath,
}: {
  /** Only used to build the default path; omit it when passing `basePath`. */
  tenantId?: number;
  /**
   * Which side of the product is scheduling.
   *
   * The console writes through `onyx/platform/tenants/:id`, an institution's
   * own staff through `onyx` — same fields, same four writes, same refusals,
   * different guard. It is one form because the client asked for one form:
   * "see how super admin can create examination, do it similarly for faculty",
   * and two copies of a four-write sequence is two chances to leave a paper
   * behind.
   */
  basePath?: string;
  courses: CourseOption[];
  /** The institution's papers, so a sitting can be one sat in a browser. */
  papers?: { id: number; title: string; course_id: number | null; status: string }[];
  /** Its teaching divisions, so a sitting can be for one of them. */
  sections?: { id: number; name: string }[];
  /** The banks a sitting can be set from directly. */
  banks?: ConsoleBank[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Held in state so the echo under the field updates as it is typed.
  const [starts, setStarts] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [pending, start] = useTransition();
  const [courseId, setCourseId] = useState<number | null>(courses[0]?.id ?? null);
  /** How this sitting is sat -- and therefore what the rest of the form asks. */
  const [how, setHow] = useState<'bank' | 'paper' | 'offline'>('bank');
  const [bankId, setBankId] = useState('');
  const [take, setTake] = useState('');
  const [switches, setSwitches] = useState<PaperSwitchState>(PAPER_SWITCH_DEFAULTS);
  const [stage, setStage] = useState<string | null>(null);
  // A course is all that is genuinely required.
  const ready = courses.length > 0;

  /*
   * Only papers on the CHOSEN course.
   *
   * The API refuses a paper from another course -- a sitting half-linked to
   * somebody else's questions sends a candidate to the wrong paper -- so
   * offering them here would be offering something that cannot be saved.
   */
  const onThisCourse = papers.filter((a) => Number(a.course_id) === Number(courseId));

  /*
   * Banks for this course, plus the ones tied to no course at all.
   *
   * A bank with no course is a general one -- an aptitude paper, a placement
   * screen -- and hiding it would mean a setter could author a bank the
   * scheduler then cannot find. A bank with no questions is not offered at
   * all: scheduling from it produces a paper nobody can sit.
   */
  const usableBanks = banks.filter((b) => (
    b.question_count > 0
    && (b.course_id == null || Number(b.course_id) === Number(courseId))
  ));
  const chosenBank = usableBanks.find((b) => String(b.id) === bankId);
  /** The largest draw a bank can honour: the size of one of its sets. */
  const perSet = chosenBank
    ? Math.floor(chosenBank.question_count / Math.max(1, Number(chosenBank.set_count ?? 1)))
    : 0;
  const drawing = Number(take || perSet || 0);

  const form = (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const startsRaw = String(data.get('starts_at') ?? '');
          const startsAt = fromLocalInput(startsRaw) ?? '';
          const duration = Number(data.get('duration_minutes') || 180);
          const title = String(data.get('title') ?? '');
          const course = Number(data.get('course_id'));
          const section = sectionId && sectionId !== 'all' ? Number(sectionId) : null;
          const base = basePath ?? 'onyx/platform/tenants/' + tenantId;

          /*
           * Scheduling FROM A BANK builds the paper on the way past.
           *
           * The paper was always there -- an examination sat in a browser is an
           * online paper the sitting points at -- but it was an object somebody
           * had to know about: create it on another screen, draw it from a
           * bank, publish it, and only then would this form offer it. Three
           * screens and a vocabulary lesson to schedule one exam.
           *
           * So the writes happen here, in the order that leaves the least
           * behind if one fails: the paper, its draw from the bank, published;
           * then the sitting. A failure part-way leaves an unpublished paper
           * and says so, which is recoverable -- the reverse order would leave
           * a sitting pointing at a paper nobody can sit.
           */
          let paperId: number | null = how === 'paper'
            ? Number(data.get('assessment_id') || 0) || null
            : null;

          if (how === 'bank') {
            if (!bankId) { setError('Pick the question bank this exam is set from.'); return; }
            setStage('Making the paper...');
            const made = await post(base + '/assessments', {
              title,
              course_id: course,
              duration_minutes: duration,
              // The window is the sitting itself. It is overridden again when
              // the exam row is written, and set here so the paper is never
              // momentarily open to the whole cohort.
              opens_at: startsAt || null,
              closes_at: startsAt
                ? new Date(new Date(startsAt).getTime() + duration * 60_000).toISOString()
                : null,
              pass_mark: Number(data.get('pass_marks') || 0) || null,
              section_id: section,
              ...paperSwitchBody(switches),
            });
            if (!made.ok || !made.data?.id) {
              setStage(null);
              setError(made.message ?? 'The paper could not be created.');
              return;
            }
            paperId = Number(made.data.id);

            setStage('Drawing from the bank...');
            const drew = await post(base + '/assessments/' + paperId + '/sections', {
              sections: [{
                id: 's1',
                title: 'All questions',
                bank_id: Number(bankId),
                take: Math.max(1, drawing),
              }],
            }, 'PUT');
            if (!drew.ok) {
              setStage(null);
              setError('The paper was created but drew nothing: '
                + (drew.message ?? 'the bank could not be read.'));
              return;
            }

            setStage('Publishing it...');
            const live = await post(base + '/assessments/' + paperId + '/publish', {});
            if (!live.ok) {
              setStage(null);
              setError('The paper was created but could not be published: '
                + (live.message ?? 'that did not work.'));
              return;
            }
          }

          setStage('Scheduling the sitting...');
          const res = await post(base + '/exams', {
            title,
            course_id: course,
            // No semester_id is sent at all. The API reads the course's own
            // term, and writes none where the course has none.
            ...(paperId ? { assessment_id: paperId } : {}),
            // Institution time, not the browser's -- see the edit form above.
            starts_at: startsAt,
            // 'all' is the whole cohort, which the API expresses as null.
            section_id: section,
            duration_minutes: duration,
            max_marks: Number(data.get('max_marks') || 100),
            pass_marks: Number(data.get('pass_marks') || 40),
            // Off unless the box is ticked -- see the field's own note below.
            window_enforced: data.get('window_enforced') === 'on',
          });
          setStage(null);
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          setBankId('');
          setTake('');
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="col-span-full text-[13px] text-red-700">{error}</p> : null}
      <div className="sm:col-span-2">
        <label className={label} htmlFor="ce-title">Exam</label>
        <input id="ce-title" name="title" required maxLength={255} placeholder="CS101 Final"
          className={field} />
      </div>
      <div>
        <label className={label} htmlFor="ce-course">Course</label>
        <select id="ce-course" name="course_id" required className={field}
          value={courseId ?? ''}
          onChange={(e) => { setCourseId(Number(e.target.value)); setBankId(''); }}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} &mdash; {c.title}</option>)}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="ce-starts">Starts</label>
        <input id="ce-starts" name="starts_at" type="datetime-local" required className={field}
          value={starts} onChange={(e) => setStarts(e.target.value)} />
        {/* The echo that would have caught a real mistake: an examination was
            set for 01:35 when 13:35 was meant -- one mis-click apart on a
            twelve-hour picker -- and nothing on this form, the list, or the
            learner's timetable said it had been scheduled ten hours ago. */}
        <WhenEcho value={starts} />
      </div>

      <SectionChoice id="ce-section" sections={sections}
        value={sectionId} onChange={setSectionId} />

      <div>
        <label className={label} htmlFor="ce-dur">Duration (minutes)</label>
        <input id="ce-dur" name="duration_minutes" type="number" min={5} defaultValue={180}
          className={field} />
      </div>

      {/*
        * How it is sat, as a choice rather than a select nobody read.
        *
        * The three answers are genuinely different examinations -- one set from
        * a bank, one on a paper somebody already built, one on paper in a hall
        * -- and each asks for different things below, which a dropdown could
        * not show.
        */}
      <fieldset className="col-span-full rounded-xl border border-line p-3">
        <legend className="px-1 text-[12.5px] font-semibold text-slate-700">
          How it is sat
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            { k: 'bank' as const,
              title: 'From a question bank',
              body: 'Builds the paper from a bank of sets and publishes it.' },
            { k: 'paper' as const,
              title: 'On an existing paper',
              body: 'Ties this sitting to a paper that is already built.' },
            { k: 'offline' as const,
              title: 'In a hall',
              body: 'Nothing is sat in a browser; marks are entered by hand.' },
          ]).map((choice) => (
            <label key={choice.k}
              className={'flex cursor-pointer gap-2.5 rounded-xl border p-2.5 '
                + (how === choice.k
                  ? 'border-brand-500 bg-brand-50/60'
                  : 'border-line bg-white hover:bg-slate-50')}>
              <input type="radio" name="ce-how" className="mt-0.5" checked={how === choice.k}
                onChange={() => setHow(choice.k)} />
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-ink">{choice.title}</span>
                <span className="block text-[12px] leading-relaxed text-muted">
                  {choice.body}
                </span>
              </span>
            </label>
          ))}
        </div>

        {how === 'bank' ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="ce-bank">Question bank</label>
              <select id="ce-bank" className={field} value={bankId}
                onChange={(e) => { setBankId(e.target.value); setTake(''); }}>
                <option value="">Choose a bank...</option>
                {usableBanks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} &mdash; {Number(b.set_count ?? 1)} set
                    {Number(b.set_count ?? 1) === 1 ? '' : 's'}, {b.question_count} questions
                  </option>
                ))}
              </select>
              {usableBanks.length ? null : (
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  No bank on this course has questions in it yet. Build one under
                  <strong> Exam paper</strong> first.
                </p>
              )}
            </div>
            <div>
              <label className={label} htmlFor="ce-take">Questions per candidate</label>
              <input id="ce-take" type="number" min={1} max={perSet || undefined}
                className={field} value={take}
                placeholder={perSet ? String(perSet) : ''}
                onChange={(e) => setTake(e.target.value)} />
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                {chosenBank
                  ? 'Each candidate is dealt one set. This bank holds ' + perSet
                    + ' question' + (perSet === 1 ? '' : 's') + ' per set'
                    + (Number(chosenBank.set_count ?? 1) > 1
                      ? ', rotating by roll number so neighbours differ.'
                      : ', and everybody sits the same one.')
                  : 'Leave it blank to use the whole set.'}
              </p>
              {markingNote(chosenBank) ? (
                <p className="mt-1 text-[12px] leading-relaxed text-amber-800">
                  {markingNote(chosenBank)}
                </p>
              ) : null}
            </div>
            <div className="col-span-full">
              <PaperSwitches value={switches} onChange={setSwitches} />
            </div>
          </div>
        ) : null}

        {how === 'paper' ? (
          <div className="mt-3">
            <label className={label} htmlFor="ce-paper">Online paper</label>
            <select id="ce-paper" name="assessment_id" className={field}>
              <option value="">Choose a paper...</option>
              {onThisCourse.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}{a.status === 'published' ? '' : ' (' + a.status + ')'}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              {onThisCourse.length
                ? 'Its own open and close times are overridden to exactly this sitting '
                  + '&mdash; unlike an ordinary assessment, a candidate cannot start it '
                  + 'early or late.'
                : 'This course has no paper yet. Set it from a bank instead.'}
            </p>
          </div>
        ) : null}
      </fieldset>

      <div>
        <label className={label} htmlFor="ce-max">Total marks</label>
        <input id="ce-max" name="max_marks" type="number" min={1} defaultValue={100}
          className={field} />
      </div>
      <div>
        <label className={label} htmlFor="ce-pass">Pass mark</label>
        <input id="ce-pass" name="pass_marks" type="number" min={0} defaultValue={40}
          className={field} />
      </div>

      {/*
        * The slot as a lock, which is now a choice rather than the rule (0043).
        *
        * Off by default. A sitting here deals SETS -- parallel papers rotating
        * down the roll, so the person beside you is not holding yours -- and
        * that is what makes everybody sitting at one instant unnecessary. It
        * was charging for simultaneity in the one currency a candidate cannot
        * get back: miss the hour, or lose your connection inside it, and you
        * were out.
        *
        * On, the paper opens at the start and shuts at the end, which is what
        * a hall with an invigilator and a closed door actually needs.
        */}
      <div className="col-span-full rounded-xl border border-line bg-slate-50 p-3">
        <label className="flex items-start gap-2.5 text-[13px]">
          <input id="ce-window" name="window_enforced" type="checkbox" className="mt-0.5" />
          <span className="min-w-0">
            <span className="font-semibold">Only during the slot</span>
            <span className="block text-[12px] leading-relaxed text-muted">
              The paper opens when the examination starts and shuts when it ends — for a
              sitting in a hall, with everybody in one room. Left unticked, the paper opens
              at the start and stays open; the attempt is still timed either way, so a
              {' '}{'“'}90 minute{'”'} paper is 90 minutes whenever it is begun.
            </span>
          </span>
        </label>
      </div>
      <div className="col-span-full flex flex-wrap items-center gap-2 pt-1">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Scheduling...' : 'Schedule it'}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
        {/* Four writes behind one button: say which one is running, so a slow
            one does not read as a hung form. */}
        {stage ? <span className="text-[12.5px] text-muted">{stage}</span> : null}
      </div>
    </form>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={!ready} className={button}
        title={ready ? undefined : 'Needs at least one course'}>
        Schedule an exam
      </button>
      {/* A dialog. Four columns of fields expanding inside a header row is
          what put a horizontal scrollbar under the whole page. */}
      {open ? (
        <Modal title="Schedule an exam" onClose={() => setOpen(false)} wide>
          {form}
        </Modal>
      ) : null}
    </>
  );
}

const FEE_CATEGORIES = ['tuition', 'exam', 'hostel', 'transport', 'library', 'misc'];

/** Create a fee head -- the code a structure's lines point at. */
export function CreateFeeHeadForm({ tenantId }: { tenantId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={button}>Add a fee head</button>;
  }
  return (
    <form
      className="grid gap-3 rounded-2xl border border-line bg-slate-50 p-4 sm:grid-cols-2
                 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await post('onyx/platform/tenants/' + tenantId + '/fee-heads', {
            code: String(data.get('code') ?? ''),
            name: String(data.get('name') ?? ''),
            category: String(data.get('category') ?? 'tuition'),
          });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="col-span-full text-[13px] text-red-700">{error}</p> : null}
      <div>
        <label className={label} htmlFor="fh-code">Code</label>
        <input id="fh-code" name="code" required maxLength={40} placeholder="TUITION"
          className={field} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="fh-name">Name</label>
        <input id="fh-name" name="name" required maxLength={255} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="fh-category">Category</label>
        <select id="fh-category" name="category" defaultValue="tuition" className={field}>
          {FEE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="col-span-full flex gap-2">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

interface FeeHeadOption { id: number; code: string; name: string }

/** Create a fee structure -- a name plus at least one {head, amount} line.
 * Lines are entered as "code:amount-in-rupees" pairs, one per head, kept to
 * a fixed row per known head so nothing free-typed can reference a head that
 * does not exist. */
export function CreateFeeStructureForm({ tenantId, heads }: {
  tenantId: number; heads: FeeHeadOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={!heads.length} className={button}
        title={heads.length ? undefined : 'Add a fee head first'}>
        Add a fee structure
      </button>
    );
  }
  return (
    <form
      className="space-y-3 rounded-2xl border border-line bg-slate-50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const lines = heads
            .map((h) => ({ head_id: h.id, rupees: Number(data.get('amount-' + h.id) || 0) }))
            .filter((l) => l.rupees > 0)
            .map((l) => ({ head_id: l.head_id, amount_minor: Math.round(l.rupees * 100) }));
          if (!lines.length) { setError('Enter an amount for at least one fee head.'); return; }
          const res = await post('onyx/platform/tenants/' + tenantId + '/fee-structures', {
            name: String(data.get('name') ?? ''),
            instalments: Number(data.get('instalments') || 1),
            lines,
          });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="fs-name">Name</label>
          <input id="fs-name" name="name" required maxLength={255} placeholder="Semester 1 fees"
            className={field} />
        </div>
        <div>
          <label className={label} htmlFor="fs-instalments">Instalments</label>
          <input id="fs-instalments" name="instalments" type="number" min={1} max={12}
            defaultValue={1} className={field} />
        </div>
      </div>
      <div>
        <p className={label}>Amounts (₹, leave 0 to skip a head)</p>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {heads.map((h) => (
            <div key={h.id}>
              <label className="block text-[12.5px] text-muted" htmlFor={'fs-amt-' + h.id}>
                {h.code} — {h.name}
              </label>
              <input id={'fs-amt-' + h.id} name={'amount-' + h.id} type="number" min={0}
                step="0.01" defaultValue={0} className={field} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A fee structure's own delete-equivalent: draft/published/archived, the
 * same "status is the delete" pattern used everywhere else in this console
 * (see PlatformService.updateFeeStructureStatus). */
export function FeeStructureStatusButtons({ tenantId, structureId, status }: {
  tenantId: number; structureId: number; status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Archive got the same visual weight and the same single-click-and-it's-
  // done behavior as Publish/Back to draft, even though it is the one of the
  // three that takes a fee structure out of use for every student on it.
  // Reversible (Publish/Back to draft still bring it back), so a light inline
  // confirm rather than DeleteTenantButton's type-to-confirm.
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const setStatus = (next: string) => start(async () => {
    setError(null);
    const res = await post(
      'onyx/platform/tenants/' + tenantId + '/fee-structures/' + structureId + '/status',
      { status: next });
    if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
    setConfirmingArchive(false);
    router.refresh();
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status !== 'published' ? (
        <button type="button" disabled={pending} onClick={() => setStatus('published')}
          className="rounded-lg border border-emerald-600 px-2.5 py-1 text-[12px]
                     font-semibold text-emerald-700 disabled:opacity-50">
          Publish
        </button>
      ) : null}
      {status !== 'archived' ? (
        confirmingArchive ? (
          <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            Archive this?
            <button type="button" disabled={pending} onClick={() => setStatus('archived')}
              className="font-bold text-red-700 hover:underline disabled:opacity-50">
              {pending ? 'Archiving…' : 'Yes'}
            </button>
            <button type="button" onClick={() => setConfirmingArchive(false)}
              className="text-muted hover:underline">
              No
            </button>
          </span>
        ) : (
          <button type="button" disabled={pending} onClick={() => setConfirmingArchive(true)}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-[12px] font-semibold
                       text-red-700 disabled:opacity-50">
            Archive
          </button>
        )
      ) : null}
      {status !== 'draft' ? (
        <button type="button" disabled={pending} onClick={() => setStatus('draft')}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-[12px] font-semibold
                     text-slate-700 disabled:opacity-50">
          Back to draft
        </button>
      ) : null}
      {error ? <span role="alert" className="text-[12px] text-red-700">{error}</span> : null}
    </div>
  );
}

/** One labelled fact inside a manage panel. */
function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-muted">{term}</dt>
      <dd className="mt-0.5 break-all text-[13px]">{children}</dd>
    </div>
  );
}

/**
 * A registered OAuth client, opened.
 *
 * The list used to carry a red "Revoke" at the end of every row -- the only
 * control on the page, so the page's whole vocabulary was destruction. What an
 * operator actually does first is LOOK: which redirect URIs did this thing
 * register, is it confidential, when did it appear. So that is what opening a
 * row gives, and revoking is at the foot of it, once, framed by what breaks.
 */
export function OAuthClientManageToggle({ client }: {
  client: {
    client_id: string; client_name?: string; client_type: string;
    redirect_uris: string[]; grant_types: string[]; registration_type: string; created_at: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const name = client.client_name ?? client.client_id;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12.5px] font-semibold
                   hover:border-brand-300 hover:text-brand-700">
        Manage
      </button>
    );
  }
  return (
    <Modal title={name} onClose={() => setOpen(false)}>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact term="Client ID"><span className="font-mono text-[12px]">{client.client_id}</span></Fact>
        <Fact term="Type">{client.client_type}</Fact>
        <Fact term="Registered">
          {client.registration_type === 'dynamic' ? 'Self-registered' : 'Registered manually'}
          {' · '}
          {new Date(client.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}
        </Fact>
        <Fact term="Grant types">{client.grant_types.join(', ') || '—'}</Fact>
        <div className="sm:col-span-2">
          <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-muted">
            Redirect URIs
          </dt>
          <dd className="mt-0.5 space-y-0.5">
            {client.redirect_uris.length
              ? client.redirect_uris.map((u) => (
                <div key={u} className="break-all font-mono text-[12px]">{u}</div>
              ))
              : <span className="text-[13px] text-muted">None registered.</span>}
          </dd>
        </div>
      </dl>
      <RevokeOAuthClientButton clientId={client.client_id} name={name}
        onDone={() => setOpen(false)} />
    </Modal>
  );
}

export function RevokeOAuthClientButton({ clientId, name, onDone }: {
  clientId: string; name: string; onDone?: () => void;
}) {
  const router = useRouter();
  return (
    <DangerPanel
      heading="Revoke this registration"
      what={<>
        {name} stops being able to ask anyone here for delegated access, and tokens it already
        holds stop working. Anybody who signed in through it will be signed out of it. If it
        registered itself once it can register itself again.
      </>}
      cta="Revoke registration"
      onConfirm={async () => {
        const res = await post('onyx/platform/oauth-clients/' + clientId, undefined, 'DELETE');
        if (res.ok) { onDone?.(); router.refresh(); }
        return res;
      }}
    />
  );
}

/**
 * One operator, opened. Same reasoning as the OAuth panel above -- and one
 * step stricter: revoking here is confirmed by typing the person's name,
 * because platform admin is the standing that reaches every customer on the
 * platform and the mistake is not visible from anywhere else.
 */
export function AdminManageToggle({ admin }: {
  admin: { id: number; name: string; email: string; granted_at: string };
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12.5px] font-semibold
                   hover:border-brand-300 hover:text-brand-700">
        Manage
      </button>
    );
  }
  return (
    <Modal title={admin.name} onClose={() => setOpen(false)}>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact term="Email">{admin.email}</Fact>
        <Fact term="Granted">
          {new Date(admin.granted_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}
        </Fact>
        <div className="sm:col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          Holds platform admin: can create, suspend, read and delete every institution, and can
          grant the same to anyone else.
        </div>
      </dl>
      <RevokeAdminButton id={admin.id} name={admin.name} onDone={() => setOpen(false)} />
    </Modal>
  );
}

export function RevokeAdminButton({ id, name, onDone }: {
  id: number; name: string; onDone?: () => void;
}) {
  const router = useRouter();
  return (
    <DangerPanel
      heading="Revoke platform admin"
      what={<>
        {name} loses access to this console and to every institution on the platform. Their own
        user account and any institution membership they hold are untouched. Another operator can
        grant it back.
      </>}
      cta="Revoke access"
      confirmWith={name}
      onConfirm={async () => {
        const res = await post('onyx/platform/admins/' + id, undefined, 'DELETE');
        if (res.ok) { onDone?.(); router.refresh(); }
        return res;
      }}
    />
  );
}


// ---------------------------------------------------------------------------
// Live Classes
// ---------------------------------------------------------------------------

export interface ConsoleDomain {
  id: number; title: string; summary: string; curriculum_url: string;
  certificate: string; duration_label: string; price_minor: number;
  currency: string; sort: number; status: number;
  /** The stored key, and the URL a browser can load. Resolved by the API. */
  image_path?: string | null;
  image_url?: string | null;
}

/** A tile only needs a small image, and a 40 MB photograph helps nobody. */
const MAX_BANNER_BYTES = 5 * 1024 * 1024;

/**
 * Add a Live Class from the console.
 *
 * The price is typed in RUPEES and converted here, like every other money
 * field in the product: the column stores integer minor units, and a person
 * setting a price should not have to multiply by a hundred -- a slip of two
 * zeroes is the difference between three hundred rupees and thirty thousand.
 *
 * It is created as a draft. A Live Class appearing on every learner's screen
 * the instant somebody typed a title is not a default anybody would choose.
 */
export function CreateDomainForm({ tenantId }: { tenantId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /**
   * Ticket, then PUT, then the key -- the same three steps the institution's
   * own composer takes, and for the same reason: Vercel rejects request bodies
   * over about 4.5 MB, so the file goes to storage directly and only the key
   * comes back to us.
   *
   * Failures are reported against the step that failed. "Could not be
   * uploaded" and "could not be saved" send somebody to two different places,
   * and one "something went wrong" sends them nowhere.
   */
  async function uploadBanner(picked: File): Promise<string> {
    setStage('Preparing…');
    const ticketRes = await fetch('/api/proxy/onyx/platform/tenants/' + tenantId
      + '/domains/uploads/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: picked.name }),
    });
    const ticket = await ticketRes.json().catch(() => ({ ok: false }));
    if (!ticket.ok) throw new Error(ticket.message ?? 'Could not start the upload.');

    setStage('Uploading ' + picked.name + '…');
    const put = await fetch(ticket.data.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': picked.type || 'application/octet-stream' },
      body: picked,
    });
    if (!put.ok) throw new Error('The image could not be uploaded. Check your connection.');
    return ticket.data.path as string;
  }

  const form = (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          try {
            const picked = (data.get('banner') as File | null) ?? null;
            const imagePath = picked && picked.size ? await uploadBanner(picked) : null;

            setStage('Saving…');
            const res = await post('onyx/platform/tenants/' + tenantId + '/domains', {
              title: String(data.get('title') ?? ''),
              summary: String(data.get('summary') ?? ''),
              curriculum_url: String(data.get('curriculum_url') ?? ''),
              certificate: String(data.get('certificate') ?? ''),
              duration_label: String(data.get('duration_label') ?? ''),
              price_minor: Math.round(Number(data.get('price_rupees') || 0) * 100),
              ...(imagePath ? { image_path: imagePath } : {}),
            });
            if (!res.ok) throw new Error(res.message ?? 'That did not work.');
            setStage(null);
            setOpen(false);
            router.refresh();
          } catch (err) {
            setStage(null);
            setError(err instanceof Error ? err.message : 'That did not work.');
          }
        });
      }}
    >
      {error ? <p role="alert" className="col-span-full text-[13px] text-red-700">{error}</p> : null}
      <div className="sm:col-span-2">
        <label className={label} htmlFor="cd-title">Title</label>
        <input id="cd-title" name="title" required maxLength={200}
          placeholder="Cloud and DevOps — evening cohort" className={field} />
      </div>
      {/* The banner. It was missing entirely, so a Live Class made from the
          console could never have the picture every learner-facing tile is
          built around -- the institution's own composer has asked for one
          since Live Classes shipped. */}
      <div className="sm:col-span-2">
        <label className={label} htmlFor="cd-banner">Banner image</label>
        <input
          id="cd-banner" name="banner" type="file" accept="image/*"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            if (picked && picked.size > MAX_BANNER_BYTES) {
              setError('That image is larger than 5 MB. A tile only needs a small one.');
              e.target.value = '';
              return;
            }
            setError(null);
          }}
          className="mt-1.5 block w-full text-[13.5px] file:mr-3 file:rounded-lg file:border-0
                     file:bg-brand-50 file:px-3 file:py-2 file:text-[13px] file:font-semibold
                     file:text-brand-700"
        />
        <p className="mt-1 text-[12px] text-muted">
          Optional. Shown on the tile — a wide image works best. Up to 5 MB.
        </p>
      </div>

      <div className="sm:col-span-2">
        <label className={label} htmlFor="cd-summary">Summary</label>
        <textarea id="cd-summary" name="summary" maxLength={4000} rows={3} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="cd-duration">Duration</label>
        {/* Prose, not a number: "12 weeks" and "6 weekends" are both real, and
            a number would be a lie for the part-time ones. */}
        <input id="cd-duration" name="duration_label" maxLength={80} placeholder="12 weeks"
          className={field} />
      </div>
      <div>
        <label className={label} htmlFor="cd-cert">Certificate awarded</label>
        <input id="cd-cert" name="certificate" maxLength={200}
          placeholder="Leave empty if none" className={field} />
      </div>
      <div>
        <label className={label} htmlFor="cd-price">Price</label>
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute left-3 top-1/2
                                       -translate-y-1/2 text-[15px] font-semibold text-muted">₹</span>
          <input id="cd-price" name="price_rupees" type="number" min={0} step="0.01"
            defaultValue={0} className={field + ' pl-7'} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="cd-url">Curriculum link</label>
        <input id="cd-url" name="curriculum_url" maxLength={500}
          placeholder="example.com/curriculum" className={field} />
      </div>
      <div className="col-span-full flex gap-2 pt-1">
        <button type="submit" disabled={pending} className={button}>
          {stage ?? (pending ? 'Adding…' : 'Add it as a draft')}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={button}>
        Add a Live Class
      </button>
      {/* A dialog, like the institution's own composer -- which is the form
          this one is meant to match. Expanding in place put it in whatever
          width the header row had left over, which was half the screen with
          the count stranded beside it. */}
      {open ? (
        <Modal title="Add a Live Class" onClose={() => setOpen(false)} wide>
          {form}
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Publish or withdraw one Live Class, and remove it.
 *
 * Both controls are BUTTONS the same size in a single row, and the destructive
 * one is a modal rather than a panel that unfolds where it stands. It used to
 * be a `DangerPanel` inline in a table cell: opening it pushed a paragraph of
 * red prose and a confirm field into the row, which trebled the row's height,
 * shoved every column out of line and left "Withdraw" stranded in a tall empty
 * box beside it. A table row is not somewhere a form can grow.
 */
export function DomainRowActions({ tenantId, domain }: {
  tenantId: number; domain: ConsoleDomain;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const published = domain.status === 1;

  const setStatus = (status: number) => start(async () => {
    setError(null);
    const res = await post('onyx/platform/tenants/' + tenantId + '/domains/' + domain.id,
      { status }, 'PATCH');
    if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
    router.refresh();
  });

  const rowButton = 'min-h-[34px] whitespace-nowrap rounded-lg border px-3 text-[12.5px] '
    + 'font-semibold disabled:opacity-40';

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <EditDomainForm tenantId={tenantId} domain={domain} />
        <button type="button" disabled={pending} onClick={() => setStatus(published ? 0 : 1)}
          className={rowButton + ' border-line bg-white text-slate-700 hover:bg-brand-50'}>
          {published ? 'Withdraw' : 'Publish'}
        </button>
        <button type="button" disabled={pending} onClick={() => setConfirming(true)}
          className={rowButton + ' border-line bg-white text-red-700 hover:bg-red-50'}>
          Remove
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-right text-[12px] text-red-700">{error}</p>
      ) : null}

      {/* Portalled to <body>, so the confirmation is a dialog rather than
          something that grows inside a cell. */}
      {confirming ? (
        <Modal title="Remove this Live Class" onClose={() => setConfirming(false)}>
          <div className="space-y-3.5">
            <p className="text-[13.5px] leading-relaxed text-muted">
              <span className="font-bold text-ink">{domain.title}</span> disappears from every
              learner’s Live Classes. Anyone already registered keeps their registration
              record, but the class itself is gone — and this cannot be undone.
            </p>
            {error ? (
              <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button" disabled={pending}
                onClick={() => start(async () => {
                  setError(null);
                  const res = await post('onyx/platform/tenants/' + tenantId
                    + '/domains/' + domain.id, undefined, 'DELETE');
                  if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
                  setConfirming(false);
                  router.refresh();
                })}
                className="min-h-[42px] flex-1 rounded-xl bg-red-700 px-4 text-sm font-bold
                           text-white hover:bg-red-800 disabled:opacity-50"
              >
                {pending ? 'Removing…' : 'Remove it'}
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming(false)}
                className="min-h-[42px] rounded-xl border border-line px-4 text-sm font-semibold">
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The modules inside a course
// ---------------------------------------------------------------------------

/** Add a module to a course, from the console. */
/**
 * Putting somebody on a course, from the console.
 *
 * The console could create a course and never enrol anybody onto it, which is
 * not a missing convenience but a dead end: an empty roster is an examination
 * nobody can sit, a register with no names and a paper that deals to no one.
 * An operator standing an institution up built the teaching and then had to
 * sign in as that institution's own administrator to make any of it reachable.
 *
 * A picker of this institution's learners rather than a free-text id: the id is
 * a uuid, and asking anybody to paste one is asking for the wrong course to
 * gain the wrong person.
 */
/**
 * Who teaches a course, set from the console.
 *
 * The institution's own side has had this all along; the console had no way to
 * say it. That is not cosmetic: `assertCanTeach` is the check every
 * faculty-facing route makes, so a course with nobody assigned is one no
 * lecturer can take a register for, mark work in, or invigilate — and an
 * operator who had just built the whole course from here had no way to hand it
 * over.
 *
 * A course runs to at most two, which the service enforces and says why. The
 * form shows the count rather than letting somebody discover the cap by being
 * refused, and lists who is already on it with a way to take them off, because
 * the cap makes removal part of assigning rather than a separate errand.
 */
export function ConsoleCourseFaculty({ tenantId, courseId, faculty, staff }: {
  tenantId: number;
  courseId: number;
  faculty: { user_id: string; name: string | null; email: string | null }[];
  staff: { user_id: string; name: string; email: string; role: string }[];
}) {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const assigned = new Set(faculty.map((f) => String(f.user_id)));
  // Anybody who may teach and does not already teach THIS. Admins are included
  // because `assertCanTeach` lets them past unconditionally, so an institution
  // where an administrator also lectures is a real arrangement rather than a
  // mistake to design out.
  const available = staff.filter((p) => !assigned.has(String(p.user_id)));
  const full = faculty.length >= 2;

  const act = (run: () => Promise<{ ok: boolean; message?: string }>) => start(async () => {
    setError(null);
    const res = await run();
    if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
    setUserId('');
    router.refresh();
  });

  return (
    <div className="space-y-3">
      {faculty.length ? (
        <ul className="space-y-1.5">
          {faculty.map((f) => (
            <li key={f.user_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl
                         border border-line px-3 py-2">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-ink">
                  {f.name ?? 'Unknown'}
                </span>
                {f.email ? (
                  <span className="block break-all text-[12px] text-muted">{f.email}</span>
                ) : null}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => post('onyx/platform/tenants/' + tenantId
                  + '/courses/' + courseId + '/faculty/' + f.user_id, undefined, 'DELETE'))}
                className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1
                           text-[12.5px] font-semibold text-red-700 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed
                      text-amber-800">
          Nobody teaches this course yet, so no lecturer can take its register, mark its work
          or invigilate its examinations.
        </p>
      )}

      {full ? (
        <p className="text-[12.5px] text-muted">
          A course runs to two. Remove one of them to assign somebody else.
        </p>
      ) : !available.length ? (
        <p className="text-[12.5px] text-muted">
          {staff.length
            ? 'Everybody who can teach here already teaches this course.'
            : 'This institution has no faculty yet — add one under People first.'}
        </p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!userId) { setError('Choose somebody.'); return; }
            act(() => post('onyx/platform/tenants/' + tenantId
              + '/courses/' + courseId + '/faculty', { user_id: userId }));
          }}
        >
          <div className="min-w-[16rem]">
            <label className={label} htmlFor="cf-faculty">Assign a lecturer</label>
            <select id="cf-faculty" value={userId} onChange={(e) => setUserId(e.target.value)}
              className={field}>
              <option value="">Choose somebody…</option>
              {available.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}{p.role === 'admin' ? ' (administrator)' : ''} — {p.email}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={pending} className={button}>
            {pending ? 'Assigning…' : 'Assign'}
          </button>
        </form>
      )}

      {error ? <p role="alert" className="text-[13px] text-rose-700">{error}</p> : null}
    </div>
  );
}

export function ConsoleEnrolForm({ tenantId, courseId, students }: {
  tenantId: number; courseId: number;
  students: { user_id: string; name: string; roll_number: string | null }[];
}) {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!students.length) {
    return (
      <p className="text-[12.5px] text-muted">
        This institution has no learners yet — add one under Students first.
      </p>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          if (!userId) { setError('Choose a learner.'); return; }
          const res = await post(
            'onyx/platform/tenants/' + tenantId + '/courses/' + courseId + '/enroll',
            { user_id: userId });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setUserId('');
          router.refresh();
        });
      }}
    >
      <div className="min-w-[16rem]">
        <label className={label} htmlFor="ce-student">Enrol a learner</label>
        <select id="ce-student" value={userId} onChange={(e) => setUserId(e.target.value)}
          className={field}>
          <option value="">Choose a learner…</option>
          {students.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.roll_number ? p.roll_number + ' · ' : ''}{p.name}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className={button}>
        {pending ? 'Enrolling…' : 'Enrol'}
      </button>
      {error ? (
        <p role="alert" className="w-full text-[13px] text-rose-700">{error}</p>
      ) : null}
    </form>
  );
}

/** Take somebody off a course. Asked once, like every other row-scoped act here. */
export function ConsoleWithdrawButton({ tenantId, courseId, userId, name }: {
  tenantId: number; courseId: number; userId: string; name: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="text-[12.5px] font-semibold text-rose-700 hover:underline">
        Withdraw
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px]">
      <span className="max-w-[12rem] truncate text-muted">Withdraw {name}?</span>
      <button type="button" disabled={pending}
        onClick={() => start(async () => {
          await post('onyx/platform/tenants/' + tenantId + '/courses/' + courseId
            + '/enroll/' + userId, undefined, 'DELETE');
          setConfirming(false);
          router.refresh();
        })}
        className="font-bold text-rose-700 hover:underline disabled:opacity-50">
        {pending ? 'Working…' : 'Yes'}
      </button>
      <button type="button" onClick={() => setConfirming(false)}
        className="text-muted hover:underline">No</button>
    </span>
  );
}

export function AddModuleForm({ tenantId, courseId }: {
  tenantId: number; courseId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={button}>
        Add a module
      </button>
    );
  }
  return (
    <form
      className="grid gap-3 rounded-2xl border border-line bg-slate-50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await post(
            'onyx/platform/tenants/' + tenantId + '/courses/' + courseId + '/modules', {
              title: String(data.get('title') ?? ''),
              summary: String(data.get('summary') ?? ''),
            });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}
      <div>
        <label className={label} htmlFor="am-title">Module title</label>
        <input id="am-title" name="title" required maxLength={255}
          placeholder="Week 1 — Getting started" className={field} />
      </div>
      <div>
        <label className={label} htmlFor="am-summary">What it covers</label>
        <textarea id="am-summary" name="summary" maxLength={4000} rows={2} className={field} />
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted">
        A module is added empty. Add lessons to it — video, slides, a document, an image, a
        link or written text — from the module itself, once it is here.
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Adding…' : 'Add the module'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Rename a module, or remove it when it is empty. */
export function ModuleRowActions({ tenantId, module: mod }: {
  tenantId: number;
  module: { id: number; title: string; summary: string | null; lessons: unknown[] };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const empty = mod.lessons.length === 0;

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center justify-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const res = await post('onyx/platform/tenants/' + tenantId + '/modules/' + mod.id,
              { title: String(data.get('title') ?? '') }, 'PATCH');
            if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
            setEditing(false);
            router.refresh();
          });
        }}
      >
        {error ? <span role="alert" className="text-[12px] text-red-700">{error}</span> : null}
        <input name="title" defaultValue={mod.title} required maxLength={255}
          aria-label="Module title"
          className="min-h-[38px] rounded-lg border border-line px-3 text-[13px]" />
        <button type="submit" disabled={pending}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white">
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px]">Cancel</button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <button type="button" onClick={() => setEditing(true)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold">
        Rename
      </button>
      {/* A module holding lessons is somebody's teaching. The API refuses it
          too -- this only saves the round trip and says why up front. */}
      <button
        type="button"
        disabled={!empty || pending}
        title={empty ? undefined : 'Remove its lessons from the course first'}
        onClick={() => start(async () => {
          const res = await post(
            'onyx/platform/tenants/' + tenantId + '/modules/' + mod.id, undefined, 'DELETE');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          router.refresh();
        })}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold
                   text-red-700 disabled:opacity-40"
      >
        Remove
      </button>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

/**
 * What each kind of lesson needs, said in the words an author would use.
 *
 * The five are the product's own (`ONYX_LESSON_TYPES`), and the shape of the
 * form follows the choice rather than showing every field at once: a video
 * needs a file, a link needs an address, text needs text, and showing all
 * three asks somebody to work out which two to ignore.
 */
const LESSON_KINDS = [
  { type: 'video', label: 'Video', needs: 'file', accept: 'video/*',
    hint: 'A lecture recording or screencast. Uploaded straight to storage.' },
  { type: 'document', label: 'Document', needs: 'file', accept: '.pdf,.doc,.docx,.ppt,.pptx,.txt',
    hint: 'Slides, a PDF, a handout.' },
  { type: 'image', label: 'Image', needs: 'file', accept: 'image/*',
    hint: 'A diagram or a scan.' },
  { type: 'link', label: 'Link', needs: 'url',
    hint: 'Something hosted elsewhere. Opens in a new tab for the learner.' },
  { type: 'text', label: 'Written', needs: 'text',
    hint: 'Reading set out on the page itself — no file to upload.' },
] as const;

/**
 * Add a lesson to a module, from the console.
 *
 * The file never passes through this server: the browser asks for a signed
 * ticket and PUTs to storage directly, which is what makes a lecture recording
 * possible at all — Vercel rejects request bodies over about 4.5 MB.
 *
 * Progress is reported against the STEP that is running. "Could not be
 * uploaded" and "could not be saved" send an author to two different places,
 * and one "something went wrong" sends them nowhere.
 */
export function AddLessonForm({ tenantId, courseId, moduleId }: {
  tenantId: number; courseId: number; moduleId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>('video');
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = LESSON_KINDS.find((k) => k.type === kind)!;

  async function uploadAndGetPath(picked: File): Promise<string> {
    setStage('Preparing…');
    const ticketRes = await fetch('/api/proxy/onyx/platform/tenants/' + tenantId
      + '/courses/' + courseId + '/uploads/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: picked.name }),
    });
    const ticket = await ticketRes.json().catch(() => ({ ok: false }));
    if (!ticket.ok) throw new Error(ticket.message ?? 'Could not start the upload.');

    setStage('Uploading ' + picked.name + '…');
    const put = await fetch(ticket.data.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': picked.type || 'application/octet-stream' },
      body: picked,
    });
    if (!put.ok) throw new Error('The file could not be uploaded. Check your connection.');
    return ticket.data.path as string;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold">
        Add a lesson
      </button>
    );
  }

  return (
    <form
      className="mt-3 grid gap-3 rounded-xl border border-line bg-slate-50 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        setError(null);
        start(async () => {
          try {
            let path: string | null = null;
            if (chosen.needs === 'file') {
              const picked = (data.get('file') as File | null) ?? null;
              if (!picked || !picked.size) throw new Error('Choose a file first.');
              path = await uploadAndGetPath(picked);
            }
            if (chosen.needs === 'url') path = String(data.get('url') ?? '').trim();

            setStage('Saving…');
            const res = await post('onyx/platform/tenants/' + tenantId
              + '/modules/' + moduleId + '/lessons', {
              title: String(data.get('title') ?? ''),
              type: chosen.type,
              path,
              body: chosen.needs === 'text' ? String(data.get('body') ?? '') : null,
              is_preview: data.get('is_preview') === 'on',
            });
            if (!res.ok) throw new Error(res.message ?? 'That did not save.');
            setStage(null);
            setOpen(false);
            router.refresh();
          } catch (err) {
            setStage(null);
            setError(err instanceof Error ? err.message : 'That did not work.');
          }
        });
      }}
    >
      {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}

      <div>
        <span className={label}>What kind of lesson</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {LESSON_KINDS.map((k) => (
            <button
              key={k.type} type="button" onClick={() => setKind(k.type)}
              aria-pressed={kind === k.type}
              className={'min-h-[34px] rounded-lg border px-3 text-[12.5px] font-semibold '
                + (kind === k.type
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-line bg-white text-slate-700 hover:bg-brand-50')}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12.5px] text-muted">{chosen.hint}</p>
      </div>

      <div>
        <label className={label} htmlFor="al-title">Lesson title</label>
        <input id="al-title" name="title" required maxLength={255}
          placeholder="Variables and types" className={field} />
      </div>

      {chosen.needs === 'file' ? (
        <div>
          <label className={label} htmlFor="al-file">File</label>
          <input id="al-file" name="file" type="file" accept={chosen.accept} required
            className={field + ' py-2'} />
        </div>
      ) : null}

      {chosen.needs === 'url' ? (
        <div>
          <label className={label} htmlFor="al-url">Address</label>
          <input id="al-url" name="url" type="url" required maxLength={500}
            placeholder="https://example.com/reading" className={field} />
        </div>
      ) : null}

      {chosen.needs === 'text' ? (
        <div>
          <label className={label} htmlFor="al-body">The reading itself</label>
          <textarea id="al-body" name="body" required rows={6} maxLength={200_000}
            className={field} />
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
        <input type="checkbox" name="is_preview" className="h-4 w-4 rounded border-slate-300" />
        {/* Said in terms of who sees it, not in terms of a flag name. */}
        Open to anyone browsing the course, before they enrol
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={button}>
          {stage ?? (pending ? 'Working…' : 'Add the lesson')}
        </button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null); }}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Remove one lesson. */
export function LessonRemoveButton({ tenantId, lesson }: {
  tenantId: number; lesson: { id: number; title: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {error ? <span role="alert" className="text-[12px] text-red-700">{error}</span> : null}
      <button
        type="button" disabled={pending}
        aria-label={'Remove ' + lesson.title}
        onClick={() => start(async () => {
          const res = await post('onyx/platform/tenants/' + tenantId + '/lessons/' + lesson.id,
            undefined, 'DELETE');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          router.refresh();
        })}
        className="shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-[12px]
                   font-semibold text-red-700 disabled:opacity-40"
      >
        Remove
      </button>
    </>
  );
}


/** Rename a lesson, retitle its text, and decide who may see it. */
export function LessonEditForm({ tenantId, lesson }: {
  tenantId: number;
  lesson: { id: number; title: string; type: string; body: string | null; is_preview: number };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="grid gap-3 rounded-2xl border border-line bg-slate-50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        setNote(null);
        start(async () => {
          const payload: Record<string, unknown> = {
            title: String(data.get('title') ?? ''),
            is_preview: data.get('is_preview') === 'on',
          };
          // Only a written lesson has text to send. Sending `body` for a video
          // is refused by the API, and rightly -- it would be text nothing
          // renders.
          if (lesson.type === 'text') payload.body = String(data.get('body') ?? '');

          const res = await post('onyx/platform/tenants/' + tenantId + '/lessons/' + lesson.id,
            payload, 'PATCH');
          if (!res.ok) { setError(res.message ?? 'That did not save.'); return; }
          setNote('Saved.');
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}
      {note ? <p role="status" className="text-[13px] text-green-700">{note}</p> : null}

      <div>
        <label className={label} htmlFor="le-title">Title</label>
        <input id="le-title" name="title" required maxLength={255}
          defaultValue={lesson.title} className={field} />
      </div>

      {lesson.type === 'text' ? (
        <div>
          <label className={label} htmlFor="le-body">The reading itself</label>
          <textarea id="le-body" name="body" required rows={8} maxLength={200_000}
            defaultValue={lesson.body ?? ''} className={field} />
        </div>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-muted">
          The file itself is not replaced here. Remove this lesson and add it again with the
          new file — that way nothing points at a file that has quietly changed underneath it.
        </p>
      )}

      <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
        <input type="checkbox" name="is_preview" defaultChecked={Boolean(lesson.is_preview)}
          className="h-4 w-4 rounded border-slate-300" />
        Open to anyone browsing the course, before they enrol
      </label>

      <div>
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Making a paper sittable
// ---------------------------------------------------------------------------

export interface ConsoleBank {
  id: number; name: string; course_id: number | null; question_count: number;
  /**
   * How many of them a machine cannot mark — an essay or a code question, or a
   * multiple-choice nobody set a correct option on. The second kind is why this
   * is on the screen at all: it reads as objective everywhere it is listed and
   * marks exactly like an essay.
   */
  needs_marking?: number;
  /**
   * How many parallel sets it holds.
   *
   * The fact that decides whether a bank can be scheduled: candidates are
   * dealt one set each, rotating by roll number, so a one-set bank gives
   * everybody the same paper and a ten-set bank gives ten.
   */
  set_count?: number;
}

/**
 * What drawing from this bank means for when the candidate gets their mark.
 *
 * The draw is random, so one unmarkable question in the bank is enough to
 * decide it for whoever is dealt that question — which makes "some of these
 * need a marker" the honest thing to say, not "this paper will be marked by
 * hand".
 */
function markingNote(bank: ConsoleBank | undefined): string | null {
  const needs = Number(bank?.needs_marking ?? 0);
  if (!bank || !needs) return null;
  if (needs >= bank.question_count) {
    return 'Every question in this bank needs a marker, so results will not be instant.';
  }
  return needs + ' of the ' + bank.question_count + ' questions in this bank need a marker'
    + ' (an essay, a code question, or a multiple-choice with no correct option set).'
    + ' If the draw includes one, the result waits for a person instead of appearing'
    + ' at hand-in.';
}

/**
 * Which questions a paper draws, and how many of each.
 *
 * A paper created from the console had no sections at all, so it drew nothing
 * — and the refusal arrived at `start()`, in front of a candidate who had just
 * pressed the button. This is where that gets decided instead, with the size
 * of each bank shown so nobody asks for twenty questions from a bank of six.
 */
export function AssessmentSectionsForm({ tenantId, assessment, banks }: {
  tenantId: number;
  assessment: { id: number; title: string; status: string;
    sections?: { id: string; title: string; bank_id: number; take: number }[] | null };
  banks: ConsoleBank[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(() =>
    (assessment.sections ?? []).map((sec) => ({ ...sec }))
    || []);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const usable = banks.filter((b) => b.question_count > 0);
  const drawn = rows.reduce((n, r) => n + Number(r.take || 0), 0);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={!usable.length}
        title={usable.length ? undefined : 'This institution has no question bank with questions in it yet'}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold
                   disabled:opacity-40">
        {drawn ? 'Questions (' + drawn + ')' : 'Add questions'}
      </button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-3 rounded-xl border border-line bg-slate-50 p-3.5">
      {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}
      {note ? <p role="status" className="text-[13px] text-green-700">{note}</p> : null}

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">
          This paper draws nothing yet, so nobody can sit it. Add a section below.
        </p>
      ) : null}

      <ul className="space-y-2">
        {rows.map((row, i) => (
          <li key={row.id} className="grid gap-2 sm:grid-cols-[1fr,auto,auto]">
            <select
              aria-label={'Question bank for section ' + (i + 1)}
              value={row.bank_id}
              onChange={(e) => setRows(rows.map((r, j) =>
                (j === i ? { ...r, bank_id: Number(e.target.value) } : r)))}
              className={field + ' mt-0'}
            >
              {usable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — {Number(b.set_count ?? 1)}{' '}
                  {Number(b.set_count ?? 1) === 1 ? 'set' : 'sets'}
                  {', ' + b.question_count + ' question'}{b.question_count === 1 ? '' : 's'}
                  {Number(b.needs_marking ?? 0)
                    ? ', ' + b.needs_marking + ' needing a marker' : ''}
                </option>
              ))}
            </select>
            <input
              type="number" min={1} max={500} value={row.take}
              aria-label={'How many to draw for section ' + (i + 1)}
              onChange={(e) => setRows(rows.map((r, j) =>
                (j === i ? { ...r, take: Number(e.target.value) } : r)))}
              className={field + ' mt-0 w-24'}
            />
            <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="rounded-lg border border-slate-300 px-3 text-[13px] font-semibold
                         text-red-700">
              Remove
            </button>
            {/* Said once per section rather than once per form: which bank was
                picked is what decides it, and a form can hold several. */}
            {markingNote(usable.find((b) => Number(b.id) === Number(row.bank_id))) ? (
              <p className="text-[12.5px] leading-relaxed text-amber-800 sm:col-span-3">
                {markingNote(usable.find((b) => Number(b.id) === Number(row.bank_id)))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setRows([...rows, {
            id: 's' + (rows.length + 1),
            title: 'Section ' + (rows.length + 1),
            bank_id: usable[0]!.id,
            take: 1,
          }])}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold"
        >
          Add a section
        </button>
        <button
          type="button" disabled={pending}
          onClick={() => start(async () => {
            setError(null);
            setNote(null);
            const res = await post('onyx/platform/tenants/' + tenantId
              + '/assessments/' + assessment.id + '/sections', { sections: rows }, 'PUT');
            if (!res.ok) { setError(res.message ?? 'That did not save.'); return; }
            setNote('Saved — this paper draws ' + drawn + ' question'
              + (drawn === 1 ? '' : 's') + '.');
            router.refresh();
          })}
          className={button}
        >
          {pending ? 'Saving…' : 'Save the sections'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px]">
          Close
        </button>
      </div>
    </div>
  );
}

/** Publish a paper, once it draws something. */
export function AssessmentPublishButton({ tenantId, assessment }: {
  tenantId: number; assessment: { id: number; status: string };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (assessment.status === 'published') return null;
  return (
    <div className="flex flex-col items-end gap-1">
      {error ? <span role="alert" className="text-[12px] text-red-700">{error}</span> : null}
      <button
        type="button" disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          const res = await post('onyx/platform/tenants/' + tenantId
            + '/assessments/' + assessment.id + '/publish', {});
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          router.refresh();
        })}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold"
      >
        {pending ? 'Publishing…' : 'Publish'}
      </button>
    </div>
  );
}


// ---------------------------------------------------------------------------
// A whole paper, in one form
// ---------------------------------------------------------------------------

const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;

interface DraftQuestion {
  type: 'single' | 'essay' | 'code';
  prompt: string;
  points: string;
  /** Four slots; blank ones are dropped on submit. `single` only. */
  options: string[];
  /** One of OPTION_IDS. Blank until somebody says which is right. */
  correct: string;
  /** A `single` with no key: marked by a person, not by a machine. */
  manualOnly: boolean;
  /**
   * `code` only: the published Code Lab problem whose tests mark it, or
   * NEW_CONSOLE_PROBLEM to write one as part of saving the paper.
   */
  problemId: string;
  /** `code` only, and only when problemId is NEW_CONSOLE_PROBLEM. */
  draft: ProblemDraft;
}

/**
 * "Write the problem here", which is what a coding question starts as.
 *
 * A sentinel on the same menu rather than a toggle beside it: which problem
 * marks this question is one question, and its answer is either one that
 * exists or one that does not yet. It is the DEFAULT because somebody setting
 * a paper is thinking of the question they want to ask -- the problem usually
 * does not exist yet, and opening on a list of stock problems asks them to go
 * shopping before they can write anything down.
 */
const NEW_CONSOLE_PROBLEM = '__new__';

/*
 * `correct` starts blank rather than at 'a'.
 *
 * Option A pre-selected means somebody who types four options and never
 * touches the radios has silently locked in "A is correct" -- a paper that
 * marks itself wrongly and looks finished. Nothing is correct until it is
 * said to be.
 */
const blankQuestion = (): DraftQuestion => ({
  type: 'single', prompt: '', points: '10', options: ['', '', '', ''],
  correct: '', manualOnly: false,
  // A coding question starts as one you WRITE. See the note on
  // NEW_CONSOLE_PROBLEM: the picker is the fallback, not the front door.
  problemId: NEW_CONSOLE_PROBLEM, draft: blankProblemDraft(),
});

/**
 * Authors a whole paper -- bank, questions, and the assessment that draws
 * every one of them -- then publishes it.
 *
 * The console could already do all of this and only as four separate acts
 * across two screens: create a bank, add questions to it, create a paper, set
 * its sections, publish. Every one of those is a place to stop halfway, and
 * the half-finished state (a paper drawing no questions) is one the engine
 * only complains about when a candidate presses Start.
 *
 * The institution's own Examinations screen has had this shortcut since
 * papers existed. This is the same path for an operator, on the screen they
 * are already on when they think of it.
 *
 * Coding questions are offered here and are not on the faculty version: the
 * console has the problems list, and a paper an operator builds should not be
 * less capable than one they could assemble by hand from the same API.
 */
/**
 * Change how an existing paper is sat.
 *
 * The switches were settable only at creation, which made a mistake permanent:
 * an operator who left monitoring off had no way back to it and no way to see
 * what the paper was actually set to — the detail page showed a "Monitored"
 * pill or showed nothing, and nothing at all about camera, screen or shuffling.
 *
 * Editable while candidates are still to sit it; a paper already sat keeps
 * whatever it was sat under, which is the engine's business rather than this
 * form's — it reads the paper at `start()`, so a change now applies to sittings
 * that have not begun.
 */
export function PaperSettingsForm({ tenantId, assessment }: {
  tenantId: number;
  assessment: { id: number } & Partial<Record<keyof PaperSwitchState, boolean | number | null>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // 0/1 out of the database, boolean in the form. `Boolean(0)` is false and
  // `Boolean('0')` is true, so the number cast is not optional.
  const on = (v: boolean | number | null | undefined, fallback: boolean) =>
    (v === null || v === undefined ? fallback : Boolean(Number(v)));
  const initial: PaperSwitchState = {
    shuffle_questions: on(assessment.shuffle_questions, true),
    shuffle_options: on(assessment.shuffle_options, true),
    proctoring: on(assessment.proctoring, false),
    require_camera: on(assessment.require_camera, false),
    require_screen: on(assessment.require_screen, false),
    watch_camera: on(assessment.watch_camera, false),
    anonymous_marking: on(assessment.anonymous_marking, true),
    moderation_required: on(assessment.moderation_required, false),
    instant_results: on(assessment.instant_results, true),
  };
  const [switches, setSwitches] = useState<PaperSwitchState>(initial);

  return (
    <>
      <button type="button" onClick={() => { setSwitches(initial); setOpen(true); }}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold">
        How it is sat
      </button>
      {open ? (
        <Modal title="How this paper is sat" onClose={() => setOpen(false)}>
          <div className="space-y-3">
          {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}
          <PaperSwitches value={switches} onChange={setSwitches} />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => start(async () => {
                setError(null);
                const res = await post(
                  'onyx/platform/tenants/' + tenantId + '/assessments/' + assessment.id,
                  paperSwitchBody(switches), 'PATCH');
                if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
                setOpen(false);
                router.refresh();
              })}
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-semibold
                         text-white disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-300 px-3.5 py-2 text-[13px] font-semibold">
              Cancel
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function ConsoleCreatePaper({ tenantId, courses, problems = [] }: {
  tenantId: number;
  courses: CourseOption[];
  /** Published Code Lab problems, for a coding question to be marked by. */
  problems?: { id: number; title: string; status: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState(courses[0] ? String(courses[0].id) : '');
  const [duration, setDuration] = useState('60');
  const [passMark, setPassMark] = useState('');
  const [questions, setQuestions] = useState<DraftQuestion[]>([blankQuestion()]);
  const [switches, setSwitches] = useState<PaperSwitchState>(PAPER_SWITCH_DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const usableProblems = problems.filter((x) => String(x.status) === 'published');
  const setQuestion = (i: number, patch: Partial<DraftQuestion>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setOption = (i: number, oi: number, text: string) =>
    setQuestions((qs) => qs.map((q, j) => (j === i
      ? { ...q, options: q.options.map((o, k) => (k === oi ? text : o)) } : q)));

  const submit = () => start(async () => {
    setError(null);
    if (!courseId) { setError('Pick a course.'); return; }

    const clean = questions
      .map((q) => ({ ...q, prompt: q.prompt.trim() }))
      .filter((q) => q.prompt !== '');
    if (!clean.length) { setError('Add at least one question.'); return; }

    /*
     * Everything checked BEFORE anything is written.
     *
     * The first request creates a bank; failing on question three would leave
     * an empty bank behind and the operator staring at an error. Nothing is
     * sent until the whole paper is known to be valid.
     */
    for (const q of clean) {
      if (q.type === 'single') {
        const opts = q.options.map((o, i) => ({ id: OPTION_IDS[i]!, text: o.trim() }))
          .filter((o) => o.text !== '');
        if (opts.length < 2) {
          setError('“' + q.prompt.slice(0, 40) + '…” needs at least two options.');
          return;
        }
        if (!q.manualOnly && !opts.some((o) => o.id === q.correct)) {
          setError('“' + q.prompt.slice(0, 40)
            + '…” — mark which option is correct, or mark it for manual marking.');
          return;
        }
      }
      if (q.type === 'code' && !q.problemId) {
        setError('“' + q.prompt.slice(0, 40)
          + '…” needs a problem to be marked against — pick one, or write a new one.');
        return;
      }
      // A drafted problem is checked here with everything else, before the
      // first request goes out. The whole point of this pre-flight is that a
      // paper is never left half-made; a problem drafted on question three
      // that turns out to have no visible test case must not be discovered
      // after the bank and two questions already exist.
      if (q.type === 'code' && q.problemId === NEW_CONSOLE_PROBLEM) {
        const wrong = problemDraftError(q.draft);
        if (wrong) {
          setError('“' + q.prompt.slice(0, 40) + '…”: ' + wrong);
          return;
        }
      }
    }

    const base = 'onyx/platform/tenants/' + tenantId;

    /*
     * Any problem written on this form is made FIRST, before the bank.
     *
     * It has to be: a code question cannot be bound to a problem that does not
     * exist, and only a PUBLISHED problem can mark one -- so each drafted
     * problem is created, given its test cases and published, and the id it
     * comes back with is what the question carries.
     *
     * Before the bank rather than alongside the questions, so that a refusal
     * here costs nothing: at this point the only rows written are problems,
     * which are a bank of their own and are worth keeping even if the paper
     * is abandoned. The reverse order would leave an empty question bank
     * behind every failed attempt.
     */
    const authored = new Map<number, number>();
    for (const [i, q] of clean.entries()) {
      if (q.type !== 'code' || q.problemId !== NEW_CONSOLE_PROBLEM) continue;
      setStage('Creating problem for question ' + (i + 1) + '…');
      const made = await createProblemFromDraft(post, base + '/problems', q.draft);
      if ('error' in made) {
        setStage(null);
        setError('Question ' + (i + 1) + ': ' + made.error);
        return;
      }
      authored.set(i, made.id);
    }

    setStage('Making the bank…');
    // One bank per paper, so editing one exam's questions never touches
    // another's.
    const bank = await post(base + '/banks', {
      name: title.trim() + ' — question bank', course_id: Number(courseId),
    });
    if (!bank.ok) { setStage(null); setError(bank.message ?? 'Could not make the bank.'); return; }
    const bankId = bank.data.id as number;

    for (const [i, q] of clean.entries()) {
      setStage('Adding question ' + (i + 1) + ' of ' + clean.length + '…');
      const body = q.type === 'single'
        ? {
          type: 'single', prompt: q.prompt, points: Number(q.points) || 10,
          options: q.options.map((o, oi) => ({ id: OPTION_IDS[oi]!, text: o.trim() }))
            .filter((o) => o.text !== ''),
          // No key at all when it is marked by hand: the API leaves such a
          // question unmarked rather than grading every answer wrong against
          // a blank one.
          answer: q.manualOnly ? undefined : q.correct,
        }
        : q.type === 'code'
          ? { type: 'code', prompt: q.prompt, points: Number(q.points) || 10,
            problem_id: authored.get(i) ?? Number(q.problemId) }
          : { type: 'essay', prompt: q.prompt, points: Number(q.points) || 10 };

      const made = await post(base + '/banks/' + bankId + '/questions', body);
      if (!made.ok) {
        setStage(null);
        setError('Question ' + (i + 1) + ': ' + (made.message ?? 'could not be added.'));
        return;
      }
    }

    setStage('Making the paper…');
    const paper = await post(base + '/assessments', {
      title: title.trim(),
      course_id: Number(courseId),
      duration_minutes: Number(duration) || 60,
      ...(passMark.trim() ? { pass_mark: Number(passMark) } : {}),
      ...paperSwitchBody(switches),
    });
    if (!paper.ok) { setStage(null); setError(paper.message ?? 'Could not make the paper.'); return; }
    const paperId = paper.data.id as number;

    setStage('Drawing the questions…');
    const sections = await post(base + '/assessments/' + paperId + '/sections', {
      sections: [{ id: 's1', title: 'All questions', bank_id: bankId, take: clean.length }],
    }, 'PUT');
    if (!sections.ok) {
      setStage(null);
      setError('Paper made, but it draws nothing: ' + (sections.message ?? 'set its sections.'));
      return;
    }

    setStage('Publishing…');
    // Published rather than left a draft: a paper nobody scheduling an exam
    // can see in the picker a moment later has not finished being made.
    const live = await post(base + '/assessments/' + paperId + '/publish', {});
    if (!live.ok) {
      setStage(null);
      setError('Paper made but not published: ' + (live.message ?? 'publish it from its row.'));
      return;
    }

    setStage(null);
    setTitle('');
    setQuestions([blankQuestion()]);
    setOpen(false);
    router.refresh();
  });

  const totalMarks = questions
    .filter((q) => q.prompt.trim())
    .reduce((n, q) => n + (Number(q.points) || 0), 0);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={!courses.length}
        title={courses.length ? undefined : 'Needs at least one course'}
        className="min-h-[42px] rounded-xl border border-line bg-white px-4 text-sm font-semibold
                   hover:bg-brand-50 disabled:opacity-40">
        Create a paper
      </button>

      {open ? (
        <Modal title="Create a paper" onClose={() => setOpen(false)} wide>
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
            <p className="text-[12.5px] leading-relaxed text-muted">
              Builds a question bank and a published paper in one go, ready to pick as an
              examination’s online paper straight afterwards.
            </p>

            {error ? (
              <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {error}
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={label} htmlFor="cp-title">Paper title</label>
                <input id="cp-title" required value={title} placeholder="CS101 Midterm"
                  onChange={(e) => setTitle(e.target.value)} className={field} />
              </div>
              <div>
                <label className={label} htmlFor="cp-course">Course</label>
                <select id="cp-course" required value={courseId} className={field}
                  onChange={(e) => setCourseId(e.target.value)}>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="cp-duration">Duration (minutes)</label>
                <input id="cp-duration" type="number" min={5} max={600} value={duration}
                  onChange={(e) => setDuration(e.target.value)} className={field} />
              </div>
              <div>
                <label className={label} htmlFor="cp-pass">Pass mark</label>
                <input id="cp-pass" type="number" min={0} value={passMark} placeholder="Optional"
                  onChange={(e) => setPassMark(e.target.value)} className={field} />
              </div>
            </div>

            <div className="border-t border-line pt-3">
              <h3 className="mb-2 text-[14px] font-bold text-ink">How it is sat</h3>
              <PaperSwitches value={switches} onChange={setSwitches} />
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t
                            border-line pt-3">
              <h3 className="text-[14px] font-bold text-ink">Questions</h3>
              <span className="text-[12.5px] tabular-nums text-muted">
                {questions.filter((q) => q.prompt.trim()).length} written · {totalMarks} marks
              </span>
            </div>

            <ol className="space-y-3">
              {questions.map((q, i) => (
                <li key={i} className="rounded-xl border border-line bg-slate-50 p-3.5">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[12.5px] font-bold text-muted">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(['single', 'essay', 'code'] as const).map((t) => (
                        <button
                          key={t} type="button" aria-pressed={q.type === t}
                          /*
                           * Never disabled any more.
                           *
                           * This was gated on the institution already having a
                           * published problem, which was right while pointing
                           * at one was the only option and is exactly backwards
                           * now: an institution with an empty bank is the one
                           * that most needs to write a problem while setting
                           * its first coding paper, and the picker's "write a
                           * new problem" is the way out of precisely that empty
                           * state. The gate disabled the door out of the room.
                           */
                          title={t === 'code' && !usableProblems.length
                            ? 'No published problem here yet — you can write one on the form'
                            : undefined}
                          onClick={() => setQuestion(i, { type: t })}
                          className={'min-h-[30px] rounded-lg border px-2.5 text-[12px] '
                            + 'font-semibold disabled:opacity-40 '
                            + (q.type === t
                              ? 'border-brand-600 bg-brand-600 text-white'
                              : 'border-line bg-white text-slate-700')}
                        >
                          {t === 'single' ? 'Multiple choice' : t === 'essay' ? 'Written' : 'Code'}
                        </button>
                      ))}
                      {questions.length > 1 ? (
                        <button type="button"
                          onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                          className="min-h-[30px] rounded-lg border border-line bg-white px-2.5
                                     text-[12px] font-semibold text-red-700">
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <textarea
                    value={q.prompt} rows={2} placeholder="The question"
                    aria-label={'Question ' + (i + 1)}
                    onChange={(e) => setQuestion(i, { prompt: e.target.value })}
                    className={field + ' mt-0'}
                  />

                  {q.type === 'single' ? (
                    <div className="mt-2.5 space-y-1.5">
                      {q.options.map((o, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          {/* The radio IS the answer key, beside the option it
                              marks -- a separate "correct answer" dropdown is
                              a second place for the two to disagree. */}
                          <input
                            type="radio" name={'correct-' + i} checked={q.correct === OPTION_IDS[oi]}
                            disabled={q.manualOnly}
                            aria-label={'Option ' + OPTION_IDS[oi]!.toUpperCase() + ' is correct'}
                            onChange={() => setQuestion(i, { correct: OPTION_IDS[oi]! })}
                            className="h-4 w-4 shrink-0"
                          />
                          <input
                            value={o} placeholder={'Option ' + OPTION_IDS[oi]!.toUpperCase()}
                            aria-label={'Option ' + OPTION_IDS[oi]!.toUpperCase()}
                            onChange={(e) => setOption(i, oi, e.target.value)}
                            className={field + ' mt-0'}
                          />
                        </div>
                      ))}
                      <label className="flex items-center gap-2 text-[12.5px] text-slate-700">
                        <input type="checkbox" checked={q.manualOnly}
                          onChange={(e) => setQuestion(i, {
                            manualOnly: e.target.checked,
                            correct: e.target.checked ? '' : q.correct,
                          })}
                          className="h-4 w-4 rounded border-slate-300" />
                        No single right answer — a person marks this one
                      </label>
                    </div>
                  ) : null}

                  {q.type === 'code' ? (
                    <div className="mt-2.5">
                      <label className={label} htmlFor={'cp-prob-' + i}>
                        Marked by the tests of
                      </label>
                      <select id={'cp-prob-' + i} value={q.problemId} className={field}
                        onChange={(e) => setQuestion(i, { problemId: e.target.value })}>
                        {/* First, and selected by default: the problem for a
                            question being written now usually does not exist
                            yet. Reuse stays available underneath, which is the
                            better answer whenever the bank already has it --
                            it has been practised, its tests are trusted, and a
                            candidate's history with it stays in one place. */}
                        <option value={NEW_CONSOLE_PROBLEM}>
                          Write the problem here
                        </option>
                        {usableProblems.length ? (
                          <optgroup label="Or reuse a published problem">
                            {usableProblems.map((x) => (
                              <option key={x.id} value={x.id}>{x.title}</option>
                            ))}
                          </optgroup>
                        ) : null}
                      </select>
                      {q.problemId === NEW_CONSOLE_PROBLEM ? (
                        <div className="mt-2.5">
                          <ProblemDraftFields draft={q.draft}
                            idPrefix={'console-draft-' + i}
                            onChange={(patch) => setQuestion(i,
                              { draft: { ...q.draft, ...patch } })}
                            inputClass={field} labelClass={label} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-2.5 flex items-center gap-2">
                    <label className="text-[12.5px] font-semibold text-slate-700"
                      htmlFor={'cp-points-' + i}>
                      Marks
                    </label>
                    <input id={'cp-points-' + i} type="number" min={1} value={q.points}
                      onChange={(e) => setQuestion(i, { points: e.target.value })}
                      className={field + ' mt-0 w-24'} />
                  </div>
                </li>
              ))}
            </ol>

            <button type="button" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px]
                         font-semibold">
              Add another question
            </button>

            <div className="flex gap-2 border-t border-line pt-3">
              <button type="submit" disabled={pending} className={button}>
                {stage ?? (pending ? 'Working…' : 'Create and publish it')}
              </button>
              <button type="button" disabled={pending} onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/* ===================================================================== *
 * Code Lab, from the console.
 *
 * The bank was READABLE here long before it was writable: the paper builder
 * lists an institution's published problems so a coding question can be bound
 * to one. What it could not do was make a problem, so the first coding problem
 * at any institution had to be authored by signing in as that institution's
 * own administrator -- which is the one thing a platform operator is not
 * supposed to have to do.
 *
 * These four components are the whole authoring loop, and each maps onto one
 * CodeLabService call rather than reimplementing its rules:
 *
 *   ConsoleCreateProblem  POST   .../problems          -- statement and limits
 *   ConsoleProblemEdit    PATCH  .../problems/:id      -- change any of it
 *   ConsoleTestCases      PUT    .../problems/:id/tests -- the answer key
 *   ConsolePublishProblem POST   .../problems/:id/publish | /unpublish
 *
 * The order matters and the product says so: a problem is created as a DRAFT,
 * because the API refuses to publish one with no test cases and refuses to
 * change the cases of a published one. Publishing is therefore the last step
 * and unpublishing is the only door back -- offered plainly here rather than
 * worked around, since changing the key under submissions already marked would
 * regrade them silently.
 * ===================================================================== */

const LANGUAGE_CHOICES = ['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'go', 'rust'];

const SOLUTION_RULES: { value: string; label: string }[] = [
  { value: 'never', label: 'Never show it' },
  { value: 'after_solve', label: 'Once they solve it' },
  { value: 'after_attempts', label: 'After a number of attempts' },
  { value: 'after_date', label: 'From a date' },
];

/** Draft a coding problem: what it asks, in what language, under what limits. */
export function ConsoleCreateProblem({ tenantId, courses }: {
  tenantId: number; courses: CourseOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [languages, setLanguages] = useState<string[]>(['python']);
  const [rule, setRule] = useState('after_solve');

  const toggle = (lang: string) => setLanguages((ls) =>
    (ls.includes(lang) ? ls.filter((l) => l !== lang) : [...ls, lang]));

  const form = (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          if (!languages.length) { setError('Pick at least one language.'); return; }
          const afterDate = String(data.get('solution_after') ?? '');
          const courseRaw = String(data.get('course_id') ?? '');
          const made = await post('onyx/platform/tenants/' + tenantId + '/problems', {
            title: String(data.get('title') ?? ''),
            statement: String(data.get('statement') ?? '') || null,
            difficulty: String(data.get('difficulty') ?? 'easy'),
            topic: String(data.get('topic') ?? '').trim() || null,
            tags: String(data.get('tags') ?? '').split(',')
              .map((t) => t.trim()).filter(Boolean),
            languages,
            course_id: courseRaw ? Number(courseRaw) : null,
            // Seconds and megabytes on the form, because that is how a time
            // limit is talked about; milliseconds and kilobytes on the wire,
            // because that is what the sandbox takes.
            time_limit_ms: Math.round((Number(data.get('time_limit')) || 5) * 1000),
            memory_limit_kb: Math.round((Number(data.get('memory_limit')) || 256) * 1024),
            solution: String(data.get('solution') ?? '').trim() || null,
            solution_rule: rule,
            ...(rule === 'after_attempts'
              ? { solution_after_attempts: Number(data.get('after_attempts')) || 3 } : {}),
            solution_after: rule === 'after_date' && afterDate
              ? new Date(afterDate).toISOString() : null,
          });
          if (!made.ok) { setError(made.message ?? 'That did not work.'); return; }
          setOpen(false);
          // Straight to the new problem, not back to the list: it is a draft
          // with no test cases, and the next thing anybody has to do is write
          // them. Returning to the list would make a half-finished problem one
          // more row to find.
          router.push('/onyx/platform/tenants/' + tenantId + '/problems/' + made.data.id);
        });
      }}
    >
      <Error_ message={error} />
      <p className="col-span-full text-[12.5px] text-muted">
        Created as a draft. The next screen sets its test cases, which it cannot be
        published without.
      </p>

      <div className="sm:col-span-2">
        <label className={label} htmlFor="cprob-title">Problem</label>
        <input id="cprob-title" name="title" required maxLength={255} placeholder="Two Sum"
          className={field} />
      </div>

      <div className="sm:col-span-2">
        <label className={label} htmlFor="cprob-statement">Description</label>
        <textarea id="cprob-statement" name="statement" required rows={6}
          placeholder={'What the program must do, the shape of its input and its output, '
            + 'and a worked example.'}
          className={field + ' py-2 leading-relaxed'} />
        <p className="mt-1 text-[12px] text-muted">
          This is what a learner reads. The visible test cases are shown alongside it, so
          the example here and the cases below should agree.
        </p>
      </div>

      <div>
        <label className={label} htmlFor="cprob-difficulty">Difficulty</label>
        <select id="cprob-difficulty" name="difficulty" defaultValue="easy" className={field}>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>
      <div>
        <label className={label} htmlFor="cprob-topic">Topic</label>
        <input id="cprob-topic" name="topic" maxLength={100} placeholder="Arrays"
          className={field} />
      </div>

      <div className="sm:col-span-2">
        <label className={label} htmlFor="cprob-tags">Tags</label>
        <input id="cprob-tags" name="tags" placeholder="arrays, hashing" className={field} />
        <p className="mt-1 text-[12px] text-muted">Comma-separated.</p>
      </div>

      <fieldset className="sm:col-span-2 rounded-xl border border-line p-3">
        <legend className="px-1 text-[13.5px] font-semibold text-slate-700">
          Languages it may be solved in
        </legend>
        <div className="flex flex-wrap gap-2">
          {LANGUAGE_CHOICES.map((lang) => {
            const on = languages.includes(lang);
            return (
              <button key={lang} type="button" onClick={() => toggle(lang)}
                aria-pressed={on}
                className={'rounded-xl px-3 py-1.5 text-[13px] font-semibold '
                  + (on
                    ? 'bg-brand-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-brand-50')}>
                {lang}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          A learner may only submit in one of these. Leaving one out is how a problem
          whose answer key assumes Python stays fair.
        </p>
      </fieldset>

      <div>
        <label className={label} htmlFor="cprob-time">Time per case (seconds)</label>
        <input id="cprob-time" name="time_limit" type="number" min={0.1} max={30} step="0.1"
          defaultValue={5} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="cprob-memory">Memory per case (MB)</label>
        <input id="cprob-memory" name="memory_limit" type="number" min={16} max={1024}
          defaultValue={256} className={field} />
      </div>

      <div className="sm:col-span-2">
        <label className={label} htmlFor="cprob-course">Course</label>
        <select id="cprob-course" name="course_id" defaultValue="" className={field}>
          <option value="">Not tied to a course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
          ))}
        </select>
        <p className="mt-1 text-[12px] text-muted">
          A problem on no course is still practised and still examinable — it simply does
          not appear under a course.
        </p>
      </div>

      <fieldset className="sm:col-span-2 rounded-xl border border-line p-3">
        <legend className="px-1 text-[13.5px] font-semibold text-slate-700">
          Worked solution
        </legend>
        <label className="block text-[12.5px] font-semibold text-slate-700" htmlFor="cprob-solution">
          Solution (optional)
        </label>
        <textarea id="cprob-solution" name="solution" rows={4}
          className={field + ' py-2 font-mono text-[12.5px]'} />
        <label className="mt-2 block text-[12.5px] font-semibold text-slate-700"
          htmlFor="cprob-rule">
          Release it to a learner
        </label>
        <select id="cprob-rule" name="solution_rule" value={rule}
          onChange={(e) => setRule(e.target.value)} className={field}>
          {SOLUTION_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {rule === 'after_attempts' ? (
          <div className="mt-2">
            <label className="block text-[12.5px] font-semibold text-slate-700"
              htmlFor="cprob-attempts">
              After this many attempts
            </label>
            <input id="cprob-attempts" name="after_attempts" type="number" min={1} max={100}
              defaultValue={3} className={field} />
          </div>
        ) : null}
        {rule === 'after_date' ? (
          <div className="mt-2">
            <label className="block text-[12.5px] font-semibold text-slate-700"
              htmlFor="cprob-after">
              From
            </label>
            <input id="cprob-after" name="solution_after" type="datetime-local" className={field} />
          </div>
        ) : null}
      </fieldset>

      <div className="col-span-full flex gap-2 pt-1">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Creating…' : 'Create the draft'}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={button}>
        Add a problem
      </button>
      {open ? (
        <Modal title="New coding problem" onClose={() => setOpen(false)} wide>
          {form}
        </Modal>
      ) : null}
    </>
  );
}

export interface ConsoleProblem {
  id: number; title: string; slug: string; statement: string | null;
  difficulty: string; topic: string | null; tags: string[]; languages: string[];
  course_id: number | null; time_limit_ms: number; memory_limit_kb: number;
  status: string;
}

/**
 * Change a problem after the fact.
 *
 * Open regardless of whether it is published, and deliberately so: the
 * statement, the topic and the languages carry no answer key, and a typo in a
 * question is worth fixing while people are reading it. The TEST CASES are the
 * exception, and they are not on this form -- see ConsoleTestCases.
 */
export function ConsoleProblemEdit({ tenantId, problem, courses }: {
  tenantId: number; problem: ConsoleProblem; courses: CourseOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [languages, setLanguages] = useState<string[]>(problem.languages ?? []);

  const toggle = (lang: string) => setLanguages((ls) =>
    (ls.includes(lang) ? ls.filter((l) => l !== lang) : [...ls, lang]));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold
                   hover:border-brand-300 hover:text-brand-700">
        Edit
      </button>
    );
  }

  return (
    <Modal title="Edit problem" onClose={() => setOpen(false)} wide>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            if (!languages.length) { setError('Pick at least one language.'); return; }
            const courseRaw = String(data.get('course_id') ?? '');
            const res = await post(
              'onyx/platform/tenants/' + tenantId + '/problems/' + problem.id,
              {
                title: String(data.get('title') ?? ''),
                statement: String(data.get('statement') ?? '') || null,
                difficulty: String(data.get('difficulty') ?? problem.difficulty),
                topic: String(data.get('topic') ?? '').trim() || null,
                tags: String(data.get('tags') ?? '').split(',')
                  .map((t) => t.trim()).filter(Boolean),
                languages,
                course_id: courseRaw ? Number(courseRaw) : null,
                time_limit_ms: Math.round((Number(data.get('time_limit')) || 5) * 1000),
                memory_limit_kb: Math.round((Number(data.get('memory_limit')) || 256) * 1024),
              }, 'PATCH');
            if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
            setOpen(false);
            router.refresh();
          });
        }}
      >
        <Error_ message={error} />
        <div className="sm:col-span-2">
          <label className={label} htmlFor="ep-title">Problem</label>
          <input id="ep-title" name="title" required maxLength={255}
            defaultValue={problem.title} className={field} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="ep-statement">Description</label>
          <textarea id="ep-statement" name="statement" rows={8}
            defaultValue={problem.statement ?? ''}
            className={field + ' py-2 leading-relaxed'} />
        </div>
        <div>
          <label className={label} htmlFor="ep-difficulty">Difficulty</label>
          <select id="ep-difficulty" name="difficulty" defaultValue={problem.difficulty}
            className={field}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ep-topic">Topic</label>
          <input id="ep-topic" name="topic" maxLength={100} defaultValue={problem.topic ?? ''}
            className={field} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="ep-tags">Tags</label>
          <input id="ep-tags" name="tags" defaultValue={(problem.tags ?? []).join(', ')}
            className={field} />
        </div>
        <fieldset className="sm:col-span-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-[13.5px] font-semibold text-slate-700">Languages</legend>
          <div className="flex flex-wrap gap-2">
            {[...new Set([...LANGUAGE_CHOICES, ...(problem.languages ?? [])])].map((lang) => {
              const on = languages.includes(lang);
              return (
                <button key={lang} type="button" onClick={() => toggle(lang)} aria-pressed={on}
                  className={'rounded-xl px-3 py-1.5 text-[13px] font-semibold '
                    + (on
                      ? 'bg-brand-600 text-white'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-brand-50')}>
                  {lang}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div>
          <label className={label} htmlFor="ep-time">Time per case (seconds)</label>
          <input id="ep-time" name="time_limit" type="number" min={0.1} max={30} step="0.1"
            defaultValue={problem.time_limit_ms / 1000} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="ep-memory">Memory per case (MB)</label>
          <input id="ep-memory" name="memory_limit" type="number" min={16} max={1024}
            defaultValue={Math.round(problem.memory_limit_kb / 1024)} className={field} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="ep-course">Course</label>
          <select id="ep-course" name="course_id" defaultValue={problem.course_id ?? ''}
            className={field}>
            <option value="">Not tied to a course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
            ))}
          </select>
        </div>
        <div className="col-span-full flex gap-2 pt-1">
          <button type="submit" disabled={pending} className={button}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" disabled={pending} onClick={() => setOpen(false)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface DraftCase {
  name: string; stdin: string; expected_stdout: string; is_hidden: boolean; weight: string;
}

/**
 * The answer key: the cases a submission is marked against.
 *
 * Two rules are the API's and are stated here rather than discovered on save,
 * because both are about the problem being fair rather than about the form:
 *
 *   * **At least one case must be visible.** Without one a learner cannot tell
 *     what the problem wants, only that they got it wrong.
 *   * **A hidden case is the answer.** Its input, its expected output and what
 *     a submission printed for it never reach a learner -- which is what makes
 *     an auto-graded coding question worth anything.
 *
 * A published problem's cases cannot be edited at all. That is not this
 * component being cautious: changing them under submissions already marked
 * would regrade those silently, and nobody would know which score meant what.
 * The way back is Unpublish, offered beside this as its own deliberate act.
 */
export function ConsoleTestCases({ tenantId, problemId, initial, published }: {
  tenantId: number; problemId: number;
  initial?: { name?: string | null; stdin: string | null; expected_stdout: string | null;
    is_hidden: number | boolean; weight?: number }[];
  published: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [cases, setCases] = useState<DraftCase[]>(
    (initial ?? []).length
      ? initial!.map((t) => ({
        name: t.name ?? '',
        stdin: t.stdin ?? '',
        expected_stdout: t.expected_stdout ?? '',
        is_hidden: Boolean(t.is_hidden),
        weight: String(t.weight ?? 1),
      }))
      : [
        // One of each, so the shape of a usable key is the starting point
        // rather than something to be discovered from an error message.
        { name: 'Example', stdin: '', expected_stdout: '', is_hidden: false, weight: '1' },
        { name: 'Hidden', stdin: '', expected_stdout: '', is_hidden: true, weight: '1' },
      ]);

  const setCase = (i: number, patch: Partial<DraftCase>) =>
    setCases((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  if (published) {
    return (
      <div className="rounded-2xl border border-line bg-white p-4">
        <p className="text-[13px] text-muted">
          This problem is published, so its test cases are fixed — changing them under
          submissions already marked would regrade those silently. Unpublish it to edit
          them; it stops accepting new submissions until it is published again.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-3 rounded-2xl border border-line bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const clean = cases
            .map((c) => ({ ...c, expected_stdout: c.expected_stdout }))
            .filter((c) => c.expected_stdout.trim() !== '' || c.stdin.trim() !== '');
          if (!clean.length) { setError('A problem needs at least one test case.'); return; }
          if (!clean.some((c) => !c.is_hidden)) {
            setError('At least one case has to be visible — otherwise a learner cannot tell '
              + 'what the problem wants.');
            return;
          }
          const res = await post(
            'onyx/platform/tenants/' + tenantId + '/problems/' + problemId + '/tests',
            {
              tests: clean.map((c, i) => ({
                name: c.name.trim() || 'Case ' + (i + 1),
                stdin: c.stdin,
                expected_stdout: c.expected_stdout,
                is_hidden: c.is_hidden,
                weight: Number(c.weight) || 1,
              })),
            }, 'PUT');
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          router.refresh();
        });
      }}
    >
      <Error_ message={error} />

      {cases.map((c, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <input aria-label={'Name of case ' + (i + 1)} value={c.name}
              onChange={(e) => setCase(i, { name: e.target.value })}
              placeholder={'Case ' + (i + 1)}
              className={field + ' mt-0 max-w-[14rem] min-h-[38px]'} />
            <label className="flex items-center gap-1.5 text-[13px] font-semibold">
              <input type="checkbox" checked={c.is_hidden}
                onChange={(e) => setCase(i, { is_hidden: e.target.checked })} />
              Hidden
            </label>
            <label className="flex items-center gap-1.5 text-[13px] font-semibold">
              Weight
              <input type="number" min={0.01} step="0.01" value={c.weight}
                onChange={(e) => setCase(i, { weight: e.target.value })}
                className={field + ' mt-0 w-[6rem] min-h-[38px]'} />
            </label>
            <span className="flex-1" />
            {cases.length > 1 ? (
              <button type="button"
                onClick={() => setCases((cs) => cs.filter((_, j) => j !== i))}
                className="text-[12.5px] font-semibold text-rose-700 hover:underline">
                Remove
              </button>
            ) : null}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-[12px] font-semibold text-slate-700"
                htmlFor={'tc-in-' + i}>
                Input (stdin)
              </label>
              <textarea id={'tc-in-' + i} rows={3} value={c.stdin}
                onChange={(e) => setCase(i, { stdin: e.target.value })}
                className={field + ' py-2 font-mono text-[12.5px]'} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-700"
                htmlFor={'tc-out-' + i}>
                Expected output
              </label>
              <textarea id={'tc-out-' + i} rows={3} value={c.expected_stdout}
                onChange={(e) => setCase(i, { expected_stdout: e.target.value })}
                className={field + ' py-2 font-mono text-[12.5px]'} />
            </div>
          </div>
          {c.is_hidden ? (
            <p className="mt-1.5 text-[12px] text-muted">
              Hidden: neither this input, this expected output, nor what a submission printed
              for it is ever shown to a learner.
            </p>
          ) : null}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button type="button"
          onClick={() => setCases((cs) => [...cs,
            { name: '', stdin: '', expected_stdout: '', is_hidden: true, weight: '1' }])}
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-semibold">
          Add another case
        </button>
        <span className="flex-1" />
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Saving…' : 'Save the test cases'}
        </button>
      </div>

      <p className="text-[12px] text-muted">
        Trailing spaces and line endings are ignored when output is compared — a correct
        answer is not failed over a <code>\r\n</code>.
      </p>
    </form>
  );
}

/** Publish a finished draft, or pull a live problem back to draft to fix it. */
export function ConsolePublishProblem({ tenantId, problemId, published, caseCount }: {
  tenantId: number; problemId: number; published: boolean; caseCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (what: 'publish' | 'unpublish') => start(async () => {
    setError(null);
    const res = await post(
      'onyx/platform/tenants/' + tenantId + '/problems/' + problemId + '/' + what);
    if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
    router.refresh();
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error ? (
        <p role="alert" className="w-full text-[13px] text-rose-700">{error}</p>
      ) : null}
      {published ? (
        <>
          <button type="button" disabled={pending} onClick={() => act('unpublish')}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold
                       hover:border-rose-300 hover:text-rose-700 disabled:opacity-50">
            {pending ? 'Working…' : 'Unpublish'}
          </button>
          <span className="text-[12.5px] text-muted">
            Stops accepting new submissions, and lets the test cases be edited again.
          </span>
        </>
      ) : (
        <>
          <button type="button" disabled={pending || caseCount === 0} onClick={() => act('publish')}
            className={button}
            title={caseCount === 0 ? 'Add test cases first' : undefined}>
            {pending ? 'Publishing…' : 'Publish it'}
          </button>
          <span className="text-[12.5px] text-muted">
            {caseCount === 0
              ? 'A problem cannot be published with no test cases.'
              : 'Learners can practise it, and a coding question can be marked against it.'}
          </span>
        </>
      )}
    </div>
  );
}


/**
 * Edit one Live Class.
 *
 * The console could publish it, withdraw it and destroy it, and could not fix
 * a typo in its title — so a price entered wrongly, or a name spelled wrong on
 * the tile every learner sees, meant removing the whole thing and building it
 * again, taking its registrations with it.
 *
 * The banner can be replaced here too, which the institution's own edit form
 * cannot do: it sets the picture at creation and never again. Same three steps
 * as everywhere else — ticket, PUT to storage, key — and leaving the field
 * empty keeps whatever is already there rather than clearing it, because "I
 * did not touch this" and "remove this" are different intentions and only one
 * of them is expressed by an empty file input.
 */
export function EditDomainForm({ tenantId, domain }: {
  tenantId: number; domain: ConsoleDomain;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function uploadBanner(picked: File): Promise<string> {
    setStage('Uploading…');
    const ticketRes = await fetch('/api/proxy/onyx/platform/tenants/' + tenantId
      + '/domains/uploads/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: picked.name }),
    });
    const ticket = await ticketRes.json().catch(() => ({ ok: false }));
    if (!ticket.ok) throw new Error(ticket.message ?? 'Could not start the upload.');
    const put = await fetch(ticket.data.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': picked.type || 'application/octet-stream' },
      body: picked,
    });
    if (!put.ok) throw new Error('The image could not be uploaded. Check your connection.');
    return ticket.data.path as string;
  }

  const form = (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          try {
            const picked = (data.get('banner') as File | null) ?? null;
            const imagePath = picked && picked.size ? await uploadBanner(picked) : null;

            setStage('Saving…');
            const res = await post('onyx/platform/tenants/' + tenantId + '/domains/' + domain.id, {
              title: String(data.get('title') ?? ''),
              summary: String(data.get('summary') ?? ''),
              curriculum_url: String(data.get('curriculum_url') ?? ''),
              certificate: String(data.get('certificate') ?? ''),
              duration_label: String(data.get('duration_label') ?? ''),
              price_minor: Math.round(Number(data.get('price_rupees') || 0) * 100),
              status: Number(data.get('status') ?? 0),
              // Omitted when nobody chose a new one: sending null would wipe
              // the banner somebody uploaded, which is not what leaving a file
              // input alone means.
              ...(imagePath ? { image_path: imagePath } : {}),
            }, 'PATCH');
            if (!res.ok) throw new Error(res.message ?? 'That did not save.');
            setStage(null);
            setOpen(false);
            router.refresh();
          } catch (err) {
            setStage(null);
            setError(err instanceof Error ? err.message : 'That did not work.');
          }
        });
      }}
    >
      {error ? (
        <p role="alert" className="col-span-full rounded-xl bg-red-50 px-3 py-2 text-[13px]
                                   text-red-700">{error}</p>
      ) : null}

      <div className="sm:col-span-2">
        <label className={label} htmlFor="ed-title">Title</label>
        <input id="ed-title" name="title" required maxLength={200}
          defaultValue={domain.title} className={field} />
      </div>

      <div className="sm:col-span-2">
        <label className={label} htmlFor="ed-banner">Replace the banner</label>
        <input
          id="ed-banner" name="banner" type="file" accept="image/*"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            if (picked && picked.size > MAX_BANNER_BYTES) {
              setError('That image is larger than 5 MB. A tile only needs a small one.');
              e.target.value = '';
              return;
            }
            setError(null);
          }}
          className="mt-1.5 block w-full text-[13.5px] file:mr-3 file:rounded-lg file:border-0
                     file:bg-brand-50 file:px-3 file:py-2 file:text-[13px] file:font-semibold
                     file:text-brand-700"
        />
        <p className="mt-1 text-[12px] text-muted">
          {domain.image_url
            ? 'Leave empty to keep the picture that is already there.'
            : 'Optional. Shown on the tile — a wide image works best. Up to 5 MB.'}
        </p>
      </div>

      <div className="sm:col-span-2">
        <label className={label} htmlFor="ed-summary">Summary</label>
        <textarea id="ed-summary" name="summary" maxLength={4000} rows={3}
          defaultValue={domain.summary} className={field} />
      </div>

      <div>
        <label className={label} htmlFor="ed-duration">Duration</label>
        <input id="ed-duration" name="duration_label" maxLength={80}
          defaultValue={domain.duration_label} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="ed-cert">Certificate awarded</label>
        <input id="ed-cert" name="certificate" maxLength={200}
          placeholder="Leave empty if none"
          defaultValue={domain.certificate} className={field} />
      </div>

      <div>
        <label className={label} htmlFor="ed-price">Price</label>
        {/* Rupees, converted on the way out -- the column stores minor units
            and nobody setting a price should have to multiply by a hundred. */}
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute left-3 top-1/2
                                       -translate-y-1/2 text-[15px] font-semibold text-muted">₹</span>
          <input id="ed-price" name="price_rupees" type="number" min={0} step="0.01"
            defaultValue={(Number(domain.price_minor ?? 0) / 100).toFixed(2)}
            className={field + ' pl-7'} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="ed-status">Shown to learners</label>
        <select id="ed-status" name="status" defaultValue={String(domain.status)}
          className={field}>
          <option value="1">Published</option>
          <option value="0">Draft — nobody outside sees it</option>
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className={label} htmlFor="ed-url">Curriculum link</label>
        <input id="ed-url" name="curriculum_url" maxLength={500}
          placeholder="example.com/curriculum"
          defaultValue={domain.curriculum_url} className={field} />
      </div>

      <div className="col-span-full flex gap-2 pt-1">
        <button type="submit" disabled={pending} className={button}>
          {stage ?? (pending ? 'Saving…' : 'Save')}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="min-h-[34px] whitespace-nowrap rounded-lg border border-line bg-white px-3
                   text-[12.5px] font-semibold text-slate-700 hover:bg-brand-50">
        Edit
      </button>
      {open ? (
        <Modal title="Edit this Live Class" onClose={() => setOpen(false)} wide>
          {form}
        </Modal>
      ) : null}
    </>
  );
}


/**
 * Answer one learner's question, from the console.
 *
 * The reply is the whole point: a queue an operator can read and not answer is
 * a queue that tells them about a problem they cannot do anything about.
 *
 * Resolving is a SEPARATE button rather than a tickbox on the reply, because
 * they are different claims. "Here is your answer" and "this is finished" are
 * often the same act and often are not, and a form that assumes they are is
 * one that closes a thread the learner was still in.
 */
export function TicketReply({ tenantId, ticket }: {
  tenantId: number;
  ticket: { id: number; subject: string; body: string; status: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const settled = ticket.status === 'resolved' || ticket.status === 'closed';

  const send = (path: string, body: unknown, done: string) => start(async () => {
    setError(null);
    setNote(null);
    const res = await post('onyx/platform/tenants/' + tenantId + '/tickets/'
      + ticket.id + path, body);
    if (!res.ok) { setError(res.message ?? 'That did not send.'); return; }
    setNote(done);
    router.refresh();
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="min-h-[34px] whitespace-nowrap rounded-lg border border-line bg-white px-3
                   text-[12.5px] font-semibold text-slate-700 hover:bg-brand-50">
        {settled ? 'Read' : 'Answer'}
      </button>

      {open ? (
        <Modal title="Answer this question" onClose={() => setOpen(false)} wide>
          <div className="space-y-3.5">
            <div>
              <h3 className="text-[15px] font-bold text-ink">{ticket.subject}</h3>
              {/* Kept as written: a learner describing a problem uses
                  paragraphs, and running them together loses the steps. */}
              <p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2.5
                            text-[13.5px] leading-relaxed text-slate-800">
                {ticket.body}
              </p>
            </div>

            {error ? (
              <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {error}
              </p>
            ) : null}
            {note ? (
              <p role="status" className="rounded-xl bg-green-50 px-3 py-2 text-[13px]
                                          text-green-800">{note}</p>
            ) : null}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                send('/respond', { body: String(data.get('reply') ?? '') }, 'Reply sent.');
              }}
              className="space-y-2.5"
            >
              <div>
                <label className={label} htmlFor="tr-reply">Your answer</label>
                <textarea id="tr-reply" name="reply" required rows={5} maxLength={20_000}
                  placeholder="Answer the question as you would to their face."
                  className={field} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending} className={button}>
                  {pending ? 'Sending…' : 'Send the answer'}
                </button>
                {!settled ? (
                  <button
                    type="button" disabled={pending}
                    onClick={() => send('/resolve', {}, 'Marked as resolved.')}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm
                               font-semibold"
                  >
                    Mark resolved
                  </button>
                ) : null}
                <button type="button" disabled={pending} onClick={() => setOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
                  Close
                </button>
              </div>
            </form>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------- credentials */

/** Just enough of a member to fill the holder picker. */
export interface HolderOption { user_id: string; name: string; roll_number: string | null }

/**
 * CAR-03 from the console -- issuing a credential.
 *
 * Deliberately narrower than the institution's own form: no `assessment_id`,
 * no free-form `detail`. Those exist so that a certificate awarded BY a paper
 * can point back at it, and a certificate an operator issues by hand is not
 * that. Everything a verifier ever sees -- the holder, what it says, when it
 * was issued and whether it still stands -- is here.
 */
export function IssueCertificateForm({ tenantId, holders, courses, capped }: {
  tenantId: number; holders: HolderOption[]; courses: CourseOption[];
  /** True when the roster ran to its ceiling and somebody may be missing. */
  capped?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={!holders.length}
        className={button}
        title={holders.length ? undefined : 'Add somebody to this institution first'}>
        Issue a certificate
      </button>
    );
  }
  return (
    <form
      className="grid gap-3 rounded-2xl border border-line bg-slate-50 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const expires = String(data.get('expires_at') ?? '');
          const courseId = String(data.get('course_id') ?? '');
          const res = await post('onyx/platform/tenants/' + tenantId + '/certificates', {
            user_id: String(data.get('user_id') ?? ''),
            title: String(data.get('title') ?? ''),
            kind: String(data.get('kind') ?? 'course'),
            // Empty means "not tied to a course", which is a real answer and
            // not the same as zero.
            course_id: courseId ? Number(courseId) : null,
            expires_at: expires ? new Date(expires).toISOString() : null,
          });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="col-span-full text-[13px] text-red-700">{error}</p> : null}
      <div className="sm:col-span-2">
        <label className={label} htmlFor="pc-holder">Holder</label>
        <select id="pc-holder" name="user_id" required className={field}>
          {holders.map((h) => (
            <option key={h.user_id} value={h.user_id}>
              {h.roll_number ? h.roll_number + ' · ' : ''}{h.name}
            </option>
          ))}
        </select>
        {capped ? (
          <p className="mt-1 text-[12.5px] text-muted">
            The first {holders.length} people at this institution. If the holder
            you want is not here, issue it from the institution&rsquo;s own
            Certificates screen.
          </p>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="pc-title">What it certifies</label>
        <input id="pc-title" name="title" required maxLength={255} className={field}
          placeholder="Applied Algorithms — Course Completion" />
      </div>
      <div>
        <label className={label} htmlFor="pc-kind">Kind</label>
        {/* Written out, not the four words the column stores. The
            institution's own form offers "course / assessment / contest /
            program" exactly as they appear in the database, which is a
            picker that reads like a schema. */}
        <select id="pc-kind" name="kind" className={field} defaultValue="course">
          <option value="course">Completing a course</option>
          <option value="assessment">Passing an assessment</option>
          <option value="contest">Placing in a contest</option>
          <option value="program">Completing a programme</option>
        </select>
      </div>
      <div>
        <label className={label} htmlFor="pc-course">Course (optional)</label>
        <select id="pc-course" name="course_id" className={field} defaultValue="">
          <option value="">Not tied to a course</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="pc-expires">Valid until (optional)</label>
        <input id="pc-expires" name="expires_at" type="date" className={field} />
        <p className="mt-1 text-[12.5px] text-muted">
          Leave it empty and the credential does not expire, which is what a
          course completion usually is.
        </p>
      </div>
      <div className="col-span-full flex gap-2">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Issuing…' : 'Issue'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Revoking one, which always asks why.
 *
 * The reason is not paperwork. A revoked credential is never deleted -- its
 * public page keeps answering and says it was withdrawn -- and the registrar
 * fielding "why does mine say revoked" a year from now has only this field to
 * answer from.
 */
export function RevokeCertificateButton({ tenantId, certificateId }: {
  tenantId: number; certificateId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-red-300 px-3 py-1.5 text-[13px] font-semibold
                   text-red-700 hover:bg-red-50">
        Revoke
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-start justify-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await post('onyx/platform/tenants/' + tenantId
            + '/certificates/' + certificateId + '/revoke',
          { reason: String(data.get('reason') ?? '') });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="w-full text-[13px] text-red-700">{error}</p> : null}
      <label className="sr-only" htmlFor={'pc-reason-' + certificateId}>
        Why it is being revoked
      </label>
      <input id={'pc-reason-' + certificateId} name="reason" required maxLength={500}
        placeholder="Why it is being revoked"
        className="min-h-[38px] w-56 rounded-lg border border-line bg-white px-3 text-[13px]" />
      <button type="submit" disabled={pending}
        className="min-h-[38px] rounded-lg bg-red-600 px-3 text-[13px] font-semibold text-white
                   hover:bg-red-700 disabled:opacity-60">
        {pending ? 'Revoking…' : 'Confirm'}
      </button>
      <button type="button" onClick={() => setOpen(false)}
        className="min-h-[38px] rounded-lg border border-slate-300 px-3 text-[13px]">
        Cancel
      </button>
    </form>
  );
}
