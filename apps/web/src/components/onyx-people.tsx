'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useState, useTransition } from 'react';
import { ROLE_LABELS } from '@/lib/onyx-nav';
import { Modal } from '@/components/onyx-modal';
import { Icon } from '@/components/onyx-ui';
import { DangerPanel } from '@/components/onyx-danger';
import type { Role } from '@/lib/onyx-session';

/**
 * F-04 / F-06 -- the roster of one institution.
 *
 * Read-only for faculty, editable by an administrator. Both go through the same
 * API, which enforces the same thing again; hiding the controls only avoids
 * offering an action that would be refused.
 */
export interface Member {
  id: number;
  role: Role;
  status: number;
  tenant_id: number;
  /** This institution's own number for them. Null where it does not use them. */
  roll_number: string | null;
  user: { id: number; name: string; email: string; phone: string | null; status: number } | null;
}

// Guardian belongs here too: CMP-04 gives a parent their own account, and
// leaving the role out of this list meant an administrator could link a
// guardian to a student but never create one to link.
const ROLES: Role[] = [
  'student', 'faculty', 'exams', 'placement', 'employer', 'guardian', 'admin',
];

const field = 'rounded-lg border border-slate-300 px-3 py-2 text-sm '
  + 'focus:border-slate-900 focus:outline-none';

