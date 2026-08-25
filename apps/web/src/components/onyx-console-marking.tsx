'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SectionHead } from '@/components/onyx-ui';

/**
 * Awarding marks from the console, question by question.
 *
 * The console could already correct an attempt's TOTAL, which is the right
 * tool for fixing a figure and the wrong one for marking. A page, an essay, or
 * a coding answer the sandbox misjudged is marked per question with a reason
 * against it, and the total is then derived — typing "17" over somebody's
 * paper says nothing about which question earned what, and a candidate
 * querying it has nothing to be shown.
 *
 * It posts to the same service call a lecturer's marking screen makes, so what
 * follows is identical: the marks recompute, the attempt releases, and the
 * candidate sees the corrected figure. There is no second marking rule for
 * operators.
 *
 * Only the questions somebody actually has to judge are worth typing into, but
 * all of them are offered: a marker who disagrees with an auto-scored answer
 * is exactly the person this exists for, and hiding those rows would mean the
 * one correction that matters most is the one you cannot make.
 */
export function ConsoleMarkPanel({ tenantId, attemptId, questions }: {
  tenantId: number;
  attemptId: number;
  questions: { question_id: number; prompt: string; points: number; awarded: number | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<Record<number, string>>(
    () => Object.fromEntries(questions.map((q) => [
      q.question_id, q.awarded === null ? '' : String(q.awarded),
    ])));
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => start(async () => {
    setError(null);
    setDone(null);
    const given = questions
      .filter((q) => String(marks[q.question_id] ?? '').trim() !== '')
      .map((q) => ({
        question_id: q.question_id,
        points: Number(marks[q.question_id]),
        comment: (notes[q.question_id] ?? '').trim() || null,
      }));
    if (!given.length) { setError('Put a mark against at least one question.'); return; }
    const over = given.find((m) => {
      const q = questions.find((x) => x.question_id === m.question_id)!;
      return !Number.isFinite(m.points) || m.points < 0 || m.points > q.points;
    });
    if (over) {
      const q = questions.find((x) => x.question_id === over.question_id)!;
      setError('That question is out of ' + q.points + '.');
      return;
    }

    const res = await fetch('/api/proxy/onyx/platform/tenants/' + tenantId
      + '/attempts/' + attemptId + '/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marks: given }),
    });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
    setDone('Marked. The candidate sees the new figure.');
    router.refresh();
  });

  if (!questions.length) return null;

  if (!open) {
    return (
      <div className="mb-4">
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border
                     border-slate-300 bg-white px-3 text-[13px] font-semibold
                     hover:bg-brand-50">
          Mark this attempt
        </button>
        {done ? (
          <p className="mt-2 text-[12.5px] font-semibold text-emerald-800">{done}</p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="mb-5">
      <SectionHead title="Marking" />
      <div className="rounded-2xl border border-line bg-white p-4">
        <p className="mb-3 max-w-2xl text-[12.5px] leading-relaxed text-muted">
          Award each question out of its own total. Anything left blank is left as it is —
          so correcting one question does not disturb the rest. A comment is shown to the
          candidate beside that question.
        </p>
        {error ? <p role="alert" className="mb-2 text-[13px] text-red-700">{error}</p> : null}

        <ol className="space-y-3">
          {questions.map((q, i) => (
            <li key={q.question_id} className="rounded-xl border border-line bg-slate-50/60 p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[12px] font-bold text-muted">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1 text-[13px] text-ink">
                  {q.prompt.slice(0, 110)}{q.prompt.length > 110 ? '…' : ''}
                </span>
                <label className="flex items-center gap-1.5">
                  <span className="sr-only">Marks for question {i + 1}</span>
                  <input type="number" min={0} max={q.points} step="0.5"
                    value={marks[q.question_id] ?? ''}
                    onChange={(e) => setMarks((m) => ({ ...m, [q.question_id]: e.target.value }))}
                    className="w-20 rounded-lg border border-line bg-white px-2 py-1
                               text-right text-[13px] tabular-nums" />
                  <span className="text-[12.5px] text-muted">/ {q.points}</span>
                </label>
              </div>
              <input
                value={notes[q.question_id] ?? ''}
                onChange={(e) => setNotes((n) => ({ ...n, [q.question_id]: e.target.value }))}
                placeholder="Why (shown to the candidate)"
                className="mt-2 w-full rounded-lg border border-line bg-white px-2.5 py-1.5
                           text-[12.5px]" />
            </li>
          ))}
        </ol>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={save}
            className="rounded-xl bg-brand-600 px-4 py-2 text-[13.5px] font-bold text-white
                       hover:bg-brand-700 disabled:opacity-60">
            {pending ? 'Saving…' : 'Save the marks'}
          </button>
          <button type="button" disabled={pending} onClick={() => setOpen(false)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-[13.5px] font-semibold">
            Close
          </button>
          {done ? <span className="text-[12.5px] text-emerald-800">{done}</span> : null}
        </div>
      </div>
    </section>
  );
}
