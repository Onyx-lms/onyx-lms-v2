'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Modal } from '@/components/onyx-modal';
import { ROLE_LABELS } from '@/lib/onyx-nav';
import type { Role } from '@/lib/onyx-session';

/**
 * The institution-admin counterpart to the platform console's own "Create a
 * profile" — same modal, same idea, but there is no institution picker: an
 * administrator creating a profile is always creating it for their own
 * institution, so that question is already answered by which account they
 * are signed in as. POSTs to the same `/api/onyx/members` this institution's
 * People page already uses.
 */
const ROLES: Role[] = ['student', 'faculty', 'exams', 'placement', 'employer', 'guardian', 'admin'];

const field = 'mt-1.5 block min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 '
  + 'text-[14.5px] text-ink transition placeholder:text-muted hover:border-slate-300 '
  + 'focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-ink/20';
const label = 'block text-[13px] font-semibold text-slate-700';

export function OnyxCreateProfileButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-3
                   py-2.5 text-[13.5px] font-bold text-white hover:bg-brand-700"
      >
        Create a profile
      </button>
      {open ? (
        <Modal title="Create a profile" onClose={() => setOpen(false)}>
          <form
            className="space-y-3"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setError(null);
              start(async () => {
                const res = await fetch('/api/proxy/onyx/members', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: String(data.get('name') ?? ''),
                    email: String(data.get('email') ?? ''),
                    role: String(data.get('role') ?? 'student'),
                    password: String(data.get('password') ?? ''),
                  }),
                });
                const body = await res.json().catch(() => ({ ok: false }));
                if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
                setOpen(false);
                router.refresh();
              });
            }}
          >
            {error ? <p role="alert" className="text-[13px] text-rose-700">{error}</p> : null}
            <div>
              <label className={label} htmlFor="ocp-role">Role</label>
              <select id="ocp-role" name="role" defaultValue="student" className={field}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="ocp-name">Name</label>
              <input id="ocp-name" name="name" required maxLength={255} autoComplete="off"
                className={field} />
            </div>
            <div>
              <label className={label} htmlFor="ocp-email">Email</label>
              {/* autoComplete="off": email next to password reads as a login
                  form to the browser otherwise, which offers to fill this
                  create form with the admin's own saved credentials. */}
              <input id="ocp-email" name="email" type="email" required autoComplete="off"
                className={field} />
            </div>
            <div>
              <label className={label} htmlFor="ocp-password">Password</label>
              <input id="ocp-password" name="password" type="password" required minLength={8}
                autoComplete="new-password" className={field} />
            </div>
            <p className="text-[12.5px] text-muted">
              Someone who already has an Onyx account keeps it — they are attached to this
              institution rather than given a second one.
            </p>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={pending}
                className="min-h-[44px] flex-1 rounded-xl bg-brand-600 px-4 text-[14.5px]
                           font-bold text-white hover:bg-brand-700 disabled:opacity-50">
                {pending ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-300 px-4 text-[14.5px]">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