/** A field with a real label above it, and room for a line of guidance. */
function Labelled({ label, htmlFor, hint, wide, children }: {
  label: string; htmlFor: string; hint?: string; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-slate-700">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * What each role is called on a button that adds one. ROLE_LABELS names the
 * role ("Examinations"); this names the person ("an examinations officer"),
 * because "Add Examinations" reads as a section, not as a person.
 */
const NOUN: Record<Role, string> = {
  student: 'a student',
  faculty: 'a faculty member',
  exams: 'an examinations officer',
  placement: 'a placement officer',
  employer: 'an employer contact',
  guardian: 'a parent or guardian',
  admin: 'an administrator',
};

export function OnyxPeople({ members, canEdit, initialRole, tenantName }: {
  members: Member[]; canEdit: boolean; initialRole?: Role;
  /** Named in the remove panel, so the consequence is not stated in the abstract. */
  tenantName: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>(initialRole ?? '');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();

  const call = (path: string, init: RequestInit, success: string, done?: () => void) => {
    setNotice(null);
    start(async () => {
      const res = await fetch('/api/proxy/onyx/' + path, init);
      const body = await res.json().catch(() => ({}));
      if (!body.ok) {
        setNotice({ tone: 'bad', text: body.message ?? 'That did not work.' });
        return;
      }
      setNotice({ tone: 'ok', text: success });
      done?.();
      router.refresh();
    });
  };

  /**
   * What the button offers to add, and what the panel then creates.
   *
   * The Students and Faculty nav links land here with the filter already set,
   * so the roster in front of somebody who clicked "Students" is students --
   * and asking them to answer "which role?" again, in a menu of seven, is
   * asking a question they have already answered. Where the filter settles it,
   * the panel does not ask; on the unfiltered roster it still does, because
   * there the question is real.
   */
  const addRole: Role | null = roleFilter || null;
  const addLabel = addRole ? 'Add ' + NOUN[addRole] : 'Add someone';

  // Modal puts the cursor in its own first field on mount and traps Tab inside
  // it, so there is nothing to do here beyond opening it -- the rAF focus call
  // this used to make raced the modal's and sometimes lost.
  const openAdd = () => setAdding(true);

  const needle = search.trim().toLowerCase();
  const byRole = roleFilter ? members.filter((m) => m.role === roleFilter) : members;
  const shown = needle
    ? byRole.filter((m) =>
      (m.user?.name ?? '').toLowerCase().includes(needle)
      || (m.user?.email ?? '').toLowerCase().includes(needle))
    : byRole;

  return (
    <div className="space-y-6">
      {notice ? (
        <p
          role="status"
          className={'rounded-lg px-3 py-2 text-sm '
            + (notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}
        >
          {notice.text}
        </p>
      ) : null}

      {/* Find on the left, add on the right, both directly above the table
          they act on. The add form used to sit here permanently open -- six
          empty boxes and a role menu between the page title and the roster,
          on every visit, for the one visit in ten that is about adding
          somebody. Reading the roster is the common act, so the roster is what
          the screen leads with. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search people"
          className={field + ' w-full sm:max-w-xs'}
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as Role | '')}
          aria-label="Filter by role"
          className={field}
        >
          <option value="">Every role</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        {canEdit ? (
          <button
            type="button"
            onClick={openAdd}
            title={addLabel}
            className="ml-auto inline-flex min-h-[38px] items-center gap-1.5 rounded-lg
                       bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white
                       hover:bg-brand-700"
          >
            <Icon name="plus" className="h-4 w-4" aria-hidden="true" />
            {/* The words are the button on anything wider than a phone; below
                that the plus carries it alone and `title`/`aria-label` say what
                it does. A bare icon is not a label. */}
            <span className="hidden sm:inline">{addLabel}</span>
            <span className="sr-only sm:hidden">{addLabel}</span>
          </button>
        ) : null}
      </div>

      {canEdit && adding ? (
        <Modal title={addLabel} onClose={() => setAdding(false)} wide>
        <form
          id="add-a-member"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            call('members', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: String(data.get('name') ?? ''),
                email: String(data.get('email') ?? ''),
                // The filter decides the role where there is one, so what the
                // button promised is what gets created -- there is no menu left
                // to knock off "Student" by accident on the Students roster.
                role: addRole ?? String(data.get('role') ?? 'student'),
                password: String(data.get('password') ?? '') || undefined,
                roll_number: String(data.get('roll_number') ?? '') || null,
              }),
            }, 'Added.', () => setAdding(false));
            form.reset();
          }}
        >
          {/* Real labels, not placeholders: a placeholder disappears at the
              first keystroke, and a screen reader announces an unnamed box --
              on the form that creates somebody a login. */}
          {/* The role picker appears only where the role is still an open
              question. Reached from Students or Faculty, the filter has
              already answered it and the modal is titled with the answer. */}
          {addRole ? null : (
            <Labelled label="Role" htmlFor="ap-role" wide>
              <select id="ap-role" name="role" defaultValue="student" className={field + ' w-full'}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Labelled>
          )}
          <Labelled label="Full name" htmlFor="ap-name">
            <input id="ap-name" name="name" required autoComplete="off"
              className={field + ' w-full'} />
          </Labelled>
          <Labelled label="Email address" htmlFor="ap-email">
            {/* autoComplete off: an email beside a password reads as a sign-in
                form to the browser, which then offers to fill this create form
                with the administrator's own saved credentials. */}
            <input id="ap-email" name="email" type="email" required autoComplete="off"
              className={field + ' w-full'} />
          </Labelled>
          {/* The institution's own number for this person. Everybody gets one,
              not only students -- a staff ID is the same idea, and the
              examinations office and the registry both work from it. */}
          <Labelled label="Roll number or staff ID" htmlFor="ap-roll" hint="Optional.">
            <input id="ap-roll" name="roll_number" maxLength={40} autoComplete="off"
              className={field + ' w-full'} />
          </Labelled>
          <Labelled label="Temporary password" htmlFor="ap-password"
            hint="Leave blank and they set their own on first sign-in.">
            <input id="ap-password" name="password" type="password" minLength={8}
              autoComplete="new-password" className={field + ' w-full'} />
          </Labelled>
          <p className="text-xs leading-relaxed text-muted sm:col-span-2">
            Someone who already has an Onyx account keeps it &mdash; they are attached to this
            institution rather than given a second one.
          </p>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={pending}
              className="min-h-[42px] rounded-lg bg-brand-600 px-4 text-sm font-semibold
                         text-white hover:bg-brand-700 disabled:opacity-50">
              {pending ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => setAdding(false)}
              className="min-h-[42px] rounded-lg border border-slate-300 px-4 text-sm
                         font-semibold hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </form>
        </Modal>
      ) : null}

      {/* On a phone the email column is dropped rather than scrolled. A
          horizontally-scrolling table is a poor way to read a roster on a
          390px screen, and the four columns together were 80px wider than
          the viewport -- which scrolled the whole page sideways. The name
          already identifies the person; the address is shown underneath it
          instead, where it costs no width.
          tabIndex/role keep the scroll reachable by keyboard on the widths
          that still need it. */}
      {/* `relative` is load-bearing: the sr-only caption and the sr-only
          "Actions" header are absolutely positioned, and without a positioned
          ancestor they resolve against the initial containing block, land at
          the wide table's far-right coordinate in document space, and drag
          page scroll width past the viewport at 320px while staying invisible. */}
      <div className="relative min-w-0 max-w-full overflow-x-auto rounded-2xl border border-line
                      bg-white shadow-card"
        tabIndex={0} role="region" aria-label="Members of this institution">
        <table className="w-full text-sm">
          <caption className="sr-only">Everyone at this institution</caption>
          <thead>
            <tr className="border-b border-line bg-slate-50 text-left text-[11px] uppercase
                           tracking-[.06em] text-muted [&>th]:whitespace-nowrap [&>th]:px-4
                           [&>th]:py-2.5 [&>th]:font-bold">
              <th scope="col">Name</th>
              <th scope="col">Roll / staff no.</th>
              <th scope="col" className="hidden sm:table-cell">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Account</th>
              {canEdit ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((m) => (
              <Fragment key={m.id}>
                <tr className="hover:bg-brand-50/40">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2.5">
                      {/* Initials, so a roster of forty reads as people rather
                          than as forty lines of text. Decorative -- the name is
                          right beside it, so a screen reader skips this. */}
                      <span aria-hidden="true"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full
                                   bg-gradient-to-br from-brand-500 to-brand-700 text-[11px]
                                   font-bold text-white">
                        {(m.user?.name ?? m.user?.email ?? '?').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {m.user?.name ?? '—'}
                        </span>
                        {/* The address, folded under the name on a phone only. */}
                        <span className="block truncate text-xs text-muted sm:hidden">
                          {m.user?.email ?? ''}
                        </span>
                      </span>
                    </span>
                  </td>
                  {/* Editable in place, because this is the field an
                      administrator corrects one row at a time off a paper
                      register -- opening an edit panel for each would make a
                      roster of forty a morning's work. Saved on blur, not on
                      every keystroke. */}
                  <td className="px-4 py-3">
                    {canEdit ? (
                      <input
                        aria-label={'Roll number for ' + (m.user?.name ?? 'this member')}
                        defaultValue={m.roll_number ?? ''}
                        maxLength={40}
                        placeholder="—"
                        disabled={pending}
                        className={field + ' w-32 font-mono text-[13px]'}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next === (m.roll_number ?? '')) return;
                          call('members/' + m.id, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ roll_number: next || null }),
                          }, next ? 'Roll number set.' : 'Roll number cleared.');
                        }}
                      />
                    ) : (
                      <span className="font-mono text-[13px]">{m.roll_number ?? '—'}</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-muted sm:table-cell">
                    {m.user?.email ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {canEdit ? (
                      <select
                        aria-label={'Role for ' + (m.user?.name ?? 'this member')}
                        defaultValue={m.role}
                        disabled={pending}
                        className={field}
                        onChange={(e) => {
                          // Changing a role changes what somebody can reach the
                          // instant the select fires. Worth a sentence first.
                          const to = e.target.value as Role;
                          if (!window.confirm('Make ' + (m.user?.name ?? 'this member') + ' a '
                            + (ROLE_LABELS[to] ?? to) + '? It changes what they can see now.')) {
                            e.target.value = m.role;
                            return;
                          }
                          call('members/' + m.id, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ role: to }),
                          }, 'Role updated.');
                        }}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    ) : ROLE_LABELS[m.role]}
                  </td>
                  <td className="px-4 py-3">
                    <span className={'inline-flex items-center gap-1.5 text-[12.5px] font-semibold '
                      + (m.user?.status === 1 ? 'text-emerald-700' : 'text-rose-700')}>
                      <span aria-hidden="true" className={'h-1.5 w-1.5 rounded-full '
                        + (m.user?.status === 1 ? 'bg-emerald-600' : 'bg-rose-600')} />
                      {m.user?.status === 1 ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  {/* Edit, and only Edit. "Remove" used to sit here in red on
                      every row -- forty near-identical lines, and the one
                      irreversible act among them was the easiest thing on the
                      screen to hit. It is at the foot of this person's own
                      edit panel now, which is the only place an administrator
                      can be certain which of the forty they are ending. Same
                      rule the platform console was put on. */}
                  {canEdit ? (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        {editingId === m.id ? 'Close' : 'Edit'}
                      </button>
                    </td>
                  ) : null}
                </tr>
                {canEdit && editingId === m.id ? (
                  <tr key={m.id + '-edit'}>
                    {/* Six columns, not five: Name, Roll, Email, Role, Account and the
                        actions cell. This row only renders when canEdit is true,
                        which is exactly when that sixth column exists -- the
                        panel had been stopping one column short of the table
                        ever since the actions cell was added. */}
                    <td colSpan={6} className="bg-slate-50 px-4 py-3.5">
                      <form
                        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          call('members/' + m.id, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              name: String(data.get('name') ?? ''),
                              email: String(data.get('email') ?? ''),
                              phone: String(data.get('phone') ?? '') || null,
                              account_status: Number(data.get('account_status')),
                            }),
                          }, 'Updated.');
                          setEditingId(null);
                        }}
                      >
                        <div>
                          <label className="block text-xs font-semibold text-slate-700"
                            htmlFor={'pe-name-' + m.id}>
                            Name
                          </label>
                          <input id={'pe-name-' + m.id} name="name" defaultValue={m.user?.name}
                            required maxLength={255} className={field + ' mt-1 w-full'} />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700"
                            htmlFor={'pe-email-' + m.id}>
                            Email
                          </label>
                          <input id={'pe-email-' + m.id} name="email" type="email"
                            defaultValue={m.user?.email} required
                            className={field + ' mt-1 w-full'} />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700"
                            htmlFor={'pe-phone-' + m.id}>
                            Phone
                          </label>
                          <input id={'pe-phone-' + m.id} name="phone"
                            defaultValue={m.user?.phone ?? ''} className={field + ' mt-1 w-full'} />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700"
                            htmlFor={'pe-status-' + m.id}>
                            Account
                          </label>
                          <select id={'pe-status-' + m.id} name="account_status"
                            defaultValue={m.user?.status ?? 1} className={field + ' mt-1 w-full'}>
                            <option value={1}>Active</option>
                            <option value={0}>Disabled</option>
                          </select>
                        </div>
                        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
                          <button type="submit" disabled={pending}
                            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium
                                       text-white hover:bg-brand-700 disabled:opacity-50">
                            {pending ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" onClick={() => setEditingId(null)}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
                            Cancel
                          </button>
                        </div>
                      </form>

                      {/* The one irreversible act on this screen, at the foot
                          of the panel for the one person it acts on, naming
                          them and naming the reversible alternative above it. */}
                      <DangerPanel
                        heading="Remove from this institution"
                        what={<>
                          {m.user?.name ?? 'This member'} loses access to {tenantName} and drops
                          off its rosters. Their marks, submissions and invoices stay on record.
                          To stop them signing in without removing them, set Account to
                          {' '}<em>Disabled</em> above instead.
                        </>}
                        cta="Remove member"
                        onConfirm={async () => {
                          const res = await fetch('/api/proxy/onyx/members/' + m.id,
                            { method: 'DELETE' });
                          const body = await res.json().catch(() => ({ ok: false }));
                          if (body.ok) {
                            setEditingId(null);
                            setNotice({ tone: 'ok', text: 'Removed.' });
                            router.refresh();
                          }
                          return body;
                        }}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="px-4 py-8 text-center text-muted">
                  {members.length === 0 ? 'Nobody here yet.' : 'Nobody matches that.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
