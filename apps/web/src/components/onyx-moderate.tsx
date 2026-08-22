'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/onyx-ui';
import { Modal } from '@/components/onyx-modal';

/**
 * CMP-02c -- a moderation pass across a whole paper.
 *
 * The API has had this since the examinations service was written and there
 * was no way to reach it from a browser: `POST /api/onyx/exams/:id/moderate`,
 * guarded by `exams.moderate`, applying a delta to every unpublished mark and
 * recording who decided it and why. The exam page offered Edit, Seat, Mark and
 * Publish, and the one step between marking and publishing was missing -- so a
 * board that agreed a paper had been marked two points harsh had to either
 * publish it anyway or edit scripts one at a time.
 *
 * Three things this deliberately does not do, each of which was a tempting
 * shortcut:
 *
 * **It does not overwrite the raw mark.** The delta is stored beside it, so
 * afterwards the board's decision and the marker's judgement stay separable.
 * A moderated mark is clamped to the paper's range on the way out -- +10 on a
 * 95 is 100, not 105 -- and the service does that, not this.
 *
 * **It does not let the reason be optional.** The API refuses a blank one with
 * a 422, and it is right to: a moderation with no recorded reason is a change
 * to somebody's grade that nobody can account for later. The form requires it
 * for the same reason rather than letting the server say no.
 *
 * **It does not touch published marks.** The service filters them out, so a
 * paper already released cannot be quietly re-graded underneath the people who
 * have seen it. The panel says so before anybody presses anything.
 */
export function ModerateMarks({ examId, maxMarks, unpublished, moderated }: {
  examId: number;
  maxMarks: number;
  /** How many marks this would actually move. Zero means there is nothing to do. */
  unpublished: number;
  /** How many already carry a delta, so a second pass is visibly a second pass. */
  moderated: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const value = Number(delta);
  const valid = delta.trim() !== '' && Number.isFinite(value)
    && value >= -100 && value <= 100 && value !== 0 && reason.trim().length > 0;

  const apply = () => start(async () => {
    setError(null);
    const res = await fetch('/api/proxy/onyx/exams/' + examId + '/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: value, reason: reason.trim() }),
    });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!body.ok) { setError(body.message ?? 'That did not go through.'); return; }
    setOpen(false);
    setDelta('');
    setReason('');
    router.refresh();
  });

  // Nothing unpublished means the service would 422. Saying so on a disabled
  // button beats letting somebody fill a form in and be refused at the end.
  if (!unpublished) {
    return (
      <span className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl border
                       border-line px-3.5 text-[13px] font-semibold text-muted">
        <Icon name="chart" className="h-4 w-4" />
        Nothing left to moderate
      </span>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl border
                   border-line px-3.5 text-[13px] font-bold text-slate-700
                   hover:bg-brand-50">
        <Icon name="chart" className="h-4 w-4" />
        Moderate
      </button>

      {open ? (
        <Modal title="Moderate this paper" onClose={() => setOpen(false)}>
          {/* A real <form>, not a div with a button on it. Two fields and a
              submit is a form, so Enter should send it -- and the panel is
              reachable to anything that looks for named fields inside one,
              which is how every other create panel in this product behaves. */}
          <form className="space-y-3.5"
            onSubmit={(e) => { e.preventDefault(); if (valid) apply(); }}>
            <p className="text-[13.5px] leading-relaxed text-muted">
              This shifts every unpublished mark on the paper by the same amount —{' '}
              <span className="font-bold text-ink">
                {unpublished} {unpublished === 1 ? 'script' : 'scripts'}
              </span>
              . Marks already published are left alone.
            </p>

            {moderated ? (
              <p className="rounded-xl bg-accent-50 px-3 py-2.5 text-[12.5px] leading-relaxed
                            text-accent-700">
                {moderated} {moderated === 1 ? 'mark has' : 'marks have'} been moderated
                already. A second pass replaces that adjustment rather than adding to it.
              </p>
            ) : null}

            <div>
              <label htmlFor="mod-delta"
                className="block text-[13px] font-semibold text-slate-700">
                Adjustment
              </label>
              <input
                id="mod-delta" name="delta" type="number" min={-100} max={100} step="0.5"
                value={delta} onChange={(e) => setDelta(e.target.value)}
                placeholder="2 to raise, -2 to lower"
                className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2
                           text-[13px] focus:border-brand-600 focus:outline-none"
              />
              <p className="mt-1 text-[12px] text-muted">
                Added to the raw mark. The raw mark is kept — nothing is overwritten — and
                the result is capped at 0 and {maxMarks}.
              </p>
            </div>

            <div>
              <label htmlFor="mod-reason"
                className="block text-[13px] font-semibold text-slate-700">
                Why
              </label>
              <textarea
                id="mod-reason" name="reason" rows={3} maxLength={500}
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Question 4 was ambiguous; the board agreed two marks back."
                className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2
                           text-[13px] leading-relaxed focus:border-brand-600
                           focus:outline-none"
              />
              {/* Required, and said as a reason rather than as a rule. */}
              <p className="mt-1 text-[12px] text-muted">
                Recorded in the audit log against your name. A grade change nobody can
                account for later is the thing this prevents.
              </p>
            </div>

            {error ? (
              <p role="alert" className="text-[13px] text-red-700">{error}</p>
            ) : null}

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={pending || !valid}
                className="min-h-[46px] flex-1 rounded-xl bg-brand-600 px-4 text-sm font-bold
                           text-white hover:bg-brand-700 disabled:opacity-50">
                {pending ? 'Applying…' : 'Apply to ' + unpublished
                  + (unpublished === 1 ? ' script' : ' scripts')}
              </button>
              <button type="button" onClick={() => setOpen(false)} disabled={pending}
                className="min-h-[46px] rounded-xl border border-line px-4 text-sm font-semibold">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
