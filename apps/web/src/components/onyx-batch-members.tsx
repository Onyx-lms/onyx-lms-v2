'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/onyx-ui';
import { Modal } from '@/components/onyx-modal';

/**
 * CMP-01 -- who is in a cohort.
 *
 * `POST /api/onyx/batches/:id/members` has existed since batches did, and
 * nothing in the product ever called it. A batch could be created and then
 * never filled, which made three things quietly impossible:
 *
 *   * **Bulk enrolment.** `enrollBatch` enrols a cohort onto a course in one
 *     act, and refuses an empty one -- so every enrolment had to be done a
 *     person at a time, which is exactly where mistakes live.
 *   * **Scheduling a class.** The timetable refuses a slot for a batch with
 *     nobody in it, in as many words, and there was no way to act on what it
 *     asked for.
 *   * **The education section of a resume**, which derives from batch ->
 *     programme. Every learner's read as though they were reading for nothing.
 *
 * A checkbox list rather than one-at-a-time, because a cohort is added as a
 * cohort: the route takes `user_ids` as an array and admitting a batch of
 * forty by making forty requests would be a worse version of the problem this
 * exists to solve.
 */

export interface BatchCandidate {
  id: string;
  name: string;
  email: string;
}

export function BatchMembers({ batchId, batchName, members, candidates }: {
  batchId: number;
  batchName: string;
  /** Ids already in the batch. They are shown ticked and cannot be removed here. */
  members: string[];
  /** Every student at this institution. */
  candidates: BatchCandidate[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const inBatch = new Set(members);
  const remaining = candidates.filter((c) => !inBatch.has(c.id));

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const add = () => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/batches/' + batchId + '/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_ids: picked }),
    });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
    setOpen(false);
    setPicked([]);
    router.refresh();
  });

  return (
    <>
      <button
        type="button"
        onClick={() => { setPicked([]); setError(null); setOpen(true); }}
        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border
                   border-line px-3 text-[12.5px] font-semibold text-slate-700
                   hover:bg-brand-50"
      >
        <Icon name="users" className="h-[15px] w-[15px]" />
        {members.length
          ? members.length + (members.length === 1 ? ' member' : ' members')
          : 'Add members'}
      </button>

      {open ? (
        <Modal title={'Who is in ' + batchName} onClose={() => setOpen(false)}>
          <div className="space-y-3.5">
            {members.length ? (
              <p className="text-[13px] text-muted">
                {members.length} already in this batch. Tick anybody else who belongs in it.
              </p>
            ) : (
              <p className="text-[13px] text-muted">
                Nobody is in this batch yet. A cohort has to have members before it can be
                enrolled onto a course or given a class on the timetable.
              </p>
            )}

            {remaining.length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[12.5px] text-muted">
                {candidates.length === 0
                  ? 'There are no students at this institution yet.'
                  : 'Every student here is already in this batch.'}
              </p>
            ) : (
              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border
                              border-line p-2.5">
                {remaining.map((c) => (
                  <label key={c.id}
                    className="flex items-start gap-2 text-[13px] leading-snug text-ink">
                    <input
                      type="checkbox"
                      checked={picked.includes(c.id)}
                      onChange={() => toggle(c.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line
                                 text-brand-600 focus:ring-brand-600"
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">{c.name}</span>
                      <span className="block truncate text-[12px] text-muted">{c.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {error ? (
              <p role="alert" className="text-[13px] text-red-700">{error}</p>
            ) : null}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={add} disabled={pending || picked.length === 0}
                className="min-h-[46px] flex-1 rounded-xl bg-brand-600 px-4 text-sm font-bold
                           text-white hover:bg-brand-700 disabled:opacity-50">
                {pending ? 'Adding…'
                  : picked.length
                    ? 'Add ' + picked.length + (picked.length === 1 ? ' person' : ' people')
                    : 'Add'}
              </button>
              <button type="button" onClick={() => setOpen(false)} disabled={pending}
                className="min-h-[46px] rounded-xl border border-line px-4 text-sm font-semibold">
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
