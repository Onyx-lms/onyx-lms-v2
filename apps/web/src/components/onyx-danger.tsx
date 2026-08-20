'use client';

import { useId, useState, useTransition } from 'react';

const cancelButton = 'rounded-lg border border-slate-300 px-3 py-1.5 text-[12.5px] '
  + 'font-semibold hover:bg-slate-50';

/**
 * The one shape every destructive action in this product wears.
 *
 * Lives in its own module because both consoles use it: the platform console
 * (institutions, courses, operators, OAuth clients) and, since the same review
 * was applied to it, an institution administrator's own roster.
 *
 * The consoles used to put red buttons on list rows -- Remove beside every
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
