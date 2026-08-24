'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import { Modal } from '@/components/onyx-modal';
import { ROLE_LABELS } from '@/lib/onyx-nav';
import { DangerPanel } from '@/components/onyx-danger';

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
        <input id="password" name="password" type="password" required
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
              <input id="ct-admin-password" name="admin_password" type="password" required
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
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function openModal() {
    setOpen(true);
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
                    return post('onyx/platform/tenants/' + tenantId + '/members',
                      { name, email, role: type, password });
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
              <input id="cp-password" name="password" type="password" required minLength={8}
                autoComplete="new-password" className={field} />
            </div>
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
              <input id="ga-password" name="password" type="password" minLength={8}
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
export function CourseEditToggle({ tenantId, course }: {
  tenantId: number;
  course: { id: number; title: string; code: string; credits: number; status: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
          <label className={smallLabel} htmlFor={'c-status-' + course.id}>Status</label>
          <select id={'c-status-' + course.id} name="status" defaultValue={course.status}
            className={smallField}>
            <option value={1}>Open</option>
            <option value={0}>Draft</option>
          </select>
        </div>
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
              starts_at: startsRaw ? new Date(startsRaw).toISOString() : null,
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
            defaultValue={exam.starts_at ? exam.starts_at.slice(0, 16) : ''}
            className={smallField} />
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
export function TenantEditForm({ tenant }: {
  tenant: { id: number; name: string; slug: string; plan: string | null };
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
export function CreateAssessmentForm({ tenantId, courses }: {
  tenantId: number; courses: CourseOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={button}>Add an assessment</button>;
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
        <label className={label} htmlFor="cs-duration">Minutes</label>
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

interface SemesterOption { id: number; name: string }

/** Schedule an exam -- needs both a course and a semester, unlike the other
 * creation forms. */
export function CreateExamForm({ tenantId, courses, semesters }: {
  tenantId: number; courses: CourseOption[]; semesters: SemesterOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = courses.length > 0 && semesters.length > 0;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={!ready} className={button}
        title={ready ? undefined : 'Needs at least one course and one semester'}>
        Schedule an exam
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
          const startsRaw = String(data.get('starts_at') ?? '');
          const res = await post('onyx/platform/tenants/' + tenantId + '/exams', {
            title: String(data.get('title') ?? ''),
            course_id: Number(data.get('course_id')),
            semester_id: Number(data.get('semester_id')),
            starts_at: startsRaw ? new Date(startsRaw).toISOString() : '',
            duration_minutes: Number(data.get('duration_minutes') || 180),
            max_marks: Number(data.get('max_marks') || 100),
            pass_marks: Number(data.get('pass_marks') || 40),
          });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
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
        <select id="ce-course" name="course_id" required className={field}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="ce-semester">Semester</label>
        <select id="ce-semester" name="semester_id" required className={field}>
          {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="ce-starts">Starts</label>
        <input id="ce-starts" name="starts_at" type="datetime-local" required className={field} />
      </div>
      <div>
        <label className={label} htmlFor="ce-dur">Minutes</label>
        <input id="ce-dur" name="duration_minutes" type="number" min={5} defaultValue={180}
          className={field} />
      </div>
      <div>
        <label className={label} htmlFor="ce-max">Out of</label>
        <input id="ce-max" name="max_marks" type="number" min={1} defaultValue={100}
          className={field} />
      </div>
      <div>
        <label className={label} htmlFor="ce-pass">Pass mark</label>
        <input id="ce-pass" name="pass_marks" type="number" min={0} defaultValue={40}
          className={field} />
      </div>
      <div className="col-span-full flex gap-2">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Scheduling…' : 'Schedule'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
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
          {new Date(client.created_at).toLocaleDateString(undefined,
            { day: 'numeric', month: 'short', year: 'numeric' })}
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
          {new Date(admin.granted_at).toLocaleDateString(undefined,
            { day: 'numeric', month: 'short', year: 'numeric' })}
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
}

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
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={button}>
        Add a Live Class
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
          const res = await post('onyx/platform/tenants/' + tenantId + '/domains', {
            title: String(data.get('title') ?? ''),
            summary: String(data.get('summary') ?? ''),
            curriculum_url: String(data.get('curriculum_url') ?? ''),
            certificate: String(data.get('certificate') ?? ''),
            duration_label: String(data.get('duration_label') ?? ''),
            price_minor: Math.round(Number(data.get('price_rupees') || 0) * 100),
          });
          if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      {error ? <p role="alert" className="col-span-full text-[13px] text-red-700">{error}</p> : null}
      <div className="sm:col-span-2">
        <label className={label} htmlFor="cd-title">Title</label>
        <input id="cd-title" name="title" required maxLength={200}
          placeholder="Cloud and DevOps — evening cohort" className={field} />
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
      <div className="col-span-full flex gap-2">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Adding…' : 'Add it as a draft'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Publish or withdraw one Live Class, and remove it. */
export function DomainRowActions({ tenantId, domain }: {
  tenantId: number; domain: ConsoleDomain;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const published = domain.status === 1;

  const setStatus = (status: number) => start(async () => {
    setError(null);
    const res = await post('onyx/platform/tenants/' + tenantId + '/domains/' + domain.id,
      { status }, 'PATCH');
    if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
    router.refresh();
  });

  return (
    <div className="flex flex-col items-end gap-1.5">
      {error ? <span role="alert" className="text-[12px] text-red-700">{error}</span> : null}
      <div className="flex justify-end gap-1.5">
        <button type="button" disabled={pending} onClick={() => setStatus(published ? 0 : 1)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold">
          {published ? 'Withdraw' : 'Publish'}
        </button>
        <DangerPanel
          heading="Remove this Live Class"
          confirmWith={domain.title}
          what={'“' + domain.title + '” disappears from every learner’s Live Classes. '
            + 'Anyone already registered keeps their registration record, but the class '
            + 'itself is gone, and this cannot be undone.'}
          cta="Remove it"
          onConfirm={async () => {
            const res = await post(
              'onyx/platform/tenants/' + tenantId + '/domains/' + domain.id, undefined, 'DELETE');
            if (res.ok) router.refresh();
            return res;
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The modules inside a course
// ---------------------------------------------------------------------------

/** Add a module to a course, from the console. */
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
                  {b.name} ({b.question_count} question{b.question_count === 1 ? '' : 's'})
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
