'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useState, useTransition } from 'react';
import { ROLE_LABELS } from '@/lib/onyx-nav';
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

export function OnyxPeople({ members, canEdit, initialRole }: {
  members: Member[]; canEdit: boolean; initialRole?: Role;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>(initialRole ?? '');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const call = (path: string, init: RequestInit, success: string) => {
    setNotice(null);
    start(async () => {
      const res = await fetch('/api/proxy/onyx/' + path, init);
      const body = await res.json().catch(() => ({}));
      if (!body.ok) {
        setNotice({ tone: 'bad', text: body.message ?? 'That did not work.' });
        return;
      }
      setNotice({ tone: 'ok', text: success });
      router.refresh();
    });
  };

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

      {canEdit ? (
        <form
          className="grid gap-3 rounded-2xl border border-line p-4 sm:grid-cols-5"
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
                role: String(data.get('role') ?? 'student'),
                password: String(data.get('password') ?? '') || undefined,
              }),
            }, 'Added.');
            form.reset();
          }}
        >
          <input name="name" required placeholder="Name" className={field} />
          <input name="email" type="email" required placeholder="Email address" className={field} />
          <select name="role" defaultValue="student" aria-label="Role" className={field}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <input name="password" type="password" minLength={8}
            placeholder="Temporary password" className={field} />
          <button type="submit" disabled={pending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white
                       hover:bg-brand-700 disabled:opacity-50">
            Add
          </button>
          <p className="text-xs text-muted sm:col-span-5">
            Someone who already has an Onyx account keeps it &mdash; they are attached to this
            institution rather than given a second one.
          </p>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-2.5">
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
      </div>

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
                        onChange={(e) => call('members/' + m.id, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ role: e.target.value }),
                        }, 'Role updated.')}
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
                  {canEdit ? (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                          className="text-sm font-medium text-brand-700 hover:underline"
                        >
                          {editingId === m.id ? 'Close' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => call('members/' + m.id, { method: 'DELETE' }, 'Removed.')}
                          // rose-600 is 4.7:1 on white and would pass on its own,
                          // but `disabled:opacity-50` halves it to ~2.4:1 while
                          // the control is still rendered. A dimmed colour token
                          // says "disabled" without taking the text below AA.
                          className="text-sm font-medium text-rose-700 hover:underline
                                     disabled:text-muted disabled:no-underline"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
                {canEdit && editingId === m.id ? (
                  <tr key={m.id + '-edit'}>
                    <td colSpan={5} className="bg-slate-50 px-4 py-3.5">
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
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="px-4 py-8 text-center text-muted">
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
