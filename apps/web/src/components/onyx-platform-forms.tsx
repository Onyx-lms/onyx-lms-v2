'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Modal } from '@/components/onyx-modal';
import { ROLE_LABELS } from '@/lib/onyx-nav';

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
  return res.json().catch(() => ({ ok: false, message: 'Something went wrong.' }));
}

export function PlatformLoginForm() {
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
          router.push('/onyx/platform');
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
      <button type="submit" disabled={pending} className={button + ' w-full'}>
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

/**
 * The one shape every destructive action in this console now wears.
 *
 * The console used to put its red buttons on list rows -- Remove beside every
 * member, Delete beside every course, Revoke beside every operator -- so the
 * fastest thing to reach on a screen full of records was the one action that
 * cannot be undone. Worse, the tenant layout's danger zone rendered under
 * EVERY institution tab, which meant "Delete institution" was on the bottom of
 * the fees page, the timetable, the grade book: nine chances to end a customer
 * while doing something else entirely.
 *
 * The rule now, taken from the operator consoles that get this right (Toggl's
 * admin console keeps "Organization actions" as one isolated block at the foot
 * of one page; Google Workspace and Docusign both bury account deletion a
 * level in behind the record itself):
 *
 *   1. A destructive control never appears on a list row.
 *   2. It appears once you have OPENED the specific record it destroys.
 *   3. When it appears, it is at the bottom, in its own bordered block, under
 *      a plain sentence naming what will actually be lost.
 *
 * `confirmWith` adds the type-the-name step, for the cases where losing the
 * record loses a lot with it.
 */
export function DangerPanel({ heading, what, cta, confirmWith, onConfirm, note }: {
  heading: string;
  /** Plain prose: what disappears, and whether it comes back. */
  what: React.ReactNode;
  cta: string;
  confirmWith?: string;
  note?: string;
  onConfirm: () => Promise<{ ok?: boolean; message?: string }>;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mt-5 rounded-xl border border-red-200 bg-red-50/40 p-3.5">
      <h3 className="text-[11px] font-bold uppercase tracking-[.08em] text-red-800">{heading}</h3>
      <p className="mt-1 max-w-prose text-[12.5px] leading-relaxed text-muted">{what}</p>

      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="mt-2.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-[12.5px]
                     font-semibold text-red-700 hover:border-red-500 hover:bg-red-50">
          {cta}
        </button>
      ) : (
        <div className="mt-2.5 space-y-2">
          {confirmWith ? (
            <>
              <label className="block text-[12px] font-semibold text-red-800"
                htmlFor={inputId}>
                Type <span className="font-mono">{confirmWith}</span> to confirm
              </label>
              <input id={inputId} value={confirm}
                onChange={(e) => setConfirm(e.target.value)} placeholder={confirmWith}
                className="block min-h-[38px] w-full max-w-sm rounded-lg border border-red-300
                           bg-white px-2.5 text-[13.5px] focus:border-red-500 focus:outline-none
                           focus:ring-2 focus:ring-red-200" />
            </>
          ) : null}
          {note ? <p className="text-[12px] text-muted">{note}</p> : null}
          {error ? <p role="alert" className="text-[12.5px] text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || (confirmWith ? confirm !== confirmWith : false)}
              onClick={() => start(async () => {
                setError(null);
                const res = await onConfirm();
                if (!res.ok) { setError(res.message ?? 'That did not work.'); return; }
              })}
              className="rounded-lg bg-red-600 px-3.5 py-2 text-[12.5px] font-bold text-white
                         hover:bg-red-700 disabled:opacity-40"
            >
              {pending ? 'Working…' : cta}
            </button>
            <button type="button"
              onClick={() => { setOpen(false); setConfirm(''); setError(null); }}
              className={cancelButton}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
