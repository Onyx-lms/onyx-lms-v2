'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/onyx-ui';
import { Modal } from '@/components/onyx-modal';

/**
 * LRN-04 -- saying how the marks are earned.
 *
 * `PUT /assignments/:id/rubric` has existed since the module was written, and
 * the assignment page renders a rubric properly when one is there. Nothing in
 * the product could create one. So a lecturer set an assignment "out of 100"
 * and could never say what the 100 were for, the grader fell back to a single
 * score box for every piece of work in the institution, and the marking
 * criteria the assignment page promised to show were criteria nobody could
 * enter.
 *
 * Two rules from the service are mirrored here rather than left to come back
 * as a 422, because both are arithmetic the person is already doing in their
 * head and getting either wrong means retyping the whole thing:
 *
 *   * the criteria must add up to exactly what the assignment is worth, so
 *     the running total is on screen the whole time and the button says how
 *     far off it is;
 *   * a published assignment's rubric is fixed, because changing the weights
 *     under work already submitted regrades it silently -- so this does not
 *     open at all once the assignment is out, and says why.
 */

const input = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm '
  + 'focus:border-brand-600 focus:outline-none';
const label = 'block text-[13px] font-semibold text-slate-700';

export interface Criterion {
  id?: number;
  title: string;
  description: string | null;
  points: number;
}

export function RubricBuilder({ assignmentId, totalPoints, criteria, published }: {
  assignmentId: number;
  totalPoints: number;
  criteria: Criterion[];
  published: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Criterion[]>(
    criteria.length
      ? criteria.map((c) => ({ ...c }))
      // A sensible opening position rather than a blank sheet: most rubrics
      // are two or three criteria, and an empty form makes the person invent
      // the shape as well as the content.
      : [
        { title: 'Correctness', description: 'Does it do the right thing?',
          points: Math.ceil(totalPoints * 0.6) },
        { title: 'Clarity', description: 'Can somebody else follow it?',
          points: totalPoints - Math.ceil(totalPoints * 0.6) },
      ]);

  const sum = rows.reduce((n, r) => n + (Number(r.points) || 0), 0);
  const off = sum - totalPoints;
  const named = rows.every((r) => r.title.trim());
  const canSave = off === 0 && named && rows.length > 0;

  const edit = (i: number, patch: Partial<Criterion>) =>
    setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, n) => n !== i));
  const add = () => setRows((rs) => [...rs, {
    title: '', description: '',
    // Whatever is left over, so adding a criterion moves the total towards
    // balanced rather than away from it.
    points: Math.max(1, totalPoints - rs.reduce((n, r) => n + (Number(r.points) || 0), 0)),
  }]);

  /** Spread the marks evenly, since "split it equally" is the common case. */
  const balance = () => setRows((rs) => {
    if (!rs.length) return rs;
    const each = Math.floor(totalPoints / rs.length);
    return rs.map((r, i) => ({
      ...r,
      // The remainder goes on the first criterion rather than being lost.
      points: i === 0 ? totalPoints - each * (rs.length - 1) : each,
    }));
  });

  if (published) {
    return (
      <p className="text-[13px] text-muted">
        {criteria.length
          ? 'This assignment is published, so its rubric is fixed — changing the weights '
            + 'under work already handed in would regrade it silently.'
          : 'This assignment was published without a rubric, so it is marked out of '
            + totalPoints + ' as a single score. A rubric can only be set before publishing.'}
      </p>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center gap-2 rounded-xl border border-line px-3
                   py-2 text-[13px] font-semibold hover:bg-brand-50">
        <Icon name="list" className="h-4 w-4" />
        {criteria.length ? 'Edit the marking criteria' : 'Set marking criteria'}
      </button>

      {open ? (
        <Modal title="How the marks are earned" onClose={() => setOpen(false)} wide>
          <p className="mb-3 text-[13px] text-muted">
            This assignment is worth {totalPoints} marks. Say what they are for, and the
            marker gets a box per criterion instead of one number for the whole piece.
          </p>

          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="rounded-xl border border-line bg-canvas p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                  <div>
                    <label className={label} htmlFor={'c-title-' + i}>Criterion</label>
                    <input id={'c-title-' + i} className={input} value={r.title}
                      placeholder="Correctness"
                      onChange={(e) => edit(i, { title: e.target.value })} />
                  </div>
                  <div>
                    <label className={label} htmlFor={'c-points-' + i}>Marks</label>
                    <input id={'c-points-' + i} type="number" min={1} max={totalPoints}
                      className={input} value={r.points}
                      onChange={(e) => edit(i, { points: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="mt-2">
                  <label className={label} htmlFor={'c-desc-' + i}>
                    What earns them <span className="font-normal text-muted">(optional)</span>
                  </label>
                  <input id={'c-desc-' + i} className={input} value={r.description ?? ''}
                    placeholder="Does it do the right thing?"
                    onChange={(e) => edit(i, { description: e.target.value })} />
                  <p className="mt-1 text-xs text-muted">
                    Shown to the learner with their mark, so it is worth writing.
                  </p>
                </div>
                {rows.length > 1 ? (
                  <button type="button" onClick={() => remove(i)}
                    className="mt-2 rounded-lg border border-rose-200 px-2 py-1 text-[12px]
                               font-semibold text-rose-700 hover:bg-rose-50">
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={add}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3
                         py-2 text-[13px] font-semibold">
              <Icon name="plus" className="h-4 w-4" /> Add a criterion
            </button>
            <button type="button" onClick={balance}
              className="rounded-xl border border-line px-3 py-2 text-[13px] font-semibold">
              Split evenly
            </button>
          </div>

          {/* The running total, permanently. The server refuses a rubric that
              does not add up, and finding that out after typing five criteria
              means typing them again. */}
          <p className={'mt-3 rounded-xl px-3 py-2 text-sm font-semibold '
            + (off === 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900')}
            role="status">
            {off === 0
              ? sum + ' of ' + totalPoints + ' marks accounted for.'
              : sum + ' of ' + totalPoints + ' — '
                + (off > 0 ? off + ' too many.' : Math.abs(off) + ' still to allocate.')}
          </p>

          {error ? (
            <p role="alert" className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <button type="button" disabled={pending || !canSave}
              onClick={() => start(async () => {
                setError(null);
                const res = await fetch('/api/proxy/onyx/assignments/' + assignmentId + '/rubric', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    criteria: rows.map((r) => ({
                      title: r.title.trim(),
                      description: r.description?.trim() || null,
                      points: Number(r.points),
                    })),
                  }),
                });
                const body = await res.json().catch(() => ({ ok: false }));
                if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
                setOpen(false);
                router.refresh();
              })}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white
                         hover:bg-brand-700 disabled:opacity-50">
              {pending ? 'Saving…' : 'Save the criteria'}
            </button>
            <button type="button" onClick={() => setOpen(false)}
              className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">
              Cancel
            </button>
            {!canSave && !named ? (
              <span className="self-center text-[12.5px] text-muted">
                Every criterion needs a name.
              </span>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
